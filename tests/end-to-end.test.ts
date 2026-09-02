import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Definition-of-Done walkthrough.
 *
 * Drives the whole vertical slice against a mocked HackerOne HTTP surface:
 *
 *   credentials -> test connection -> sync -> normalized records -> versions
 *     -> change detection -> AI queue -> evaluations -> opportunity scores
 *     -> dashboard + assets list + scope detail
 *
 * then re-syncs identical data, then a changed scope, then a removal.
 */

const CREDENTIALS = { apiUsername: "researcher", apiToken: "t".repeat(40) };

interface ScopeFixture {
  id: string;
  asset_type: string;
  asset_identifier: string;
  eligible_for_bounty: boolean;
  eligible_for_submission: boolean;
  max_severity: string;
  instruction?: string;
}

const state: { scopes: ScopeFixture[] } = { scopes: [] };

function baseScopes(): ScopeFixture[] {
  return [
    {
      id: "1",
      asset_type: "URL",
      asset_identifier: "https://api-v2.example.com",
      eligible_for_bounty: true,
      eligible_for_submission: true,
      max_severity: "critical",
      instruction: "Payments and accounts API.",
    },
    {
      id: "2",
      asset_type: "URL",
      asset_identifier: "https://www.example.test",
      eligible_for_bounty: false,
      eligible_for_submission: true,
      max_severity: "low",
    },
    {
      id: "3",
      asset_type: "WILDCARD",
      asset_identifier: "*.example.test",
      eligible_for_bounty: true,
      eligible_for_submission: true,
      max_severity: "high",
    },
  ];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Mocked HackerOne API: one program plus the current scope fixture set. */
function installFetchMock(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));

    if (url.pathname === "/v1/hackers/programs") {
      return jsonResponse({
        data: [
          {
            id: "9001",
            type: "program",
            attributes: {
              handle: "example-corp",
              name: "Example Corp",
              state: "public_mode",
              submission_state: "open",
              currency: "usd",
              offers_bounties: true,
              gold_standard_safe_harbor: true,
              policy: "Only the listed assets are in scope. No denial-of-service testing.",
              average_bounty_lower_amount: 500,
              average_bounty_upper_amount: 20000,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          },
        ],
        links: {},
      });
    }

    if (url.pathname.endsWith("/structured_scopes")) {
      return jsonResponse({
        data: state.scopes.map((scope) => ({
          id: scope.id,
          type: "structured-scope",
          attributes: { ...scope, created_at: "2026-01-01T00:00:00.000Z" },
        })),
        links: {},
      });
    }

    return jsonResponse({ data: [], links: {} });
  });

  vi.stubGlobal("fetch", mock);
  return mock;
}

const { prisma } = await import("@/lib/db");
const { saveCredentials } = await import("@/lib/credentials/store");
const { getAdapter } = await import("@/lib/providers/registry");
const { runProviderSync } = await import("@/lib/sync/engine");
const { setConnectionStatus } = await import("@/lib/credentials/store");
const { drainJobs } = await import("@/lib/jobs/worker");
const { getDashboardMetrics, getTopOpportunities } = await import("@/lib/queries/dashboard");
const { listAssets } = await import("@/lib/queries/assets");
const { assetsQuerySchema } = await import("@/lib/api/schemas");
const { authorize } = await import("@/lib/authorization/scope-authorization");
const { resetDatabase, seedProvider } = await import("./helpers");

beforeEach(async () => {
  await resetDatabase();
  await seedProvider("HACKERONE", "HackerOne");
  state.scopes = baseScopes();
  process.env.AI_PROVIDER = "heuristic";
  vi.unstubAllGlobals();
});

describe("the full vertical slice", () => {
  it("runs from credentials through to a scored dashboard, idempotently", async () => {
    installFetchMock();
    const adapter = getAdapter("HACKERONE");

    // --- 1. Configure credentials -----------------------------------------
    await saveCredentials("HACKERONE", CREDENTIALS);

    const integration = await prisma.providerIntegration.findFirstOrThrow();
    expect(integration.encryptedCredentials).toBeTruthy();
    expect(integration.encryptedCredentials).not.toContain(CREDENTIALS.apiToken);

    // --- 2. Test connection -----------------------------------------------
    const connection = await adapter.testConnection(CREDENTIALS);
    expect(connection.status).toBe("CONNECTED");
    await setConnectionStatus("HACKERONE", connection.status);

    expect((await prisma.providerIntegration.findFirstOrThrow()).connectionStatus).toBe("CONNECTED");

    // --- 3. Sync now -------------------------------------------------------
    const first = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(first.status).toBe("SUCCESS");
    expect(first.programsCreated).toBe(1);
    expect(first.scopesCreated).toBe(3);
    expect(first.changesDetected).toBe(3); // one ASSET_ADDED per scope
    expect(first.aiJobsEnqueued).toBe(3);

    // --- 4. Normalized records --------------------------------------------
    const program = await prisma.program.findFirstOrThrow();
    expect(program.name).toBe("Example Corp");
    expect(program.safeHarbor).toBe("FULL");
    expect(program.bountyMax).toBe(20000);

    const scopes = await prisma.scope.findMany({ orderBy: { assetIdentifier: "asc" } });
    expect(scopes.map((scope) => scope.assetIdentifier)).toEqual([
      "*.example.test",
      "https://api-v2.example.com",
      "https://www.example.test",
    ]);

    // The generic provider type is refined into API by the identifier.
    const api = scopes.find((scope) => scope.assetIdentifier.includes("api-v2"));
    expect(api?.assetType).toBe("API");
    expect(scopes.find((scope) => scope.assetIdentifier === "*.example.test")?.assetType).toBe(
      "WILDCARD",
    );

    // --- 5. Scope history --------------------------------------------------
    expect(await prisma.scopeVersion.count()).toBe(3);
    expect(await prisma.scopeVersion.count({ where: { validTo: null } })).toBe(3);

    // --- 6. AI evaluations -------------------------------------------------
    expect(await prisma.scopeAiEvaluation.count({ where: { status: "PENDING" } })).toBe(3);

    const processed = await drainJobs(50);
    expect(processed).toBeGreaterThanOrEqual(3);

    const completed = await prisma.scopeAiEvaluation.findMany({ where: { status: "COMPLETED" } });
    expect(completed).toHaveLength(3);
    for (const evaluation of completed) {
      expect(evaluation.opportunityScore).toBeGreaterThanOrEqual(0);
      expect(evaluation.opportunityScore).toBeLessThanOrEqual(100);
    }

    // --- 7. Dashboard ------------------------------------------------------
    const metrics = await getDashboardMetrics();
    expect(metrics.programs).toBe(1);
    expect(metrics.activeScopes).toBe(3);
    expect(metrics.newAssets7d).toBe(3);
    // Findings and payouts do not exist yet, so they are reported unavailable
    // rather than as a fabricated zero.
    expect(metrics.findings.available).toBe(false);
    expect(metrics.totalPayout.available).toBe(false);

    const opportunities = await getTopOpportunities(10);
    expect(opportunities).toHaveLength(3);
    // Ranked descending.
    for (let index = 1; index < opportunities.length; index += 1) {
      expect(opportunities[index - 1]!.opportunityScore).toBeGreaterThanOrEqual(
        opportunities[index]!.opportunityScore,
      );
    }
    // The bounty-eligible critical API should outrank the low-severity marketing site.
    expect(opportunities[0]!.assetIdentifier).toBe("https://api-v2.example.com");

    // --- 8. Assets list ----------------------------------------------------
    const assets = await listAssets(assetsQuerySchema.parse({}));
    expect(assets.total).toBe(3);
    expect(assets.unevaluatedCount).toBe(0);
    expect(assets.items[0]!.opportunityScore).not.toBeNull();

    const bountyOnly = await listAssets(assetsQuerySchema.parse({ bountyEligible: "true" }));
    expect(bountyOnly.total).toBe(2);

    // --- 9. Authorization --------------------------------------------------
    const decision = await authorize(api!.id);
    expect(decision.decision).toBe("ALLOW");

    // --- 10. Re-sync identical data ---------------------------------------
    const evaluationsBefore = await prisma.scopeAiEvaluation.count();
    const changesBefore = await prisma.changeEvent.count();
    const versionsBefore = await prisma.scopeVersion.count();

    const second = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(second.status).toBe("SUCCESS");
    expect(second.programsCreated).toBe(0);
    expect(second.scopesCreated).toBe(0);
    expect(second.scopesUpdated).toBe(0);
    expect(second.changesDetected).toBe(0);
    expect(second.aiJobsEnqueued).toBe(0);

    expect(await prisma.program.count()).toBe(1);
    expect(await prisma.scope.count()).toBe(3);
    expect(await prisma.changeEvent.count()).toBe(changesBefore);
    expect(await prisma.scopeVersion.count()).toBe(versionsBefore);
    expect(await prisma.scopeAiEvaluation.count()).toBe(evaluationsBefore);
  });

  it("handles a scope change: version, event, staleness, re-score", async () => {
    installFetchMock();

    await saveCredentials("HACKERONE", CREDENTIALS);
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });
    await drainJobs(50);

    const scope = await prisma.scope.findFirstOrThrow({
      where: { assetIdentifier: "https://api-v2.example.com" },
    });
    const originalEvaluation = await prisma.scopeAiEvaluation.findFirstOrThrow({
      where: { scopeId: scope.id, status: "COMPLETED" },
    });

    // Simulate the provider raising the ceiling and rewriting the instruction.
    state.scopes = state.scopes.map((entry) =>
      entry.id === "1"
        ? { ...entry, instruction: "Now includes the GraphQL gateway.", max_severity: "critical" }
        : entry,
    );

    const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(result.scopesUpdated).toBe(1);
    expect(result.changesDetected).toBe(1);
    expect(result.aiJobsEnqueued).toBe(1);

    const updated = await prisma.scope.findUniqueOrThrow({
      where: { id: scope.id },
      include: { versions: { orderBy: { version: "asc" } } },
    });

    expect(updated.version).toBe(2);
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0]!.validTo).not.toBeNull();
    expect(updated.versions[1]!.validTo).toBeNull();

    const change = await prisma.changeEvent.findFirstOrThrow({
      where: { scopeId: scope.id, changeType: "INSTRUCTION_CHANGED" },
    });
    expect(change.oldValue).toBe("Payments and accounts API.");
    expect(change.newValue).toContain("GraphQL");

    expect(
      (await prisma.scopeAiEvaluation.findUniqueOrThrow({ where: { id: originalEvaluation.id } }))
        .status,
    ).toBe("STALE");

    await drainJobs(50);

    const fresh = await prisma.scopeAiEvaluation.findFirstOrThrow({
      where: { scopeId: scope.id, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    });
    expect(fresh.id).not.toBe(originalEvaluation.id);
    expect(fresh.opportunityScore).not.toBeNull();
  });

  it("handles a scope removal and denies further research on it", async () => {
    installFetchMock();

    await saveCredentials("HACKERONE", CREDENTIALS);
    await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    const scope = await prisma.scope.findFirstOrThrow({
      where: { assetIdentifier: "*.example.test" },
    });
    expect((await authorize(scope.id)).decision).toBe("ALLOW");

    // The provider drops the wildcard from scope.
    state.scopes = state.scopes.filter((entry) => entry.id !== "3");

    const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });
    expect(result.scopesRemoved).toBe(1);

    const removed = await prisma.scope.findUniqueOrThrow({
      where: { id: scope.id },
      include: { versions: true },
    });

    expect(removed.scopeStatus).toBe("REMOVED");
    expect(removed.removedAt).not.toBeNull();
    // History survives.
    expect(removed.versions.length).toBeGreaterThanOrEqual(2);

    await prisma.changeEvent.findFirstOrThrow({
      where: { scopeId: scope.id, changeType: "ASSET_REMOVED" },
    });

    // The safety gate now refuses active research.
    const decision = await authorize(scope.id);
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons).toContain("SCOPE_REMOVED");

    // And it disappears from the default (in-scope) asset view.
    const assets = await listAssets(assetsQuerySchema.parse({}));
    expect(assets.items.map((item) => item.assetIdentifier)).not.toContain("*.example.test");
  });

  it("records an auth failure honestly instead of a fake success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ errors: [] }, 401)),
    );

    await saveCredentials("HACKERONE", CREDENTIALS);

    const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("HTTP_401");

    const integration = await prisma.providerIntegration.findFirstOrThrow();
    expect(integration.connectionStatus).toBe("AUTH_ERROR");
    expect(integration.lastSuccessfulSyncAt).toBeNull();
    expect(integration.lastAttemptedSyncAt).not.toBeNull();
    // Nothing was imported.
    expect(await prisma.program.count()).toBe(0);
  });

  it("keeps the sync green when AI evaluation fails", async () => {
    installFetchMock();
    await saveCredentials("HACKERONE", CREDENTIALS);

    const { getAiProvider } = await import("@/lib/ai/provider");
    const provider = await getAiProvider();
    const spy = vi
      .spyOn(provider, "evaluateScope")
      .mockRejectedValue(new Error("AI backend is down"));

    try {
      const result = await runProviderSync("HACKERONE", { triggerType: "MANUAL" });

      // The sync itself succeeds; AI is downstream and non-blocking.
      expect(result.status).toBe("SUCCESS");
      expect(result.scopesCreated).toBe(3);

      await drainJobs(50);

      expect(await prisma.scopeAiEvaluation.count({ where: { status: "FAILED" } })).toBe(3);
      // The imported data is intact regardless.
      expect(await prisma.scope.count()).toBe(3);

      // Unevaluated assets surface as "not evaluated", never as score 0.
      const assets = await listAssets(assetsQuerySchema.parse({}));
      expect(assets.unevaluatedCount).toBe(3);
      for (const item of assets.items) {
        expect(item.opportunityScore).toBeNull();
      }
    } finally {
      spy.mockRestore();
    }
  });
});
