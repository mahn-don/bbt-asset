import { NextResponse } from "next/server";
import { jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { authorize } from "@/lib/authorization/scope-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/assets/:id/authorization
 *
 * The safety gate, exposed so any future active-research tooling can check
 * authorization before acting.
 */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;
  return jsonOk(await authorize(id as string));
});
