import { NextResponse } from "next/server";
import { jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { listIntegrationSummaries } from "@/lib/queries/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations - all provider integration cards (never includes secrets). */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  return jsonOk({ integrations: await listIntegrationSummaries() });
});
