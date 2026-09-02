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
 * Intigriti adapter.
 *
 * Targets the documented Intigriti external researcher API
 * (https://api.intigriti.com/external/researcher/v1), authenticated with a
 * bearer token issued from the Intigriti account settings.
 *
 *   GET /programs                - programs the researcher can see
 *   GET /programs/{programId}    - program detail, including the domain list
 *
 * TODO(intigriti): the field names below follow the published researcher API
 * documentation but are unverified against a live token in this codebase.
 * Before relying on Intigriti data, confirm (1) the token type accepted by the
 * Authorization header (personal access token vs. OAuth client-credentials
 * access token) and (2) the `domains` payload shape on the program detail
 * response, which has historically been versioned as an array of arrays.
 */

const BASE_URL = "https://api.intigriti.com";
const RESEARCHER_PREFIX = "/external/researcher/v1";
const PAGE_SIZE = 100;

interface IntiProgram {
  programId?: string;
  id?: string;
  handle?: string;
  name?: string;
  companyHandle?: string;
  companyName?: string;
  status?: { id?: number; value?: string } | string;
  confidentialityLevel?: { id?: number; value?: string } | string;
  minBounty?: { value?: number; currency?: string };
  maxBounty?: { value?: number; currency?: string };
  webLinks?: { detail?: string };
  createdAt?: string | number;
  lastUpdatedAt?: string | number;
  description?: string;
}

interface IntiDomain {
  id?: string;
  endpoint?: string;
  type?: { id?: number; value?: string } | string;
  tier?: { id?: number; value?: string } | string;
  description?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
}

interface IntiProgramDetail extends IntiProgram {
  domains?: IntiDomain[] | { content?: IntiDomain[] };
  outOfScopes?: IntiDomain[];
}

interface IntiListResponse<T> {
  records?: T[];
  maxCount?: number;
  info?: { count?: number };
}

/** Intigriti domain `type.value` mapped onto the normalized enum. */
const TYPE_MAP: Record<string, AssetType> = {
  url: "URL",
  wildcard: "WILDCARD",
  ip: "IP",
  cidr: "CIDR",
  "mobile application - android": "ANDROID",
  android: "ANDROID",
  "mobile application - ios": "IOS",
  ios: "IOS",
  "source code": "REPOSITORY",
  api: "API",
  device: "OTHER",
  other: "OTHER",
};

function enumValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) {
    const inner = (value as { value?: unknown }).value;
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

export class IntigritiAdapter implements ProviderAdapter {
  readonly providerSlug = "INTIGRITI" as const;
  readonly displayName = "Intigriti";

  credentialSchema(): CredentialSchema {
    return {
      authMethod: "Bearer token",
      docsUrl: "https://kb.intigriti.com/en/articles/8355060-researcher-api",
      instructions:
        "Generate a personal access token from Intigriti account settings and paste it here.",
      fields: [
        {
          key: "accessToken",
          label: "Personal Access Token",
          secret: true,
          required: true,
          type: "password",
          helpText: "Stored encrypted; never displayed again after saving.",
        },
      ],
    };
  }

  validateCredentials(credentials: ProviderCredentials): ValidationResult {
    const token = credentials.accessToken?.trim();
    if (!token) {
      return {
        valid: false,
        fieldErrors: { accessToken: "Access token is required." },
        message: "Credentials are incomplete.",
      };
    }
    if (token.length < 20) {
      return {
        valid: false,
        fieldErrors: { accessToken: "Token looks too short to be valid." },
        message: "Credentials are incomplete.",
      };
    }
    return { valid: true };
  }

  private client(credentials: ProviderCredentials): ProviderHttpClient {
    return new ProviderHttpClient({
      baseUrl: BASE_URL,
      providerSlug: this.providerSlug,
      defaultHeaders: { authorization: `Bearer ${credentials.accessToken ?? ""}` },
    });
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
      const response = await this.client(credentials).request<IntiListResponse<IntiProgram>>({
        path: `${RESEARCHER_PREFIX}/programs`,
        query: { limit: 1, offset: 0 },
        maxRetries: 1,
      });

      const count = response.data.records?.length ?? 0;
      return {
        status: "CONNECTED",
        code: "OK",
        message:
          count > 0
            ? "Connected. The token can read programs."
            : "Connected, but no programs are visible to this token.",
        details: { programsVisible: count },
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        // 403 on Intigriti means the token authenticated but was created without
        // the scope that grants read access to the researcher API. Intigriti
        // tokens are scope-selected at creation time (principle of least
        // privilege), so this is almost always a missing-scope problem rather
        // than an account-level block. Point the operator at the fix.
        if (error.status === 403) {
          return {
            status: "PERMISSION_ERROR",
            code: error.code,
            message:
              "The token is valid but lacks permission for the researcher API. " +
              "Re-create the token in Intigriti account settings (Settings → API Tokens) " +
              "and grant it the read scopes for programs and submissions. If the token " +
              "already has them, confirm your account is enabled for researcher API access.",
          };
        }
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
    const offset = cursor ? Number(cursor) : 0;
    const response = await this.client(context.credentials).request<IntiListResponse<IntiProgram>>({
      path: `${RESEARCHER_PREFIX}/programs`,
      query: { limit: PAGE_SIZE, offset },
      signal: context.signal,
    });

    const rows = response.data.records ?? [];
    return {
      programs: rows.map((row) => this.normalizeProgram(row)),
      nextCursor: rows.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : undefined,
      totalCount: response.data.maxCount ?? response.data.info?.count,
    };
  }

  async fetchProgram(context: FetchContext, idOrHandle: string): Promise<NormalizedProgram | null> {
    try {
      const response = await this.client(context.credentials).request<IntiProgramDetail>({
        path: `${RESEARCHER_PREFIX}/programs/${encodeURIComponent(idOrHandle)}`,
        signal: context.signal,
      });
      return this.normalizeProgram(response.data);
    } catch (error) {
      // 403 = program exists in the list but the researcher has not joined it,
      // so its detail is not readable; 404 = gone. Both mean "not available"
      // rather than a credential error.
      if (error instanceof ProviderHttpError && (error.status === 403 || error.status === 404)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Intigriti returns scope on the program detail document rather than a
   * dedicated collection, so this is a single non-paginated fetch.
   *
   * Access model: the programs *list* returns every program the researcher can
   * see, but the program *detail* (which carries the scope) is only readable
   * for programs the researcher has actually joined. Programs that have not
   * been joined return 403 (or 404) on detail. That is a normal per-program
   * outcome, not a credential failure — the token is fine, the list worked —
   * so it is swallowed here as "no accessible scope" rather than propagated,
   * which would otherwise make the sync engine treat it as a bad credential
   * and abort the whole run.
   */
  async fetchScopes(
    context: FetchContext,
    program: NormalizedProgram,
    cursor?: string,
  ): Promise<ScopePage> {
    if (cursor) return { scopes: [] };

    let response;
    try {
      response = await this.client(context.credentials).request<IntiProgramDetail>({
        path: `${RESEARCHER_PREFIX}/programs/${encodeURIComponent(program.externalId)}`,
        signal: context.signal,
      });
    } catch (error) {
      if (error instanceof ProviderHttpError && (error.status === 403 || error.status === 404)) {
        return { scopes: [] };
      }
      throw error;
    }

    const detail = response.data;
    const inScope = Array.isArray(detail.domains)
      ? detail.domains
      : (detail.domains?.content ?? []);

    const scopes: NormalizedScope[] = [];
    for (const domain of inScope) {
      scopes.push(this.normalizeScope(domain));
    }
    for (const domain of detail.outOfScopes ?? []) {
      scopes.push({ ...this.normalizeScope(domain), scopeStatus: "OUT_OF_SCOPE", eligibleForSubmission: false, eligibleForBounty: false });
    }

    return { scopes };
  }

  normalizeProgram(raw: unknown): NormalizedProgram {
    const program = (raw ?? {}) as IntiProgramDetail;

    const externalId = program.programId ?? program.id ?? program.handle;
    if (!externalId) throw new Error("Intigriti program payload is missing an identifier.");

    const status = enumValue(program.status)?.toLowerCase();
    const confidentiality = enumValue(program.confidentialityLevel)?.toLowerCase();

    return {
      externalId: String(externalId),
      handleOrSlug: program.handle ?? String(externalId),
      name: program.name?.trim() || program.handle || String(externalId),
      sourceUrl:
        program.webLinks?.detail ??
        (program.companyHandle && program.handle
          ? `https://app.intigriti.com/researcher/programs/${program.companyHandle}/${program.handle}/detail`
          : undefined),
      status:
        status === "open" || status === "active"
          ? "ACTIVE"
          : status === "suspended" || status === "paused"
            ? "PAUSED"
            : status === "closed" || status === "archived"
              ? "ARCHIVED"
              : "UNKNOWN",
      visibility:
        confidentiality === "public"
          ? "PUBLIC"
          : confidentiality === undefined
            ? "UNKNOWN"
            : "PRIVATE",
      policy: truncate(program.description, 20000),
      bountyMin: program.minBounty?.value,
      bountyMax: program.maxBounty?.value,
      currency: (program.minBounty?.currency ?? program.maxBounty?.currency)?.toUpperCase(),
      safeHarbor: "UNKNOWN",
      sourceCreatedAt: parseDate(program.createdAt),
      sourceUpdatedAt: parseDate(program.lastUpdatedAt),
      raw,
    };
  }

  normalizeScope(raw: unknown): NormalizedScope {
    const domain = (raw ?? {}) as IntiDomain;

    const identifier = domain.endpoint?.trim();
    if (!identifier) throw new Error("Intigriti domain payload is missing an endpoint.");

    const nativeType = enumValue(domain.type)?.toLowerCase() ?? "";
    const declared = TYPE_MAP[nativeType] ?? "OTHER";
    const normalizedIdentifier = normalizeAssetIdentifier(identifier);

    const tier = enumValue(domain.tier)?.toLowerCase();
    // Intigriti expresses "no bounty" scope as tier 4 / "No Bounty".
    const bountyEligible = tier !== undefined && !tier.includes("no bounty");

    return {
      externalId: domain.id,
      assetIdentifier: normalizedIdentifier,
      assetType: refineAssetType(declared, normalizedIdentifier),
      scopeStatus: "IN_SCOPE",
      eligibleForSubmission: true,
      eligibleForBounty: bountyEligible,
      maxSeverity: normalizeSeverity(tier),
      instruction: truncate(domain.description, 8000),
      sourceCreatedAt: parseDate(domain.createdAt),
      sourceUpdatedAt: parseDate(domain.updatedAt),
      providerMetadata: { nativeType: nativeType || null, tier: tier ?? null },
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
        "Researcher API with a personal access token. Wire format follows published docs but is unverified against a live token.",
    };
  }

  getRateLimitPolicy(): RateLimitPolicy {
    return { requestsPerMinute: 60, maxConcurrency: 2, honoursRetryAfter: true };
  }
}
