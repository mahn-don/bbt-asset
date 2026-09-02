import { NextResponse } from "next/server";
import { jsonOk, parseQuery, requireApiUser, withApi } from "@/lib/api/http";
import { changesQuerySchema } from "@/lib/api/schemas";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/changes - the change feed. */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const query = parseQuery(request, changesQuerySchema);

  const where: Prisma.ChangeEventWhereInput = {};
  if (query.changeType?.length) where.changeType = { in: query.changeType };
  if (query.importance?.length) where.importance = { in: query.importance };
  if (query.programId) where.programId = query.programId;
  if (query.scopeId) where.scopeId = query.scopeId;
  if (query.provider?.length) where.provider = { slug: { in: query.provider } };
  if (query.sinceHours) {
    where.detectedAt = { gte: new Date(Date.now() - query.sinceHours * 60 * 60 * 1000) };
  }

  const [total, changes] = await Promise.all([
    prisma.changeEvent.count({ where }),
    prisma.changeEvent.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        provider: { select: { slug: true } },
        program: { select: { id: true, name: true } },
        scope: { select: { id: true, assetIdentifier: true, assetType: true } },
      },
    }),
  ]);

  return jsonOk({ changes, total, page: query.page, pageSize: query.pageSize });
});
