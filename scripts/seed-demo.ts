/**
 * Demo data.
 *
 * Creates a MANUAL program with obviously fake assets so the UI can be
 * explored without provider credentials. Uses reserved example domains only
 * (example.com / .test), and contains no real program or credential data.
 *
 *   npm run seed:demo
 */
import "../src/lib/load-env";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma";
import { getAdapter } from "../src/lib/providers/registry";
import { programContentHash, scopeContentHash, canonicalScope } from "../src/lib/sync/canonical";
import { stableStringify } from "../src/lib/canonical/hash";

const DEMO_SCOPES = [
  {
    assetIdentifier: "api-v2.example.com",
    assetType: "API",
    eligibleForBounty: true,
    eligibleForSubmission: true,
    maxSeverity: "CRITICAL",
    instruction: "Public GraphQL and REST surface. Multi-tenant; respect rate limits.",
  },
  {
    assetIdentifier: "accounts.example.com",
    assetType: "URL",
    eligibleForBounty: true,
    eligibleForSubmission: true,
    maxSeverity: "CRITICAL",
    instruction: "Authentication, SSO and OAuth flows. Account takeover is in scope.",
  },
  {
    assetIdentifier: "*.example.test",
    assetType: "WILDCARD",
    eligibleForBounty: true,
    eligibleForSubmission: true,
    maxSeverity: "HIGH",
    instruction: "All subdomains except those explicitly listed as out of scope.",
  },
  {
    assetIdentifier: "com.example.mobile",
    assetType: "ANDROID",
    eligibleForBounty: true,
    eligibleForSubmission: true,
    maxSeverity: "HIGH",
    instruction: "Android client. Backend interaction issues are in scope.",
  },
  {
    assetIdentifier: "mobile.example.test",
    assetType: "IOS",
    eligibleForBounty: false,
    eligibleForSubmission: true,
    maxSeverity: "MEDIUM",
  },
  {
    assetIdentifier: "www.example.test",
    assetType: "URL",
    eligibleForBounty: false,
    eligibleForSubmission: true,
    maxSeverity: "LOW",
    instruction: "Marketing site. Low severity only; no automated scanning.",
  },
  {
    assetIdentifier: "legacy.example.test",
    assetType: "URL",
    eligibleForBounty: false,
    eligibleForSubmission: false,
    maxSeverity: "NONE",
    instruction: "Deprecated. Out of scope.",
    scopeStatus: "OUT_OF_SCOPE",
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  const adapter = getAdapter("MANUAL");

  try {
    const provider = await prisma.provider.findUnique({ where: { slug: "MANUAL" } });
    if (!provider) {
      throw new Error("The MANUAL provider is not seeded. Run `npm run seed:providers` first.");
    }

    const normalizedProgram = adapter.normalizeProgram({
      handleOrSlug: "demo-corp",
      name: "Demo Corp (example data)",
      sourceUrl: "https://example.com/security",
      status: "ACTIVE",
      visibility: "PUBLIC",
      policy:
        "This is fabricated demo policy text for local exploration only. " +
        "Testing is limited to the listed assets. No denial-of-service testing. " +
        "No social engineering. Safe harbour applies to good-faith research.",
      bountyMin: 250,
      bountyMax: 15000,
      currency: "USD",
      safeHarbor: "FULL",
    });

    const now = new Date();
    const program = await prisma.program.upsert({
      where: {
        providerId_externalId: {
          providerId: provider.id,
          externalId: normalizedProgram.externalId,
        },
      },
      create: {
        providerId: provider.id,
        externalId: normalizedProgram.externalId,
        handleOrSlug: normalizedProgram.handleOrSlug,
        name: normalizedProgram.name,
        sourceUrl: normalizedProgram.sourceUrl ?? null,
        status: normalizedProgram.status,
        visibility: normalizedProgram.visibility,
        policy: normalizedProgram.policy ?? null,
        bountyMin: normalizedProgram.bountyMin ?? null,
        bountyMax: normalizedProgram.bountyMax ?? null,
        currency: normalizedProgram.currency ?? null,
        safeHarbor: normalizedProgram.safeHarbor ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSyncedAt: now,
        contentHash: programContentHash(normalizedProgram),
      },
      update: { lastSeenAt: now, lastSyncedAt: now },
    });

    let created = 0;
    for (const input of DEMO_SCOPES) {
      const normalized = adapter.normalizeScope(input);
      const hash = scopeContentHash(normalized);

      const existing = await prisma.scope.findUnique({
        where: {
          programId_assetIdentifier_assetType: {
            programId: program.id,
            assetIdentifier: normalized.assetIdentifier,
            assetType: normalized.assetType,
          },
        },
      });

      if (existing) continue;

      const scope = await prisma.scope.create({
        data: {
          programId: program.id,
          assetIdentifier: normalized.assetIdentifier,
          assetType: normalized.assetType,
          scopeStatus: normalized.scopeStatus,
          eligibleForSubmission: normalized.eligibleForSubmission,
          eligibleForBounty: normalized.eligibleForBounty,
          maxSeverity: normalized.maxSeverity ?? null,
          instruction: normalized.instruction ?? null,
          providerMetadata: stableStringify(normalized.providerMetadata ?? {}),
          firstSeenAt: now,
          lastSeenAt: now,
          contentHash: hash,
          version: 1,
        },
      });

      await prisma.scopeVersion.create({
        data: {
          scopeId: scope.id,
          version: 1,
          canonicalSnapshot: stableStringify(canonicalScope(normalized)),
          contentHash: hash,
          validFrom: now,
        },
      });

      await prisma.changeEvent.create({
        data: {
          providerId: provider.id,
          programId: program.id,
          scopeId: scope.id,
          changeType: "ASSET_ADDED",
          newValue: normalized.assetIdentifier,
          importance: normalized.eligibleForBounty ? "HIGH" : "LOW",
        },
      });

      created += 1;
    }

    console.log(`Demo program ready: ${program.name} (${created} new scope(s)).`);
    console.log("Queue AI evaluations from the asset pages, or run `npm run worker`.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
