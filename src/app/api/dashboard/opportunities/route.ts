import { NextResponse } from "next/server";
import { jsonOk, parseQuery, requireApiUser, withApi } from "@/lib/api/http";
import { opportunitiesQuerySchema } from "@/lib/api/schemas";
import { getDashboardMetrics, getTopOpportunities } from "@/lib/queries/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/dashboard/opportunities */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const query = parseQuery(request, opportunitiesQuerySchema);

  const [opportunities, metrics] = await Promise.all([
    getTopOpportunities(query.limit),
    getDashboardMetrics(),
  ]);

  return jsonOk({ opportunities, metrics });
});
