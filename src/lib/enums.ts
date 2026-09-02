/**
 * Application-level enums.
 *
 * SQLite has no native enum type, so every enum column is a String. These
 * constants are the single source of truth for the allowed values and are used
 * by validation, normalisation and the UI.
 */

export const PROVIDER_SLUGS = [
  "HACKERONE",
  "BUGCROWD",
  "INTIGRITI",
  "YESWEHACK",
  "MANUAL",
] as const;
export type ProviderSlug = (typeof PROVIDER_SLUGS)[number];

export const CONNECTION_STATUSES = [
  "CONNECTED",
  "NOT_CONFIGURED",
  "AUTH_ERROR",
  "PERMISSION_ERROR",
  "RATE_LIMITED",
  "API_ERROR",
  "UNSUPPORTED",
  "DISABLED",
  // Local providers (MANUAL) have no remote API to connect to. Reserving
  // CONNECTED for real integrations keeps the card honest.
  "READY",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const PROGRAM_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED", "UNKNOWN"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const PROGRAM_VISIBILITIES = ["PUBLIC", "PRIVATE", "UNKNOWN"] as const;
export type ProgramVisibility = (typeof PROGRAM_VISIBILITIES)[number];

export const SAFE_HARBOR_LEVELS = ["FULL", "PARTIAL", "NONE", "UNKNOWN"] as const;
export type SafeHarborLevel = (typeof SAFE_HARBOR_LEVELS)[number];

export const ASSET_TYPES = [
  "DOMAIN",
  "WILDCARD",
  "URL",
  "API",
  "IP",
  "CIDR",
  "ANDROID",
  "IOS",
  "REPOSITORY",
  "OTHER",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const SCOPE_STATUSES = ["IN_SCOPE", "OUT_OF_SCOPE", "REMOVED", "UNKNOWN"] as const;
export type ScopeStatus = (typeof SCOPE_STATUSES)[number];

export const SEVERITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Ordering used for "highest max severity" sorting and comparisons. */
export const SEVERITY_RANK: Record<Severity, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const CHANGE_TYPES = [
  "ASSET_ADDED",
  "ASSET_REMOVED",
  "ASSET_CHANGED",
  "BOUNTY_ELIGIBILITY_CHANGED",
  "SUBMISSION_ELIGIBILITY_CHANGED",
  "MAX_SEVERITY_CHANGED",
  "INSTRUCTION_CHANGED",
  "POLICY_CHANGED",
  "PROGRAM_CHANGED",
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_IMPORTANCES = ["LOW", "MEDIUM", "HIGH", "CRITICAL_ATTENTION"] as const;
export type ChangeImportance = (typeof CHANGE_IMPORTANCES)[number];

export const SYNC_TRIGGER_TYPES = ["MANUAL", "SCHEDULED", "INCREMENTAL"] as const;
export type SyncTriggerType = (typeof SYNC_TRIGGER_TYPES)[number];

export const SYNC_STATUSES = ["RUNNING", "SUCCESS", "PARTIAL", "FAILED"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const AI_EVALUATION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "STALE",
] as const;
export type AiEvaluationStatus = (typeof AI_EVALUATION_STATUSES)[number];

export const JOB_TYPES = ["EVALUATE_SCOPE", "ANALYZE_CHANGE", "SUMMARIZE_POLICY"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const USER_ROLES = ["ADMIN", "RESEARCHER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Opportunity bands. These rank *research opportunity*, not vulnerability
 * severity - the distinction matters and is surfaced in the UI.
 */
export type OpportunityBand = "HIGH" | "MEDIUM_HIGH" | "MEDIUM" | "LOW";

export function opportunityBand(score: number): OpportunityBand {
  if (score >= 80) return "HIGH";
  if (score >= 60) return "MEDIUM_HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export const OPPORTUNITY_BAND_LABEL: Record<OpportunityBand, string> = {
  HIGH: "High",
  MEDIUM_HIGH: "Medium High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

export function isProviderSlug(value: string): value is ProviderSlug {
  return (PROVIDER_SLUGS as readonly string[]).includes(value);
}

export function isScopeStatus(value: string): value is ScopeStatus {
  return (SCOPE_STATUSES as readonly string[]).includes(value);
}
