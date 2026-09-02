import "server-only";
import { prisma } from "@/lib/db";
import { getAdapter, listAdapters } from "@/lib/providers/registry";
import { getIntegrationView, type IntegrationView } from "@/lib/credentials/store";
import type { CredentialSchema, ProviderCapabilities } from "@/lib/providers/types";

/**
 * Integration summaries for the settings UI.
 *
 * Nothing here can leak a secret: it is built from `getIntegrationView`, which
 * exposes only the masked hint, plus counts and adapter metadata.
 */

export interface IntegrationSummary extends IntegrationView {
  displayName: string;
  capabilities: ProviderCapabilities;
  credentialSchema: CredentialSchema;
  programCount: number;
  activeScopeCount: number;
  lastSyncRun: {
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    programsReceived: number;
    scopesReceived: number;
    changesDetected: number;
    errorSummary: string | null;
  } | null;
}

export async function getIntegrationSummary(providerSlug: string): Promise<IntegrationSummary> {
  const adapter = getAdapter(providerSlug);
  const view = await getIntegrationView(providerSlug);

  const provider = await prisma.provider.findUnique({
    where: { slug: providerSlug.toUpperCase() },
  });

  if (!provider) throw new Error(`Provider "${providerSlug}" is not registered.`);

  const [programCount, activeScopeCount, lastSyncRun] = await Promise.all([
    prisma.program.count({ where: { providerId: provider.id } }),
    prisma.scope.count({
      where: { scopeStatus: "IN_SCOPE", program: { providerId: provider.id } },
    }),
    prisma.syncRun.findFirst({
      where: { providerId: provider.id },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        programsReceived: true,
        scopesReceived: true,
        changesDetected: true,
        errorSummary: true,
      },
    }),
  ]);

  return {
    ...view,
    displayName: adapter.displayName,
    capabilities: adapter.getCapabilities(),
    credentialSchema: adapter.credentialSchema(),
    programCount,
    activeScopeCount,
    lastSyncRun,
  };
}

export async function listIntegrationSummaries(): Promise<IntegrationSummary[]> {
  const summaries: IntegrationSummary[] = [];
  for (const adapter of listAdapters()) {
    summaries.push(await getIntegrationSummary(adapter.providerSlug));
  }
  return summaries;
}

export async function listSyncRuns(providerSlug: string, limit = 20) {
  const provider = await prisma.provider.findUnique({
    where: { slug: providerSlug.toUpperCase() },
    select: { id: true },
  });

  if (!provider) return [];

  return prisma.syncRun.findMany({
    where: { providerId: provider.id },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
