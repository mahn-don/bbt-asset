import "server-only";
import { prisma } from "@/lib/db";
import { contentHash } from "@/lib/canonical/hash";
import type { ScopeEvaluationInput } from "@/lib/ai/types";
import { PROMPT_VERSION } from "@/lib/ai/types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

/**
 * Builds the canonical AI evaluation input for a scope, plus its input hash.
 *
 * The hash is the cost-control primitive: if a scope's evaluation-relevant
 * context has not changed, the hash is identical and the existing COMPLETED
 * evaluation is reused instead of paying for another model call.
 *
 * For that to hold, the input must contain no values that drift on their own.
 * `ageDays` and `daysSinceLastChange` would change every day and are therefore
 * bucketed rather than exact, so a scope does not silently re-evaluate itself
 * once per day forever.
 */

const POLICY_EXCERPT_LIMIT = 6000;
const RECENT_CHANGE_LIMIT = 10;

/**
 * Buckets a day count into a stable band. Two scopes 31 and 44 days old share
 * a bucket, so the input hash does not churn daily.
 */
function bucketDays(days: number | null): number | null {
  if (days === null) return null;
  if (days <= 1) return 1;
  if (days <= 7) return 7;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  if (days <= 90) return 90;
  if (days <= 180) return 180;
  if (days <= 365) return 365;
  return 999;
}

function daysBetween(from: Date | null, to: Date): number | null {
  if (!from) return null;
  const diff = to.getTime() - from.getTime();
  return diff < 0 ? 0 : Math.floor(diff / (24 * 60 * 60 * 1000));
}

export interface BuiltEvaluationInput {
  input: ScopeEvaluationInput;
  inputHash: string;
}

export async function buildScopeEvaluationInput(
  scopeId: string,
  outputLanguage: Locale = DEFAULT_LOCALE,
): Promise<BuiltEvaluationInput | null> {
  const scope = await prisma.scope.findUnique({
    where: { id: scopeId },
    include: {
      program: { include: { provider: true } },
      changeEvents: {
        orderBy: { detectedAt: "desc" },
        take: RECENT_CHANGE_LIMIT,
      },
      researchSessions: { select: { id: true, startedAt: true } },
      findings: { select: { id: true, status: true } },
    },
  });

  if (!scope) return null;

  const now = new Date();
  const lastChange = scope.changeEvents[0]?.detectedAt ?? null;

  const findingCount = scope.findings.length;
  const sessionCount = scope.researchSessions.length;

  // Only report research history when the platform actually holds some; an
  // all-zero object would read to the model as "confirmed untouched".
  const researchHistory =
    sessionCount > 0 || findingCount > 0
      ? {
          sessionCount,
          findingCount,
          acceptedCount: scope.findings.filter((finding) => finding.status === "ACCEPTED").length,
          duplicateCount: scope.findings.filter((finding) => finding.status === "DUPLICATE").length,
          lastResearchedAt:
            scope.researchSessions
              .map((session) => session.startedAt)
              .sort((a, b) => b.getTime() - a.getTime())[0]
              ?.toISOString() ?? null,
        }
      : null;

  const latestCompleted = await prisma.scopeAiEvaluation.findFirst({
    where: { scopeId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { tags: true },
  });

  let existingTags: string[] = [];
  if (latestCompleted?.tags) {
    try {
      const parsed: unknown = JSON.parse(latestCompleted.tags);
      if (Array.isArray(parsed)) existingTags = parsed.filter((tag): tag is string => typeof tag === "string");
    } catch {
      existingTags = [];
    }
  }

  const input: ScopeEvaluationInput = {
    outputLanguage,
    program: {
      name: scope.program.name,
      provider: scope.program.provider.slug,
      status: scope.program.status,
      visibility: scope.program.visibility,
      bountyMin: scope.program.bountyMin,
      bountyMax: scope.program.bountyMax,
      currency: scope.program.currency,
      safeHarbor: scope.program.safeHarbor,
      policyExcerpt: scope.program.policy ? scope.program.policy.slice(0, POLICY_EXCERPT_LIMIT) : null,
    },
    scope: {
      assetIdentifier: scope.assetIdentifier,
      assetType: scope.assetType,
      scopeStatus: scope.scopeStatus,
      eligibleForBounty: scope.eligibleForBounty,
      eligibleForSubmission: scope.eligibleForSubmission,
      maxSeverity: scope.maxSeverity,
      instruction: scope.instruction,
      firstSeenAt: scope.firstSeenAt.toISOString(),
      sourceUpdatedAt: scope.sourceUpdatedAt?.toISOString() ?? null,
      ageDays: bucketDays(daysBetween(scope.firstSeenAt, now)),
      daysSinceLastChange: bucketDays(daysBetween(lastChange, now)),
    },
    recentChanges: scope.changeEvents.map((change) => ({
      changeType: change.changeType,
      fieldName: change.fieldName,
      detectedAt: change.detectedAt.toISOString(),
      importance: change.importance,
    })),
    researchHistory,
    existingTags,
  };

  return { input, inputHash: hashEvaluationInput(input) };
}

/**
 * Hashes the evaluation input.
 *
 * Two exclusions matter:
 *
 *  - `detectedAt` timestamps on recent changes. The *set* of recent changes is
 *    meaningful; their exact instants are not, and including them would defeat
 *    reuse entirely.
 *
 *  - `existingTags`. Those tags come from the previous evaluation's own
 *    output, so hashing them makes the input self-referential: completing an
 *    evaluation would change the very hash that decides whether it can be
 *    reused, guaranteeing a redundant second model call for every scope (and
 *    potentially an oscillation between two tag sets). They are still sent to
 *    the model as context - they just do not participate in cache identity.
 *
 * The prompt version is included, so changing the prompt correctly invalidates
 * every cached evaluation.
 */
export function hashEvaluationInput(input: ScopeEvaluationInput): string {
  return contentHash({
    promptVersion: PROMPT_VERSION,
    // Language is part of cache identity: an English evaluation cannot be
    // reused to satisfy a Vietnamese request, and vice versa.
    outputLanguage: input.outputLanguage,
    program: input.program,
    scope: input.scope,
    recentChanges: input.recentChanges.map((change) => ({
      changeType: change.changeType,
      fieldName: change.fieldName,
      importance: change.importance,
    })),
    researchHistory: input.researchHistory,
  });
}
