import type { CanonicalProgram, CanonicalScope } from "@/lib/sync/canonical";
import type { ChangeImportance, ChangeType, Severity } from "@/lib/enums";
import { SEVERITY_RANK } from "@/lib/enums";

/**
 * Change detection.
 *
 * Diffs two canonical snapshots and produces typed, human-meaningful change
 * events. Only fields that carry research meaning are compared - internal
 * timestamps never reach this function because they are not part of a
 * canonical snapshot in the first place.
 */

export interface DetectedChange {
  changeType: ChangeType;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  importance: ChangeImportance;
}

function severityRank(value: Severity | null): number {
  return value ? (SEVERITY_RANK[value] ?? -1) : -1;
}

/** Asset types where a newly added scope is worth immediate attention. */
const HIGH_INTEREST_TYPES = new Set(["API", "WILDCARD", "REPOSITORY", "ANDROID", "IOS"]);

export function importanceForNewScope(scope: CanonicalScope): ChangeImportance {
  if (scope.scopeStatus !== "IN_SCOPE") return "LOW";

  const interestingType = HIGH_INTEREST_TYPES.has(scope.assetType);
  const criticalSeverity = severityRank(scope.maxSeverity) >= SEVERITY_RANK.CRITICAL;

  if (scope.eligibleForBounty && interestingType && criticalSeverity) return "CRITICAL_ATTENTION";
  if (scope.eligibleForBounty && interestingType) return "HIGH";
  if (scope.eligibleForBounty || interestingType) return "MEDIUM";
  return "LOW";
}

export function diffScopes(
  previous: CanonicalScope,
  next: CanonicalScope,
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  if (previous.eligibleForBounty !== next.eligibleForBounty) {
    changes.push({
      changeType: "BOUNTY_ELIGIBILITY_CHANGED",
      fieldName: "eligibleForBounty",
      oldValue: String(previous.eligibleForBounty),
      newValue: String(next.eligibleForBounty),
      // Becoming bounty-eligible is a research signal; losing it is bookkeeping.
      importance: next.eligibleForBounty ? "HIGH" : "MEDIUM",
    });
  }

  if (previous.eligibleForSubmission !== next.eligibleForSubmission) {
    changes.push({
      changeType: "SUBMISSION_ELIGIBILITY_CHANGED",
      fieldName: "eligibleForSubmission",
      oldValue: String(previous.eligibleForSubmission),
      newValue: String(next.eligibleForSubmission),
      importance: next.eligibleForSubmission ? "HIGH" : "MEDIUM",
    });
  }

  if (previous.maxSeverity !== next.maxSeverity) {
    const raised = severityRank(next.maxSeverity) > severityRank(previous.maxSeverity);
    changes.push({
      changeType: "MAX_SEVERITY_CHANGED",
      fieldName: "maxSeverity",
      oldValue: previous.maxSeverity ?? undefined,
      newValue: next.maxSeverity ?? undefined,
      importance: raised ? "HIGH" : "LOW",
    });
  }

  if ((previous.instruction ?? "") !== (next.instruction ?? "")) {
    changes.push({
      changeType: "INSTRUCTION_CHANGED",
      fieldName: "instruction",
      oldValue: previous.instruction ?? undefined,
      newValue: next.instruction ?? undefined,
      importance: "MEDIUM",
    });
  }

  if (previous.assetType !== next.assetType) {
    changes.push({
      changeType: "ASSET_CHANGED",
      fieldName: "assetType",
      oldValue: previous.assetType,
      newValue: next.assetType,
      importance: "MEDIUM",
    });
  }

  if (previous.scopeStatus !== next.scopeStatus) {
    changes.push({
      changeType: "ASSET_CHANGED",
      fieldName: "scopeStatus",
      oldValue: previous.scopeStatus,
      newValue: next.scopeStatus,
      // Entering scope matters more than leaving it via status.
      importance: next.scopeStatus === "IN_SCOPE" ? "HIGH" : "MEDIUM",
    });
  }

  if ((previous.externalId ?? "") !== (next.externalId ?? "")) {
    changes.push({
      changeType: "ASSET_CHANGED",
      fieldName: "externalId",
      oldValue: previous.externalId ?? undefined,
      newValue: next.externalId ?? undefined,
      importance: "LOW",
    });
  }

  return changes;
}

const PROGRAM_TRACKED_FIELDS: (keyof CanonicalProgram)[] = [
  "name",
  "status",
  "visibility",
  "bountyMin",
  "bountyMax",
  "currency",
  "safeHarbor",
  "sourceUrl",
  "handleOrSlug",
];

export function diffPrograms(
  previous: CanonicalProgram,
  next: CanonicalProgram,
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  if ((previous.policy ?? "") !== (next.policy ?? "")) {
    changes.push({
      changeType: "POLICY_CHANGED",
      fieldName: "policy",
      // Policies run to many kilobytes; store a bounded excerpt.
      oldValue: excerpt(previous.policy),
      newValue: excerpt(next.policy),
      importance: "MEDIUM",
    });
  }

  for (const field of PROGRAM_TRACKED_FIELDS) {
    const before = previous[field];
    const after = next[field];
    if ((before ?? null) === (after ?? null)) continue;

    changes.push({
      changeType: "PROGRAM_CHANGED",
      fieldName: field,
      oldValue: before === null || before === undefined ? undefined : String(before),
      newValue: after === null || after === undefined ? undefined : String(after),
      importance: field === "status" || field === "bountyMax" ? "MEDIUM" : "LOW",
    });
  }

  return changes;
}

function excerpt(value: string | null, max = 1000): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
