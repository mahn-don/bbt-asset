import { NextResponse } from "next/server";
import { ApiError, jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/programs/:id */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;

  const program = await prisma.program.findUnique({
    where: { id: id as string },
    include: {
      provider: true,
      scopes: { orderBy: { assetIdentifier: "asc" }, take: 500 },
      _count: { select: { scopes: true, changeEvents: true } },
    },
  });

  if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found.");
  return jsonOk({ program });
});
