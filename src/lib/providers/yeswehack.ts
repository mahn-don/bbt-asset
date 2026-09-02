import "server-only";
import type {
  ConnectionResult,
  CredentialSchema,
  FetchContext,
  NormalizedProgram,
  NormalizedScope,
  ProgramPage,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderCredentials,
  RateLimitPolicy,
  ScopePage,
  ValidationResult,
} from "@/lib/providers/types";
import { ProviderHttpClient, ProviderHttpError } from "@/lib/providers/http-client";
import {
  normalizeAssetIdentifier,
  normalizeSeverity,
  parseDate,
  refineAssetType,
  truncate,
} from "@/lib/normalization/asset";
import type { AssetType } from "@/lib/enums";

/**
 * YesWeHack adapter.
 *
 * Targets the documented YesWeHack API (https://api.yeswehack.com):
 *   POST /login                  - exchanges email + password for a JWT
 *   GET  /programs               - programs visible to the hunter
 *   GET  /programs/{slug}        - program detail, including scopes
 *
 * Two-factor accounts additionally require a TOTP exchange; when the account
 * has 2FA enabled and no TOTP code is supplied, the login returns a 2FA
 * challenge which this adapter reports as AUTH_ERROR with an explanatory
 * message rather than silently failing.
 *
 * TODO(yeswehack): the JWT login flow and program payload shapes follow the
 * published API documentation but are unverified against a live hunter
 * account in this codebase. Before relying on YesWeHack data, confirm (1) the
 * 2FA/TOTP exchange endpoint and payload, (2) the `scopes[].scope_type`
 * vocabulary, and (3) whether short-lived JWTs need a refresh-token flow for
 * syncs that run longer than the token lifetime.
 */

const BASE_URL = "https://api.yeswehack.com";
const PAGE_SIZE = 100;

interface YwhLoginResponse {
  token?: string;
  totp_token?: string;
  message?: string;
}

interface YwhScope {
  id?: number | string;
  scope?: string;
  scope_type?: string;
  availability_requirement?: string;
  confidentiality_requirement?: string;
  integrity_requirement?: string;
  max_severity?: string;
  scope_description?: string;
  description?: string;
}

interface YwhProgram {
  id?: number | string;
  slug?: string;
  title?: string;
  status?: string;
  public?: boolean;
  disabled?: boolean;
  bounty?: boolean;
  bounty_reward_min?: number;
  bounty_reward_max?: number;
  currency?: string;
  rules?: string;
  scopes?: YwhScope[];
  out_of_scope?: YwhScope[];
  created_at?: string;
  updated_at?: string;
}

interface YwhCollection<T> {
  items?: T[];
  pagination?: { nb_pages?: number; page?: number; nb_results?: number };
}

/** YesWeHack `scope_type` values mapped onto the normalized enum. */
const SCOPE_TYPE_MAP: Record<string, AssetType> = {
  "web-application": "URL",
  web: "URL",
  api: "API",
  "mobile-application": "OTHER",
  "mobile-application-android": "ANDROID",
  "android-application": "ANDROID",
  "mobile-application-ios": "IOS",
  "ios-application": "IOS",
  "ip-address": "IP",
  ip: "IP",
  cidr: "CIDR",
  "source-code": "REPOSITORY",
  application: "OTHER",
  other: "OTHER",
};

export class YesWeHackAdapter implements ProviderAdapter {
  readonly providerSlug = "YESWEHACK" as const;
  readonly displayName = "YesWeHack";

  /** JWTs are short-lived; cached per credential set for the life of a sync. */
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  credentialSchema(): CredentialSchema {
    return {
      authMethod: "Email + password (JWT), optional TOTP",
      docsUrl: "https://docs.yeswehack.com/",
      instructions:
        "YesWeHack authenticates with your hunter account credentials and returns a short-lived JWT. " +
        "If your account has 2FA enabled, supply a current TOTP code - note that a static code expires, " +
        "so scheduled syncs on a 2FA account will need re-authentication.",
      fields: [
        {
          key: "email",
          label: "Account Email",
          secret: false,
          required: true,
          type: "text",
          placeholder: "hunter@example.com",
        },
        {
          key: "password",
          label: "Account Password",
          secret: true,
          required: true,
          type: "password",
          helpText: "Stored encrypted; never displayed again after saving.",
        },
        {
          key: "totpCode",
          label: "TOTP Code (if 2FA enabled)",
          secret: true,
          required: false,
          type: "password",
          placeholder: "123456",
        },
      ],
    };
  }

  validateCredentials(credentials: ProviderCredentials): ValidationResult {
    const fieldErrors: Record<string, string> = {};

    const email = credentials.email?.trim();
    if (!email) fieldErrors.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Enter a valid email address.";

    if (!credentials.password?.trim()) fieldErrors.password = "Password is required.";

    const totp = credentials.totpCode?.trim();
    if (totp && !/^\d{6,8}$/.test(totp)) fieldErrors.totpCode = "TOTP code must be 6-8 digits.";

    if (Object.keys(fieldErrors).length > 0) {
      return { valid: false, fieldErrors, message: "Credentials are incomplete." };
    }
    return { valid: true };
  }

  private client(token?: string): ProviderHttpClient {
    return new ProviderHttpClient({
      baseUrl: BASE_URL,
      providerSlug: this.providerSlug,
      defaultHeaders: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  private cacheKey(credentials: ProviderCredentials): string {
    // Identifies the credential set without storing the secret itself.
    return credentials.email ?? "";
  }

  private async authenticate(credentials: ProviderCredentials): Promise<string> {
    const key = this.cacheKey(credentials);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const response = await this.client().request<YwhLoginResponse>({
      method: "POST",
      path: "/login",
      body: { email: credentials.email, password: credentials.password },
      maxRetries: 1,
    });

    if (response.data.totp_token && !credentials.totpCode) {
      throw new ProviderHttpError(
        401,
        "AUTH_ERROR",
        "TOTP_REQUIRED",
        "This account requires a two-factor code. Add a current TOTP code to the credentials.",
      );
    }

    let token = response.data.token;

    if (response.data.totp_token && credentials.totpCode) {
      const totpResponse = await this.client().request<YwhLoginResponse>({
        method: "POST",
        path: "/account/totp",
        body: { token: response.data.totp_token, code: credentials.totpCode },
        maxRetries: 1,
      });
      token = totpResponse.data.token;
    }

    if (!token) {
      throw new ProviderHttpError(
        401,
        "AUTH_ERROR",
        "NO_TOKEN",
        "Authentication succeeded but no session token was returned.",
      );
    }

    // JWTs are short-lived; assume a conservative 10 minutes.
    this.tokenCache.set(key, { token, expiresAt: Date.now() + 10 * 60 * 1000 });
    return token;
  }

  async testConnection(credentials: ProviderCredentials): Promise<ConnectionResult> {
    const validation = this.validateCredentials(credentials);
    if (!validation.valid) {
      return {
        status: "NOT_CONFIGURED",
        code: "INCOMPLETE_CREDENTIALS",
        message: validation.message ?? "Credentials are incomplete.",
      };
    }

    try {
      const token = await this.authenticate(credentials);
      const response = await this.client(token).request<YwhCollection<YwhProgram>>({
        path: "/programs",
        query: { page: 1, resultsPerPage: 1 },
        maxRetries: 1,
      });

      const count = response.data.items?.length ?? 0;
      return {
        status: "CONNECTED",
        code: "OK",
        message:
          count > 0
            ? "Connected. The account can read programs."
            : "Connected, but no programs are visible to this account.",
        details: { programsVisible: count },
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        return { status: error.connectionStatus, code: error.code, message: error.message };
      }
      return {
        status: "API_ERROR",
        code: "UNKNOWN",
        message: "The connection test failed for an unexpected reason.",
      };
    }
  }

  async fetchPrograms(context: FetchContext, cursor?: string): Promise<ProgramPage> {
    const token = await this.authenticate(context.credentials);
    const page = cursor ? Number(cursor) : 1;

    const response = await this.client(token).request<YwhCollection<YwhProgram>>({
      path: "/programs",
      query: { page, resultsPerPage: PAGE_SIZE },
      signal: context.signal,
    });

    const rows = response.data.items ?? [];
    const totalPages = response.data.pagination?.nb_pages ?? 1;

    return {
      programs: rows.map((row) => this.normalizeProgram(row)),
      nextCursor: page < totalPages ? String(page + 1) : undefined,
      totalCount: response.data.pagination?.nb_results,
    };
  }

  async fetchProgram(context: FetchContext, idOrHandle: string): Promise<NormalizedProgram | null> {
    const token = await this.authenticate(context.credentials);
    try {
      const response = await this.client(token).request<YwhProgram>({
        path: `/programs/${encodeURIComponent(idOrHandle)}`,
        signal: context.signal,
      });
      return this.normalizeProgram(response.data);
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return null;
      throw error;
    }
  }

  /** Scope lives on the program detail document; single non-paginated fetch. */
  async fetchScopes(
    context: FetchContext,
    program: NormalizedProgram,
    cursor?: string,
  ): Promise<ScopePage> {
    if (cursor) return { scopes: [] };

    const token = await this.authenticate(context.credentials);
    const response = await this.client(token).request<YwhProgram>({
      path: `/programs/${encodeURIComponent(program.handleOrSlug)}`,
      signal: context.signal,
    });

    const detail = response.data;
    const bountyProgram = detail.bounty !== false;

    const scopes: NormalizedScope[] = (detail.scopes ?? []).map((scope) => ({
      ...this.normalizeScope(scope),
      eligibleForBounty: bountyProgram,
    }));

    for (const scope of detail.out_of_scope ?? []) {
      scopes.push({
        ...this.normalizeScope(scope),
        scopeStatus: "OUT_OF_SCOPE",
        eligibleForSubmission: false,
        eligibleForBounty: false,
      });
    }

    return { scopes };
  }

  normalizeProgram(raw: unknown): NormalizedProgram {
    const program = (raw ?? {}) as YwhProgram;

    const slug = program.slug?.trim();
    const externalId = program.id !== undefined ? String(program.id) : slug;
    if (!externalId) throw new Error("YesWeHack program payload is missing both id and slug.");

    return {
      externalId,
      handleOrSlug: slug ?? externalId,
      name: program.title?.trim() || slug || externalId,
      sourceUrl: slug ? `https://yeswehack.com/programs/${slug}` : undefined,
      status:
        program.disabled === true
          ? "ARCHIVED"
          : program.status?.toLowerCase() === "suspended"
            ? "PAUSED"
            : program.status
              ? "ACTIVE"
              : "UNKNOWN",
      visibility: program.public === true ? "PUBLIC" : program.public === false ? "PRIVATE" : "UNKNOWN",
      policy: truncate(program.rules, 20000),
      bountyMin: program.bounty_reward_min,
      bountyMax: program.bounty_reward_max,
      currency: program.currency?.toUpperCase(),
      safeHarbor: "UNKNOWN",
      sourceCreatedAt: parseDate(program.created_at),
      sourceUpdatedAt: parseDate(program.updated_at),
      raw,
    };
  }

  normalizeScope(raw: unknown): NormalizedScope {
    const scope = (raw ?? {}) as YwhScope;

    const identifier = scope.scope?.trim();
    if (!identifier) throw new Error("YesWeHack scope payload is missing a scope value.");

    const nativeType = scope.scope_type?.trim().toLowerCase() ?? "";
    const declared = SCOPE_TYPE_MAP[nativeType] ?? "OTHER";
    const normalizedIdentifier = normalizeAssetIdentifier(identifier);

    return {
      externalId: scope.id !== undefined ? String(scope.id) : undefined,
      assetIdentifier: normalizedIdentifier,
      assetType: refineAssetType(declared, normalizedIdentifier),
      scopeStatus: "IN_SCOPE",
      eligibleForSubmission: true,
      eligibleForBounty: false, // overridden by fetchScopes using program-level bounty flag
      maxSeverity: normalizeSeverity(scope.max_severity),
      instruction: truncate(scope.scope_description ?? scope.description, 8000),
      providerMetadata: {
        nativeScopeType: nativeType || null,
        confidentialityRequirement: scope.confidentiality_requirement ?? null,
        integrityRequirement: scope.integrity_requirement ?? null,
        availabilityRequirement: scope.availability_requirement ?? null,
      },
      raw,
    };
  }

  getCapabilities(): ProviderCapabilities {
    return {
      listPrograms: true,
      listScopes: true,
      programPolicy: true,
      incrementalSync: false,
      manualEntry: false,
      requiresCredentials: true,
      notes:
        "Password-based JWT auth. Accounts with 2FA need a fresh TOTP code, so unattended scheduled syncs " +
        "are not reliable on 2FA accounts. Wire format follows published docs but is unverified against a live account.",
    };
  }

  getRateLimitPolicy(): RateLimitPolicy {
    return { requestsPerMinute: 60, maxConcurrency: 1, honoursRetryAfter: true };
  }
}
