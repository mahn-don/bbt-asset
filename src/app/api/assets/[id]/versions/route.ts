import { NextResponse } from "next/server";
import { jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assets/:id/versions - full scope version history. */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;

  const versions = await prisma.scopeVersion.findMany({
    where: { scopeId: id as string },
    orderBy: { version: "desc" },
    take: 200,
  });

  return jsonOk({ versions });
});
