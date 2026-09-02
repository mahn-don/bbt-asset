import { NextResponse } from "next/server";
import { ApiError, jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/assets/:id/review - mark an asset as reviewed by the operator.
 *
 * For MANUAL scope this doubles as the explicit human confirmation the
 * authorization gate requires.
 */
export const POST = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;

  const scope = await prisma.scope.findUnique({ where: { id: id as string } });
  if (!scope) throw new ApiError(404, "NOT_FOUND", "Asset not found.");

  if (scope.scopeStatus === "REMOVED") {
    throw new ApiError(409, "SCOPE_REMOVED", "A removed asset cannot be confirmed as authorized.");
  }

  const updated = await prisma.scope.update({
    where: { id: scope.id },
    data: { reviewedAt: new Date() },
  });

  return jsonOk({ scope: { id: updated.id, reviewedAt: updated.reviewedAt } });
});
