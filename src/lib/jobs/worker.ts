import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { logger, sanitizeErrorMessage } from "@/lib/logger";
import { getAiSettings } from "@/lib/ai/settings";
import { claimNextJob, completeJob, failJob, reclaimStalledJobs } from "@/lib/jobs/queue";
import { runScopeEvaluation } from "@/lib/ai/evaluate";
import { getAiProvider } from "@/lib/ai/provider";
import { AiUnavailableError } from "@/lib/ai/types";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";

/**
 * Job handlers and the drain loop.
 *
 * The worker can run standalone (`npm run worker`) or be drained on demand
 * from an authenticated API route, which keeps the platform usable without a
 * second process during local development.
 */

async function handleEvaluateScope(payload: Record<string, unknown>): Promise<void> {
  const evaluationId = typeof payload.evaluationId === "string" ? payload.evaluationId : null;
  if (!evaluationId) throw new Error("EVALUATE_SCOPE payload is missing evaluationId.");

  const succeeded = await runScopeEvaluation(evaluationId);
  if (!succeeded) {
    // runScopeEvaluation already recorded the failure on the evaluation row.
    throw new Error("Scope evaluation did not complete.");
  }
}

async function handleAnalyzeChange(payload: Record<string, unknown>): Promise<void> {
  const changeEventId = typeof payload.changeEventId === "string" ? payload.changeEventId : null;
  if (!changeEventId) throw new Error("ANALYZE_CHANGE payload is missing changeEventId.");

  const change = await prisma.changeEvent.findUnique({
    where: { id: changeEventId },
    include: {
      scope: true,
      program: true,
      provider: true,
    },
  });

  if (!change) return; // the change was deleted; nothing to do

  const language = typeof payload.language === "string" ? payload.language : DEFAULT_LOCALE;

  const provider = await getAiProvider();
  const result = await provider.analyzeChange({
    outputLanguage: language === "vi" ? "vi" : "en",
    programName: change.program?.name ?? "Unknown program",
    provider: change.provider.slug,
    assetIdentifier: change.scope?.assetIdentifier ?? null,
    assetType: change.scope?.assetType ?? null,
    changeType: change.changeType,
    fieldName: change.fieldName,
    oldValue: change.oldValue,
    newValue: change.newValue,
    eligibleForBounty: change.scope?.eligibleForBounty ?? null,
    maxSeverity: change.scope?.maxSeverity ?? null,
    bountyMax: change.program?.bountyMax ?? null,
  });

  await prisma.changeEvent.update({
    where: { id: changeEventId },
    data: {
      aiSummary: result.output.summary,
      importance: result.output.importance,
      aiAnalysed: true,
    },
  });
}

async function handleSummarizePolicy(payload: Record<string, unknown>): Promise<void> {
  const programId = typeof payload.programId === "string" ? payload.programId : null;
  if (!programId) throw new Error("SUMMARIZE_POLICY payload is missing programId.");

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { provider: true },
  });

  if (!program?.policy) return;

  const language = typeof payload.language === "string" ? payload.language : DEFAULT_LOCALE;

  const provider = await getAiProvider();
  const result = await provider.summarizePolicy({
    outputLanguage: language === "vi" ? "vi" : "en",
    programName: program.name,
    provider: program.provider.slug,
    policy: program.policy,
  });

  // Policy summaries are advisory context only; the authoritative policy text
  // stays untouched.
  logger.info("policy summarised", {
    programId,
    restrictions: result.output.keyRestrictions.length,
    safeHarbor: result.output.safeHarborAssessment,
  });
}

export async function processJob(job: {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const log = logger.child({ jobId: job.id, jobType: job.type });
  const startedAt = Date.now();

  try {
    switch (job.type) {
      case "EVALUATE_SCOPE":
        await handleEvaluateScope(job.payload);
        break;
      case "ANALYZE_CHANGE":
        await handleAnalyzeChange(job.payload);
        break;
      case "SUMMARIZE_POLICY":
        await handleSummarizePolicy(job.payload);
        break;
      default:
        await failJob(job.id, "UNKNOWN_JOB_TYPE", `No handler for job type "${job.type}".`, false);
        return false;
    }

    await completeJob(job.id);
    log.info("job completed", { durationMs: Date.now() - startedAt });
    return true;
  } catch (error) {
    const summary = sanitizeErrorMessage(error, 300);

    // A missing API key or a hard auth failure will not fix itself on retry.
    const retryable = !(
      error instanceof AiUnavailableError &&
      ["NO_API_KEY", "AI_AUTH_ERROR", "MODEL_REFUSAL"].includes(error.code)
    );

    const code =
      error instanceof AiUnavailableError ? error.code : "JOB_ERROR";

    await failJob(job.id, code, summary, retryable);
    log.warn("job failed", { code, retryable, error: summary, durationMs: Date.now() - startedAt });
    return false;
  }
}

/**
 * Drains up to `limit` jobs. Returns how many were processed.
 * Used by both the standalone worker and the on-demand drain endpoint.
 */
export async function drainJobs(limit = 25, workerId: string = randomUUID()): Promise<number> {
  const settings = await getAiSettings().catch(() => null);
  if (settings && !settings.enabled) return 0;

  await reclaimStalledJobs();

  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    await processJob(job);
    processed += 1;
  }

  return processed;
}
