import "server-only";
import { prisma } from "@/lib/db";
import { SEVERITY_RANK, type AssetType, type Severity } from "@/lib/enums";
import type { Prisma } from "@/generated/prisma";

/**
 * AI Supporter — the narrow tip of the prioritisation funnel.
 *
 * The design principle (see the product notes): AI is expensive and slow, so it
 * must never be pointed at the whole inventory. Deterministic filters do the
 * bulk reduction for free (48k scopes → ~7k eligible), and the model only
 * reasons over a bounded, value-prioritised slice of the survivors. This module
 * provides the funnel counts, the ranked recommendations (completed
 * evaluations over eligible in-scope scope), and the candidate selection that
 * the on-demand generator evaluates.
 */

/** Only eligible, in-scope, provider-current scope can ever be a recommendation. */
const ELIGIBLE_WHERE: Prisma.ScopeWhereInput = {
  scopeStatus: "IN_SCOPE",
  eligibleForSubmission: true,
  eligibleForBounty: true,
};

/**
 * Asset classes worth model attention, in priority order. URLs and OTHER are
 * deliberately down-weighted: they are the bulk of the inventory but the least
 * differentiated, so they are not part of the default "focus".
 */
export const FOCUS_ASSET_TYPES: AssetType[] = ["API", "WILDCARD", "REPOSITORY", "ANDROID", "IOS"];

export interface FunnelStats {
  total: number;
  inScope: number;
  eligible: number;
  highSeverity: number;
  evaluated: number;
  recommended: number;
  candidatePool: number;
}

/**
 * The deterministic funnel. Every number is a plain count — no AI, instant,
 * free. This is what makes the model spend tractable.
 */
export async function getFunnelStats(): Promise<FunnelStats> {
  const [total, inScope, eligible, highSeverity, evaluatedScopes, recommendedScopes] =
    await Promise.all([
      prisma.scope.count(),
      prisma.scope.count({ where: { scopeStatus: "IN_SCOPE" } }),
      prisma.scope.count({ where: ELIGIBLE_WHERE }),
      prisma.scope.count({
        where: { ...ELIGIBLE_WHERE, maxSeverity: { in: ["HIGH", "CRITICAL"] } },
      }),
      prisma.scope.count({
        where: { ...ELIGIBLE_WHERE, aiEvaluations: { some: { status: "COMPLETED" } } },
      }),
      prisma.scope.count({
        where: {
          ...ELIGIBLE_WHERE,
          aiEvaluations: { some: { status: "COMPLETED", opportunityScore: { gte: 70 } } },
        },
      }),
    ]);

  return {
    total,
    inScope,
    eligible,
    highSeverity,
    evaluated: evaluatedScopes,
    recommended: recommendedScopes,
    candidatePool: eligible - evaluatedScopes,
  };
}

export interface Recommendation {
  scopeId: string;
  assetIdentifier: string;
  assetType: string;
  programName: string;
  programId: string;
  provider: string;
  opportunityScore: number;
  confidence: number | null;
  evaluationSource: string;
  model: string;
  summary: string | null;
  tags: string[];
  maxSeverity: string | null;
  eligibleForBounty: boolean;
}

export interface RecommendationQuery {
  focus?: AssetType[];
  provider?: string[];
  limit?: number;
}

/**
 * The ranked shortlist: the current completed evaluation for each eligible
 * in-scope scope, highest Opportunity Score first, one row per scope.
 *
 * Bounded by design — it reads evaluation rows (already few relative to the
 * inventory), not the whole scope table, so it never hits the parameter-limit
 * problem the assets list had to solve.
 */
export async function getRecommendations(query: RecommendationQuery = {}): Promise<Recommendation[]> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);

  const scopeWhere: Prisma.ScopeWhereInput = { ...ELIGIBLE_WHERE };
  if (query.focus?.length) scopeWhere.assetType = { in: query.focus };
  if (query.provider?.length) scopeWhere.program = { provider: { slug: { in: query.provider } } };

  const evaluations = await prisma.scopeAiEvaluation.findMany({
    where: {
      status: "COMPLETED",
      opportunityScore: { not: null },
      scope: scopeWhere,
    },
    orderBy: [{ opportunityScore: "desc" }, { createdAt: "desc" }],
    // Over-fetch so superseded evaluations for the same scope can be dropped.
    take: limit * 8,
    include: {
      scope: { include: { program: { include: { provider: true } } } },
    },
  });

  const seen = new Set<string>();
  const out: Recommendation[] = [];

  for (const evaluation of evaluations) {
    if (seen.has(evaluation.scopeId)) continue;
    seen.add(evaluation.scopeId);

    let tags: string[] = [];
    if (evaluation.tags) {
      try {
        const parsed: unknown = JSON.parse(evaluation.tags);
        if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === "string");
      } catch {
        tags = [];
      }
    }

    out.push({
      scopeId: evaluation.scopeId,
      assetIdentifier: evaluation.scope.assetIdentifier,
      assetType: evaluation.scope.assetType,
      programName: evaluation.scope.program.name,
      programId: evaluation.scope.programId,
      provider: evaluation.scope.program.provider.slug,
      opportunityScore: evaluation.opportunityScore ?? 0,
      confidence: evaluation.confidence,
      evaluationSource: evaluation.evaluationSource,
      model: evaluation.model,
      summary: evaluation.summary,
      tags,
      maxSeverity: evaluation.scope.maxSeverity,
      eligibleForBounty: evaluation.scope.eligibleForBounty,
    });

    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Selects the next batch of eligible scopes worth spending a model call on.
 *
 * Deterministic pre-rank so AI spend goes to the highest-value un-evaluated
 * scope first: eligible + in-scope, not yet evaluated, matching the chosen
 * focus, ordered by severity ceiling then recency. Bounded fetch + in-memory
 * sort keeps it safe at any inventory size.
 */
export async function selectCandidates(focus: AssetType[], limit: number): Promise<string[]> {
  const where: Prisma.ScopeWhereInput = {
    ...ELIGIBLE_WHERE,
    // Candidate = eligible scope with no COMPLETED evaluation yet. A pending
    // evaluation (queued by a sync but never processed, because no worker ran)
    // still counts as a candidate — the generator's job is to turn those into
    // completed recommendations.
    aiEvaluations: { none: { status: "COMPLETED" } },
  };
  if (focus.length) where.assetType = { in: focus };

  const candidates = await prisma.scope.findMany({
    where,
    take: Math.max(limit * 20, 200),
    select: { id: true, maxSeverity: true, firstSeenAt: true },
  });

  const severityRank = (value: string | null): number =>
    value ? (SEVERITY_RANK[value as Severity] ?? -1) : -1;

  candidates.sort((a, b) => {
    const bySev = severityRank(b.maxSeverity) - severityRank(a.maxSeverity);
    if (bySev !== 0) return bySev;
    return b.firstSeenAt.getTime() - a.firstSeenAt.getTime();
  });

  return candidates.slice(0, limit).map((scope) => scope.id);
}
