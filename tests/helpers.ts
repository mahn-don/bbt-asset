import { prisma } from "@/lib/db";
import type { ProviderAdapter } from "@/lib/providers/types";

/**
 * Test helpers.
 *
 * `resetDatabase` truncates in dependency order rather than dropping the
 * schema, so each test starts from a known-empty state without re-running
 * migrations.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.aiSettings.deleteMany();
  await prisma.scopeAiEvaluation.deleteMany();
  await prisma.changeEvent.deleteMany();
  await prisma.scopeVersion.deleteMany();
  await prisma.finding.deleteMany();
  await prisma.researchSession.deleteMany();
  await prisma.scope.deleteMany();
  await prisma.program.deleteMany();
  await prisma.syncRun.deleteMany();
  await prisma.job.deleteMany();
  await prisma.providerIntegration.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedProvider(slug: string, name = slug): Promise<string> {
  const provider = await prisma.provider.upsert({
    where: { slug },
    create: { slug, name, enabled: true },
    update: { enabled: true },
  });

  await prisma.providerIntegration.upsert({
    where: { providerId: provider.id },
    create: { providerId: provider.id, enabled: true, connectionStatus: "CONNECTED" },
    update: { enabled: true, connectionStatus: "CONNECTED" },
  });

  return provider.id;
}

/**
 * A fake provider adapter driven by scripted pages, so pagination, malformed
 * payloads and HTTP failures can be exercised without a network.
 */
export interface FakePage<T> {
  items: T[];
  nextCursor?: string;
}

export function countingAdapter(
  base: ProviderAdapter,
  counters: { programCalls: number; scopeCalls: number },
): ProviderAdapter {
  return {
    ...base,
    providerSlug: base.providerSlug,
    displayName: base.displayName,
    credentialSchema: () => base.credentialSchema(),
    validateCredentials: (credentials) => base.validateCredentials(credentials),
    testConnection: (credentials) => base.testConnection(credentials),
    fetchPrograms: async (context, cursor) => {
      counters.programCalls += 1;
      return base.fetchPrograms(context, cursor);
    },
    fetchProgram: (context, id) => base.fetchProgram(context, id),
    fetchScopes: async (context, program, cursor) => {
      counters.scopeCalls += 1;
      return base.fetchScopes(context, program, cursor);
    },
    normalizeProgram: (raw) => base.normalizeProgram(raw),
    normalizeScope: (raw) => base.normalizeScope(raw),
    getCapabilities: () => base.getCapabilities(),
    getRateLimitPolicy: () => base.getRateLimitPolicy(),
  };
}
