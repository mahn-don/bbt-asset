import { NextResponse } from "next/server";
import { jsonOk, parseQuery, requireApiUser, withApi } from "@/lib/api/http";
import { assetsQuerySchema } from "@/lib/api/schemas";
import { listAssets } from "@/lib/queries/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assets - filtered, sorted asset inventory. */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const query = parseQuery(request, assetsQuerySchema);
  return jsonOk(await listAssets(query));
});
