import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { serverEnv } from "@/lib/env";
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

/**
 * Anthropic-backed AI provider.
 *
 * Structured outputs are used throughout, so every response is schema-checked
 * before it can reach the database.
 *
 * Prompt-injection posture: scope instructions and program policy are text
 * written by third parties. They are passed to the model as clearly delimited
 * *data* (see `prompt.ts`), with a standing instruction that content inside
 * those blocks is never to be treated as instructions. The model also has no
 * ability to change authorization or the final score — both are computed in
 * application code — so a successful injection can at worst produce a
 * misleading summary, not an unauthorized target.
 */

const MAX_TOKENS = 4096;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic";
  readonly model: string;
  readonly source = "AI_MODEL" as const;

  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options?: { apiKey?: string; model?: string; maxTokens?: number | null }) {
    const apiKey = options?.apiKey ?? serverEnv.anthropicApiKey;
    if (!apiKey) {
      throw new AiUnavailableError(
        "No Anthropic API key is configured. Add one under Settings → AI, or set ANTHROPIC_API_KEY.",
        "NO_API_KEY",
      );
    }

    this.model = options?.model || serverEnv.aiModel;
    this.maxTokens = options?.maxTokens ?? MAX_TOKENS;
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  private effort(): Effort {
    const configured = serverEnv.aiEffort.toLowerCase();
    const allowed: Effort[] = ["low", "medium", "high", "xhigh", "max"];
    return allowed.includes(configured as Effort) ? (configured as Effort) : "medium";
  }

  /**
   * Minimal credential probe: a 1-token message, not a scope evaluation.
   */
  async testConnection(): Promise<AiConnectionResult> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });

      return { status: "CONNECTED", code: "OK", messageKey: "aiTest.connected" };
    } catch (error) {
      const mapped = this.toAiError(error);
      const code = mapped instanceof AiUnavailableError ? mapped.code : "AI_UNKNOWN_ERROR";

      switch (code) {
        case "AI_AUTH_ERROR":
          return { status: "AUTH_ERROR", code, messageKey: "aiTest.invalidKey" };
        case "AI_PERMISSION_ERROR":
          return { status: "PERMISSION_ERROR", code, messageKey: "aiTest.permissionDenied" };
        case "AI_RATE_LIMITED":
          return { status: "RATE_LIMITED", code, messageKey: "aiTest.rateLimited" };
        case "NO_API_KEY":
          return { status: "NOT_CONFIGURED", code, messageKey: "aiTest.incomplete" };
        default:
          return { status: "API_ERROR", code, messageKey: "aiTest.unavailable" };
      }
    }
  }

  async evaluateScope(input: ScopeEvaluationInput): Promise<AiResult<ScopeEvaluationOutput>> {
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        output_config: {
          effort: this.effort(),
          format: zodOutputFormat(scopeEvaluationOutputSchema),
        },
        messages: [{ role: "user", content: buildScopeUserMessage(input) }],
      });

      if (response.stop_reason === "refusal") {
        throw new AiUnavailableError(
          "The model declined to evaluate this scope.",
          "MODEL_REFUSAL",
        );
      }

      const parsed = response.parsed_output;
      if (!parsed) {
        throw new AiValidationError("The model returned no parsable structured output.");
      }

      return {
        output: { ...parsed, tags: normalizeTags(parsed.tags) },
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          latencyMs: Date.now() - startedAt,
        },
        model: this.model,
        providerName: this.name,
        source: this.source,
      };
    } catch (error) {
      throw this.toAiError(error);
    }
  }

  async analyzeChange(input: ChangeAnalysisInput): Promise<AiResult<ChangeAnalysisOutput>> {
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: zodOutputFormat(changeAnalysisOutputSchema) },
        messages: [{ role: "user", content: buildChangeUserMessage(input) }],
      });

      if (response.stop_reason === "refusal") {
        throw new AiUnavailableError("The model declined to analyse this change.", "MODEL_REFUSAL");
      }

      const parsed = response.parsed_output;
      if (!parsed) throw new AiValidationError("The model returned no parsable structured output.");

      return {
        output: parsed,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          latencyMs: Date.now() - startedAt,
        },
        model: this.model,
        providerName: this.name,
        source: this.source,
      };
    } catch (error) {
      throw this.toAiError(error);
    }
  }

  async summarizePolicy(input: PolicyInput): Promise<AiResult<PolicySummary>> {
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: zodOutputFormat(policySummaryOutputSchema) },
        messages: [{ role: "user", content: buildPolicyUserMessage(input) }],
      });

      if (response.stop_reason === "refusal") {
        throw new AiUnavailableError(
          "The model declined to summarise this policy.",
          "MODEL_REFUSAL",
        );
      }

      const parsed = response.parsed_output;
      if (!parsed) throw new AiValidationError("The model returned no parsable structured output.");

      return {
        output: parsed,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          latencyMs: Date.now() - startedAt,
        },
        model: this.model,
        providerName: this.name,
        source: this.source,
      };
    } catch (error) {
      throw this.toAiError(error);
    }
  }

  private toAiError(error: unknown): Error {
    if (error instanceof AiValidationError || error instanceof AiUnavailableError) return error;

    if (error instanceof Anthropic.RateLimitError) {
      return new AiUnavailableError("The AI provider rate limit was exceeded.", "AI_RATE_LIMITED");
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return new AiUnavailableError("The AI API key was rejected.", "AI_AUTH_ERROR");
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return new AiUnavailableError(
        "The AI API key lacks permission for this model.",
        "AI_PERMISSION_ERROR",
      );
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new AiUnavailableError("Could not reach the AI provider.", "AI_CONNECTION_ERROR");
    }
    if (error instanceof Anthropic.APIError) {
      const status = error.status ?? 0;
      return new AiUnavailableError(
        `The AI provider returned HTTP ${status}.`,
        `AI_HTTP_${status}`,
      );
    }

    return new AiUnavailableError(sanitizeErrorMessage(error, 200), "AI_UNKNOWN_ERROR");
  }
}
