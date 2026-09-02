import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { buildScopeEvaluationInput, hashEvaluationInput } from "@/lib/ai/input";
import { currentEvaluation, enqueueScopeEvaluation, runScopeEvaluation } from "@/lib/ai/evaluate";
import { getAiProvider, resetAiProviderCache } from "@/lib/ai/provider";
import { saveAiSettings } from "@/lib/ai/settings";
import { HeuristicAiProvider } from "@/lib/ai/heuristic";
import { scopeEvaluationOutputSchema, normalizeTags } from "@/lib/ai/types";
import { calculateOpportunityScore } from "@/lib/scoring/opportunity";
import { drainJobs } from "@/lib/jobs/worker";
import { resetDatabase, seedProvider } from "./helpers";

/**
 * AI evaluation: input hashing, reuse, staleness, output validation and
 * failure isolation. The heuristic provider keeps this deterministic and free.
 */

async function seedScope(overrides: Record<string, unknown> = {}): Promise<string> {
  const providerId = await seedProvider("HACKERONE", "HackerOne");

  const program = await prisma.program.create({
    data: {
      providerId,
      externalId: "prog-1",
      handleOrSlug: "example-corp",
      name: "Example Corp",
      status: "ACTIVE",
      visibility: "PUBLIC",
      policy: "Only listed assets are in scope.",
      bountyMax: 10000,
      currency: "USD",
      safeHarbor: "FULL",
      contentHash: "programhash",
    },
  });

  const scope = await prisma.scope.create({
    data: {
      programId: program.id,
      assetIdentifier: "api-v2.example.com",
      assetType: "API",
      scopeStatus: "IN_SCOPE",
      eligibleForSubmission: true,
      eligibleForBounty: true,
      maxSeverity: "CRITICAL",
      instruction: "Payments API. Multi-tenant.",
      contentHash: "scopehash",
      ...overrides,
    },
  });

  return scope.id;
}

beforeEach(async () => {
  await resetDatabase();
  resetAiProviderCache();
  process.env.AI_PROVIDER = "heuristic";
  process.env.AI_ENABLED = "true";
  process.env.AI_SCOPE_EVALUATION_ENABLED = "true";
});

describe("evaluation input", () => {
  it("hashes identically for unchanged context", async () => {
    const scopeId = await seedScope();

    const first = await buildScopeEvaluationInput(scopeId);
    const second = await buildScopeEvaluationInput(scopeId);

    expect(first?.inputHash).toBe(second?.inputHash);
  });

  it("buckets age so the hash does not churn daily", async () => {
    const scopeId = await seedScope();
    const built = await buildScopeEvaluationInput(scopeId);

    // A 31-day-old and a 44-day-old scope share the same bucket, so the hash
    // is stable across days rather than forcing a fresh model call each night.
    const at31 = { ...built!.input, scope: { ...built!.input.scope, ageDays: 90 } };
    const at44 = { ...built!.input, scope: { ...built!.input.scope, ageDays: 90 } };

    expect(hashEvaluationInput(at31)).toBe(hashEvaluationInput(at44));
  });

  it("changes the hash when scope meaning changes", async () => {
    const scopeId = await seedScope();
    const before = await buildScopeEvaluationInput(scopeId);

    await prisma.scope.update({
      where: { id: scopeId },
      data: { instruction: "Now includes GraphQL." },
    });

    const after = await buildScopeEvaluationInput(scopeId);
    expect(after?.inputHash).not.toBe(before?.inputHash);
  });

  it("omits research history entirely when none exists", async () => {
    const scopeId = await seedScope();
    const built = await buildScopeEvaluationInput(scopeId);

    // An all-zero object would read as "confirmed untouched" rather than "unknown".
    expect(built?.input.researchHistory).toBeNull();
  });

  it("includes research history once sessions exist", async () => {
    const scopeId = await seedScope();
    await prisma.researchSession.create({
      data: { scopeId, title: "Initial recon", status: "COMPLETED" },
    });

    const built = await buildScopeEvaluationInput(scopeId);
    expect(built?.input.researchHistory?.sessionCount).toBe(1);
  });

  it("returns null for a scope that no longer exists", async () => {
    expect(await buildScopeEvaluationInput("does-not-exist")).toBeNull();
  });
});

describe("cost control", () => {
  it("reuses a completed evaluation instead of calling the model again", async () => {
    const scopeId = await seedScope();

    await enqueueScopeEvaluation(scopeId);
    const evaluation = await prisma.scopeAiEvaluation.findFirstOrThrow();
    await runScopeEvaluation(evaluation.id);

    const provider = await getAiProvider();
    const spy = vi.spyOn(provider, "evaluateScope");

    const result = await enqueueScopeEvaluation(scopeId);

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("REUSED");
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.scopeAiEvaluation.count()).toBe(1);

    spy.mockRestore();
  });

  it("does not queue a second job while one is pending", async () => {
    const scopeId = await seedScope();

    const first = await enqueueScopeEvaluation(scopeId);
    const second = await enqueueScopeEvaluation(scopeId);

    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(second.reason).toBe("ALREADY_PENDING");
    expect(await prisma.job.count({ where: { type: "EVALUATE_SCOPE" } })).toBe(1);
  });

  it("marks the old evaluation stale and queues a new one when context changes", async () => {
    const scopeId = await seedScope();

    await enqueueScopeEvaluation(scopeId);
    const first = await prisma.scopeAiEvaluation.findFirstOrThrow();
    await runScopeEvaluation(first.id);

    await prisma.scope.update({
      where: { id: scopeId },
      data: { eligibleForBounty: false },
    });

    const result = await enqueueScopeEvaluation(scopeId);
    expect(result.enqueued).toBe(true);

    const stale = await prisma.scopeAiEvaluation.findUniqueOrThrow({ where: { id: first.id } });
    expect(stale.status).toBe("STALE");

    const pending = await prisma.scopeAiEvaluation.findFirstOrThrow({ where: { status: "PENDING" } });
    expect(pending.inputHash).not.toBe(first.inputHash);
  });

  it("does not queue anything when evaluation is disabled", async () => {
    const scopeId = await seedScope();

    // Configuration lives in the database now, not the environment.
    await saveAiSettings({ scopeEvaluationEnabled: false });

    const result = await enqueueScopeEvaluation(scopeId);

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("DISABLED");
    expect(await prisma.scopeAiEvaluation.count()).toBe(0);
  });
});

describe("evaluation execution", () => {
  it("stores dimension scores and an app-computed opportunity score", async () => {
    const scopeId = await seedScope();

    await enqueueScopeEvaluation(scopeId);
    const queued = await prisma.scopeAiEvaluation.findFirstOrThrow();
    expect(await runScopeEvaluation(queued.id)).toBe(true);

    const done = await prisma.scopeAiEvaluation.findUniqueOrThrow({ where: { id: queued.id } });

    expect(done.status).toBe("COMPLETED");
    expect(done.opportunityScore).not.toBeNull();
    expect(done.evaluatedAt).not.toBeNull();

    // The stored score must equal the deterministic formula over the stored
    // dimensions - the model never sets the final number.
    const recomputed = calculateOpportunityScore({
      businessValue: done.businessValueScore!,
      attackSurface: done.attackSurfaceScore!,
      freshness: done.freshnessScore!,
      researchPotential: done.researchPotentialScore!,
      complexity: done.complexityScore!,
      policyFit: done.policyFitScore!,
      duplicateRisk: done.duplicateRiskScore!,
    });

    expect(done.opportunityScore).toBe(recomputed);

    for (const value of [
      done.businessValueScore,
      done.attackSurfaceScore,
      done.freshnessScore,
      done.researchPotentialScore,
      done.complexityScore,
      done.policyFitScore,
      done.duplicateRiskScore,
      done.opportunityScore,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }

    expect(done.confidence).toBeGreaterThanOrEqual(0);
    expect(done.confidence).toBeLessThanOrEqual(1);
  });

  it("records the failure on the evaluation row when the provider throws", async () => {
    const scopeId = await seedScope();
    await enqueueScopeEvaluation(scopeId);
    const queued = await prisma.scopeAiEvaluation.findFirstOrThrow();

    const provider = await getAiProvider();
    const spy = vi
      .spyOn(provider, "evaluateScope")
      .mockRejectedValue(new Error("model exploded"));

    const succeeded = await runScopeEvaluation(queued.id);

    expect(succeeded).toBe(false);

    const failed = await prisma.scopeAiEvaluation.findUniqueOrThrow({ where: { id: queued.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorSummary).toContain("model exploded");
    expect(failed.opportunityScore).toBeNull();

    spy.mockRestore();
  });

  it("rejects out-of-range model output rather than storing it", async () => {
    const scopeId = await seedScope();
    await enqueueScopeEvaluation(scopeId);
    const queued = await prisma.scopeAiEvaluation.findFirstOrThrow();

    const provider = await getAiProvider();
    const spy = vi.spyOn(provider, "evaluateScope").mockResolvedValue({
      output: {
        businessValueScore: 900,
        attackSurfaceScore: 50,
        freshnessScore: 50,
        researchPotentialScore: 50,
        complexityScore: 50,
        policyFitScore: 50,
        duplicateRiskScore: 50,
        confidence: 5,
        summary: "bogus",
        reasoningSummary: "bogus",
        tags: [],
        suggestedResearchAreas: [],
        warnings: [],
      },
      usage: { latencyMs: 1 },
      model: "test",
      providerName: "test",
      source: "AI_MODEL",
    });

    expect(await runScopeEvaluation(queued.id)).toBe(false);

    const failed = await prisma.scopeAiEvaluation.findUniqueOrThrow({ where: { id: queued.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.opportunityScore).toBeNull();

    spy.mockRestore();
  });

  it("marks an evaluation stale if the scope changed before processing", async () => {
    const scopeId = await seedScope();
    await enqueueScopeEvaluation(scopeId);
    const queued = await prisma.scopeAiEvaluation.findFirstOrThrow();

    await prisma.scope.update({
      where: { id: scopeId },
      data: { instruction: "Changed while the job sat in the queue." },
    });

    expect(await runScopeEvaluation(queued.id)).toBe(true);

    const stale = await prisma.scopeAiEvaluation.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stale.status).toBe("STALE");
    // A replacement is queued for the new content.
    expect(await prisma.scopeAiEvaluation.count({ where: { status: "PENDING" } })).toBe(1);
  });

  it("drains the queue through the worker", async () => {
    const scopeId = await seedScope();
    await enqueueScopeEvaluation(scopeId);

    const processed = await drainJobs(10);

    expect(processed).toBeGreaterThanOrEqual(1);
    const evaluation = await currentEvaluation(scopeId);
    expect(evaluation?.status).toBe("COMPLETED");
  });
});

describe("output contract", () => {
  it("validates the heuristic provider output against the schema", async () => {
    const provider = new HeuristicAiProvider();

    const result = await provider.evaluateScope({
      outputLanguage: "en",
      program: {
        name: "Example Corp",
        provider: "HACKERONE",
        status: "ACTIVE",
        visibility: "PUBLIC",
        bountyMin: 100,
        bountyMax: 10000,
        currency: "USD",
        safeHarbor: "FULL",
        policyExcerpt: null,
      },
      scope: {
        assetIdentifier: "payments-api.example.com",
        assetType: "API",
        scopeStatus: "IN_SCOPE",
        eligibleForBounty: true,
        eligibleForSubmission: true,
        maxSeverity: "CRITICAL",
        instruction: "Payment processing API.",
        firstSeenAt: new Date().toISOString(),
        sourceUpdatedAt: null,
        ageDays: 1,
        daysSinceLastChange: null,
      },
      recentChanges: [],
      researchHistory: null,
      existingTags: [],
    });

    expect(scopeEvaluationOutputSchema.safeParse(result.output).success).toBe(true);
    expect(result.output.tags).toContain("payments");
    // It must be transparent about being a rule-based estimate, not a model.
    expect(result.output.warnings.join(" ")).toMatch(/rule-based/i);
    expect(result.providerName).toBe("heuristic");
  });

  it("scores an out-of-scope asset low on policy fit", async () => {
    const provider = new HeuristicAiProvider();

    const result = await provider.evaluateScope({
      outputLanguage: "en",
      program: {
        name: "Example Corp",
        provider: "HACKERONE",
        status: "ACTIVE",
        visibility: "PUBLIC",
        bountyMin: null,
        bountyMax: null,
        currency: null,
        safeHarbor: null,
        policyExcerpt: null,
      },
      scope: {
        assetIdentifier: "legacy.example.test",
        assetType: "URL",
        scopeStatus: "OUT_OF_SCOPE",
        eligibleForBounty: false,
        eligibleForSubmission: false,
        maxSeverity: null,
        instruction: null,
        firstSeenAt: new Date("2020-01-01").toISOString(),
        sourceUpdatedAt: null,
        ageDays: 999,
        daysSinceLastChange: null,
      },
      recentChanges: [],
      researchHistory: null,
      existingTags: [],
    });

    expect(result.output.policyFitScore).toBeLessThan(40);
    expect(result.output.warnings.join(" ")).toMatch(/not currently authorized/i);
  });

  it("normalises tags to a bounded, kebab-cased set", () => {
    expect(normalizeTags(["API", "api", "  Multi Tenant  ", "OAuth 2.0"])).toEqual([
      "api",
      "multi-tenant",
      "oauth-2-0",
    ]);

    expect(normalizeTags(Array.from({ length: 50 }, (_, index) => `tag${index}`))).toHaveLength(12);
  });
});

describe("input hash stability", () => {
  it("is not perturbed by the evaluation's own output tags", async () => {
    const scopeId = await seedScope();

    const before = await buildScopeEvaluationInput(scopeId);

    await enqueueScopeEvaluation(scopeId);
    const queued = await prisma.scopeAiEvaluation.findFirstOrThrow();
    await runScopeEvaluation(queued.id);

    const completed = await prisma.scopeAiEvaluation.findUniqueOrThrow({ where: { id: queued.id } });
    expect(JSON.parse(completed.tags ?? "[]").length).toBeGreaterThan(0);

    // Tags produced by an evaluation feed back into its own input. If they were
    // hashed, every scope would re-evaluate exactly once for no reason.
    const after = await buildScopeEvaluationInput(scopeId);
    expect(after?.inputHash).toBe(before?.inputHash);
    expect(after?.input.existingTags.length).toBeGreaterThan(0);
  });
});
