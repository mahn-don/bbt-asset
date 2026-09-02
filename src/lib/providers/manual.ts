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
  RateLimitPolicy,
  ScopePage,
  ValidationResult,
} from "@/lib/providers/types";
import {
  normalizeAssetIdentifier,
  normalizeSeverity,
  parseDate,
  refineAssetType,
  truncate,
} from "@/lib/normalization/asset";
import { isAssetType, isScopeStatus } from "@/lib/enums";

/**
 * Manual provider.
 *
 * A first-class provider for programs a researcher enters by hand (private
 * invites with no API, self-hosted VDPs, etc.). It needs no credentials and
 * performs no network calls: its records are written directly through the
 * manual programs/scopes API and are always labelled MANUAL so they can never
 * be mistaken for provider-verified scope.
 *
 * Its normalizers are still used - the manual write path runs input through
 * exactly the same normalisation and hashing pipeline as an API sync.
 */

export interface ManualProgramInput {
  externalId?: string;
  handleOrSlug: string;
  name: string;
  sourceUrl?: string;
  status?: string;
  visibility?: string;
  policy?: string;
  bountyMin?: number;
  bountyMax?: number;
  currency?: string;
  safeHarbor?: string;
}

export interface ManualScopeInput {
  assetIdentifier: string;
  assetType?: string;
  scopeStatus?: string;
  eligibleForSubmission?: boolean;
  eligibleForBounty?: boolean;
  maxSeverity?: string;
  instruction?: string;
  sourceUpdatedAt?: string;
}

export class ManualAdapter implements ProviderAdapter {
  readonly providerSlug = "MANUAL" as const;
  readonly displayName = "Manual";

  credentialSchema(): CredentialSchema {
    return {
      authMethod: "None",
      fields: [],
      instructions:
        "Manual programs need no credentials. Records you enter here are marked MANUAL and are never " +
        "presented as provider-verified scope.",
    };
  }

  validateCredentials(): ValidationResult {
    return { valid: true };
  }

  async testConnection(): Promise<ConnectionResult> {
    // Not CONNECTED: there is no remote service. READY means "usable now".
    return {
      status: "READY",
      code: "OK",
      message: "Ready. Manual programs require no API credentials.",
    };
  }

  async fetchPrograms(_context: FetchContext, _cursor?: string): Promise<ProgramPage> {
    // Manual records are authored in the app, never fetched.
    return { programs: [] };
  }

  async fetchProgram(): Promise<NormalizedProgram | null> {
    return null;
  }

  async fetchScopes(): Promise<ScopePage> {
    return { scopes: [] };
  }

  normalizeProgram(raw: unknown): NormalizedProgram {
    const input = (raw ?? {}) as ManualProgramInput;

    const handle = input.handleOrSlug?.trim();
    if (!handle) throw new Error("Manual program requires a handle or slug.");

    const name = input.name?.trim() || handle;
    const status = input.status?.toUpperCase();
    const visibility = input.visibility?.toUpperCase();
    const safeHarbor = input.safeHarbor?.toUpperCase();

    return {
      externalId: input.externalId?.trim() || `manual:${handle.toLowerCase()}`,
      handleOrSlug: handle,
      name,
      sourceUrl: input.sourceUrl?.trim() || undefined,
      status:
        status === "ACTIVE" || status === "PAUSED" || status === "ARCHIVED" ? status : "ACTIVE",
      visibility: visibility === "PUBLIC" || visibility === "PRIVATE" ? visibility : "UNKNOWN",
      policy: truncate(input.policy, 20000),
      bountyMin: typeof input.bountyMin === "number" ? input.bountyMin : undefined,
      bountyMax: typeof input.bountyMax === "number" ? input.bountyMax : undefined,
      currency: input.currency?.toUpperCase(),
      safeHarbor:
        safeHarbor === "FULL" || safeHarbor === "PARTIAL" || safeHarbor === "NONE"
          ? safeHarbor
          : "UNKNOWN",
      raw,
    };
  }

  normalizeScope(raw: unknown): NormalizedScope {
    const input = (raw ?? {}) as ManualScopeInput;

    const identifier = input.assetIdentifier?.trim();
    if (!identifier) throw new Error("Manual scope requires an asset identifier.");

    const normalizedIdentifier = normalizeAssetIdentifier(identifier);
    const declaredType = input.assetType?.toUpperCase();
    const declared = declaredType && isAssetType(declaredType) ? declaredType : "OTHER";

    const statusInput = input.scopeStatus?.toUpperCase();
    // A manual scope may never be created directly as REMOVED - removal is a
    // lifecycle transition performed by the app, not an authoring choice.
    const scopeStatus =
      statusInput && isScopeStatus(statusInput) && statusInput !== "REMOVED"
        ? statusInput
        : "IN_SCOPE";

    return {
      assetIdentifier: normalizedIdentifier,
      assetType: refineAssetType(declared, normalizedIdentifier),
      scopeStatus,
      eligibleForSubmission: input.eligibleForSubmission ?? scopeStatus === "IN_SCOPE",
      eligibleForBounty: input.eligibleForBounty ?? false,
      maxSeverity: normalizeSeverity(input.maxSeverity),
      instruction: truncate(input.instruction, 8000),
      sourceUpdatedAt: parseDate(input.sourceUpdatedAt),
      providerMetadata: { provenance: "MANUAL" },
      raw,
    };
  }

  getCapabilities(): ProviderCapabilities {
    return {
      listPrograms: false,
      listScopes: false,
      programPolicy: true,
      incrementalSync: false,
      manualEntry: true,
      requiresCredentials: false,
      notes: "Programs and scopes are entered by hand and always labelled MANUAL.",
    };
  }

  getRateLimitPolicy(): RateLimitPolicy {
    return { requestsPerMinute: Number.POSITIVE_INFINITY, maxConcurrency: 1, honoursRetryAfter: false };
  }
}
