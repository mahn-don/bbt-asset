import { NextResponse } from "next/server";
import { jsonOk, parseQuery, requireApiUser, withApi } from "@/lib/api/http";
import { programsQuerySchema } from "@/lib/api/schemas";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/programs */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const query = parseQuery(request, programsQuerySchema);

  const where: Prisma.ProgramWhereInput = {};
  if (query.provider?.length) where.provider = { slug: { in: query.provider } };
  if (query.status?.length) where.status = { in: query.status };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { handleOrSlug: { contains: query.search } },
    ];
  }

  const [total, programs] = await Promise.all([
    prisma.program.count({ where }),
    prisma.program.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        provider: { select: { slug: true, name: true } },
        _count: { select: { scopes: true } },
      },
    }),
  ]);

  return jsonOk({ programs, total, page: query.page, pageSize: query.pageSize });
});
