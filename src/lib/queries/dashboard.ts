import "server-only";
import { prisma } from "@/lib/db";

/**
 * Dashboard queries.
 *
 * Every number here is a real aggregate over stored rows. Metrics that depend
 * on features with no data yet (findings, payouts) report `available: false`
 * so the UI can omit the card entirely rather than display a fabricated zero.
 */

export interface DashboardMetrics {
  programs: number;
  activeScopes: number;
  newAssets7d: number;
  changesToday: number;
  highOpportunityAssets: number;
  pendingAiEvaluations: number;
  findings: { available: boolean; count: number };
  totalPayout: { available: boolean; amount: number; currency: string | null };
}

export interface OpportunityItem {
  scopeId: string;
  assetIdentifier: string;
  assetType: string;
  programName: string;
  programId: string;
  provider: string;
  opportunityScore: number;
  confidence: number | null;
  tags: string[];
  summary: string | null;
  eligibleForBounty: boolean;
  maxSeverity: string | null;
  isNew: boolean;
  isChanged: boolean;
  lastChangedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);

  const [
    programs,
    activeScopes,
    newAssets7d,
    changesToday,
    pendingAiEvaluations,
    findingCount,
    payouts,
  ] = await Promise.all([
    prisma.program.count(),
    prisma.scope.count({ where: { scopeStatus: "IN_SCOPE" } }),
    prisma.scope.count({ where: { firstSeenAt: { gte: sevenDaysAgo } } }),
    prisma.changeEvent.count({ where: { detectedAt: { gte: startOfToday } } }),
    prisma.scopeAiEvaluation.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.finding.count(),
    prisma.finding.aggregate({
      _sum: { payoutAmount: true },
      where: { payoutAmount: { not: null } },
    }),
  ]);

  // High-opportunity assets: current completed evaluation scoring >= 80 on a
  // scope that is still in scope.
  const highOpportunityAssets = await prisma.scope.count({
    where: {
      scopeStatus: "IN_SCOPE",
      aiEvaluations: { some: { status: "COMPLETED", opportunityScore: { gte: 80 } } },
    },
  });

  const payoutCurrency = await prisma.finding.findFirst({
    where: { payoutCurrency: { not: null } },
    select: { payoutCurrency: true },
  });

  return {
    programs,
    activeScopes,
    newAssets7d,
    changesToday,
    highOpportunityAssets,
    pendingAiEvaluations,
    findings: { available: findingCount > 0, count: findingCount },
    totalPayout: {
      available: (payouts._sum.payoutAmount ?? 0) > 0,
      amount: payouts._sum.payoutAmount ?? 0,
      currency: payoutCurrency?.payoutCurrency ?? null,
    },
  };
}

export async function getTopOpportunities(limit = 10): Promise<OpportunityItem[]> {
  const evaluations = await prisma.scopeAiEvaluation.findMany({
    where: {
      status: "COMPLETED",
      opportunityScore: { not: null },
      scope: { scopeStatus: "IN_SCOPE" },
    },
    orderBy: [{ opportunityScore: "desc" }, { createdAt: "desc" }],
    // Over-fetch so superseded evaluations for the same scope can be dropped.
    take: limit * 8,
    include: {
      scope: {
        include: {
          program: { include: { provider: true } },
          changeEvents: { orderBy: { detectedAt: "desc" }, take: 1, select: { detectedAt: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const items: OpportunityItem[] = [];
  const now = Date.now();

  for (const evaluation of evaluations) {
    if (seen.has(evaluation.scopeId)) continue;
    seen.add(evaluation.scopeId);

    let tags: string[] = [];
    if (evaluation.tags) {
      try {
        const parsed: unknown = JSON.parse(evaluation.tags);
        if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
      } catch {
        tags = [];
      }
    }

    const lastChangedAt = evaluation.scope.changeEvents[0]?.detectedAt ?? null;

    items.push({
      scopeId: evaluation.scopeId,
      assetIdentifier: evaluation.scope.assetIdentifier,
      assetType: evaluation.scope.assetType,
      programName: evaluation.scope.program.name,
      programId: evaluation.scope.programId,
      provider: evaluation.scope.program.provider.slug,
      opportunityScore: evaluation.opportunityScore ?? 0,
      confidence: evaluation.confidence,
      tags,
      summary: evaluation.summary,
      eligibleForBounty: evaluation.scope.eligibleForBounty,
      maxSeverity: evaluation.scope.maxSeverity,
      isNew: now - evaluation.scope.firstSeenAt.getTime() <= 7 * DAY_MS,
      isChanged: lastChangedAt !== null && now - lastChangedAt.getTime() <= 7 * DAY_MS,
      lastChangedAt,
    });

    if (items.length >= limit) break;
  }

  return items;
}

export async function getRecentChanges(limit = 20) {
  return prisma.changeEvent.findMany({
    orderBy: { detectedAt: "desc" },
    take: limit,
    include: {
      provider: true,
      program: { select: { id: true, name: true } },
      scope: { select: { id: true, assetIdentifier: true, assetType: true } },
    },
  });
}
