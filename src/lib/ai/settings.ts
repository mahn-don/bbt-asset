import "server-only";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  buildCredentialHint,
  decryptCredentials,
  encryptCredentials,
} from "@/lib/crypto/credentials";

/**
 * AI configuration store.
 *
 * The API key reuses the exact AES-256-GCM envelope used for bug bounty
 * provider credentials — same master key, same key-rotation support, same
 * additional-authenticated-data binding. There is only one place in this
 * codebase that encrypts secrets.
 *
 * Nothing here returns the plaintext key except `loadApiKey`, which is
 * server-only and consumed solely by provider constructors.
 */

export const AI_SETTINGS_ID = "default";

export const AI_PROVIDER_KINDS = [
  "ANTHROPIC",
  "OPENAI",
  "OPENAI_COMPATIBLE",
  "HEURISTIC",
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export function isAiProviderKind(value: unknown): value is AiProviderKind {
  return typeof value === "string" && (AI_PROVIDER_KINDS as readonly string[]).includes(value);
}

/** Providers that need an API key to function. */
export function requiresApiKey(kind: AiProviderKind): boolean {
  return kind === "ANTHROPIC" || kind === "OPENAI" || kind === "OPENAI_COMPATIBLE";
}

/**
 * Model catalogue per provider.
 *
 * These populate the model dropdown. "Custom model ID" is always available, so
 * a model released after this build can still be selected — the UI is never
 * hard-locked to a fixed list.
 */
export const MODEL_CATALOGUE: Record<AiProviderKind, { id: string; label: string }[]> = {
  ANTHROPIC: [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  OPENAI: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],
  OPENAI_COMPATIBLE: [],
  HEURISTIC: [],
};

export const DEFAULT_MODEL: Record<AiProviderKind, string> = {
  ANTHROPIC: "claude-opus-5",
  OPENAI: "gpt-5",
  OPENAI_COMPATIBLE: "",
  HEURISTIC: "rule-based-v1",
};

/** Additional authenticated data binding the ciphertext to this record. */
const AAD = "ai-settings:default";

export interface AiSettingsRecord {
  provider: AiProviderKind;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  credentialHint: string | null;
  connectionStatus: string;
  lastTestedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  enabled: boolean;
  scopeEvaluationEnabled: boolean;
  changeAnalysisEnabled: boolean;
  autoEvaluateNewScopes: boolean;
  autoReevaluateChangedScopes: boolean;
  heuristicFallbackEnabled: boolean;
  temperature: number | null;
  maxTokens: number | null;
  /**
   * True when ANTHROPIC_API_KEY is present in the environment. Surfaced so the
   * UI can explain precedence; the value itself never leaves the server.
   */
  environmentKeyPresent: boolean;
}

export async function ensureAiSettings() {
  const existing = await prisma.aiSettings.findUnique({ where: { id: AI_SETTINGS_ID } });
  if (existing) return existing;

  // Seed from the environment so an existing env-configured deployment keeps
  // working without anyone touching the new settings page.
  const envProvider = serverEnv.aiProvider === "anthropic" ? "ANTHROPIC" : "HEURISTIC";

  return prisma.aiSettings.create({
    data: {
      id: AI_SETTINGS_ID,
      provider: envProvider,
      model: envProvider === "ANTHROPIC" ? serverEnv.aiModel : null,
      enabled: serverEnv.aiEnabled,
      scopeEvaluationEnabled: serverEnv.aiScopeEvaluationEnabled,
      changeAnalysisEnabled: serverEnv.aiChangeAnalysisEnabled,
      autoEvaluateNewScopes: serverEnv.aiAutoEvaluateNewScopes,
      autoReevaluateChangedScopes: serverEnv.aiAutoReevaluateChangedScopes,
    },
  });
}

/** Redacted view, safe to return over the API. */
export async function getAiSettings(): Promise<AiSettingsRecord> {
  const row = await ensureAiSettings();

  return {
    provider: (isAiProviderKind(row.provider) ? row.provider : "HEURISTIC") as AiProviderKind,
    model: row.model,
    baseUrl: row.baseUrl,
    hasApiKey: Boolean(row.encryptedApiKey),
    credentialHint: row.credentialHint,
    connectionStatus: row.connectionStatus,
    lastTestedAt: row.lastTestedAt,
    lastErrorCode: row.lastErrorCode,
    lastErrorSummary: row.lastErrorSummary,
    enabled: row.enabled,
    scopeEvaluationEnabled: row.scopeEvaluationEnabled,
    changeAnalysisEnabled: row.changeAnalysisEnabled,
    autoEvaluateNewScopes: row.autoEvaluateNewScopes,
    autoReevaluateChangedScopes: row.autoReevaluateChangedScopes,
    heuristicFallbackEnabled: row.heuristicFallbackEnabled,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    environmentKeyPresent: Boolean(serverEnv.anthropicApiKey),
  };
}

export interface AiSettingsUpdate {
  provider?: AiProviderKind;
  model?: string | null;
  baseUrl?: string | null;
  /** Only written when a non-empty value is supplied. */
  apiKey?: string;
  enabled?: boolean;
  scopeEvaluationEnabled?: boolean;
  changeAnalysisEnabled?: boolean;
  autoEvaluateNewScopes?: boolean;
  autoReevaluateChangedScopes?: boolean;
  heuristicFallbackEnabled?: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
}

export async function saveAiSettings(update: AiSettingsUpdate): Promise<AiSettingsRecord> {
  const current = await ensureAiSettings();

  const data: Record<string, unknown> = {};

  if (update.provider !== undefined) data.provider = update.provider;
  if (update.model !== undefined) data.model = update.model?.trim() || null;
  if (update.baseUrl !== undefined) data.baseUrl = update.baseUrl?.trim() || null;
  if (update.enabled !== undefined) data.enabled = update.enabled;
  if (update.scopeEvaluationEnabled !== undefined) {
    data.scopeEvaluationEnabled = update.scopeEvaluationEnabled;
  }
  if (update.changeAnalysisEnabled !== undefined) {
    data.changeAnalysisEnabled = update.changeAnalysisEnabled;
  }
  if (update.autoEvaluateNewScopes !== undefined) {
    data.autoEvaluateNewScopes = update.autoEvaluateNewScopes;
  }
  if (update.autoReevaluateChangedScopes !== undefined) {
    data.autoReevaluateChangedScopes = update.autoReevaluateChangedScopes;
  }
  if (update.heuristicFallbackEnabled !== undefined) {
    data.heuristicFallbackEnabled = update.heuristicFallbackEnabled;
  }
  if (update.temperature !== undefined) data.temperature = update.temperature;
  if (update.maxTokens !== undefined) data.maxTokens = update.maxTokens;

  // A blank key field means "leave the stored key alone", never "erase it".
  // Deleting is an explicit, separate action.
  const newKey = update.apiKey?.trim();
  if (newKey) {
    const envelope = encryptCredentials({ apiKey: newKey }, AAD);
    data.encryptedApiKey = envelope.ciphertext;
    data.credentialKeyId = envelope.keyId;
    data.credentialVersion = { increment: 1 };
    data.credentialHint = buildCredentialHint({ apiKey: newKey }, [
      { key: "apiKey", secret: true, label: "API Key" },
    ]);
    // A replaced key has not been verified yet.
    data.connectionStatus = "NOT_CONFIGURED";
    data.lastErrorCode = null;
    data.lastErrorSummary = null;
  }

  // Switching provider invalidates any previous verification.
  if (update.provider !== undefined && update.provider !== current.provider) {
    data.connectionStatus = "NOT_CONFIGURED";
    data.lastErrorCode = null;
    data.lastErrorSummary = null;
  }

  await prisma.aiSettings.update({ where: { id: AI_SETTINGS_ID }, data });

  logger.info("ai settings saved", {
    provider: update.provider ?? current.provider,
    keyReplaced: Boolean(newKey),
  });

  return getAiSettings();
}

export async function deleteAiApiKey(): Promise<AiSettingsRecord> {
  await ensureAiSettings();

  await prisma.aiSettings.update({
    where: { id: AI_SETTINGS_ID },
    data: {
      encryptedApiKey: null,
      credentialKeyId: null,
      credentialHint: null,
      connectionStatus: "NOT_CONFIGURED",
      lastTestedAt: null,
      lastErrorCode: null,
      lastErrorSummary: null,
    },
  });

  logger.info("ai api key deleted");
  return getAiSettings();
}

/**
 * Decrypted API key for server-side provider construction.
 *
 * Falls back to ANTHROPIC_API_KEY so an environment-configured deployment
 * continues to work; a key saved through the settings page takes precedence.
 */
export async function loadApiKey(): Promise<string | null> {
  const row = await ensureAiSettings();

  if (row.encryptedApiKey) {
    try {
      return decryptCredentials(row.encryptedApiKey, AAD).apiKey ?? null;
    } catch (error) {
      logger.error("could not decrypt the stored AI API key", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return null;
    }
  }

  if (row.provider === "ANTHROPIC" && serverEnv.anthropicApiKey) {
    return serverEnv.anthropicApiKey;
  }

  return null;
}

export async function setAiConnectionStatus(
  status: string,
  error?: { code?: string; summary?: string },
): Promise<void> {
  await ensureAiSettings();
  await prisma.aiSettings.update({
    where: { id: AI_SETTINGS_ID },
    data: {
      connectionStatus: status,
      lastTestedAt: new Date(),
      lastErrorCode: error?.code ?? null,
      lastErrorSummary: error?.summary ?? null,
    },
  });
}
