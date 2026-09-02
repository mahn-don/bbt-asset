import "server-only";
import { prisma } from "@/lib/db";
import type { AssetsQuery } from "@/lib/api/schemas";
import { SEVERITY_RANK, type Severity } from "@/lib/enums";
import type { Prisma } from "@/generated/prisma";

/**
 * Asset (scope) queries.
 *
 * The list endpoint joins each scope to its *current* AI evaluation. A scope
 * with no completed evaluation has a null score - it is never coerced to 0,
 * because "not evaluated" and "scored zero" mean very different things to a
 * researcher deciding what to work on.
 */

export interface AssetListItem {
  id: string;
  assetIdentifier: string;
  assetType: string;
  scopeStatus: string;
  eligibleForBounty: boolean;
  eligibleForSubmission: boolean;
  maxSeverity: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  removedAt: Date | null;
  reviewedAt: Date | null;
  program: { id: string; name: string; handleOrSlug: string };
  provider: string;
  /** null when no completed evaluation exists. */
  opportunityScore: number | null;
  confidence: number | null;
  aiStatus: string | null;
  tags: string[];
  lastChangedAt: Date | null;
  researchSessionCount: number;
  isNew: boolean;
  isChanged: boolean;
}

export interface AssetListResult {
  items: AssetListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** How many matching scopes have no completed evaluation. */
  unevaluatedCount: number;
}

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CHANGED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function buildWhere(query: AssetsQuery): Prisma.ScopeWhereInput {
  const where: Prisma.ScopeWhereInput = {};
  const and: Prisma.ScopeWhereInput[] = [];

  if (query.search) {
    and.push({ assetIdentifier: { contains: query.search } });
  }

  if (query.provider?.length) {
    and.push({ program: { provider: { slug: { in: query.provider } } } });
  }

  if (query.programId) and.push({ programId: query.programId });
  if (query.assetType?.length) and.push({ assetType: { in: query.assetType } });

  if (query.scopeStatus?.length) {
    and.push({ scopeStatus: { in: query.scopeStatus } });
  } else {
    // Default view: authorized, active scope only.
    and.push({ scopeStatus: "IN_SCOPE" });
  }

  if (query.maxSeverity?.length) and.push({ maxSeverity: { in: query.maxSeverity } });
  if (query.bountyEligible !== undefined) and.push({ eligibleForBounty: query.bountyEligible });

  if (query.isNew) {
    and.push({ firstSeenAt: { gte: new Date(Date.now() - NEW_WINDOW_MS) } });
  }

  if (query.recentlyChanged) {
    and.push({
      changeEvents: { some: { detectedAt: { gte: new Date(Date.now() - CHANGED_WINDOW_MS) } } },
    });
  }

  if (query.notEvaluated) {
    and.push({ aiEvaluations: { none: { status: "COMPLETED" } } });
  }

  if (query.notReviewed) and.push({ reviewedAt: null });

  if (and.length > 0) where.AND = and;
  return where;
}

/** Largest working set reduced in memory. See the note in `listAssets`. */
const CANDIDATE_CAP = 5000;

/**
 * Batch size for `IN (…)` relation loads.
 *
 * Kept well under SQLite's bound-parameter limit (historically 999). Loading
 * relations for the whole candidate set in one `IN` clause — which is what a
 * Prisma `include` does — overflows that limit once the set is large enough and
 * crashes the query, so every relation here is loaded in bounded chunks.
 */
const RELATION_CHUNK = 400;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function listAssets(query: AssetsQuery): Promise<AssetListResult> {
  const where = buildWhere(query);

  // Score, tag and sort filters depend on the *current* evaluation, which is
  // one row per scope selected by recency. That is not expressible as a plain
  // Prisma filter, so the candidate set is reduced in memory. The where-clause
  // keeps that set bounded; relations are then loaded in chunks (never a single
  // giant `IN`, which would exceed SQLite's parameter limit).
  const candidates = await prisma.scope.findMany({
    where,
    take: CANDIDATE_CAP,
    select: {
      id: true,
      assetIdentifier: true,
      assetType: true,
      scopeStatus: true,
      eligibleForBounty: true,
      eligibleForSubmission: true,
      maxSeverity: true,
      firstSeenAt: true,
      lastSeenAt: true,
      removedAt: true,
      reviewedAt: true,
      programId: true,
    },
  });

  const scopeIds = candidates.map((scope) => scope.id);
  const programIds = [...new Set(candidates.map((scope) => scope.programId))];

  // Programs (few, distinct) — one lookup per chunk.
  const programs = new Map<string, { id: string; name: string; handleOrSlug: string; provider: string }>();
  for (const batch of chunk(programIds, RELATION_CHUNK)) {
    const rows = await prisma.program.findMany({
      where: { id: { in: batch } },
      select: { id: true, name: true, handleOrSlug: true, provider: { select: { slug: true } } },
    });
    for (const row of rows) {
      programs.set(row.id, {
        id: row.id,
        name: row.name,
        handleOrSlug: row.handleOrSlug,
        provider: row.provider.slug,
      });
    }
  }

  // Current completed evaluation per scope (newest wins).
  const currentEval = new Map<
    string,
    { opportunityScore: number | null; confidence: number | null; status: string; tags: string | null }
  >();
  for (const batch of chunk(scopeIds, RELATION_CHUNK)) {
    const rows = await prisma.scopeAiEvaluation.findMany({
      where: { scopeId: { in: batch }, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: { scopeId: true, opportunityScore: true, confidence: true, status: true, tags: true },
    });
    for (const row of rows) {
      if (!currentEval.has(row.scopeId)) currentEval.set(row.scopeId, row);
    }
  }

  // Latest change and research-session count per scope, via grouped aggregates
  // so each returns one row per scope rather than every child row.
  const lastChange = new Map<string, Date>();
  const sessionCount = new Map<string, number>();
  for (const batch of chunk(scopeIds, RELATION_CHUNK)) {
    const [changes, sessions] = await Promise.all([
      prisma.changeEvent.groupBy({
        by: ["scopeId"],
        where: { scopeId: { in: batch } },
        _max: { detectedAt: true },
      }),
      prisma.researchSession.groupBy({
        by: ["scopeId"],
        where: { scopeId: { in: batch } },
        _count: { _all: true },
      }),
    ]);
    for (const row of changes) {
      if (row.scopeId && row._max.detectedAt) lastChange.set(row.scopeId, row._max.detectedAt);
    }
    for (const row of sessions) {
      if (row.scopeId) sessionCount.set(row.scopeId, row._count._all);
    }
  }

  const now = Date.now();

  let items: AssetListItem[] = candidates.map((scope) => {
    const evaluation = currentEval.get(scope.id) ?? null;
    let tags: string[] = [];
    if (evaluation?.tags) {
      try {
        const parsed: unknown = JSON.parse(evaluation.tags);
        if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
      } catch {
        tags = [];
      }
    }

    const lastChangedAt = lastChange.get(scope.id) ?? null;
    const program = programs.get(scope.programId);

    return {
      id: scope.id,
      assetIdentifier: scope.assetIdentifier,
      assetType: scope.assetType,
      scopeStatus: scope.scopeStatus,
      eligibleForBounty: scope.eligibleForBounty,
      eligibleForSubmission: scope.eligibleForSubmission,
      maxSeverity: scope.maxSeverity,
      firstSeenAt: scope.firstSeenAt,
      lastSeenAt: scope.lastSeenAt,
      removedAt: scope.removedAt,
      reviewedAt: scope.reviewedAt,
      program: {
        id: program?.id ?? scope.programId,
        name: program?.name ?? "—",
        handleOrSlug: program?.handleOrSlug ?? "",
      },
      provider: program?.provider ?? "—",
      opportunityScore: evaluation?.opportunityScore ?? null,
      confidence: evaluation?.confidence ?? null,
      aiStatus: evaluation?.status ?? null,
      tags,
      lastChangedAt,
      researchSessionCount: sessionCount.get(scope.id) ?? 0,
      isNew: now - scope.firstSeenAt.getTime() <= NEW_WINDOW_MS,
      isChanged: lastChangedAt !== null && now - lastChangedAt.getTime() <= CHANGED_WINDOW_MS,
    };
  });

  // --- Post-filters that depend on the current evaluation ----------------
  if (query.minScore !== undefined) {
    items = items.filter((item) => item.opportunityScore !== null && item.opportunityScore >= query.minScore!);
  }
  if (query.maxScore !== undefined) {
    items = items.filter((item) => item.opportunityScore !== null && item.opportunityScore <= query.maxScore!);
  }
  if (query.tags?.length) {
    const wanted = query.tags.map((tag) => tag.toLowerCase());
    items = items.filter((item) => wanted.every((tag) => item.tags.includes(tag)));
  }

  const unevaluatedCount = items.filter((item) => item.opportunityScore === null).length;

  // --- Sorting ------------------------------------------------------------
  // Unevaluated assets always sort last rather than being treated as score 0.
  const nullsLast = (a: number | null, b: number | null, compare: (x: number, y: number) => number) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return compare(a, b);
  };

  switch (query.sort) {
    case "opportunity":
      items.sort((a, b) => nullsLast(a.opportunityScore, b.opportunityScore, (x, y) => y - x));
      break;
    case "newest":
      items.sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime());
      break;
    case "recentlyChanged":
      items.sort((a, b) =>
        nullsLast(
          a.lastChangedAt?.getTime() ?? null,
          b.lastChangedAt?.getTime() ?? null,
          (x, y) => y - x,
        ),
      );
      break;
    case "severity":
      items.sort((a, b) => {
        const rankA = a.maxSeverity ? SEVERITY_RANK[a.maxSeverity as Severity] ?? -1 : -1;
        const rankB = b.maxSeverity ? SEVERITY_RANK[b.maxSeverity as Severity] ?? -1 : -1;
        return rankB - rankA;
      });
      break;
    case "leastReviewed":
      items.sort((a, b) => {
        if (a.researchSessionCount !== b.researchSessionCount) {
          return a.researchSessionCount - b.researchSessionCount;
        }
        return nullsLast(a.opportunityScore, b.opportunityScore, (x, y) => y - x);
      });
      break;
  }

  const total = items.length;
  const start = (query.page - 1) * query.pageSize;

  return {
    items: items.slice(start, start + query.pageSize),
    total,
    page: query.page,
    pageSize: query.pageSize,
    unevaluatedCount,
  };
}

export async function getAssetDetail(scopeId: string) {
  return prisma.scope.findUnique({
    where: { id: scopeId },
    include: {
      program: { include: { provider: true } },
      aiEvaluations: { orderBy: { createdAt: "desc" }, take: 20 },
      versions: { orderBy: { version: "desc" }, take: 50 },
      changeEvents: { orderBy: { detectedAt: "desc" }, take: 100 },
      researchSessions: { orderBy: { startedAt: "desc" }, take: 20 },
      findings: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

/** Distinct tags across current evaluations, for the filter UI. */
export async function listKnownTags(limit = 40): Promise<string[]> {
  const evaluations = await prisma.scopeAiEvaluation.findMany({
    where: { status: "COMPLETED", tags: { not: null } },
    select: { tags: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const counts = new Map<string, number>();
  for (const evaluation of evaluations) {
    if (!evaluation.tags) continue;
    try {
      const parsed: unknown = JSON.parse(evaluation.tags);
      if (!Array.isArray(parsed)) continue;
      for (const tag of parsed) {
        if (typeof tag !== "string") continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    } catch {
      continue;
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}
