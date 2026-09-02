import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { manualProgramSchema } from "@/lib/api/schemas";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/providers/registry";
import { programContentHash } from "@/lib/sync/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/manual/programs - create or update a manually entered program.
 *
 * Manual input runs through the ManualAdapter's normalizer and the same
 * content-hash pipeline as an API sync, so manual and provider-sourced records
 * are structurally identical - while remaining clearly labelled MANUAL.
 */
export const POST = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const body = await parseJsonBody(request, manualProgramSchema);

  const provider = await prisma.provider.findUnique({ where: { slug: "MANUAL" } });
  if (!provider) throw new ApiError(500, "PROVIDER_MISSING", "The MANUAL provider is not seeded.");

  const normalized = getAdapter("MANUAL").normalizeProgram(body);
  const hash = programContentHash(normalized);
  const now = new Date();

  const program = await prisma.program.upsert({
    where: {
      providerId_externalId: { providerId: provider.id, externalId: normalized.externalId },
    },
    create: {
      providerId: provider.id,
      externalId: normalized.externalId,
      handleOrSlug: normalized.handleOrSlug,
      name: normalized.name,
      sourceUrl: normalized.sourceUrl ?? null,
      status: normalized.status,
      visibility: normalized.visibility,
      policy: normalized.policy ?? null,
      bountyMin: normalized.bountyMin ?? null,
      bountyMax: normalized.bountyMax ?? null,
      currency: normalized.currency ?? null,
      safeHarbor: normalized.safeHarbor ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSyncedAt: now,
      contentHash: hash,
    },
    update: {
      handleOrSlug: normalized.handleOrSlug,
      name: normalized.name,
      sourceUrl: normalized.sourceUrl ?? null,
      status: normalized.status,
      visibility: normalized.visibility,
      policy: normalized.policy ?? null,
      bountyMin: normalized.bountyMin ?? null,
      bountyMax: normalized.bountyMax ?? null,
      currency: normalized.currency ?? null,
      safeHarbor: normalized.safeHarbor ?? null,
      lastSeenAt: now,
      lastSyncedAt: now,
      contentHash: hash,
    },
  });

  return jsonOk({ program });
});
