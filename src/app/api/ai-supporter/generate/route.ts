import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { generateSchema } from "@/lib/api/ai-supporter-schema";
import { getAiSettings } from "@/lib/ai/settings";
import { getLocale } from "@/lib/preferences";
import { FOCUS_ASSET_TYPES, selectCandidates } from "@/lib/queries/ai-supporter";
import { enqueueScopeEvaluation, runScopeEvaluation } from "@/lib/ai/evaluate";
import { logger, sanitizeErrorMessage } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A batch of model evaluations can take a while; heuristic is instant.
export const maxDuration = 300;

/**
 * POST /api/ai-supporter/generate
 *
 * Evaluates a bounded, value-prioritised batch of eligible, un-evaluated scope.
 * This is the funnel's expensive tip: deterministic selection picks the highest
 * -value candidates, then exactly those are evaluated synchronously (no more,
 * no unrelated queued work). With the offline rule engine it is instant and
 * free; with a real model it is capped by `limit`.
 */
export const POST = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const body = await parseJsonBody(request, generateSchema);

  const settings = await getAiSettings();
  if (!settings.enabled || !settings.scopeEvaluationEnabled) {
    throw new ApiError(409, "AI_DISABLED", "AI scope evaluation is disabled by configuration.");
  }

  const focus = body.focus?.length ? body.focus : FOCUS_ASSET_TYPES;
  const language = await getLocale();
  const scopeIds = await selectCandidates(focus, body.limit);

  let evaluated = 0;
  let failed = 0;
  for (const scopeId of scopeIds) {
    try {
      // No force: reuse an existing pending evaluation row (syncs queue one per
      // scope) rather than creating a duplicate. Candidates already lack a
      // completed evaluation, so this always yields an id to run.
      const result = await enqueueScopeEvaluation(scopeId, { priority: 10, language });
      if (result.evaluationId) {
        const ok = await runScopeEvaluation(result.evaluationId);
        if (ok) evaluated += 1;
        else failed += 1;
      }
    } catch (error) {
      failed += 1;
      logger.warn("ai-supporter batch item failed", {
        scopeId,
        error: sanitizeErrorMessage(error, 160),
      });
    }
  }

  logger.info("ai-supporter batch complete", { requested: scopeIds.length, evaluated, failed });

  return jsonOk({
    candidatesSelected: scopeIds.length,
    evaluated,
    failed,
    focus,
  });
});
