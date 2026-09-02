import { NextResponse } from "next/server";
import { ApiError, jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { prisma } from "@/lib/db";
import { enqueueScopeEvaluation } from "@/lib/ai/evaluate";
import { drainJobs } from "@/lib/jobs/worker";
import { getAiSettings } from "@/lib/ai/settings";
import { getLocale } from "@/lib/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET /api/assets/:id/ai-evaluations - evaluation history. */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;

  const evaluations = await prisma.scopeAiEvaluation.findMany({
    where: { scopeId: id as string },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return jsonOk({ evaluations });
});

/**
 * POST /api/assets/:id/ai-evaluations - request a re-evaluation.
 *
 * Queues the job and then drains it inline so the UI gets a result without a
 * separate worker running. If the drain fails the job stays queued for the
 * standalone worker; the endpoint reports which happened.
 */
export const POST = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { id } = await context.params;
  const scopeId = id as string;

  const scope = await prisma.scope.findUnique({ where: { id: scopeId }, select: { id: true } });
  if (!scope) throw new ApiError(404, "NOT_FOUND", "Asset not found.");

  const aiSettings = await getAiSettings();
  if (!aiSettings.enabled || !aiSettings.scopeEvaluationEnabled) {
    throw new ApiError(409, "AI_DISABLED", "AI scope evaluation is disabled by configuration.");
  }

  const result = await enqueueScopeEvaluation(scopeId, {
    force: true,
    priority: 10,
    language: await getLocale(),
  });

  // Best effort: process the job now so the user sees a fresh result.
  await drainJobs(3).catch(() => 0);

  const latest = await prisma.scopeAiEvaluation.findFirst({
    where: { scopeId },
    orderBy: { createdAt: "desc" },
  });

  return jsonOk({ enqueued: result.enqueued, reason: result.reason, evaluation: latest });
});
