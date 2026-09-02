import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { aiSettingsSchema } from "@/lib/api/settings-schemas";
import { getAiSettings, requiresApiKey, saveAiSettings } from "@/lib/ai/settings";
import { resetAiProviderCache } from "@/lib/ai/provider";
import { normalizeBaseUrl } from "@/lib/ai/openai";
import { AiUnavailableError } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/ai
 *
 * Returns the redacted configuration. `getAiSettings` exposes `hasApiKey` and a
 * masked hint; the plaintext key is not part of that shape, so it cannot leak
 * through this endpoint by accident.
 */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  return jsonOk(await getAiSettings());
});

/** PUT /api/settings/ai - save configuration (and optionally replace the key). */
export const PUT = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const body = await parseJsonBody(request, aiSettingsSchema);

  // A custom endpoint must have a validated https origin before anything is
  // stored, so a bad value never reaches the outbound request path.
  let baseUrl: string | null = null;
  if (body.provider === "OPENAI_COMPATIBLE") {
    try {
      baseUrl = normalizeBaseUrl(body.baseUrl ?? null);
    } catch (error) {
      throw new ApiError(
        422,
        "INVALID_BASE_URL",
        error instanceof AiUnavailableError ? error.message : "The base URL is invalid.",
      );
    }

    if (!baseUrl) {
      throw new ApiError(
        422,
        "INVALID_BASE_URL",
        "A base URL is required for an OpenAI-compatible endpoint.",
      );
    }
  }

  const current = await getAiSettings();

  // Refuse to activate a provider that cannot possibly work: no key stored and
  // none supplied. Reporting this up front beats a confusing runtime fallback.
  if (
    body.enabled &&
    requiresApiKey(body.provider) &&
    !body.apiKey?.trim() &&
    !(current.provider === body.provider && current.hasApiKey)
  ) {
    throw new ApiError(
      422,
      "API_KEY_REQUIRED",
      "This provider needs an API key. Enter one, or choose the heuristic rule engine.",
    );
  }

  const settings = await saveAiSettings({
    provider: body.provider,
    model: body.model ?? null,
    baseUrl,
    apiKey: body.apiKey,
    enabled: body.enabled,
    scopeEvaluationEnabled: body.scopeEvaluationEnabled,
    changeAnalysisEnabled: body.changeAnalysisEnabled,
    autoEvaluateNewScopes: body.autoEvaluateNewScopes,
    autoReevaluateChangedScopes: body.autoReevaluateChangedScopes,
    heuristicFallbackEnabled: body.heuristicFallbackEnabled,
    temperature: body.temperature ?? null,
    maxTokens: body.maxTokens ?? null,
  });

  // The cached provider instance is now stale.
  resetAiProviderCache();

  return jsonOk(settings);
});
