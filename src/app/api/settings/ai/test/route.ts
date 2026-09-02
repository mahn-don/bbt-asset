import { NextResponse } from "next/server";
import { jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { getAiProvider, resetAiProviderCache } from "@/lib/ai/provider";
import { getAiSettings, setAiConnectionStatus } from "@/lib/ai/settings";
import { AiUnavailableError } from "@/lib/ai/types";
import { connectionResultFor } from "@/lib/ai/openai";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/settings/ai/test
 *
 * Server-side credential check. The key never leaves the server, and the probe
 * is a single minimal request - never a full scope evaluation.
 *
 * `noFallback` is important: without it the resolver would quietly hand back
 * the rule engine and the test would report a success that says nothing about
 * the configured provider.
 */
export const POST = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);

  const settings = await getAiSettings();

  if (settings.provider === "HEURISTIC") {
    await setAiConnectionStatus("NOT_CONFIGURED", {
      code: "HEURISTIC",
      summary: "No AI model provider is configured.",
    });
    return jsonOk({
      result: {
        status: "NOT_CONFIGURED",
        code: "HEURISTIC",
        messageKey: "aiSettings.notConfiguredBody",
      },
      settings: await getAiSettings(),
    });
  }

  resetAiProviderCache();

  try {
    const provider = await getAiProvider({ noFallback: true });
    const result = await provider.testConnection();

    await setAiConnectionStatus(
      result.status,
      result.status === "CONNECTED"
        ? undefined
        : { code: result.code, summary: result.messageKey },
    );

    logger.info("ai connection test completed", {
      provider: settings.provider,
      status: result.status,
    });

    return jsonOk({ result, settings: await getAiSettings() });
  } catch (error) {
    const result = connectionResultFor(
      error instanceof AiUnavailableError ? error : new AiUnavailableError("unknown"),
    );

    await setAiConnectionStatus(result.status, {
      code: result.code,
      summary: result.messageKey,
    });

    return jsonOk({ result, settings: await getAiSettings() });
  }
});
