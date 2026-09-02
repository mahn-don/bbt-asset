import "server-only";
import { sanitizeErrorMessage } from "@/lib/logger";
import {
  AiUnavailableError,
  AiValidationError,
  changeAnalysisOutputSchema,
  normalizeTags,
  policySummaryOutputSchema,
  scopeEvaluationOutputSchema,
  type AiConnectionResult,
  type AiProvider,
  type AiResult,
  type ChangeAnalysisInput,
  type ChangeAnalysisOutput,
  type PolicyInput,
  type PolicySummary,
  type ScopeEvaluationInput,
  type ScopeEvaluationOutput,
} from "@/lib/ai/types";
import {
  SYSTEM_PROMPT,
  buildChangeUserMessage,
  buildPolicyUserMessage,
  buildScopeUserMessage,
} from "@/lib/ai/prompt";
import { z } from "zod";

/**
 * OpenAI and OpenAI-compatible provider.
 *
 * Speaks the Chat Completions wire format over plain fetch rather than pulling
 * in a second vendor SDK — that format is the de-facto interface every
 * "OpenAI-compatible" server implements (vLLM, Ollama, OpenRouter, LM Studio,
 * Together, Groq…), so one implementation covers both `OPENAI` and
 * `OPENAI_COMPATIBLE`.
 *
 * Structured output is requested via `response_format: json_schema` with
 * `strict: true`, and validated again with Zod before it can reach the
 * database — a compatible server that ignores the schema cannot inject
 * malformed data.
 */

const OPENAI_BASE_URL = "https://api.openai.com";
const TIMEOUT_MS = 60_000;

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

/**
 * Converts a Zod schema to the JSON Schema shape the API expects.
 * Node 22+/Zod 4 expose `z.toJSONSchema`, which keeps this honest rather than
 * hand-maintaining a parallel schema.
 */
function jsonSchemaFor(schema: z.ZodType, name: string): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;

  // `strict: true` requires additionalProperties:false and every property in
  // `required`, which Zod's output already satisfies for plain objects.
  return {
    type: "json_schema",
    json_schema: { name, strict: true, schema: { ...jsonSchema, additionalProperties: false } },
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  readonly source = "AI_MODEL" as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly temperature: number | null;
  private readonly maxTokens: number;

  constructor(options: {
    apiKey: string;
    model: string;
    /** Omitted for hosted OpenAI; required for a compatible endpoint. */
    baseUrl?: string | null;
    providerName?: string;
    temperature?: number | null;
    maxTokens?: number | null;
  }) {
    if (!options.apiKey) {
      throw new AiUnavailableError("No API key is configured for this provider.", "NO_API_KEY");
    }
    if (!options.model) {
      throw new AiUnavailableError("No model is configured for this provider.", "NO_MODEL");
    }

    this.apiKey = options.apiKey;
    this.model = options.model;
    this.name = options.providerName ?? "openai";
    this.temperature = options.temperature ?? null;
    this.maxTokens = options.maxTokens ?? 4096;
    this.baseUrl = normalizeBaseUrl(options.baseUrl) ?? OPENAI_BASE_URL;
  }

  private async request<T>(
    path: string,
    body: Record<string, unknown>,
    timeoutMs = TIMEOUT_MS,
  ): Promise<{ data: T; status: number }> {
    const url = new URL(path, this.baseUrl);

    // Defence in depth: never let a configured base URL redirect the request
    // to a different origin than the one that was validated on save.
    if (url.origin !== new URL(this.baseUrl).origin) {
      throw new AiUnavailableError("Refusing to call outside the configured API origin.", "INVALID_URL");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
      });

      const text = await response.text();
      let data: T;
      try {
        data = (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new AiUnavailableError(
          "The provider returned a response that was not valid JSON.",
          "MALFORMED_RESPONSE",
        );
      }

      if (!response.ok) throw httpError(response.status);

      return { data, status: response.status };
    } catch (error) {
      if (error instanceof AiUnavailableError || error instanceof AiValidationError) throw error;
      if (controller.signal.aborted) {
        throw new AiUnavailableError("The provider request timed out.", "TIMEOUT");
      }
      throw new AiUnavailableError(
        `Could not reach the provider: ${sanitizeErrorMessage(error, 120)}`,
        "AI_CONNECTION_ERROR",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Minimal credential probe: a 1-token completion, not a scope evaluation.
   */
  async testConnection(): Promise<AiConnectionResult> {
    try {
      await this.request(
        "/v1/chat/completions",
        {
          model: this.model,
          max_completion_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        },
        15_000,
      );

      return { status: "CONNECTED", code: "OK", messageKey: "aiTest.connected" };
    } catch (error) {
      return connectionResultFor(error);
    }
  }

  private async complete<T>(
    schema: z.ZodType<T>,
    schemaName: string,
    userMessage: string,
    maxTokens: number,
  ): Promise<{ output: T; usage: { inputTokens?: number; outputTokens?: number } }> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_completion_tokens: maxTokens,
      response_format: jsonSchemaFor(schema as z.ZodType, schemaName),
    };

    if (this.temperature !== null) body.temperature = this.temperature;

    const { data } = await this.request<ChatCompletionResponse>("/v1/chat/completions", body);

    const choice = data.choices?.[0];

    if (choice?.message?.refusal) {
      throw new AiUnavailableError("The model declined this request.", "MODEL_REFUSAL");
    }

    const content = choice?.message?.content;
    if (!content) {
      throw new AiValidationError("The provider returned an empty completion.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AiValidationError("The model output was not valid JSON.");
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new AiValidationError(
        `Model output failed validation: ${result.error.issues[0]?.message ?? "unknown"}`,
      );
    }

    return {
      output: result.data,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    };
  }

  async evaluateScope(input: ScopeEvaluationInput): Promise<AiResult<ScopeEvaluationOutput>> {
    const startedAt = Date.now();

    const { output, usage } = await this.complete(
      scopeEvaluationOutputSchema,
      "scope_evaluation",
      buildScopeUserMessage(input),
      this.maxTokens,
    );

    return {
      output: { ...output, tags: normalizeTags(output.tags) },
      usage: { ...usage, latencyMs: Date.now() - startedAt },
      model: this.model,
      providerName: this.name,
      source: this.source,
    };
  }

  async analyzeChange(input: ChangeAnalysisInput): Promise<AiResult<ChangeAnalysisOutput>> {
    const startedAt = Date.now();

    const { output, usage } = await this.complete(
      changeAnalysisOutputSchema,
      "change_analysis",
      buildChangeUserMessage(input),
      1024,
    );

    return {
      output,
      usage: { ...usage, latencyMs: Date.now() - startedAt },
      model: this.model,
      providerName: this.name,
      source: this.source,
    };
  }

  async summarizePolicy(input: PolicyInput): Promise<AiResult<PolicySummary>> {
    const startedAt = Date.now();

    const { output, usage } = await this.complete(
      policySummaryOutputSchema,
      "policy_summary",
      buildPolicyUserMessage(input),
      2048,
    );

    return {
      output,
      usage: { ...usage, latencyMs: Date.now() - startedAt },
      model: this.model,
      providerName: this.name,
      source: this.source,
    };
  }
}

/**
 * Validates and normalises a user-supplied base URL.
 *
 * This is the one place a user can influence an outbound request target, so it
 * is constrained: HTTPS only, no credentials in the URL, no obvious internal
 * address. Returns null for the hosted-OpenAI case.
 */
export function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AiUnavailableError("The base URL is not a valid URL.", "INVALID_BASE_URL");
  }

  if (url.protocol !== "https:") {
    throw new AiUnavailableError("The base URL must use https.", "INVALID_BASE_URL");
  }

  if (url.username || url.password) {
    throw new AiUnavailableError("The base URL must not embed credentials.", "INVALID_BASE_URL");
  }

  const host = url.hostname.toLowerCase();

  // Block the obvious SSRF targets. This is an operator-only setting behind
  // authentication, but a link-local metadata endpoint is never a legitimate
  // OpenAI-compatible host.
  const blocked =
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "0.0.0.0" ||
    host === "[::1]";

  if (blocked) {
    throw new AiUnavailableError(
      "The base URL points at a private or link-local address.",
      "INVALID_BASE_URL",
    );
  }

  return url.origin;
}

function httpError(status: number): AiUnavailableError {
  if (status === 401) return new AiUnavailableError("The API key was rejected.", "AI_AUTH_ERROR");
  if (status === 403) {
    return new AiUnavailableError("The API key lacks permission.", "AI_PERMISSION_ERROR");
  }
  if (status === 429) {
    return new AiUnavailableError("The provider rate limit was exceeded.", "AI_RATE_LIMITED");
  }
  if (status === 404) {
    return new AiUnavailableError("The model or endpoint was not found.", "AI_NOT_FOUND");
  }
  return new AiUnavailableError(`The provider returned HTTP ${status}.`, `AI_HTTP_${status}`);
}

/** Maps a thrown provider error onto the UI connection state. */
export function connectionResultFor(error: unknown): AiConnectionResult {
  const code = error instanceof AiUnavailableError ? error.code : "AI_UNKNOWN_ERROR";

  switch (code) {
    case "AI_AUTH_ERROR":
      return { status: "AUTH_ERROR", code, messageKey: "aiTest.invalidKey" };
    case "AI_PERMISSION_ERROR":
      return { status: "PERMISSION_ERROR", code, messageKey: "aiTest.permissionDenied" };
    case "AI_RATE_LIMITED":
      return { status: "RATE_LIMITED", code, messageKey: "aiTest.rateLimited" };
    case "NO_API_KEY":
    case "NO_MODEL":
    case "INVALID_BASE_URL":
      return { status: "NOT_CONFIGURED", code, messageKey: "aiTest.incomplete" };
    default:
      return { status: "API_ERROR", code, messageKey: "aiTest.unavailable" };
  }
}
