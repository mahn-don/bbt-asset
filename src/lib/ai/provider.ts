import "server-only";
import { logger } from "@/lib/logger";
import type { AiProvider } from "@/lib/ai/types";
import { AiUnavailableError } from "@/lib/ai/types";
import { HeuristicAiProvider } from "@/lib/ai/heuristic";
import {
  DEFAULT_MODEL,
  getAiSettings,
  loadApiKey,
  requiresApiKey,
  type AiProviderKind,
} from "@/lib/ai/settings";

/**
 * AI provider selection.
 *
 * Configuration now lives in the database (Settings → AI) rather than only in
 * the environment, so an operator can switch provider or rotate a key without
 * a redeploy. Environment variables remain the fallback, which keeps existing
 * deployments working untouched.
 *
 * Resolution order:
 *   1. The configured provider, if it has everything it needs.
 *   2. The heuristic rule engine, when no key is configured or the provider
 *      cannot be constructed — but only when heuristic fallback is enabled.
 *
 * Whatever is returned reports its own `source` (AI_MODEL or HEURISTIC), and
 * that value is persisted on every evaluation. The UI never has to guess
 * whether a score came from a model.
 */

interface ProviderCacheEntry {
  key: string;
  provider: AiProvider;
}

let cache: ProviderCacheEntry | null = null;

async function buildProvider(kind: AiProviderKind, apiKey: string | null): Promise<AiProvider> {
  const settings = await getAiSettings();
  const model = settings.model?.trim() || DEFAULT_MODEL[kind];

  switch (kind) {
    case "ANTHROPIC": {
      const { AnthropicAiProvider } = await import("@/lib/ai/anthropic");
      return new AnthropicAiProvider({
        apiKey: apiKey ?? undefined,
        model,
        maxTokens: settings.maxTokens,
      });
    }

    case "OPENAI": {
      const { OpenAiCompatibleProvider } = await import("@/lib/ai/openai");
      return new OpenAiCompatibleProvider({
        apiKey: apiKey ?? "",
        model,
        providerName: "openai",
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      });
    }

    case "OPENAI_COMPATIBLE": {
      const { OpenAiCompatibleProvider } = await import("@/lib/ai/openai");
      return new OpenAiCompatibleProvider({
        apiKey: apiKey ?? "",
        model,
        baseUrl: settings.baseUrl,
        providerName: "openai-compatible",
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      });
    }

    case "HEURISTIC":
    default:
      return new HeuristicAiProvider();
  }
}

/**
 * Resolves the active provider.
 *
 * @param options.noFallback throw instead of silently degrading to the rule
 *   engine — used by Test Connection, which must report the real failure.
 */
export async function getAiProvider(options: { noFallback?: boolean } = {}): Promise<AiProvider> {
  const settings = await getAiSettings();
  const kind = settings.provider;

  const apiKey = requiresApiKey(kind) ? await loadApiKey() : null;

  const cacheKey = [
    kind,
    settings.model ?? "",
    settings.baseUrl ?? "",
    settings.maxTokens ?? "",
    settings.temperature ?? "",
    apiKey ? "keyed" : "unkeyed",
    options.noFallback ? "strict" : "fallback",
  ].join("|");

  if (cache && cache.key === cacheKey) return cache.provider;

  let provider: AiProvider;

  if (kind === "HEURISTIC") {
    provider = new HeuristicAiProvider();
  } else if (requiresApiKey(kind) && !apiKey) {
    if (options.noFallback) {
      throw new AiUnavailableError("No API key is configured for this provider.", "NO_API_KEY");
    }
    if (!settings.heuristicFallbackEnabled) {
      throw new AiUnavailableError(
        "No API key is configured and heuristic fallback is disabled.",
        "NO_API_KEY",
      );
    }
    logger.warn("no AI API key configured; using the offline rule engine", {
      configuredProvider: kind,
    });
    provider = new HeuristicAiProvider();
  } else {
    try {
      provider = await buildProvider(kind, apiKey);
    } catch (error) {
      if (options.noFallback || !settings.heuristicFallbackEnabled) throw error;
      logger.warn("AI provider could not be constructed; using the offline rule engine", {
        configuredProvider: kind,
        code: error instanceof AiUnavailableError ? error.code : "UNKNOWN",
      });
      provider = new HeuristicAiProvider();
    }
  }

  cache = { key: cacheKey, provider };
  return provider;
}

/**
 * True when a real model will handle evaluations. Drives the "AI MODEL" vs
 * "HEURISTIC" labelling everywhere in the UI.
 */
export async function isModelBacked(): Promise<boolean> {
  const settings = await getAiSettings();
  if (settings.provider === "HEURISTIC") return false;
  if (!requiresApiKey(settings.provider)) return true;
  return (await loadApiKey()) !== null;
}

/** Test hook: forces the next getAiProvider() call to rebuild. */
export function resetAiProviderCache(): void {
  cache = null;
}
