import "server-only";
import { prisma } from "@/lib/db";
import { logger, sanitizeErrorMessage } from "@/lib/logger";
import { buildScopeEvaluationInput } from "@/lib/ai/input";
import { getAiProvider } from "@/lib/ai/provider";
import { getAiSettings } from "@/lib/ai/settings";
import { PROMPT_VERSION, normalizeTags, scopeEvaluationOutputSchema } from "@/lib/ai/types";
import { calculateOpportunityScore, clampConfidence, clampScore } from "@/lib/scoring/opportunity";
import { dedupeKeys, enqueueJob } from "@/lib/jobs/queue";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

/**
 * AI evaluation orchestration.
 *
 * Cost control (§21) is enforced here, not in the provider:
 *   - the canonical input is hashed;
 *   - if a COMPLETED evaluation exists with the same hash, it is reused and no
 *     model call is made;
 *   - when relevant context changes, previous evaluations become STALE and a
 *     new PENDING row is queued.
 *
 * Language policy: the output language is part of the input hash and is stored
 * on the evaluation row. Changing the UI language therefore does NOT re-run
 * every historical evaluation — existing results keep displaying in the
 * language they were written in, with a note offering re-evaluation. This is
 * Option A from the specification, chosen to avoid a large unprompted model
 * bill the moment somebody switches language.
 *
 * The language for a given evaluation is fixed when it is queued (from the
 * triggering user's locale), so a background worker picking the job up later
 * still produces the language that was asked for.
 */

export interface EnqueueResult {
  enqueued: boolean;
  reason: "QUEUED" | "REUSED" | "ALREADY_PENDING" | "DISABLED" | "SCOPE_MISSING";
  evaluationId?: string;
}

export interface EnqueueOptions {
  force?: boolean;
  priority?: number;
  /** Language the human-readable output should be written in. */
  language?: Locale;
}

/**
 * Queues an evaluation for a scope unless an identical one already exists.
 * Never throws into the sync path - a failure here must not fail a sync.
 */
export async function enqueueScopeEvaluation(
  scopeId: string,
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const settings = await getAiSettings();

  if (!settings.enabled || !settings.scopeEvaluationEnabled) {
    return { enqueued: false, reason: "DISABLED" };
  }

  const language = options.language ?? DEFAULT_LOCALE;

  const built = await buildScopeEvaluationInput(scopeId, language);
  if (!built) return { enqueued: false, reason: "SCOPE_MISSING" };

  const { inputHash } = built;

  if (!options.force) {
    const reusable = await prisma.scopeAiEvaluation.findFirst({
      where: { scopeId, inputHash, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    });

    if (reusable) {
      logger.debug("ai evaluation reused", { scopeId, inputHash, evaluationId: reusable.id });
      return { enqueued: false, reason: "REUSED", evaluationId: reusable.id };
    }

    const pending = await prisma.scopeAiEvaluation.findFirst({
      where: { scopeId, inputHash, status: { in: ["PENDING", "PROCESSING"] } },
    });

    if (pending) {
      return { enqueued: false, reason: "ALREADY_PENDING", evaluationId: pending.id };
    }
  }

  // Anything still marked current for this scope is now out of date.
  await markStale(scopeId, inputHash);

  const provider = await getAiProvider();

  const evaluation = await prisma.scopeAiEvaluation.create({
    data: {
      scopeId,
      status: "PENDING",
      aiProvider: provider.name,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      evaluationSource: provider.source,
      language,
      inputHash,
    },
  });

  await enqueueJob({
    type: "EVALUATE_SCOPE",
    dedupeKey: dedupeKeys.evaluateScope(scopeId, inputHash),
    payload: { scopeId, evaluationId: evaluation.id, language },
    priority: options.priority ?? 100,
  });

  return { enqueued: true, reason: "QUEUED", evaluationId: evaluation.id };
}

/**
 * Marks previous COMPLETED/PENDING evaluations for a scope as STALE, except
 * any that already match the incoming input hash.
 */
export async function markStale(scopeId: string, exceptInputHash?: string): Promise<number> {
  const result = await prisma.scopeAiEvaluation.updateMany({
    where: {
      scopeId,
      status: { in: ["COMPLETED", "PENDING"] },
      ...(exceptInputHash ? { inputHash: { not: exceptInputHash } } : {}),
    },
    data: { status: "STALE" },
  });
  return result.count;
}

/**
 * Runs one queued evaluation to completion.
 *
 * Returns true on success. AI failures are recorded on the evaluation row and
 * reported to the caller; they never propagate into a provider sync.
 */
export async function runScopeEvaluation(evaluationId: string): Promise<boolean> {
  const evaluation = await prisma.scopeAiEvaluation.findUnique({ where: { id: evaluationId } });
  if (!evaluation) {
    logger.warn("evaluation row disappeared before processing", { evaluationId });
    return false;
  }

  if (evaluation.status === "COMPLETED") return true;
  if (evaluation.status === "STALE") {
    logger.debug("skipping stale evaluation", { evaluationId });
    return true;
  }

  const language = (evaluation.language as Locale) ?? DEFAULT_LOCALE;
  const built = await buildScopeEvaluationInput(evaluation.scopeId, language);

  if (!built) {
    await prisma.scopeAiEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: "FAILED",
        errorCode: "SCOPE_MISSING",
        errorSummary: "The scope no longer exists.",
      },
    });
    return false;
  }

  // The scope may have changed between queueing and processing.
  if (built.inputHash !== evaluation.inputHash) {
    await prisma.scopeAiEvaluation.update({
      where: { id: evaluationId },
      data: { status: "STALE" },
    });
    logger.info("evaluation input changed before processing; marked stale", {
      evaluationId,
      scopeId: evaluation.scopeId,
    });
    await enqueueScopeEvaluation(evaluation.scopeId, { language });
    return true;
  }

  await prisma.scopeAiEvaluation.update({
    where: { id: evaluationId },
    data: { status: "PROCESSING" },
  });

  const log = logger.child({ aiEvaluationId: evaluationId, scopeId: evaluation.scopeId });

  try {
    const provider = await getAiProvider();
    const result = await provider.evaluateScope(built.input);

    // Defence in depth: the provider already validates, but output that
    // reaches the database is validated again here.
    const parsed = scopeEvaluationOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`AI output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    }

    const output = parsed.data;

    const dimensions = {
      businessValue: clampScore(output.businessValueScore),
      attackSurface: clampScore(output.attackSurfaceScore),
      freshness: clampScore(output.freshnessScore),
      researchPotential: clampScore(output.researchPotentialScore),
      complexity: clampScore(output.complexityScore),
      policyFit: clampScore(output.policyFitScore),
      duplicateRisk: clampScore(output.duplicateRiskScore),
    };

    // The final score is computed here - never taken from the model.
    const opportunityScore = calculateOpportunityScore(dimensions);

    await prisma.scopeAiEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: "COMPLETED",
        aiProvider: result.providerName,
        model: result.model,
        // Recorded from the provider that actually ran, so a fallback to the
        // rule engine is always visible as HEURISTIC rather than AI_MODEL.
        evaluationSource: result.source,
        language,
        businessValueScore: dimensions.businessValue,
        attackSurfaceScore: dimensions.attackSurface,
        freshnessScore: dimensions.freshness,
        researchPotentialScore: dimensions.researchPotential,
        complexityScore: dimensions.complexity,
        policyFitScore: dimensions.policyFit,
        duplicateRiskScore: dimensions.duplicateRisk,
        opportunityScore,
        confidence: clampConfidence(output.confidence),
        summary: output.summary,
        reasoningSummary: output.reasoningSummary,
        tags: JSON.stringify(normalizeTags(output.tags)),
        suggestedResearchAreas: JSON.stringify(output.suggestedResearchAreas.slice(0, 8)),
        warnings: JSON.stringify(output.warnings.slice(0, 6)),
        latencyMs: result.usage.latencyMs,
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        evaluatedAt: new Date(),
        errorCode: null,
        errorSummary: null,
      },
    });

    log.info("ai evaluation completed", {
      opportunityScore,
      aiProvider: result.providerName,
      evaluationSource: result.source,
      language,
      latencyMs: result.usage.latencyMs,
    });

    return true;
  } catch (error) {
    const summary = sanitizeErrorMessage(error, 300);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "AI_ERROR";

    await prisma.scopeAiEvaluation.update({
      where: { id: evaluationId },
      data: { status: "FAILED", errorCode: code, errorSummary: summary },
    });

    log.error("ai evaluation failed", { code, error: summary });
    return false;
  }
}

/** The current evaluation for a scope: COMPLETED if one exists, else the latest. */
export async function currentEvaluation(scopeId: string) {
  const completed = await prisma.scopeAiEvaluation.findFirst({
    where: { scopeId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  if (completed) return completed;

  return prisma.scopeAiEvaluation.findFirst({
    where: { scopeId },
    orderBy: { createdAt: "desc" },
  });
}
