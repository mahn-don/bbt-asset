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
 * Bugcrowd adapter.
 *
 * Targets the documented Bugcrowd REST API (https://docs.bugcrowd.com/api/):
 *   GET /programs        - programs the credential can see
 *   GET /targets         - in-scope targets, filterable by program
 *
 * Auth is the documented `Authorization: Token <username>:<password>` scheme
 * with the `application/vnd.bugcrowd+json` accept header.
 *
 * IMPORTANT - access model: Bugcrowd issues API credentials against an
 * organisation (program-owner) account. A researcher-only account generally
 * cannot enumerate programs through this API and will receive 401/403, which
 * this adapter surfaces honestly as AUTH_ERROR / PERMISSION_ERROR rather than
 * inventing data.
 *
 * TODO(bugcrowd): the request/response shapes below follow the published API
 * documentation but have not been exercised against a live Bugcrowd
 * organisation account in this codebase. Before relying on Bugcrowd data,
 * verify against a real credential: (1) the exact `Authorization: Token`
 * value format, (2) the `data[].attributes` field names on /programs and
 * /targets, and (3) whether target scope lives on /targets or requires
 * walking /target_groups first.
 */

const BASE_URL = "https://api.bugcrowd.com";
const PAGE_SIZE = 100;
const ACCEPT = "application/vnd.bugcrowd+json";

interface BcResource<TAttributes> {
  id?: string;
  type?: string;
  attributes?: TAttributes;
  relationships?: Record<string, { data?: { id?: string; type?: string } | null }>;
}

interface BcProgramAttributes {
  name?: string;
  code?: string;
  status?: string;
  min_rewards?: number;
  max_rewards?: number;
  currency?: string;
  brief_url?: string;
  created_at?: string;
  updated_at?: string;
  confidential?: boolean;
}

interface BcTargetAttributes {
  name?: string;
  category?: string;
  uri?: string;
  description?: string;
  in_scope?: boolean;
  eligible_for_bounty?: boolean;
  eligible_for_submission?: boolean;
  max_severity?: string;
  created_at?: string;
  updated_at?: string;
}

interface BcCollection<T> {
  data?: T[];
  links?: { next?: string };
  meta?: { total_hits?: number };
}

/** Bugcrowd `category` values mapped onto the normalized enum. */
const CATEGORY_MAP: Record<string, AssetType> = {
  website: "URL",
  api: "API",
  android: "ANDROID",
  ios: "IOS",
  iot: "OTHER",
  hardware: "OTHER",
  other: "OTHER",
  source_code: "REPOSITORY",
};

export class BugcrowdAdapter implements ProviderAdapter {
  readonly providerSlug = "BUGCROWD" as const;
  readonly displayName = "Bugcrowd";

  credentialSchema(): CredentialSchema {
    return {
      authMethod: "API credential (Token username:password)",
      docsUrl: "https://docs.bugcrowd.com/api/getting-started/",
      instructions:
        "Bugcrowd API credentials are issued against an organisation account. " +
        "A researcher-only account will receive a permission error - that state is reported, not hidden.",
      fields: [
        {
          key: "apiUsername",
          label: "API Credential Username",
          secret: false,
          required: true,
          type: "text",
          placeholder: "credential-username",
        },
        {
          key: "apiPassword",
          label: "API Credential Password",
          secret: true,
          required: true,
          type: "password",
          helpText: "Stored encrypted; never displayed again after saving.",
        },
      ],
    };
  }

  validateCredentials(credentials: ProviderCredentials): ValidationResult {
    const fieldErrors: Record<string, string> = {};
    if (!credentials.apiUsername?.trim()) fieldErrors.apiUsername = "Username is required.";
    if (!credentials.apiPassword?.trim()) fieldErrors.apiPassword = "Password is required.";

    if (Object.keys(fieldErrors).length > 0) {
      return { valid: false, fieldErrors, message: "Credentials are incomplete." };
    }
    return { valid: true };
  }

  private client(credentials: ProviderCredentials): ProviderHttpClient {
    return new ProviderHttpClient({
      baseUrl: BASE_URL,
      providerSlug: this.providerSlug,
      defaultHeaders: {
        authorization: `Token ${credentials.apiUsername ?? ""}:${credentials.apiPassword ?? ""}`,
        accept: ACCEPT,
      },
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
      const response = await this.client(credentials).request<BcCollection<BcResource<BcProgramAttributes>>>({
        path: "/programs",
        query: { "page[limit]": 1 },
        maxRetries: 1,
      });

      const count = response.data.data?.length ?? 0;
      return {
        status: "CONNECTED",
        code: "OK",
        message:
          count > 0
            ? "Connected. The credential can read programs."
            : "Connected, but no programs are visible to this credential.",
        details: { programsVisible: count },
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        if (error.status === 403) {
          return {
            status: "PERMISSION_ERROR",
            code: error.code,
            message:
              "The credential is valid but not permitted to list programs. " +
              "Bugcrowd program enumeration requires an organisation API credential.",
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
    const response = await this.client(context.credentials).request<
      BcCollection<BcResource<BcProgramAttributes>>
    >({
      path: "/programs",
      query: { "page[limit]": PAGE_SIZE, "page[offset]": offset },
      signal: context.signal,
    });

    const rows = response.data.data ?? [];
    return {
      programs: rows.map((row) => this.normalizeProgram(row)),
      nextCursor: rows.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : undefined,
      totalCount: response.data.meta?.total_hits,
    };
  }

  async fetchProgram(context: FetchContext, idOrHandle: string): Promise<NormalizedProgram | null> {
    try {
      const response = await this.client(context.credentials).request<{
        data?: BcResource<BcProgramAttributes>;
      }>({
        path: `/programs/${encodeURIComponent(idOrHandle)}`,
        signal: context.signal,
      });
      return response.data.data ? this.normalizeProgram(response.data.data) : null;
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async fetchScopes(
    context: FetchContext,
    program: NormalizedProgram,
    cursor?: string,
  ): Promise<ScopePage> {
    const offset = cursor ? Number(cursor) : 0;
    const response = await this.client(context.credentials).request<
      BcCollection<BcResource<BcTargetAttributes>>
    >({
      path: "/targets",
      query: {
        "filter[program]": program.handleOrSlug,
        "page[limit]": PAGE_SIZE,
        "page[offset]": offset,
      },
      signal: context.signal,
    });

    const rows = response.data.data ?? [];
    return {
      scopes: rows.map((row) => this.normalizeScope(row)),
      nextCursor: rows.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : undefined,
    };
  }

  normalizeProgram(raw: unknown): NormalizedProgram {
    const resource = (raw ?? {}) as BcResource<BcProgramAttributes>;
    const attributes = resource.attributes ?? {};

    const code = attributes.code?.trim();
    const externalId = resource.id ?? code;
    if (!externalId) throw new Error("Bugcrowd program payload is missing both id and code.");

    return {
      externalId,
      handleOrSlug: code ?? externalId,
      name: attributes.name?.trim() || code || externalId,
      sourceUrl: attributes.brief_url
        ? `https://bugcrowd.com${attributes.brief_url}`
        : code
          ? `https://bugcrowd.com/${code}`
          : undefined,
      status:
        attributes.status?.toLowerCase() === "live"
          ? "ACTIVE"
          : attributes.status?.toLowerCase() === "paused"
            ? "PAUSED"
            : attributes.status
              ? "ARCHIVED"
              : "UNKNOWN",
      visibility: attributes.confidential === true ? "PRIVATE" : attributes.confidential === false ? "PUBLIC" : "UNKNOWN",
      bountyMin: typeof attributes.min_rewards === "number" ? attributes.min_rewards : undefined,
      bountyMax: typeof attributes.max_rewards === "number" ? attributes.max_rewards : undefined,
      currency: attributes.currency?.toUpperCase(),
      safeHarbor: "UNKNOWN",
      sourceCreatedAt: parseDate(attributes.created_at),
      sourceUpdatedAt: parseDate(attributes.updated_at),
      raw,
    };
  }

  normalizeScope(raw: unknown): NormalizedScope {
    const resource = (raw ?? {}) as BcResource<BcTargetAttributes>;
    const attributes = resource.attributes ?? {};

    const identifier = (attributes.uri ?? attributes.name)?.trim();
    if (!identifier) {
      throw new Error("Bugcrowd target payload is missing both uri and name.");
    }

    const category = attributes.category?.trim().toLowerCase() ?? "";
    const declared = CATEGORY_MAP[category] ?? "OTHER";
    const normalizedIdentifier = normalizeAssetIdentifier(identifier);

    // Bugcrowd targets are in scope unless explicitly flagged otherwise.
    const inScope = attributes.in_scope !== false;

    return {
      externalId: resource.id,
      assetIdentifier: normalizedIdentifier,
      assetType: refineAssetType(declared, normalizedIdentifier),
      scopeStatus: inScope ? "IN_SCOPE" : "OUT_OF_SCOPE",
      eligibleForSubmission: attributes.eligible_for_submission ?? inScope,
      eligibleForBounty: attributes.eligible_for_bounty ?? false,
      maxSeverity: normalizeSeverity(attributes.max_severity),
      instruction: truncate(attributes.description ?? undefined, 8000),
      sourceCreatedAt: parseDate(attributes.created_at),
      sourceUpdatedAt: parseDate(attributes.updated_at),
      providerMetadata: {
        nativeCategory: category || null,
        name: attributes.name ?? null,
      },
      raw,
    };
  }

  getCapabilities(): ProviderCapabilities {
    return {
      listPrograms: true,
      listScopes: true,
      programPolicy: false,
      incrementalSync: false,
      manualEntry: false,
      requiresCredentials: true,
      notes:
        "Requires an organisation API credential. Researcher-only accounts receive a permission error. " +
        "Wire format follows published docs but is unverified against a live account.",
    };
  }

  getRateLimitPolicy(): RateLimitPolicy {
    return { requestsPerMinute: 60, maxConcurrency: 2, honoursRetryAfter: true };
  }
}
