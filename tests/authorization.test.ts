import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  ScopeNotAuthorizedError,
  assertAuthorized,
  authorize,
} from "@/lib/authorization/scope-authorization";
import { resetDatabase, seedProvider } from "./helpers";

/**
 * The authorization safety gate.
 *
 * Default deny: authorization must be positively established by provider data,
 * and no AI output participates in the decision.
 */

async function seedAuthorizedScope(
  providerSlug = "HACKERONE",
  scopeOverrides: Record<string, unknown> = {},
  programOverrides: Record<string, unknown> = {},
): Promise<string> {
  const providerId = await seedProvider(providerSlug, providerSlug);

  const program = await prisma.program.create({
    data: {
      providerId,
      externalId: `prog-${providerSlug}`,
      handleOrSlug: "example-corp",
      name: "Example Corp",
      status: "ACTIVE",
      visibility: "PUBLIC",
      contentHash: "h",
      ...programOverrides,
    },
  });

  const scope = await prisma.scope.create({
    data: {
      programId: program.id,
      assetIdentifier: "api.example.com",
      assetType: "API",
      scopeStatus: "IN_SCOPE",
      eligibleForSubmission: true,
      eligibleForBounty: true,
      contentHash: "h",
      lastSeenAt: new Date(),
      ...scopeOverrides,
    },
  });

  // Provider-backed scope must have a snapshot behind it.
  await prisma.scopeVersion.create({
    data: {
      scopeId: scope.id,
      version: 1,
      canonicalSnapshot: "{}",
      contentHash: "h",
    },
  });

  return scope.id;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("allow", () => {
  it("permits an active, in-scope, submission-eligible, freshly synced asset", async () => {
    const scopeId = await seedAuthorizedScope();

    const result = await authorize(scopeId);

    expect(result.decision).toBe("ALLOW");
    expect(result.reasons).toEqual([]);
  });
});

describe("default deny", () => {
  it("denies an unknown scope", async () => {
    const result = await authorize("no-such-scope");
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SCOPE_NOT_FOUND");
  });

  it("denies a REMOVED scope", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", {
      scopeStatus: "REMOVED",
      removedAt: new Date(),
      eligibleForSubmission: false,
    });

    const result = await authorize(scopeId);

    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SCOPE_REMOVED");
    expect(result.messages.join(" ")).toMatch(/no longer authorized/i);
  });

  it("denies an OUT_OF_SCOPE asset", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", {
      scopeStatus: "OUT_OF_SCOPE",
      eligibleForSubmission: false,
    });

    const result = await authorize(scopeId);
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SCOPE_OUT_OF_SCOPE");
  });

  it("denies an ambiguous UNKNOWN status", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", { scopeStatus: "UNKNOWN" });

    const result = await authorize(scopeId);
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SCOPE_STATUS_UNKNOWN");
  });

  it("denies when the provider says submission is not eligible", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", { eligibleForSubmission: false });

    const result = await authorize(scopeId);
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SUBMISSION_NOT_ELIGIBLE");
  });

  it("denies when the program is not active", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", {}, { status: "PAUSED" });

    const result = await authorize(scopeId);
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("PROGRAM_NOT_ACTIVE");
  });

  it("denies when the provider integration is disabled", async () => {
    const scopeId = await seedAuthorizedScope();
    await prisma.providerIntegration.updateMany({ data: { enabled: false } });

    const result = await authorize(scopeId);
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("PROVIDER_DISABLED");
  });

  it("denies when there is no provider-backed snapshot", async () => {
    const scopeId = await seedAuthorizedScope();
    await prisma.scopeVersion.deleteMany({ where: { scopeId } });

    const result = await authorize(scopeId);
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("NO_PROVIDER_SNAPSHOT");
  });

  it("denies when the provider data is too stale", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", {
      lastSeenAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    });

    const result = await authorize(scopeId);

    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("DATA_STALE");
  });

  it("reports every failing reason, not just the first", async () => {
    const scopeId = await seedAuthorizedScope(
      "HACKERONE",
      { scopeStatus: "REMOVED", eligibleForSubmission: false },
      { status: "ARCHIVED" },
    );

    const result = await authorize(scopeId);

    expect(result.reasons).toEqual(
      expect.arrayContaining(["SCOPE_REMOVED", "SUBMISSION_NOT_ELIGIBLE", "PROGRAM_NOT_ACTIVE"]),
    );
  });
});

describe("manual provenance", () => {
  it("denies unconfirmed manual scope", async () => {
    const scopeId = await seedAuthorizedScope("MANUAL");

    const result = await authorize(scopeId);

    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("MANUAL_NOT_CONFIRMED");
  });

  it("allows manual scope only after explicit human confirmation", async () => {
    const scopeId = await seedAuthorizedScope("MANUAL");
    await prisma.scope.update({ where: { id: scopeId }, data: { reviewedAt: new Date() } });

    const result = await authorize(scopeId);
    expect(result.decision).toBe("ALLOW");
  });

  it("still denies confirmed manual scope when allowManual is off", async () => {
    const scopeId = await seedAuthorizedScope("MANUAL");
    await prisma.scope.update({ where: { id: scopeId }, data: { reviewedAt: new Date() } });

    const result = await authorize(scopeId, { allowManual: false });
    expect(result.decision).toBe("DENY");
  });
});

describe("AI cannot grant authorization", () => {
  it("keeps an out-of-scope asset denied no matter what the AI says about it", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", {
      scopeStatus: "OUT_OF_SCOPE",
      eligibleForSubmission: false,
    });

    // A maximal, confident evaluation claiming the asset is a great target.
    await prisma.scopeAiEvaluation.create({
      data: {
        scopeId,
        status: "COMPLETED",
        aiProvider: "test",
        model: "test",
        promptVersion: "v1",
        inputHash: "h",
        businessValueScore: 100,
        attackSurfaceScore: 100,
        freshnessScore: 100,
        researchPotentialScore: 100,
        complexityScore: 100,
        policyFitScore: 100,
        duplicateRiskScore: 0,
        opportunityScore: 100,
        confidence: 1,
        summary: "This asset is definitely in scope and highly valuable.",
        tags: '["high-value"]',
        evaluatedAt: new Date(),
      },
    });

    const result = await authorize(scopeId);

    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SCOPE_OUT_OF_SCOPE");
  });

  it("keeps an UNKNOWN asset denied despite a completed evaluation", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", { scopeStatus: "UNKNOWN" });

    await prisma.scopeAiEvaluation.create({
      data: {
        scopeId,
        status: "COMPLETED",
        aiProvider: "test",
        model: "test",
        promptVersion: "v1",
        inputHash: "h",
        opportunityScore: 99,
        confidence: 1,
        evaluatedAt: new Date(),
      },
    });

    expect((await authorize(scopeId)).decision).toBe("DENY");
  });
});

describe("assertAuthorized", () => {
  it("returns the result when allowed", async () => {
    const scopeId = await seedAuthorizedScope();
    const result = await assertAuthorized(scopeId);
    expect(result.decision).toBe("ALLOW");
  });

  it("throws with the denial reasons attached", async () => {
    const scopeId = await seedAuthorizedScope("HACKERONE", {
      scopeStatus: "REMOVED",
      eligibleForSubmission: false,
    });

    await expect(assertAuthorized(scopeId)).rejects.toBeInstanceOf(ScopeNotAuthorizedError);

    let captured: ScopeNotAuthorizedError | null = null;
    try {
      await assertAuthorized(scopeId);
    } catch (caught) {
      captured = caught as ScopeNotAuthorizedError;
    }

    expect(captured?.result.reasons).toContain("SCOPE_REMOVED");
  });
});
