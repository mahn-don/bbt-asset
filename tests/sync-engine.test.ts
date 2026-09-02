import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NormalizedProgram,
  NormalizedScope,
  ProviderAdapter,
} from "@/lib/providers/types";

/**
 * Sync pipeline behaviour: idempotency, versioning, change detection and
 * removal semantics.
 *
 * A scripted fake adapter stands in for a provider so the exact upstream
 * payload of each run is controlled.
 */

const scripted: { programs: NormalizedProgram[]; scopes: NormalizedScope[] } = {
  programs: [],
  scopes: [],
};

const fakeAdapter: ProviderAdapter = {
  providerSlug: "HACKERONE",
  displayName: "Fake",
  credentialSchema: () => ({ authMethod: "None", fields: [] }),
  validateCredentials: () => ({ valid: true }),
  testConnection: async () => ({ status: "CONNECTED", message: "ok" }),
  fetchPrograms: async () => ({ programs: scripted.programs }),
  fetchProgram: async () => scripted.programs[0] ?? null,
  fetchScopes: async () => ({ scopes: scripted.scopes }),
  normalizeProgram: (raw) => raw as NormalizedProgram,
  normalizeScope: (raw) => raw as NormalizedScope,
  getCapabilities: () => ({
    listPrograms: true,
    listScopes: true,
    programPolicy: true,
    incrementalSync: false,
    manualEntry: false,
    // No credentials, so the test does not need to seed an encrypted blob.
    requiresCredentials: false,
  }),
  getRateLimitPolicy: () => ({
    requestsPerMinute: 100,
    maxConcurrency: 2,
    honoursRetryAfter: true,
  }),
};

vi.mock("@/lib/providers/registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/providers/registry")>(
    "@/lib/providers/registry",
  );
  return {
    ...actual,
    getAdapter: (slug: string) => (slug.toUpperCase() === "HACKERONE" ? fakeAdapter : actual.getAdapter(slug)),
    tryGetAdapter: (slug: string) =>
      slug.toUpperCase() === "HACKERONE" ? fakeAdapter : actual.tryGetAdapter(slug),
  };
});

const { prisma } = await import("@/lib/db");
const { runProviderSync } = await import("@/lib/sync/engine");
const { resetDatabase, seedProvider } = await import("./helpers");

function program(overrides: Partial<NormalizedProgram> = {}): NormalizedProgram {
  return {
    externalId: "prog-1",
    handleOrSlug: "example-corp",
    name: "Example Corp",
    sourceUrl: "https://hackerone.com/example-corp",
    status: "ACTIVE",
    visibility: "PUBLIC",
    policy: "Only the listed assets are in scope.",
    bountyMin: 100,
    bountyMax: 5000,
    currency: "USD",
    safeHarbor: "FULL",
    ...overrides,
  };
}

function scope(overrides: Partial<NormalizedScope> = {}): NormalizedScope {
  return {
    externalId: "scope-1",
    assetIdentifier: "api.example.com",
    assetType: "API",
    scopeStatus: "IN_SCOPE",
    eligibleForSubmission: true,
    eligibleForBounty: true,
    maxSeverity: "HIGH",
    instruction: "API surface is in scope.",
    ...overrides,
  };
}

beforeAll(() => {
  process.env.AI_PROVIDER = "heuristic";
});

beforeEach(async () => {
  await resetDatabase();
  await seedProvider("HACKERONE", "HackerOne");
  scripted.programs = [program()];
  scripted.scopes = [scope()];
});

describe("first sync", () => {
  it("imports programs and scopes and records the initial version", async () => {
    const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(result.status).toBe("SUCCESS");
    expect(result.programsCreated).toBe(1);
    expect(result.scopesCreated).toBe(1);

    const stored = await prisma.scope.findFirst({ include: { versions: true } });
    expect(stored?.assetIdentifier).toBe("api.example.com");
    expect(stored?.version).toBe(1);
    expect(stored?.versions).toHaveLength(1);
    expect(stored?.versions[0]?.validTo).toBeNull();

    const added = await prisma.changeEvent.findMany({ where: { changeType: "ASSET_ADDED" } });
    expect(added).toHaveLength(1);

    // A new bounty-eligible API scope is a strong research signal.
    expect(added[0]?.importance).toBe("HIGH");
  });

  it("queues exactly one AI evaluation for the new scope", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const evaluations = await prisma.scopeAiEvaluation.findMany();
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.status).toBe("PENDING");

    const jobs = await prisma.job.findMany({ where: { type: "EVALUATE_SCOPE" } });
    expect(jobs).toHaveLength(1);
  });
});

describe("idempotency", () => {
  it("produces no duplicates and no false changes when the same data is synced twice", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const afterFirst = await prisma.scope.findFirstOrThrow();
    const changesAfterFirst = await prisma.changeEvent.count();
    const versionsAfterFirst = await prisma.scopeVersion.count();
    const evaluationsAfterFirst = await prisma.scopeAiEvaluation.count();
    const jobsAfterFirst = await prisma.job.count();

    const second = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(second.status).toBe("SUCCESS");
    expect(second.scopesCreated).toBe(0);
    expect(second.scopesUpdated).toBe(0);
    expect(second.changesDetected).toBe(0);
    expect(second.aiJobsEnqueued).toBe(0);

    expect(await prisma.program.count()).toBe(1);
    expect(await prisma.scope.count()).toBe(1);
    expect(await prisma.changeEvent.count()).toBe(changesAfterFirst);
    expect(await prisma.scopeVersion.count()).toBe(versionsAfterFirst);
    expect(await prisma.scopeAiEvaluation.count()).toBe(evaluationsAfterFirst);
    expect(await prisma.job.count()).toBe(jobsAfterFirst);

    const afterSecond = await prisma.scope.findFirstOrThrow();
    expect(afterSecond.version).toBe(afterFirst.version);
    expect(afterSecond.contentHash).toBe(afterFirst.contentHash);
    // Only liveness moves on an unchanged sync.
    expect(afterSecond.lastSeenAt.getTime()).toBeGreaterThanOrEqual(afterFirst.lastSeenAt.getTime());
  });

  it("ignores a provider timestamp change that carries no meaning", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    // Same content, new upstream `updated_at`. This must not look like a change.
    scripted.scopes = [scope({ sourceUpdatedAt: new Date("2026-06-01T00:00:00Z") })];

    const second = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(second.changesDetected).toBe(0);
    expect(await prisma.scopeVersion.count()).toBe(1);
  });

  it("collapses a duplicated asset within a single provider payload", async () => {
    scripted.scopes = [scope(), scope()];

    const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(result.scopesCreated).toBe(1);
    expect(await prisma.scope.count()).toBe(1);
  });
});

describe("scope change", () => {
  it("creates a version, a typed change event, and re-queues AI", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const firstEvaluation = await prisma.scopeAiEvaluation.findFirstOrThrow();
    // Simulate a completed evaluation so the staleness transition is observable.
    await prisma.scopeAiEvaluation.update({
      where: { id: firstEvaluation.id },
      data: { status: "COMPLETED", opportunityScore: 70, evaluatedAt: new Date() },
    });

    scripted.scopes = [scope({ instruction: "Updated: GraphQL endpoints are now in scope too." })];

    const second = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(second.scopesUpdated).toBe(1);
    expect(second.changesDetected).toBe(1);

    const stored = await prisma.scope.findFirstOrThrow({
      include: { versions: { orderBy: { version: "asc" } } },
    });

    expect(stored.version).toBe(2);
    expect(stored.versions).toHaveLength(2);
    // The superseded version is closed off rather than overwritten.
    expect(stored.versions[0]?.validTo).not.toBeNull();
    expect(stored.versions[1]?.validTo).toBeNull();

    const change = await prisma.changeEvent.findFirstOrThrow({
      where: { changeType: "INSTRUCTION_CHANGED" },
    });
    expect(change.oldValue).toBe("API surface is in scope.");
    expect(change.newValue).toContain("GraphQL");

    const stale = await prisma.scopeAiEvaluation.findUniqueOrThrow({
      where: { id: firstEvaluation.id },
    });
    expect(stale.status).toBe("STALE");

    const pending = await prisma.scopeAiEvaluation.findFirst({ where: { status: "PENDING" } });
    expect(pending).not.toBeNull();
    expect(pending?.inputHash).not.toBe(firstEvaluation.inputHash);
  });

  it("emits a typed event for each meaningful field", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    scripted.scopes = [scope({ eligibleForBounty: false, maxSeverity: "CRITICAL" })];
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const types = (await prisma.changeEvent.findMany()).map((event) => event.changeType);
    expect(types).toContain("BOUNTY_ELIGIBILITY_CHANGED");
    expect(types).toContain("MAX_SEVERITY_CHANGED");

    const severityChange = await prisma.changeEvent.findFirstOrThrow({
      where: { changeType: "MAX_SEVERITY_CHANGED" },
    });
    expect(severityChange.oldValue).toBe("HIGH");
    expect(severityChange.newValue).toBe("CRITICAL");
    // A raised ceiling is worth attention.
    expect(severityChange.importance).toBe("HIGH");
  });

  it("records a program policy change", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    scripted.programs = [program({ policy: "Updated policy: staging hosts are now excluded." })];
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const change = await prisma.changeEvent.findFirst({ where: { changeType: "POLICY_CHANGED" } });
    expect(change).not.toBeNull();
    expect(change?.newValue).toContain("staging hosts");
  });
});

describe("scope removal", () => {
  it("marks the scope removed, preserves history, and emits ASSET_REMOVED", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });
    const before = await prisma.scope.findFirstOrThrow();

    scripted.scopes = [];
    const second = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(second.scopesRemoved).toBe(1);

    const after = await prisma.scope.findUniqueOrThrow({
      where: { id: before.id },
      include: { versions: true },
    });

    // The row survives - history is never destroyed.
    expect(after.scopeStatus).toBe("REMOVED");
    expect(after.removedAt).not.toBeNull();
    expect(after.eligibleForSubmission).toBe(false);
    expect(after.eligibleForBounty).toBe(false);
    expect(after.versions.length).toBeGreaterThanOrEqual(2);

    const removal = await prisma.changeEvent.findFirstOrThrow({
      where: { changeType: "ASSET_REMOVED" },
    });
    expect(removal.oldValue).toBe("api.example.com");
    expect(removal.importance).toBe("HIGH");
  });

  it("does not re-emit ASSET_REMOVED on a subsequent sync", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });
    scripted.scopes = [];
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(await prisma.changeEvent.count({ where: { changeType: "ASSET_REMOVED" } })).toBe(1);
  });

  it("treats a returning asset as re-added", async () => {
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });
    scripted.scopes = [];
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    scripted.scopes = [scope()];
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const restored = await prisma.scope.findFirstOrThrow();
    expect(restored.scopeStatus).toBe("IN_SCOPE");
    expect(restored.removedAt).toBeNull();
    expect(await prisma.changeEvent.count({ where: { changeType: "ASSET_ADDED" } })).toBe(2);
  });
});

describe("sync run bookkeeping", () => {
  it("records counters on the sync run", async () => {
    const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: result.syncRunId } });
    expect(run.status).toBe("SUCCESS");
    expect(run.programsReceived).toBe(1);
    expect(run.scopesCreated).toBe(1);
    expect(run.finishedAt).not.toBeNull();
    expect(run.triggerType).toBe("MANUAL");
  });

  it("fails the run when the integration is disabled", async () => {
    await prisma.providerIntegration.updateMany({ data: { enabled: false } });

    const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("DISABLED");
    expect(await prisma.scope.count()).toBe(0);
  });

  it("ends PARTIAL when one program fails but another succeeds", async () => {
    scripted.programs = [program(), program({ externalId: "prog-2", handleOrSlug: "second" })];

    let call = 0;
    const original = fakeAdapter.fetchScopes;
    fakeAdapter.fetchScopes = async (context, prog, cursor) => {
      call += 1;
      if (call === 1) throw new Error("upstream exploded for this program");
      return original.call(fakeAdapter, context, prog, cursor);
    };

    try {
      const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

      expect(result.status).toBe("PARTIAL");
      // The healthy program still imported.
      expect(await prisma.program.count()).toBe(2);
      expect(await prisma.scope.count()).toBe(1);
    } finally {
      fakeAdapter.fetchScopes = original;
    }
  });
});
