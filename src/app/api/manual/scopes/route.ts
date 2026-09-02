import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { manualScopesSchema } from "@/lib/api/schemas";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/providers/registry";
import { emptyCounters, syncScopes } from "@/lib/sync/engine";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/manual/scopes - replace the scope set of a manual program.
 *
 * The submitted list is reconciled through the same `syncScopes` routine used
 * by API providers, so manual entry gets identical versioning, change
 * detection, removal semantics and AI queueing. Assets omitted from the list
 * are marked REMOVED rather than deleted.
 */
export const POST = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const body = await parseJsonBody(request, manualScopesSchema);

  const program = await prisma.program.findUnique({
    where: { id: body.programId },
    include: { provider: true },
  });

  if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found.");

  if (program.provider.slug !== "MANUAL") {
    throw new ApiError(
      409,
      "NOT_MANUAL",
      "Only MANUAL programs accept hand-entered scope. Provider-sourced scope is authoritative and must not be overwritten by hand.",
    );
  }

  const adapter = getAdapter("MANUAL");
  const normalized = body.scopes.map((scope) => adapter.normalizeScope(scope));

  const counters = emptyCounters();
  const log = logger.child({ provider: "MANUAL", programId: program.id });

  await syncScopes(program.providerId, "MANUAL", program.id, null, normalized, counters, log);

  // Explicit operator confirmation is what authorises manual scope; record it
  // only for the entries where the caller actually ticked the box.
  const confirmedIdentifiers = body.scopes
    .filter((scope) => scope.confirmAuthorized)
    .map((scope) => adapter.normalizeScope(scope).assetIdentifier);

  if (confirmedIdentifiers.length > 0) {
    await prisma.scope.updateMany({
      where: { programId: program.id, assetIdentifier: { in: confirmedIdentifiers } },
      data: { reviewedAt: new Date() },
    });
  }

  return jsonOk({
    result: {
      scopesCreated: counters.scopesCreated,
      scopesUpdated: counters.scopesUpdated,
      scopesRemoved: counters.scopesRemoved,
      changesDetected: counters.changesDetected,
      aiJobsEnqueued: counters.aiJobsEnqueued,
      confirmedAuthorized: confirmedIdentifiers.length,
    },
  });
});
