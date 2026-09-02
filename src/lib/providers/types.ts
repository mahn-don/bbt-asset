import type {
  AssetType,
  ConnectionStatus,
  ProgramStatus,
  ProgramVisibility,
  ProviderSlug,
  SafeHarborLevel,
  ScopeStatus,
  Severity,
} from "@/lib/enums";

/**
 * The provider contract.
 *
 * Everything outside `src/lib/providers/<provider>.ts` works exclusively with
 * the normalized models below. Provider-specific HTTP shapes, auth schemes,
 * pagination styles and asset-type vocabularies stay inside the adapter.
 */

// --- Credentials -----------------------------------------------------------

export interface CredentialField {
  key: string;
  label: string;
  /** Secret fields are write-only: never echoed back, masked in hints. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  type: "text" | "password";
}

export interface CredentialSchema {
  /** Human-readable name of the auth scheme, e.g. "API token", "OAuth client credentials". */
  authMethod: string;
  fields: CredentialField[];
  /** Provider documentation URL shown next to the form. */
  docsUrl?: string;
  instructions?: string;
}

export type ProviderCredentials = Record<string, string>;

// --- Results ---------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  /** Field-level messages keyed by credential field key. */
  fieldErrors?: Record<string, string>;
  message?: string;
}

export interface ConnectionResult {
  status: ConnectionStatus;
  /** Sanitised, user-facing message. Never contains credential material. */
  message: string;
  /** Stable machine code, e.g. `AUTH_ERROR`, `HTTP_503`. */
  code?: string;
  /** Extra non-sensitive detail, e.g. the account handle the token belongs to. */
  details?: Record<string, string | number | boolean>;
}

// --- Normalized domain models ---------------------------------------------

export interface NormalizedProgram {
  externalId: string;
  handleOrSlug: string;
  name: string;
  sourceUrl?: string;
  status: ProgramStatus;
  visibility: ProgramVisibility;
  policy?: string;
  bountyMin?: number;
  bountyMax?: number;
  currency?: string;
  safeHarbor?: SafeHarborLevel;
  sourceCreatedAt?: Date;
  sourceUpdatedAt?: Date;
  /** Provider payload retained for auditing; excluded from the content hash. */
  raw?: unknown;
}

export interface NormalizedScope {
  externalId?: string;
  assetIdentifier: string;
  assetType: AssetType;
  scopeStatus: ScopeStatus;
  eligibleForSubmission: boolean;
  eligibleForBounty: boolean;
  maxSeverity?: Severity;
  instruction?: string;
  sourceCreatedAt?: Date;
  sourceUpdatedAt?: Date;
  /** Provider-native values preserved verbatim (e.g. original asset type). */
  providerMetadata?: Record<string, unknown>;
  raw?: unknown;
}

// --- Pagination ------------------------------------------------------------

export interface ProgramPage {
  programs: NormalizedProgram[];
  /** Opaque cursor for the next page; undefined means the last page. */
  nextCursor?: string;
  totalCount?: number;
}

export interface ScopePage {
  scopes: NormalizedScope[];
  nextCursor?: string;
  totalCount?: number;
}

// --- Capabilities ----------------------------------------------------------

export interface ProviderCapabilities {
  /** The adapter can enumerate programs from the API. */
  listPrograms: boolean;
  /** The adapter can fetch structured scopes from the API. */
  listScopes: boolean;
  /** The API exposes program policy text. */
  programPolicy: boolean;
  /** The API supports server-side filtering by updated-at (incremental sync). */
  incrementalSync: boolean;
  /** Programs/scopes are entered by hand rather than fetched. */
  manualEntry: boolean;
  /** Requires stored credentials to operate. */
  requiresCredentials: boolean;
  /** Free-text notes rendered on the integration card. */
  notes?: string;
}

export interface RateLimitPolicy {
  /** Advisory ceiling used to pace requests. */
  requestsPerMinute: number;
  /** Concurrent in-flight requests the adapter permits. */
  maxConcurrency: number;
  /** Whether the provider sends Retry-After on 429. */
  honoursRetryAfter: boolean;
}

// --- The adapter interface -------------------------------------------------

export interface FetchContext {
  credentials: ProviderCredentials;
  /** Only fetch records updated at/after this instant, when supported. */
  since?: Date;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly providerSlug: ProviderSlug;
  readonly displayName: string;

  credentialSchema(): CredentialSchema;

  validateCredentials(credentials: ProviderCredentials): ValidationResult;

  testConnection(credentials: ProviderCredentials): Promise<ConnectionResult>;

  fetchPrograms(context: FetchContext, cursor?: string): Promise<ProgramPage>;

  fetchProgram(context: FetchContext, idOrHandle: string): Promise<NormalizedProgram | null>;

  fetchScopes(
    context: FetchContext,
    program: NormalizedProgram,
    cursor?: string,
  ): Promise<ScopePage>;

  normalizeProgram(raw: unknown): NormalizedProgram;

  normalizeScope(raw: unknown): NormalizedScope;

  getCapabilities(): ProviderCapabilities;

  getRateLimitPolicy(): RateLimitPolicy;
}

/**
 * Signals that an adapter cannot perform an operation with the current
 * credentials or the provider's public API. Carries the connection status the
 * integration should be moved into, so the UI can tell "not supported" apart
 * from "broken".
 */
export class ProviderCapabilityError extends Error {
  constructor(
    readonly status: ConnectionStatus,
    message: string,
    readonly code = "UNSUPPORTED",
  ) {
    super(message);
    this.name = "ProviderCapabilityError";
  }
}
