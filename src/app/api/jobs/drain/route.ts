import { NextResponse } from "next/server";
import { jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { drainJobs } from "@/lib/jobs/worker";
import { queueDepth } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/jobs/drain - process queued AI jobs on demand.
 *
 * Lets the platform run end to end without a separate worker process during
 * local development. The standalone worker remains the production path.
 */
export const POST = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const processed = await drainJobs(25);
  return jsonOk({ processed, queue: await queueDepth() });
});

/** GET /api/jobs/drain - queue depth only. */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  return jsonOk({ queue: await queueDepth() });
});
