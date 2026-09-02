/**
 * Evaluation dataset.
 *
 * Builds a realistic multi-program inventory by driving the REAL sync pipeline
 * (normalise -> hash -> upsert -> version -> diff -> queue), so scope versions,
 * change events and sync runs are genuine records rather than hand-inserted
 * rows. Three simulated syncs over time produce real change history.
 *
 * Fictional companies on reserved example.* domains only.
 *
 *   npm run seed:eval
 */
import "../src/lib/load-env";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma";
import { emptyCounters, syncScopes } from "../src/lib/sync/engine";
import { programContentHash } from "../src/lib/sync/canonical";
import { getAdapter } from "../src/lib/providers/registry";
import { enqueueScopeEvaluation } from "../src/lib/ai/evaluate";
import { drainJobs } from "../src/lib/jobs/worker";
import { logger } from "../src/lib/logger";
import type { NormalizedScope } from "../src/lib/providers/types";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

interface ScopeSpec {
  id: string;
  identifier: string;
  type: string;
  bounty: boolean;
  severity: string;
  instruction?: string;
}

interface ProgramSpec {
  provider: string;
  externalId: string;
  handle: string;
  name: string;
  bountyMin: number;
  bountyMax: number;
  policy: string;
  scopes: ScopeSpec[];
}

const PROGRAMS: ProgramSpec[] = [
  {
    provider: "HACKERONE",
    externalId: "h1-2001",
    handle: "northwind-commerce",
    name: "Northwind Commerce",
    bountyMin: 250,
    bountyMax: 25000,
    policy:
      "Northwind Commerce operates a global e-commerce platform. Testing is permitted against the " +
      "assets listed below only. No denial-of-service testing. No social engineering of employees " +
      "or customers. Automated scanning must be rate limited to 5 requests per second. Safe harbour " +
      "applies to good-faith research conducted within this policy.",
    scopes: [
      { id: "s1", identifier: "https://api.northwind.example.com", type: "URL", bounty: true, severity: "critical", instruction: "Primary REST and GraphQL API. Payments, orders and account endpoints are in scope." },
      { id: "s2", identifier: "https://accounts.northwind.example.com", type: "URL", bounty: true, severity: "critical", instruction: "Authentication, SSO and OAuth flows. Account takeover is in scope." },
      { id: "s3", identifier: "https://checkout.northwind.example.com", type: "URL", bounty: true, severity: "critical", instruction: "Payment and checkout flow. Do not use real card numbers; use the documented test cards." },
      { id: "s4", identifier: "*.northwind.example.com", type: "WILDCARD", bounty: true, severity: "high" },
      { id: "s5", identifier: "https://admin.northwind.example.com", type: "URL", bounty: true, severity: "critical", instruction: "Merchant admin console. Multi-tenant; tenant isolation issues are high priority." },
      { id: "s6", identifier: "com.northwind.shop", type: "GOOGLE_PLAY_APP_ID", bounty: true, severity: "high" },
      { id: "s7", identifier: "1592837465", type: "APPLE_STORE_APP_ID", bounty: true, severity: "high" },
      { id: "s8", identifier: "https://www.northwind.example.com", type: "URL", bounty: false, severity: "low", instruction: "Marketing site. Low severity only." },
      { id: "s9", identifier: "https://status.northwind.example.com", type: "URL", bounty: false, severity: "low" },
      { id: "s10", identifier: "203.0.113.0/24", type: "CIDR", bounty: true, severity: "high" },
    ],
  },
  {
    provider: "HACKERONE",
    externalId: "h1-2002",
    handle: "cascade-financial",
    name: "Cascade Financial",
    bountyMin: 500,
    bountyMax: 40000,
    policy:
      "Cascade Financial is a regulated financial services provider. Only the listed assets are in " +
      "scope. Testing against production customer accounts is prohibited; use the sandbox. " +
      "No automated scanning without prior written approval. Report all findings within 24 hours.",
    scopes: [
      { id: "c1", identifier: "https://api.cascade.example.com", type: "URL", bounty: true, severity: "critical", instruction: "Core banking API. Requires sandbox credentials, available on request." },
      { id: "c2", identifier: "https://sandbox.cascade.example.com", type: "URL", bounty: true, severity: "high" },
      { id: "c3", identifier: "https://id.cascade.example.com", type: "URL", bounty: true, severity: "critical", instruction: "Identity provider. OAuth and OIDC configuration review welcome." },
      { id: "c4", identifier: "https://webhooks.cascade.example.com", type: "URL", bounty: true, severity: "high", instruction: "Outbound webhook delivery. Webhook trust boundary issues are in scope." },
      { id: "c5", identifier: "https://github.com/cascade-financial/sdk-js", type: "SOURCE_CODE", bounty: true, severity: "medium" },
    ],
  },
  {
    provider: "BUGCROWD",
    externalId: "bc-3001",
    handle: "helios-media",
    name: "Helios Media",
    bountyMin: 100,
    bountyMax: 8000,
    policy:
      "Helios Media runs a video streaming platform. Please avoid degrading service quality for " +
      "other users. No testing against the CDN edge. Rate limit to 10 requests per second.",
    scopes: [
      { id: "m1", identifier: "https://api.helios.example.test", type: "URL", bounty: true, severity: "high", instruction: "Playback and account API." },
      { id: "m2", identifier: "https://upload.helios.example.test", type: "URL", bounty: true, severity: "high", instruction: "Creator upload pipeline. File handling issues are in scope." },
      { id: "m3", identifier: "*.helios.example.test", type: "WILDCARD", bounty: false, severity: "medium" },
      { id: "m4", identifier: "https://legacy.helios.example.test", type: "URL", bounty: false, severity: "low", instruction: "Deprecated. Being decommissioned." },
    ],
  },
];

function toNormalized(spec: ScopeSpec): unknown {
  return {
    id: spec.id,
    type: "structured-scope",
    attributes: {
      asset_type: spec.type,
      asset_identifier: spec.identifier,
      eligible_for_bounty: spec.bounty,
      eligible_for_submission: true,
      max_severity: spec.severity,
      instruction: spec.instruction ?? null,
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  };
}

async function upsertProgram(spec: ProgramSpec): Promise<{ programId: string; providerId: string }> {
  const provider = await prisma.provider.findUniqueOrThrow({ where: { slug: spec.provider } });
  const now = new Date();

  const normalized = {
    externalId: spec.externalId,
    handleOrSlug: spec.handle,
    name: spec.name,
    sourceUrl: `https://${spec.provider.toLowerCase()}.com/${spec.handle}`,
    status: "ACTIVE" as const,
    visibility: "PUBLIC" as const,
    policy: spec.policy,
    bountyMin: spec.bountyMin,
    bountyMax: spec.bountyMax,
    currency: "USD",
    safeHarbor: "FULL" as const,
  };

  const program = await prisma.program.upsert({
    where: { providerId_externalId: { providerId: provider.id, externalId: spec.externalId } },
    create: {
      providerId: provider.id,
      externalId: spec.externalId,
      handleOrSlug: normalized.handleOrSlug,
      name: normalized.name,
      sourceUrl: normalized.sourceUrl,
      status: normalized.status,
      visibility: normalized.visibility,
      policy: normalized.policy,
      bountyMin: normalized.bountyMin,
      bountyMax: normalized.bountyMax,
      currency: normalized.currency,
      safeHarbor: normalized.safeHarbor,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSyncedAt: now,
      contentHash: programContentHash(normalized),
    },
    update: { lastSeenAt: now, lastSyncedAt: now },
  });

  return { programId: program.id, providerId: provider.id };
}

/** Runs one simulated provider sync, producing a real SyncRun record. */
async function simulateSync(
  label: string,
  mutate: (spec: ProgramSpec) => ScopeSpec[],
): Promise<void> {
  const adapter = getAdapter("HACKERONE");
  const log = logger.child({ seed: label });

  for (const providerSlug of ["HACKERONE", "BUGCROWD"]) {
    const provider = await prisma.provider.findUniqueOrThrow({ where: { slug: providerSlug } });
    const counters = emptyCounters();

    const run = await prisma.syncRun.create({
      data: { providerId: provider.id, triggerType: "SCHEDULED", status: "RUNNING" },
    });

    for (const spec of PROGRAMS.filter((p) => p.provider === providerSlug)) {
      const { programId } = await upsertProgram(spec);
      counters.programsReceived += 1;

      const scopes: NormalizedScope[] = mutate(spec).map((scope) =>
        adapter.normalizeScope(toNormalized(scope)),
      );
      counters.scopesReceived += scopes.length;

      await syncScopes(provider.id, providerSlug, programId, run.id, scopes, counters, log, "en");
    }

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(Date.now() + 18_400),
        programsReceived: counters.programsReceived,
        programsCreated: counters.programsCreated,
        programsUpdated: counters.programsUpdated,
        scopesReceived: counters.scopesReceived,
        scopesCreated: counters.scopesCreated,
        scopesUpdated: counters.scopesUpdated,
        scopesRemoved: counters.scopesRemoved,
        changesDetected: counters.changesDetected,
        aiJobsEnqueued: counters.aiJobsEnqueued,
      },
    });

    console.log(
      `  ${label} / ${providerSlug}: +${counters.scopesCreated} ~${counters.scopesUpdated} ` +
        `-${counters.scopesRemoved}, ${counters.changesDetected} changes`,
    );
  }
}

async function main(): Promise<void> {
  console.log("Seeding evaluation dataset…\n");

  // --- Sync 1: initial import -------------------------------------------
  await simulateSync("sync-1 initial", (spec) => spec.scopes);

  // --- Sync 2: the provider changes things ------------------------------
  await simulateSync("sync-2 changes", (spec) => {
    if (spec.handle === "northwind-commerce") {
      return spec.scopes
        // A low-value asset is dropped from scope entirely.
        .filter((s) => s.id !== "s9")
        .map((s) => {
          // The marketing site becomes bounty eligible.
          if (s.id === "s8") return { ...s, bounty: true, severity: "medium" };
          // The admin console instruction is rewritten.
          if (s.id === "s5") {
            return {
              ...s,
              instruction:
                "Merchant admin console. Multi-tenant; tenant isolation issues are high priority. " +
                "NEW: the v2 permissions model is now live - role boundary testing is especially welcome.",
            };
          }
          return s;
        })
        .concat([
          // A brand new, high-value API scope appears.
          {
            id: "s11",
            identifier: "https://api-v2.northwind.example.com",
            type: "URL",
            bounty: true,
            severity: "critical",
            instruction: "New GraphQL gateway. Replaces api.northwind over the next quarter.",
          },
        ]);
    }

    if (spec.handle === "cascade-financial") {
      return spec.scopes.map((s) =>
        // The core banking API ceiling is raised to Critical.
        s.id === "c2" ? { ...s, severity: "critical" } : s,
      );
    }

    return spec.scopes;
  });

  // --- Sync 3: one more new asset ---------------------------------------
  await simulateSync("sync-3 new asset", (spec) => {
    if (spec.handle === "helios-media") {
      return spec.scopes.concat([
        {
          id: "m5",
          identifier: "https://api-partners.helios.example.test",
          type: "URL",
          bounty: true,
          severity: "critical",
          instruction: "Partner integration API. Webhook and OAuth surface.",
        },
      ]);
    }
    if (spec.handle === "northwind-commerce") {
      return spec.scopes
        .filter((s) => s.id !== "s9")
        .map((s) => (s.id === "s8" ? { ...s, bounty: true, severity: "medium" } : s))
        .concat([
          {
            id: "s11",
            identifier: "https://api-v2.northwind.example.com",
            type: "URL",
            bounty: true,
            severity: "critical",
            instruction: "New GraphQL gateway. Replaces api.northwind over the next quarter.",
          },
        ]);
    }
    return spec.scopes;
  });

  // --- Evaluate everything ----------------------------------------------
  console.log("\nQueueing evaluations…");
  const scopes = await prisma.scope.findMany({ select: { id: true } });
  for (const scope of scopes) await enqueueScopeEvaluation(scope.id, { language: "en" });

  let processed = 0;
  for (let i = 0; i < 20; i += 1) {
    const n = await drainJobs(100);
    processed += n;
    if (n === 0) break;
  }
  console.log(`Processed ${processed} AI jobs.`);

  // --- A little research history ----------------------------------------
  const apiScope = await prisma.scope.findFirst({
    where: { assetIdentifier: "https://api.northwind.example.com" },
  });

  if (apiScope) {
    const existing = await prisma.researchSession.findFirst({ where: { scopeId: apiScope.id } });
    if (!existing) {
      const session = await prisma.researchSession.create({
        data: {
          scopeId: apiScope.id,
          title: "Authorization boundary review",
          status: "COMPLETED",
          notes: "Reviewed the order and payment endpoints for horizontal access control.",
          durationMinutes: 180,
        },
      });

      await prisma.finding.create({
        data: {
          scopeId: apiScope.id,
          researchSessionId: session.id,
          title: "IDOR on order detail endpoint",
          severity: "HIGH",
          status: "DUPLICATE",
          notes: "Already reported by another researcher three days earlier.",
          submittedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  const [programs, scopeCount, changes, runs, evals] = await Promise.all([
    prisma.program.count(),
    prisma.scope.count(),
    prisma.changeEvent.count(),
    prisma.syncRun.count(),
    prisma.scopeAiEvaluation.count({ where: { status: "COMPLETED" } }),
  ]);

  console.log(
    `\nDone. ${programs} programs, ${scopeCount} scopes, ${changes} changes, ` +
      `${runs} sync runs, ${evals} completed evaluations.`,
  );

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
