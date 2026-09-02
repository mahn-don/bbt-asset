import "server-only";

/**
 * Server-side environment access.
 *
 * `import "server-only"` makes it a build error for any client component to
 * pull this module (and therefore any secret) into browser JavaScript.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example for the expected values.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export const serverEnv = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /** Master key for credential encryption. Never leaves the server. */
  get credentialEncryptionKey(): string {
    return required("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY");
  },

  /** Identifier stamped into every ciphertext envelope, enabling key rotation. */
  get credentialKeyId(): string {
    return optional("INTEGRATION_CREDENTIAL_KEY_ID", "k1");
  },

  /**
   * Previous keys, so ciphertexts written before a rotation stay readable.
   * Format: `keyId:secret,keyId:secret`.
   */
  get credentialPreviousKeys(): string {
    return optional("INTEGRATION_CREDENTIAL_PREVIOUS_KEYS", "");
  },

  get sessionSecret(): string {
    return required("SESSION_SECRET");
  },

  get sessionTtlHours(): number {
    return optionalNumber("SESSION_TTL_HOURS", 24 * 14);
  },

  // --- AI -----------------------------------------------------------------

  /** `anthropic` or `heuristic` (deterministic, offline, no API calls). */
  get aiProvider(): string {
    return optional("AI_PROVIDER", "anthropic").toLowerCase();
  },

  get aiModel(): string {
    return optional("AI_MODEL", "claude-opus-5");
  },

  get anthropicApiKey(): string | undefined {
    const value = process.env.ANTHROPIC_API_KEY;
    return value && value.trim() !== "" ? value : undefined;
  },

  get aiEnabled(): boolean {
    return optionalBool("AI_ENABLED", true);
  },

  get aiScopeEvaluationEnabled(): boolean {
    return optionalBool("AI_SCOPE_EVALUATION_ENABLED", true);
  },

  get aiChangeAnalysisEnabled(): boolean {
    return optionalBool("AI_CHANGE_ANALYSIS_ENABLED", true);
  },

  get aiAutoEvaluateNewScopes(): boolean {
    return optionalBool("AI_AUTO_EVALUATE_NEW_SCOPES", true);
  },

  get aiAutoReevaluateChangedScopes(): boolean {
    return optionalBool("AI_AUTO_REEVALUATE_CHANGED_SCOPES", true);
  },

  get aiEffort(): string {
    return optional("AI_EFFORT", "medium");
  },

  // --- Sync / authorization ------------------------------------------------

  /**
   * Provider data older than this is considered too stale to authorise active
   * research against (see ScopeAuthorizationService).
   */
  get scopeFreshnessMaxAgeHours(): number {
    return optionalNumber("SCOPE_FRESHNESS_MAX_AGE_HOURS", 24 * 7);
  },

  get syncPageLimit(): number {
    return optionalNumber("SYNC_MAX_PAGES", 200);
  },

  get httpTimeoutMs(): number {
    return optionalNumber("PROVIDER_HTTP_TIMEOUT_MS", 20_000);
  },

  get httpMaxRetries(): number {
    return optionalNumber("PROVIDER_HTTP_MAX_RETRIES", 3);
  },

  /**
   * User-Agent sent to provider APIs.
   *
   * Neutral by default. Some providers sit behind a WAF (Intigriti is on
   * Cloudflare) that returns a 403 at the edge — before the token is even
   * evaluated — for unrecognised or bot-flagged agents, including ones that
   * advertise "bug bounty". A plain, common UA avoids that false block for a
   * legitimate, token-authenticated client. Overridable per deployment.
   */
  get httpUserAgent(): string {
    return optional(
      "PROVIDER_HTTP_USER_AGENT",
      "Mozilla/5.0 (compatible; BBIAssetIntelligence/0.1)",
    );
  },

  get logLevel(): string {
    return optional("LOG_LEVEL", "info");
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
} as const;
