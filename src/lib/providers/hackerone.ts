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
import { ProviderHttpClient, ProviderHttpError, basicAuthHeader } from "@/lib/providers/http-client";
import {
  normalizeAssetIdentifier,
  normalizeSeverity,
  parseDate,
  refineAssetType,
  truncate,
} from "@/lib/normalization/asset";
import type { AssetType, ProgramStatus, ProgramVisibility, SafeHarborLevel } from "@/lib/enums";

/**
 * HackerOne adapter.
 *
 * Uses only the officially documented Hacker API (https://api.hackerone.com/hacker-resources/),
 * authenticated with an API username + API token via HTTP Basic auth. No
 * internal, private or session-authenticated endpoints are used.
 *
 * Endpoints:
 *   GET /v1/hackers/programs                          - programs visible to the account
 *   GET /v1/hackers/programs/{handle}                  - program detail incl. policy
 *   GET /v1/hackers/programs/{handle}/structured_scopes - structured scope list
 */

const BASE_URL = "https://api.hackerone.com";
const PAGE_SIZE = 100;

// --- Provider wire types (JSON:API) ---------------------------------------

interface H1Resource<TAttributes> {
  id?: string | number;
  type?: string;
  attributes?: TAttributes;
  relationships?: Record<string, { data?: unknown }>;
}

interface H1ProgramAttributes {
  handle?: string;
  name?: string;
  currency?: string;
  submission_state?: string;
  triage_active?: boolean | null;
  state?: string;
  started_accepting_at?: string;
  number_of_reports_for_user?: number;
  number_of_valid_reports_for_user?: number;
  bounty_earned_for_user?: number;
  last_invitation_accepted_at_for_user?: string;
  bookmarked?: boolean;
  allows_bounty_splitting?: boolean;
  offers_bounties?: boolean;
  open_scope?: boolean;
  fast_payments?: boolean;
  gold_standard_safe_harbor?: boolean;
  policy?: string;
  created_at?: string;
  updated_at?: string;
  base_bounty?: number;
  average_bounty_lower_amount?: number;
  average_bounty_upper_amount?: number;
}

interface H1StructuredScopeAttributes {
  asset_type?: string;
  asset_identifier?: string;
  eligible_for_bounty?: boolean;
  eligible_for_submission?: boolean;
  instruction?: string | null;
  max_severity?: string;
  created_at?: string;
  updated_at?: string;
  confidentiality_requirement?: string;
  integrity_requirement?: string;
  availability_requirement?: string;
  reference?: string | null;
  archived_at?: string | null;
}

interface H1Collection<T> {
  data?: T[];
  links?: { self?: string; next?: string; prev?: string; last?: string };
}

/**
 * HackerOne's `asset_type` vocabulary mapped onto our normalized enum.
 * Anything unlisted falls back to structural inference from the identifier.
 */
const ASSET_TYPE_MAP: Record<string, AssetType> = {
  URL: "URL",
  WILDCARD: "WILDCARD",
  CIDR: "CIDR",
  IP_ADDRESS: "IP",
  API: "API",
  GOOGLE_PLAY_APP_ID: "ANDROID",
  OTHER_APK: "ANDROID",
  APPLE_STORE_APP_ID: "IOS",
  TESTFLIGHT: "IOS",
  OTHER_IPA: "IOS",
  SOURCE_CODE: "REPOSITORY",
  WINDOWS_APP_STORE_APP_ID: "OTHER",
  DOWNLOADABLE_EXECUTABLES: "OTHER",
  HARDWARE: "OTHER",
  AI_MODEL: "OTHER",
  SMART_CONTRACT: "OTHER",
  OTHER: "OTHER",
};

function mapProgramStatus(attributes: H1ProgramAttributes): ProgramStatus {
  const submissionState = attributes.submission_state?.toLowerCase();
  const state = attributes.state?.toLowerCase();

  if (state === "soft_launched" || submissionState === "open") return "ACTIVE";
  if (submissionState === "paused") return "PAUSED";
  if (submissionState === "disabled") return "ARCHIVED";
  if (state === "public_mode" || state === "private_mode") return "ACTIVE";
  return "UNKNOWN";
}

function mapVisibility(attributes: H1ProgramAttributes): ProgramVisibility {
  const state = attributes.state?.toLowerCase();
  if (state === "public_mode") return "PUBLIC";
  if (state === "private_mode" || state === "soft_launched") return "PRIVATE";
  return "UNKNOWN";
}

function mapSafeHarbor(attributes: H1ProgramAttributes): SafeHarborLevel {
  if (attributes.gold_standard_safe_harbor === true) return "FULL";
  if (attributes.gold_standard_safe_harbor === false) return "UNKNOWN";
  return "UNKNOWN";
}

/** Extracts the `page[number]` value from a JSON:API `links.next` URL. */
function nextPageCursor(links: H1Collection<unknown>["links"]): string | undefined {
  if (!links?.next) return undefined;
  try {
    const url = new URL(links.next);
    const page = url.searchParams.get("page[number]");
    return page ?? undefined;
  } catch {
    return undefined;
  }
}

export class HackerOneAdapter implements ProviderAdapter {
  readonly providerSlug = "HACKERONE" as const;
  readonly displayName = "HackerOne";

  credentialSchema(): CredentialSchema {
    return {
      authMethod: "API token (HTTP Basic)",
      docsUrl: "https://docs.hackerone.com/en/articles/8410331-hacker-api",
      instructions:
        "Create an API token from your HackerOne account settings (Settings → API Tokens). " +
        "The identifier is your API username, not your login email.",
      fields: [
        {
          key: "apiUsername",
          label: "API Username",
          secret: false,
          required: true,
          type: "text",
          placeholder: "your-api-username",
          helpText: "Shown next to the token in HackerOne API token settings.",
        },
        {
          key: "apiToken",
          label: "API Token",
          secret: true,
          required: true,
          type: "password",
          placeholder: "••••••••••••••••",
          helpText: "Stored encrypted; never displayed again after saving.",
        },
      ],
    };
  }

  validateCredentials(credentials: ProviderCredentials): ValidationResult {
    const fieldErrors: Record<string, string> = {};

    const username = credentials.apiUsername?.trim();
    const token = credentials.apiToken?.trim();

    if (!username) fieldErrors.apiUsername = "API username is required.";
    else if (username.length > 200) fieldErrors.apiUsername = "API username is too long.";
    else if (/[:\s]/.test(username))
      fieldErrors.apiUsername = "API username cannot contain spaces or colons.";

    if (!token) fieldErrors.apiToken = "API token is required.";
    else if (token.length < 20) fieldErrors.apiToken = "API token looks too short to be valid.";
    else if (token.length > 500) fieldErrors.apiToken = "API token is too long.";

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
        authorization: basicAuthHeader(
          credentials.apiUsername ?? "",
          credentials.apiToken ?? "",
        ),
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
      const response = await this.client(credentials).request<H1Collection<H1Resource<H1ProgramAttributes>>>({
        path: "/v1/hackers/programs",
        query: { "page[size]": 1 },
        maxRetries: 1,
      });

      const count = response.data.data?.length ?? 0;
      return {
        status: "CONNECTED",
        code: "OK",
        message:
          count > 0
            ? "Connected. The API token can read programs."
            : "Connected, but this account is not a member of any programs yet.",
        details: { programsVisible: count },
      };
    } catch (error) {
      return this.toConnectionResult(error);
    }
  }

  private toConnectionResult(error: unknown): ConnectionResult {
    if (error instanceof ProviderHttpError) {
      return { status: error.connectionStatus, code: error.code, message: error.message };
    }
    return {
      status: "API_ERROR",
      code: "UNKNOWN",
      message: "The connection test failed for an unexpected reason.",
    };
  }

  async fetchPrograms(context: FetchContext, cursor?: string): Promise<ProgramPage> {
    const pageNumber = cursor ? Number(cursor) : 1;
    const response = await this.client(context.credentials).request<
      H1Collection<H1Resource<H1ProgramAttributes>>
    >({
      path: "/v1/hackers/programs",
      query: { "page[size]": PAGE_SIZE, "page[number]": pageNumber },
      signal: context.signal,
    });

    const rows = response.data.data ?? [];
    return {
      programs: rows.map((row) => this.normalizeProgram(row)),
      nextCursor: rows.length > 0 ? nextPageCursor(response.data.links) : undefined,
    };
  }

  async fetchProgram(context: FetchContext, idOrHandle: string): Promise<NormalizedProgram | null> {
    const handle = encodeURIComponent(idOrHandle);
    try {
      const response = await this.client(context.credentials).request<H1Resource<H1ProgramAttributes>>({
        path: `/v1/hackers/programs/${handle}`,
        signal: context.signal,
      });
      return this.normalizeProgram(response.data);
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
    const pageNumber = cursor ? Number(cursor) : 1;
    const handle = encodeURIComponent(program.handleOrSlug);

    const response = await this.client(context.credentials).request<
      H1Collection<H1Resource<H1StructuredScopeAttributes>>
    >({
      path: `/v1/hackers/programs/${handle}/structured_scopes`,
      query: { "page[size]": PAGE_SIZE, "page[number]": pageNumber },
      signal: context.signal,
    });

    const rows = response.data.data ?? [];
    return {
      scopes: rows.map((row) => this.normalizeScope(row)),
      nextCursor: rows.length > 0 ? nextPageCursor(response.data.links) : undefined,
    };
  }

  normalizeProgram(raw: unknown): NormalizedProgram {
    const resource = (raw ?? {}) as H1Resource<H1ProgramAttributes>;
    const attributes = resource.attributes ?? {};

    const handle = attributes.handle?.trim();
    const externalId = resource.id !== undefined ? String(resource.id) : handle;

    if (!externalId) {
      throw new Error("HackerOne program payload is missing both id and handle.");
    }

    const bountyMin = attributes.average_bounty_lower_amount ?? attributes.base_bounty;
    const bountyMax = attributes.average_bounty_upper_amount;

    return {
      externalId,
      handleOrSlug: handle ?? externalId,
      name: attributes.name?.trim() || handle || externalId,
      sourceUrl: handle ? `https://hackerone.com/${handle}` : undefined,
      status: mapProgramStatus(attributes),
      visibility: mapVisibility(attributes),
      policy: attributes.policy ?? undefined,
      bountyMin: typeof bountyMin === "number" && Number.isFinite(bountyMin) ? bountyMin : undefined,
      bountyMax: typeof bountyMax === "number" && Number.isFinite(bountyMax) ? bountyMax : undefined,
      currency: attributes.currency?.toUpperCase(),
      safeHarbor: mapSafeHarbor(attributes),
      sourceCreatedAt: parseDate(attributes.created_at ?? attributes.started_accepting_at),
      sourceUpdatedAt: parseDate(attributes.updated_at),
      raw,
    };
  }

  normalizeScope(raw: unknown): NormalizedScope {
    const resource = (raw ?? {}) as H1Resource<H1StructuredScopeAttributes>;
    const attributes = resource.attributes ?? {};

    const identifier = attributes.asset_identifier?.trim();
    if (!identifier) {
      throw new Error("HackerOne structured scope payload is missing asset_identifier.");
    }

    const nativeType = attributes.asset_type?.trim().toUpperCase() ?? "";
    const declared = ASSET_TYPE_MAP[nativeType] ?? "OTHER";
    const normalizedIdentifier = normalizeAssetIdentifier(identifier);

    // Archived scopes are still returned by the API; they are not authorised
    // targets, so they normalize to OUT_OF_SCOPE rather than being dropped.
    const archived = Boolean(attributes.archived_at);
    const eligibleForSubmission = attributes.eligible_for_submission === true && !archived;

    return {
      externalId: resource.id !== undefined ? String(resource.id) : undefined,
      assetIdentifier: normalizedIdentifier,
      assetType: refineAssetType(declared, normalizedIdentifier),
      scopeStatus: archived ? "OUT_OF_SCOPE" : eligibleForSubmission ? "IN_SCOPE" : "OUT_OF_SCOPE",
      eligibleForSubmission,
      eligibleForBounty: attributes.eligible_for_bounty === true && !archived,
      maxSeverity: normalizeSeverity(attributes.max_severity),
      instruction: truncate(attributes.instruction ?? undefined, 8000),
      sourceCreatedAt: parseDate(attributes.created_at),
      sourceUpdatedAt: parseDate(attributes.updated_at),
      providerMetadata: {
        nativeAssetType: nativeType || null,
        confidentialityRequirement: attributes.confidentiality_requirement ?? null,
        integrityRequirement: attributes.integrity_requirement ?? null,
        availabilityRequirement: attributes.availability_requirement ?? null,
        reference: attributes.reference ?? null,
        archivedAt: attributes.archived_at ?? null,
      },
      raw,
    };
  }

  getCapabilities(): ProviderCapabilities {
    return {
      listPrograms: true,
      listScopes: true,
      programPolicy: true,
      // The Hacker API has no updated-since filter on these collections, so a
      // sync always walks the full program list. Change detection is driven by
      // content hashing instead, which keeps writes and AI calls incremental.
      incrementalSync: false,
      manualEntry: false,
      requiresCredentials: true,
      notes: "Reads programs and structured scopes the API account is a member of.",
    };
  }

  getRateLimitPolicy(): RateLimitPolicy {
    return { requestsPerMinute: 100, maxConcurrency: 2, honoursRetryAfter: true };
  }
}
