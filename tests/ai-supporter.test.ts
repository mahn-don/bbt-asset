import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  getFunnelStats,
  getRecommendations,
  selectCandidates,
} from "@/lib/queries/ai-supporter";
import { resetDatabase, seedProvider } from "./helpers";

/**
 * AI Supporter funnel, recommendations and candidate selection.
 */

async function seedScope(
  overrides: {
    assetIdentifier: string;
    assetType?: string;
    scopeStatus?: string;
    eligibleForSubmission?: boolean;
    eligibleForBounty?: boolean;
    maxSeverity?: string | null;
  },
  programId: string,
): Promise<string> {
  const scope = await prisma.scope.create({
    data: {
      programId,
      assetIdentifier: overrides.assetIdentifier,
      assetType: overrides.assetType ?? "URL",
      scopeStatus: overrides.scopeStatus ?? "IN_SCOPE",
      eligibleForSubmission: overrides.eligibleForSubmission ?? true,
      eligibleForBounty: overrides.eligibleForBounty ?? true,
      maxSeverity: overrides.maxSeverity ?? "HIGH",
      contentHash: "h",
    },
  });
  return scope.id;
}

async function completeEvaluation(scopeId: string, score: number, source = "AI_MODEL"): Promise<void> {
  await prisma.scopeAiEvaluation.create({
    data: {
      scopeId,
      status: "COMPLETED",
      aiProvider: source === "AI_MODEL" ? "anthropic" : "heuristic",
      model: source === "AI_MODEL" ? "claude-opus-5" : "rule-based-v1",
      promptVersion: "scope-eval-v1",
      evaluationSource: source,
      language: "en",
      inputHash: `hash-${scopeId}-${score}`,
      opportunityScore: score,
      confidence: 0.8,
      summary: "Test recommendation.",
      tags: '["api"]',
      evaluatedAt: new Date(),
    },
  });
}

let programId: string;

beforeEach(async () => {
  await resetDatabase();
  const providerId = await seedProvider("HACKERONE", "HackerOne");
  const program = await prisma.program.create({
    data: {
      providerId,
      externalId: "p1",
      handleOrSlug: "acme",
      name: "Acme",
      status: "ACTIVE",
      visibility: "PUBLIC",
      contentHash: "h",
    },
  });
  programId = program.id;
});

describe("funnel", () => {
  it("counts each deterministic stage", async () => {
    await seedScope({ assetIdentifier: "a1", eligibleForBounty: true, maxSeverity: "CRITICAL" }, programId);
    await seedScope({ assetIdentifier: "a2", eligibleForBounty: true, maxSeverity: "LOW" }, programId);
    // In scope but not bounty-eligible -> counts for inScope, not eligible.
    await seedScope({ assetIdentifier: "a3", eligibleForBounty: false }, programId);
    // Out of scope -> counts only for total.
    await seedScope({ assetIdentifier: "a4", scopeStatus: "OUT_OF_SCOPE", eligibleForBounty: true }, programId);

    const f = await getFunnelStats();
    expect(f.total).toBe(4);
    expect(f.inScope).toBe(3);
    expect(f.eligible).toBe(2);
    expect(f.highSeverity).toBe(1); // only a1 (CRITICAL); a2 is LOW
    expect(f.evaluated).toBe(0);
    expect(f.candidatePool).toBe(2);
  });

  it("counts evaluated and recommended once evaluations exist", async () => {
    const s1 = await seedScope({ assetIdentifier: "a1", eligibleForBounty: true }, programId);
    const s2 = await seedScope({ assetIdentifier: "a2", eligibleForBounty: true }, programId);
    await completeEvaluation(s1, 85);
    await completeEvaluation(s2, 40); // below the 70 recommended threshold

    const f = await getFunnelStats();
    expect(f.evaluated).toBe(2);
    expect(f.recommended).toBe(1); // only s1 scores >= 70
    expect(f.candidatePool).toBe(0);
  });
});

describe("recommendations", () => {
  it("returns only eligible in-scope scopes, ranked, one per scope", async () => {
    const s1 = await seedScope({ assetIdentifier: "high", eligibleForBounty: true }, programId);
    const s2 = await seedScope({ assetIdentifier: "low", eligibleForBounty: true }, programId);
    const s3 = await seedScope({ assetIdentifier: "ineligible", eligibleForBounty: false }, programId);

    await completeEvaluation(s1, 90);
    await completeEvaluation(s2, 55);
    await completeEvaluation(s3, 99); // must be excluded: not bounty-eligible

    const recs = await getRecommendations({ limit: 10 });

    expect(recs.map((r) => r.assetIdentifier)).toEqual(["high", "low"]);
    expect(recs[0]!.opportunityScore).toBe(90);
    expect(recs.find((r) => r.assetIdentifier === "ineligible")).toBeUndefined();
  });

  it("keeps only the newest completed evaluation per scope", async () => {
    const s1 = await seedScope({ assetIdentifier: "a1", eligibleForBounty: true }, programId);
    await completeEvaluation(s1, 60);
    await new Promise((r) => setTimeout(r, 5));
    await completeEvaluation(s1, 88);

    const recs = await getRecommendations({ limit: 10 });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.opportunityScore).toBe(88);
  });

  it("filters by focus asset type", async () => {
    const api = await seedScope({ assetIdentifier: "api", assetType: "API", eligibleForBounty: true }, programId);
    const url = await seedScope({ assetIdentifier: "url", assetType: "URL", eligibleForBounty: true }, programId);
    await completeEvaluation(api, 80);
    await completeEvaluation(url, 95);

    const recs = await getRecommendations({ focus: ["API"], limit: 10 });
    expect(recs.map((r) => r.assetIdentifier)).toEqual(["api"]);
  });
});

describe("candidate selection", () => {
  it("selects eligible, un-evaluated scope, severity-first", async () => {
    const crit = await seedScope({ assetIdentifier: "crit", assetType: "API", maxSeverity: "CRITICAL" }, programId);
    const med = await seedScope({ assetIdentifier: "med", assetType: "API", maxSeverity: "MEDIUM" }, programId);
    const done = await seedScope({ assetIdentifier: "done", assetType: "API", maxSeverity: "CRITICAL" }, programId);
    await completeEvaluation(done, 90); // already evaluated -> excluded

    const ids = await selectCandidates(["API"], 10);

    expect(ids).toContain(crit);
    expect(ids).toContain(med);
    expect(ids).not.toContain(done);
    // Severity-first ordering.
    expect(ids[0]).toBe(crit);
  });

  it("respects the focus filter", async () => {
    const api = await seedScope({ assetIdentifier: "api", assetType: "API" }, programId);
    await seedScope({ assetIdentifier: "url", assetType: "URL" }, programId);

    const ids = await selectCandidates(["API"], 10);
    expect(ids).toEqual([api]);
  });

  it("still selects a scope whose only evaluation is pending", async () => {
    // Syncs queue a PENDING evaluation per scope but no worker processes them,
    // so a pending-only scope is precisely what the generator must turn into a
    // completed recommendation — it stays a candidate.
    const s1 = await seedScope({ assetIdentifier: "a1", assetType: "API" }, programId);
    await prisma.scopeAiEvaluation.create({
      data: {
        scopeId: s1,
        status: "PENDING",
        aiProvider: "anthropic",
        model: "claude-opus-5",
        promptVersion: "scope-eval-v1",
        evaluationSource: "AI_MODEL",
        language: "en",
        inputHash: "pending-hash",
      },
    });

    const ids = await selectCandidates(["API"], 10);
    expect(ids).toContain(s1);
  });

  it("excludes a scope that already has a completed evaluation", async () => {
    const s1 = await seedScope({ assetIdentifier: "a1", assetType: "API" }, programId);
    await completeEvaluation(s1, 80);

    const ids = await selectCandidates(["API"], 10);
    expect(ids).not.toContain(s1);
  });
});
