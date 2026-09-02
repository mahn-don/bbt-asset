import "server-only";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * ScopeAuthorizationService - the safety gate.
 *
 * Any future active research action must pass through `authorize()` first.
 * The gate defaults to DENY: authorization must be positively established by
 * provider-backed data (or explicitly user-confirmed manual data), and every
 * ambiguity resolves against permitting work.
 *
 * A hard invariant: AI output is never an input to this function. A model
 * cannot move an asset from OUT_OF_SCOPE or UNKNOWN into IN_SCOPE, because
 * nothing here reads an AI evaluation. Authorization comes from provider data
 * only.
 */

export type AuthorizationDecision = "ALLOW" | "DENY";

export type DenialReason =
  | "SCOPE_NOT_FOUND"
  | "SCOPE_REMOVED"
  | "SCOPE_OUT_OF_SCOPE"
  | "SCOPE_STATUS_UNKNOWN"
  | "SUBMISSION_NOT_ELIGIBLE"
  | "PROGRAM_NOT_ACTIVE"
  | "PROVIDER_DISABLED"
  | "DATA_STALE"
  | "NO_PROVIDER_SNAPSHOT"
  | "MANUAL_NOT_CONFIRMED";

export interface AuthorizationResult {
  decision: AuthorizationDecision;
  /** Populated on DENY. */
  reasons: DenialReason[];
  /** Human-readable explanation for the UI. */
  messages: string[];
  context: {
    scopeId: string;
    assetIdentifier?: string;
    provider?: string;
    programStatus?: string;
    scopeStatus?: string;
    lastVerifiedAt?: Date | null;
    dataAgeHours?: number | null;
    isManual?: boolean;
  };
}

const DENIAL_MESSAGES: Record<DenialReason, string> = {
  SCOPE_NOT_FOUND: "The asset does not exist in the inventory.",
  SCOPE_REMOVED: "The asset was removed from the program scope and is no longer authorized.",
  SCOPE_OUT_OF_SCOPE: "The provider lists this asset as out of scope.",
  SCOPE_STATUS_UNKNOWN: "The authorization status of this asset is ambiguous.",
  SUBMISSION_NOT_ELIGIBLE: "The provider marks this asset as not eligible for submission.",
  PROGRAM_NOT_ACTIVE: "The program is not currently active.",
  PROVIDER_DISABLED: "The provider integration is disabled, so scope cannot be verified.",
  DATA_STALE: "The provider data is older than the configured freshness limit and must be re-synced.",
  NO_PROVIDER_SNAPSHOT: "No provider-backed snapshot exists for this asset.",
  MANUAL_NOT_CONFIRMED: "This manual asset has not been explicitly confirmed as authorized.",
};

/**
 * Evaluates whether active research against a scope is authorized.
 *
 * @param scopeId the scope to check
 * @param options.allowManual permit user-confirmed MANUAL provenance (default true)
 */
export async function authorize(
  scopeId: string,
  options: { allowManual?: boolean } = {},
): Promise<AuthorizationResult> {
  const allowManual = options.allowManual ?? true;

  const scope = await prisma.scope.findUnique({
    where: { id: scopeId },
    include: {
      program: { include: { provider: { include: { integration: true } } } },
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  if (!scope) {
    return {
      decision: "DENY",
      reasons: ["SCOPE_NOT_FOUND"],
      messages: [DENIAL_MESSAGES.SCOPE_NOT_FOUND],
      context: { scopeId },
    };
  }

  const reasons: DenialReason[] = [];
  const provider = scope.program.provider;
  const isManual = provider.slug === "MANUAL";

  // --- Scope status -------------------------------------------------------
  switch (scope.scopeStatus) {
    case "IN_SCOPE":
      break;
    case "REMOVED":
      reasons.push("SCOPE_REMOVED");
      break;
    case "OUT_OF_SCOPE":
      reasons.push("SCOPE_OUT_OF_SCOPE");
      break;
    default:
      reasons.push("SCOPE_STATUS_UNKNOWN");
  }

  if (!scope.eligibleForSubmission) reasons.push("SUBMISSION_NOT_ELIGIBLE");

  // --- Program status -----------------------------------------------------
  if (scope.program.status !== "ACTIVE") reasons.push("PROGRAM_NOT_ACTIVE");

  // --- Provenance ---------------------------------------------------------
  if (isManual) {
    // Manual scope is authorized only by explicit human confirmation, which is
    // recorded as an operator review of the asset.
    if (!allowManual || !scope.reviewedAt) reasons.push("MANUAL_NOT_CONFIRMED");
  } else {
    if (!provider.enabled || provider.integration?.enabled === false) {
      reasons.push("PROVIDER_DISABLED");
    }

    // There must be a provider-backed snapshot behind this row.
    if (scope.versions.length === 0) reasons.push("NO_PROVIDER_SNAPSHOT");
  }

  // --- Freshness ----------------------------------------------------------
  // Manual records have no upstream to go stale against.
  const lastVerifiedAt = isManual ? scope.updatedAt : scope.lastSeenAt;
  const dataAgeHours = (Date.now() - lastVerifiedAt.getTime()) / (60 * 60 * 1000);

  if (!isManual && dataAgeHours > serverEnv.scopeFreshnessMaxAgeHours) {
    reasons.push("DATA_STALE");
  }

  const decision: AuthorizationDecision = reasons.length === 0 ? "ALLOW" : "DENY";

  if (decision === "DENY") {
    logger.info("scope authorization denied", {
      scopeId,
      provider: provider.slug,
      reasons,
    });
  }

  return {
    decision,
    reasons,
    messages: reasons.map((reason) => DENIAL_MESSAGES[reason]),
    context: {
      scopeId,
      assetIdentifier: scope.assetIdentifier,
      provider: provider.slug,
      programStatus: scope.program.status,
      scopeStatus: scope.scopeStatus,
      lastVerifiedAt,
      dataAgeHours: Math.round(dataAgeHours * 10) / 10,
      isManual,
    },
  };
}

/**
 * Throwing variant for call sites that must not proceed on denial.
 */
export class ScopeNotAuthorizedError extends Error {
  constructor(readonly result: AuthorizationResult) {
    super(`Scope is not authorized for active research: ${result.messages.join(" ")}`);
    this.name = "ScopeNotAuthorizedError";
  }
}

export async function assertAuthorized(
  scopeId: string,
  options: { allowManual?: boolean } = {},
): Promise<AuthorizationResult> {
  const result = await authorize(scopeId, options);
  if (result.decision === "DENY") throw new ScopeNotAuthorizedError(result);
  return result;
}

export const ScopeAuthorizationService = { authorize, assertAuthorized };

/**
 * Presentation status for the asset detail header.
 *
 * Deliberately separate from *scope classification*. A provider can classify an
 * asset as IN_SCOPE while our own gate still refuses it (stale data, disabled
 * integration, unconfirmed manual entry) - previously those two facts were
 * rendered with contradictory-looking labels.
 *
 *   VERIFIED       provider-backed data satisfies every gate check
 *   USER_CONFIRMED a MANUAL asset an operator explicitly confirmed
 *   NOT_VERIFIED   anything else
 */
export type AuthorizationStatus = "VERIFIED" | "USER_CONFIRMED" | "NOT_VERIFIED";

export function authorizationStatus(result: AuthorizationResult): AuthorizationStatus {
  if (result.decision !== "ALLOW") return "NOT_VERIFIED";
  return result.context.isManual ? "USER_CONFIRMED" : "VERIFIED";
}
