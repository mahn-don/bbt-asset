import { z } from "zod";

/**
 * AI provider abstraction.
 *
 * Nothing outside `src/lib/ai/` depends on a specific vendor. The evaluation
 * layer talks to this interface; `provider.ts` decides which implementation
 * backs it.
 *
 * Scope of the AI's role: it is an intelligence and prioritisation layer. It
 * ranks and explains authorized scope. It does not decide authorization, it
 * does not produce exploitation steps, and it never gets to set the final
 * Opportunity Score.
 */

export const PROMPT_VERSION = "scope-eval-v1";

// --- Scope evaluation ------------------------------------------------------

export interface ScopeEvaluationInput {
  /**
   * Language the human-readable output must be written in. Scores and
   * technical identifiers are unaffected.
   */
  outputLanguage: "en" | "vi";
  program: {
    name: string;
    provider: string;
    status: string;
    visibility: string;
    bountyMin: number | null;
    bountyMax: number | null;
    currency: string | null;
    safeHarbor: string | null;
    /** Truncated policy text; absent when the provider exposes none. */
    policyExcerpt: string | null;
  };
  scope: {
    assetIdentifier: string;
    assetType: string;
    scopeStatus: string;
    eligibleForBounty: boolean;
    eligibleForSubmission: boolean;
    maxSeverity: string | null;
    instruction: string | null;
    firstSeenAt: string;
    sourceUpdatedAt: string | null;
    ageDays: number | null;
    daysSinceLastChange: number | null;
  };
  recentChanges: {
    changeType: string;
    fieldName: string | null;
    detectedAt: string;
    importance: string;
  }[];
  /** Only present when the system actually holds this history. */
  researchHistory: {
    sessionCount: number;
    findingCount: number;
    acceptedCount: number;
    duplicateCount: number;
    lastResearchedAt: string | null;
  } | null;
  existingTags: string[];
}

export const scopeEvaluationOutputSchema = z.object({
  businessValueScore: z.number().min(0).max(100),
  attackSurfaceScore: z.number().min(0).max(100),
  freshnessScore: z.number().min(0).max(100),
  researchPotentialScore: z.number().min(0).max(100),
  complexityScore: z.number().min(0).max(100),
  policyFitScore: z.number().min(0).max(100),
  duplicateRiskScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(600),
  reasoningSummary: z.string().min(1).max(1200),
  tags: z.array(z.string().min(1).max(40)).max(12),
  suggestedResearchAreas: z.array(z.string().min(1).max(120)).max(8),
  warnings: z.array(z.string().min(1).max(200)).max(6),
});

export type ScopeEvaluationOutput = z.infer<typeof scopeEvaluationOutputSchema>;

// --- Change analysis -------------------------------------------------------

export interface ChangeAnalysisInput {
  outputLanguage: "en" | "vi";
  programName: string;
  provider: string;
  assetIdentifier: string | null;
  assetType: string | null;
  changeType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  eligibleForBounty: boolean | null;
  maxSeverity: string | null;
  bountyMax: number | null;
}

export const changeAnalysisOutputSchema = z.object({
  importance: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL_ATTENTION"]),
  summary: z.string().min(1).max(500),
});

export type ChangeAnalysisOutput = z.infer<typeof changeAnalysisOutputSchema>;

// --- Policy summary --------------------------------------------------------

export interface PolicyInput {
  outputLanguage: "en" | "vi";
  programName: string;
  provider: string;
  policy: string;
}

export const policySummaryOutputSchema = z.object({
  summary: z.string().min(1).max(1500),
  keyRestrictions: z.array(z.string().min(1).max(200)).max(10),
  safeHarborAssessment: z.enum(["FULL", "PARTIAL", "NONE", "UNKNOWN"]),
});

export type PolicySummary = z.infer<typeof policySummaryOutputSchema>;

// --- Provider interface ----------------------------------------------------

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export interface AiResult<T> {
  output: T;
  usage: AiUsage;
  model: string;
  providerName: string;
  source: EvaluationSource;
}

/**
 * Where an evaluation actually came from.
 *
 * This is persisted on every evaluation and surfaced in the UI. Heuristic
 * output must never be presented as model output.
 */
export type EvaluationSource = "AI_MODEL" | "HEURISTIC";

export interface AiConnectionResult {
  status: "CONNECTED" | "AUTH_ERROR" | "PERMISSION_ERROR" | "RATE_LIMITED" | "API_ERROR" | "NOT_CONFIGURED";
  /** Stable machine code, e.g. `HTTP_401`. */
  code: string;
  /** Message key from the dictionary, so the UI can localise it. */
  messageKey: string;
  /** Non-sensitive extra detail (never credential material). */
  detail?: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** AI_MODEL for real providers, HEURISTIC for the offline rule engine. */
  readonly source: EvaluationSource;

  /**
   * Minimal, low-cost credential check. Implementations must NOT run a full
   * scope evaluation just to verify a key.
   */
  testConnection(): Promise<AiConnectionResult>;

  evaluateScope(input: ScopeEvaluationInput): Promise<AiResult<ScopeEvaluationOutput>>;
  analyzeChange(input: ChangeAnalysisInput): Promise<AiResult<ChangeAnalysisOutput>>;
  summarizePolicy(input: PolicyInput): Promise<AiResult<PolicySummary>>;
}

/** Raised when the model produced output that failed schema validation. */
export class AiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiValidationError";
  }
}

/** Raised when the AI backend is unavailable or refused the request. */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    readonly code = "AI_UNAVAILABLE",
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/**
 * Normalises free-form tags: lower-case, kebab-cased, de-duplicated, bounded.
 * The tag vocabulary is open, but the shape is not.
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const tag of tags) {
    const normalized = tag
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 12) break;
  }

  return output;
}
