import type { AssetType, Severity } from "@/lib/enums";
import { SEVERITIES } from "@/lib/enums";

/**
 * Shared normalisation helpers.
 *
 * Adapters map their provider's native asset-type vocabulary onto our enum
 * explicitly; these helpers cover the structural inference that is identical
 * across providers (is this a wildcard? a CIDR? an app store id?).
 */

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV6 = /^[0-9a-f:]+:[0-9a-f:]*$/i;
const CIDR_V6 = /^[0-9a-f:]+:[0-9a-f:]*\/\d{1,3}$/i;
const ANDROID_PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/i;

const REPOSITORY_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "sr.ht", "codeberg.org"];

/** Hostnames that read as an API surface: api.x, api-v2.x, graphql.x. */
const API_HOST = /^(api|graphql)([.-]|$)/;

/**
 * Structural inference from the identifier alone. Used when the provider gives
 * no usable type, and as a refinement for generic provider types.
 */
export function inferAssetType(identifier: string): AssetType {
  const value = identifier.trim();
  if (!value) return "OTHER";

  const lower = value.toLowerCase();

  if (CIDR_V4.test(lower) || CIDR_V6.test(lower)) return "CIDR";
  if (IPV4.test(lower)) return "IP";
  if (IPV6.test(lower) && lower.includes(":")) return "IP";

  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    let host = "";
    let path = "";
    try {
      const url = new URL(lower);
      host = url.hostname;
      path = url.pathname;
    } catch {
      return "URL";
    }

    if (REPOSITORY_HOSTS.some((repoHost) => host === repoHost || host.endsWith(`.${repoHost}`))) {
      return "REPOSITORY";
    }
    // Same host heuristic as the bare-hostname branch below: `api.x.com`,
    // `api-v2.x.com` and `graphql.x.com` are all API surfaces.
    if (API_HOST.test(host) || /(^|\/)(api|graphql)(\/|$)/.test(path)) return "API";
    return "URL";
  }

  if (lower.includes("*")) return "WILDCARD";

  if (lower.startsWith("com.") || lower.startsWith("io.") || lower.startsWith("org.")) {
    if (ANDROID_PACKAGE.test(lower) && !lower.includes("/")) return "ANDROID";
  }

  // Bare hostnames.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(lower)) {
    if (API_HOST.test(lower)) return "API";
    return "DOMAIN";
  }

  return "OTHER";
}

/**
 * Refines a provider-declared type with structural evidence.
 *
 * The provider's declaration wins for anything it states unambiguously; we
 * only refine the generic buckets (URL/DOMAIN/OTHER) where a wildcard or an
 * API host is detectable from the identifier itself.
 */
export function refineAssetType(declared: AssetType, identifier: string): AssetType {
  const inferred = inferAssetType(identifier);

  if (declared === "OTHER") return inferred;

  if (declared === "URL" || declared === "DOMAIN") {
    if (inferred === "WILDCARD") return "WILDCARD";
    if (inferred === "API") return "API";
    if (inferred === "REPOSITORY") return "REPOSITORY";
    if (inferred === "CIDR" || inferred === "IP") return inferred;
  }

  return declared;
}

export function normalizeSeverity(value: unknown): Severity | undefined {
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase();
  if (!upper) return undefined;

  if ((SEVERITIES as readonly string[]).includes(upper)) return upper as Severity;

  // Common provider spellings.
  switch (upper) {
    case "P1":
    case "CRIT":
      return "CRITICAL";
    case "P2":
      return "HIGH";
    case "P3":
      return "MEDIUM";
    case "P4":
      return "LOW";
    case "P5":
    case "INFORMATIONAL":
    case "INFO":
      return "NONE";
    default:
      return undefined;
  }
}

/**
 * Canonical identifier form, so the same asset from two syncs collapses to one
 * row: trimmed, lower-cased host, no trailing dot or slash.
 */
export function normalizeAssetIdentifier(identifier: string): string {
  let value = identifier.trim();
  if (!value) return value;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.hostname = url.hostname.toLowerCase();
      url.protocol = url.protocol.toLowerCase();
      if (url.pathname === "/") url.pathname = "";
      value = url.toString().replace(/\/$/, "");
      return value;
    } catch {
      // fall through to generic handling
    }
  }

  value = value.replace(/\.$/, "").replace(/\/$/, "");

  // Hostnames and wildcard hostnames are case-insensitive.
  if (/^[*a-z0-9._-]+$/i.test(value)) return value.toLowerCase();

  return value;
}

/**
 * Trims and length-bounds a string.
 *
 * Accepts `null` as well as `undefined`: provider JSON uses `null` for absent
 * text fields (Intigriti sends `description: null`), and a caller passing that
 * through must not crash on `null.trim()`.
 */
export function truncate(value: string | null | undefined, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
