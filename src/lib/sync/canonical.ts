import { contentHash } from "@/lib/canonical/hash";
import type { NormalizedProgram, NormalizedScope } from "@/lib/providers/types";
import type { AssetType, ScopeStatus, Severity } from "@/lib/enums";

/**
 * Canonical snapshots.
 *
 * A canonical snapshot contains only the fields that constitute the *meaning*
 * of a record. Everything transient - when we fetched it, when the provider
 * last touched its own row, our internal bookkeeping - is deliberately
 * excluded, because including it would make every sync look like a change and
 * produce a version, a change event and an AI call per scope per run.
 */

export interface CanonicalScope {
  externalId: string | null;
  assetIdentifier: string;
  assetType: AssetType;
  scopeStatus: ScopeStatus;
  eligibleForSubmission: boolean;
  eligibleForBounty: boolean;
  maxSeverity: Severity | null;
  instruction: string | null;
}

export interface CanonicalProgram {
  externalId: string;
  handleOrSlug: string;
  name: string;
  sourceUrl: string | null;
  status: string;
  visibility: string;
  policy: string | null;
  bountyMin: number | null;
  bountyMax: number | null;
  currency: string | null;
  safeHarbor: string | null;
}

export function canonicalScope(scope: NormalizedScope): CanonicalScope {
  return {
    externalId: scope.externalId ?? null,
    assetIdentifier: scope.assetIdentifier,
    assetType: scope.assetType,
    scopeStatus: scope.scopeStatus,
    eligibleForSubmission: scope.eligibleForSubmission,
    eligibleForBounty: scope.eligibleForBounty,
    maxSeverity: scope.maxSeverity ?? null,
    instruction: scope.instruction ?? null,
  };
}

export function canonicalProgram(program: NormalizedProgram): CanonicalProgram {
  return {
    externalId: program.externalId,
    handleOrSlug: program.handleOrSlug,
    name: program.name,
    sourceUrl: program.sourceUrl ?? null,
    status: program.status,
    visibility: program.visibility,
    policy: program.policy ?? null,
    bountyMin: program.bountyMin ?? null,
    bountyMax: program.bountyMax ?? null,
    currency: program.currency ?? null,
    safeHarbor: program.safeHarbor ?? null,
  };
}

export function scopeContentHash(scope: NormalizedScope): string {
  return contentHash(canonicalScope(scope));
}

export function programContentHash(program: NormalizedProgram): string {
  return contentHash(canonicalProgram(program));
}

/** Rebuilds a canonical scope from a persisted row, for diffing. */
export function canonicalScopeFromRow(row: {
  externalId: string | null;
  assetIdentifier: string;
  assetType: string;
  scopeStatus: string;
  eligibleForSubmission: boolean;
  eligibleForBounty: boolean;
  maxSeverity: string | null;
  instruction: string | null;
}): CanonicalScope {
  return {
    externalId: row.externalId,
    assetIdentifier: row.assetIdentifier,
    assetType: row.assetType as AssetType,
    scopeStatus: row.scopeStatus as ScopeStatus,
    eligibleForSubmission: row.eligibleForSubmission,
    eligibleForBounty: row.eligibleForBounty,
    maxSeverity: row.maxSeverity as Severity | null,
    instruction: row.instruction,
  };
}

export function canonicalProgramFromRow(row: {
  externalId: string;
  handleOrSlug: string;
  name: string;
  sourceUrl: string | null;
  status: string;
  visibility: string;
  policy: string | null;
  bountyMin: number | null;
  bountyMax: number | null;
  currency: string | null;
  safeHarbor: string | null;
}): CanonicalProgram {
  return { ...row };
}
