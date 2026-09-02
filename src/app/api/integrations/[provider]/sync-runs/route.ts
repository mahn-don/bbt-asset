import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseQuery, requireApiUser, withApi } from "@/lib/api/http";
import { providerSlugSchema, syncRunsQuerySchema } from "@/lib/api/schemas";
import { listSyncRuns } from "@/lib/queries/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations/:provider/sync-runs */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;

  const parsed = providerSlugSchema.safeParse(provider?.toUpperCase());
  if (!parsed.success) throw new ApiError(404, "UNKNOWN_PROVIDER", "No such provider.");

  const query = parseQuery(request, syncRunsQuerySchema);
  return jsonOk({ syncRuns: await listSyncRuns(parsed.data, query.limit) });
});
