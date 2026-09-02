import { z } from "zod";
import {
  ASSET_TYPES,
  CHANGE_TYPES,
  PROVIDER_SLUGS,
  SCOPE_STATUSES,
  SEVERITIES,
} from "@/lib/enums";

/**
 * Request validation schemas.
 *
 * Every route validates its input through one of these. Query parameters
 * arrive as strings, so numeric and boolean fields are coerced explicitly
 * rather than trusted.
 */

const boolFromQuery = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((value) => value.split(",").map((entry) => entry.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)));

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export const providerSlugSchema = z.enum(PROVIDER_SLUGS);

/**
 * Credential payloads are provider-specific. The shape is validated as a flat
 * string map here; the adapter's own `validateCredentials` enforces which keys
 * are required, and `saveCredentials` discards keys the adapter does not
 * declare.
 */
export const credentialsSchema = z.object({
  credentials: z.record(z.string().min(1).max(100), z.string().max(4000)),
});

export const setEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const syncRequestSchema = z.object({
  programHandle: z.string().min(1).max(200).optional(),
});

export const assetsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  provider: csv(PROVIDER_SLUGS).optional(),
  programId: z.string().max(50).optional(),
  assetType: csv(ASSET_TYPES).optional(),
  scopeStatus: csv(SCOPE_STATUSES).optional(),
  maxSeverity: csv(SEVERITIES).optional(),
  bountyEligible: boolFromQuery.optional(),
  tags: z
    .string()
    .max(300)
    .transform((value) => value.split(",").map((entry) => entry.trim()).filter(Boolean))
    .optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  isNew: boolFromQuery.optional(),
  recentlyChanged: boolFromQuery.optional(),
  notEvaluated: boolFromQuery.optional(),
  notReviewed: boolFromQuery.optional(),
  sort: z
    .enum(["opportunity", "newest", "recentlyChanged", "severity", "leastReviewed"])
    .default("opportunity"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type AssetsQuery = z.infer<typeof assetsQuerySchema>;

export const changesQuerySchema = z.object({
  changeType: csv(CHANGE_TYPES).optional(),
  provider: csv(PROVIDER_SLUGS).optional(),
  programId: z.string().max(50).optional(),
  scopeId: z.string().max(50).optional(),
  importance: csv(["LOW", "MEDIUM", "HIGH", "CRITICAL_ATTENTION"] as const).optional(),
  sinceHours: z.coerce.number().int().min(1).max(24 * 365).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const programsQuerySchema = z.object({
  provider: csv(PROVIDER_SLUGS).optional(),
  search: z.string().max(200).optional(),
  status: csv(["ACTIVE", "PAUSED", "ARCHIVED", "UNKNOWN"] as const).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const opportunitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const syncRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reevaluateSchema = z.object({
  force: z.boolean().default(true),
});

// --- Manual provider -------------------------------------------------------

export const manualProgramSchema = z.object({
  handleOrSlug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores."),
  name: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(500).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  policy: z.string().max(50_000).optional(),
  bountyMin: z.number().min(0).max(10_000_000).optional(),
  bountyMax: z.number().min(0).max(10_000_000).optional(),
  currency: z.string().length(3).optional(),
  safeHarbor: z.enum(["FULL", "PARTIAL", "NONE", "UNKNOWN"]).optional(),
});

export const manualScopeSchema = z.object({
  assetIdentifier: z.string().min(1).max(500),
  assetType: z.enum(ASSET_TYPES).optional(),
  scopeStatus: z.enum(["IN_SCOPE", "OUT_OF_SCOPE", "UNKNOWN"]).optional(),
  eligibleForSubmission: z.boolean().optional(),
  eligibleForBounty: z.boolean().optional(),
  maxSeverity: z.enum(SEVERITIES).optional(),
  instruction: z.string().max(8000).optional(),
  /** Explicit operator confirmation that this asset is authorized. */
  confirmAuthorized: z.boolean().default(false),
});

export const manualScopesSchema = z.object({
  programId: z.string().min(1).max(50),
  scopes: z.array(manualScopeSchema).min(1).max(500),
});
