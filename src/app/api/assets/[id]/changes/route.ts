import { NextResponse } from "next/server";
import { jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assets/:id/changes */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;

  const changes = await prisma.changeEvent.findMany({
    where: { scopeId: id as string },
    orderBy: { detectedAt: "desc" },
    take: 200,
  });

  return jsonOk({ changes });
});
