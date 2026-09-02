import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  deleteAiApiKey,
  getAiSettings,
  loadApiKey,
  requiresApiKey,
  saveAiSettings,
} from "@/lib/ai/settings";
import { getAiProvider, isModelBacked, resetAiProviderCache } from "@/lib/ai/provider";
import { normalizeBaseUrl } from "@/lib/ai/openai";
import { AiUnavailableError } from "@/lib/ai/types";
import { resetDatabase } from "./helpers";

/**
 * AI settings: encrypted key storage, redaction, provider resolution and the
 * heuristic fallback.
 */

const KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123456789";

beforeEach(async () => {
  await resetDatabase();
  resetAiProviderCache();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("configuration storage", () => {
  it("defaults to the rule engine before anything is configured", async () => {
    const settings = await getAiSettings();

    expect(settings.hasApiKey).toBe(false);
    expect(settings.connectionStatus).toBe("NOT_CONFIGURED");
    expect(await isModelBacked()).toBe(false);
  });

  it("saves provider configuration", async () => {
    const settings = await saveAiSettings({
      provider: "OPENAI",
      model: "gpt-5",
      enabled: true,
      scopeEvaluationEnabled: true,
      changeAnalysisEnabled: false,
      autoEvaluateNewScopes: true,
      autoReevaluateChangedScopes: false,
      heuristicFallbackEnabled: true,
      temperature: 0.3,
      maxTokens: 2048,
    });

    expect(settings.provider).toBe("OPENAI");
    expect(settings.model).toBe("gpt-5");
    expect(settings.changeAnalysisEnabled).toBe(false);
    expect(settings.temperature).toBe(0.3);
    expect(settings.maxTokens).toBe(2048);
  });

  it("encrypts the API key at rest", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: KEY });

    const row = await prisma.aiSettings.findFirstOrThrow();

    expect(row.encryptedApiKey).toBeTruthy();
    expect(row.encryptedApiKey).not.toContain(KEY);
    // Nothing anywhere in the row leaks the secret.
    expect(JSON.stringify(row)).not.toContain(KEY);
  });

  it("never returns the plaintext key through the redacted view", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: KEY });

    const settings = await getAiSettings();

    expect(settings.hasApiKey).toBe(true);
    expect(JSON.stringify(settings)).not.toContain(KEY);
    // At most the last four characters of a long secret are shown.
    expect(settings.credentialHint).toContain("****");
    expect(settings.credentialHint).not.toContain(KEY);
    expect(settings).not.toHaveProperty("encryptedApiKey");
  });

  it("returns the plaintext only through the server-side loader", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: KEY });
    expect(await loadApiKey()).toBe(KEY);
  });

  it("keeps the stored key when the field is submitted empty", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: KEY });

    // A blank key field means "leave it alone", never "erase it".
    await saveAiSettings({ provider: "ANTHROPIC", model: "claude-sonnet-5", apiKey: "" });

    expect(await loadApiKey()).toBe(KEY);
    expect((await getAiSettings()).model).toBe("claude-sonnet-5");
  });

  it("replaces the key and bumps the credential version", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: KEY });
    const first = await prisma.aiSettings.findFirstOrThrow();

    const replacement = "sk-test-replacement-key-9876543210abcdef";
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: replacement });

    const second = await prisma.aiSettings.findFirstOrThrow();
    expect(second.credentialVersion).toBe(first.credentialVersion + 1);
    expect(await loadApiKey()).toBe(replacement);
  });

  it("deletes the key on request", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: KEY });

    const settings = await deleteAiApiKey();

    expect(settings.hasApiKey).toBe(false);
    expect(settings.credentialHint).toBeNull();
    expect(settings.connectionStatus).toBe("NOT_CONFIGURED");
    expect(await loadApiKey()).toBeNull();

    const row = await prisma.aiSettings.findFirstOrThrow();
    expect(row.encryptedApiKey).toBeNull();
  });

  it("resets verification when a new key is stored", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", apiKey: KEY });
    await prisma.aiSettings.updateMany({ data: { connectionStatus: "CONNECTED" } });

    await saveAiSettings({ provider: "ANTHROPIC", apiKey: "sk-test-another-key-1234567890abcdef" });

    // A replaced key has not been tested yet, so it must not inherit CONNECTED.
    expect((await getAiSettings()).connectionStatus).toBe("NOT_CONFIGURED");
  });
});

describe("provider resolution", () => {
  it("falls back to the rule engine when no key is configured", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", heuristicFallbackEnabled: true });

    const provider = await getAiProvider();

    expect(provider.name).toBe("heuristic");
    expect(provider.source).toBe("HEURISTIC");
    expect(await isModelBacked()).toBe(false);
  });

  it("refuses to fall back when explicitly asked not to", async () => {
    await saveAiSettings({ provider: "ANTHROPIC", heuristicFallbackEnabled: true });

    // Test Connection must report the real failure, not a rule-engine success.
    await expect(getAiProvider({ noFallback: true })).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("throws when fallback is disabled and no key exists", async () => {
    await saveAiSettings({ provider: "OPENAI", heuristicFallbackEnabled: false });
    await expect(getAiProvider()).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("reports model-backed once a key is stored", async () => {
    await saveAiSettings({ provider: "OPENAI", model: "gpt-5", apiKey: KEY });

    expect(await isModelBacked()).toBe(true);

    const provider = await getAiProvider();
    expect(provider.source).toBe("AI_MODEL");
    expect(provider.model).toBe("gpt-5");
  });

  it("treats the explicit heuristic provider as not model-backed", async () => {
    await saveAiSettings({ provider: "HEURISTIC" });

    expect(await isModelBacked()).toBe(false);
    expect((await getAiProvider()).source).toBe("HEURISTIC");
  });

  it("knows which providers need a key", () => {
    expect(requiresApiKey("ANTHROPIC")).toBe(true);
    expect(requiresApiKey("OPENAI")).toBe(true);
    expect(requiresApiKey("OPENAI_COMPATIBLE")).toBe(true);
    expect(requiresApiKey("HEURISTIC")).toBe(false);
  });
});

describe("connection test", () => {
  it("reports CONNECTED on a successful probe", async () => {
    await saveAiSettings({ provider: "OPENAI", model: "gpt-5", apiKey: KEY });

    const fetchMock = vi.fn(async (_url: string | URL, _init: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const provider = await getAiProvider({ noFallback: true });
      const result = await provider.testConnection();

      expect(result.status).toBe("CONNECTED");
      // A minimal probe, not a full scope evaluation.
      const init = fetchMock.mock.calls[0]?.[1];
      const body = JSON.parse(String(init?.body)) as { max_completion_tokens?: number };
      expect(body.max_completion_tokens).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports AUTH_ERROR on 401", async () => {
    await saveAiSettings({ provider: "OPENAI", model: "gpt-5", apiKey: KEY });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 401 })),
    );

    try {
      const result = await (await getAiProvider({ noFallback: true })).testConnection();
      expect(result.status).toBe("AUTH_ERROR");
      expect(result.messageKey).toBe("aiTest.invalidKey");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports RATE_LIMITED on 429", async () => {
    await saveAiSettings({ provider: "OPENAI", model: "gpt-5", apiKey: KEY });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 429 })),
    );

    try {
      const result = await (await getAiProvider({ noFallback: true })).testConnection();
      expect(result.status).toBe("RATE_LIMITED");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports the provider unavailable on 5xx", async () => {
    await saveAiSettings({ provider: "OPENAI", model: "gpt-5", apiKey: KEY });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 503 })),
    );

    try {
      const result = await (await getAiProvider({ noFallback: true })).testConnection();
      expect(result.status).toBe("API_ERROR");
      expect(result.messageKey).toBe("aiTest.unavailable");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never sends the key anywhere but the Authorization header", async () => {
    await saveAiSettings({ provider: "OPENAI", model: "gpt-5", apiKey: KEY });

    const fetchMock = vi.fn(async (_url: string | URL, _init: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await (await getAiProvider({ noFallback: true })).testConnection();

      const call = fetchMock.mock.calls[0];
      expect(String(call?.[0])).not.toContain(KEY);
      expect(String(call?.[1]?.body)).not.toContain(KEY);
      expect((call?.[1]?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("custom endpoint validation (SSRF)", () => {
  it("accepts an https origin", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com");
  });

  it("rejects plain http", () => {
    expect(() => normalizeBaseUrl("http://api.example.com")).toThrow(/https/i);
  });

  it("rejects credentials embedded in the URL", () => {
    expect(() => normalizeBaseUrl("https://user:pass@api.example.com")).toThrow(/credentials/i);
  });

  it("rejects private and link-local addresses", () => {
    for (const url of [
      "https://localhost",
      "https://127.0.0.1",
      "https://10.0.0.5",
      "https://192.168.1.10",
      "https://169.254.169.254",
      "https://172.16.0.1",
      "https://metadata.google.internal",
    ]) {
      expect(() => normalizeBaseUrl(url), url).toThrow(/private or link-local/i);
    }
  });

  it("returns null for an empty value (hosted OpenAI)", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl(null)).toBeNull();
  });
});
