import { NextResponse } from "next/server";
import { ApiError, jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { getAssetDetail } from "@/lib/queries/assets";
import { authorize } from "@/lib/authorization/scope-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assets/:id */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;

  const scope = await getAssetDetail(id as string);
  if (!scope) throw new ApiError(404, "NOT_FOUND", "Asset not found.");

  return jsonOk({ scope, authorization: await authorize(scope.id) });
});
