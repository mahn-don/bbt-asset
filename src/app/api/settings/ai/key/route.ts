import { NextResponse } from "next/server";
import { jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { deleteAiApiKey } from "@/lib/ai/settings";
import { resetAiProviderCache } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/settings/ai/key
 *
 * Removes the stored key. Evaluation then falls back to the offline rule
 * engine (when fallback is enabled), which is always labelled HEURISTIC.
 */
export const DELETE = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);

  const settings = await deleteAiApiKey();
  resetAiProviderCache();

  return jsonOk(settings);
});
