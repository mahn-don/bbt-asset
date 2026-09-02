import { createHash } from "node:crypto";

/**
 * Stable canonical serialisation + hashing.
 *
 * The same logical object must always produce the same hash, regardless of
 * key insertion order or how the provider happened to serialise it. This is
 * the foundation for idempotency, change detection and AI cost control, so it
 * is deliberately strict:
 *
 *   - object keys are sorted
 *   - `undefined` and `null` members are dropped (an absent field and a null
 *     field are the same thing for our purposes)
 *   - Dates become ISO-8601 strings
 *   - arrays keep their order (order is meaningful for e.g. scope lists)
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function canonicalize(input: unknown): CanonicalValue | undefined {
  if (input === undefined || input === null) return undefined;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? undefined : input.toISOString();
  }

  if (Array.isArray(input)) {
    const items = input
      .map((entry) => canonicalize(entry))
      .filter((entry): entry is CanonicalValue => entry !== undefined);
    return items;
  }

  switch (typeof input) {
    case "string":
      return input;
    case "boolean":
      return input;
    case "number":
      // NaN/Infinity have no stable JSON form.
      return Number.isFinite(input) ? input : undefined;
    case "bigint":
      return input.toString();
    case "object": {
      const source = input as Record<string, unknown>;
      const output: Record<string, CanonicalValue> = {};
      for (const key of Object.keys(source).sort()) {
        const value = canonicalize(source[key]);
        if (value !== undefined) output[key] = value;
      }
      return output;
    }
    default:
      // functions, symbols - not serialisable, treated as absent
      return undefined;
  }
}

/** Deterministic JSON string for a value. */
export function stableStringify(input: unknown): string {
  const canonical = canonicalize(input);
  return JSON.stringify(canonical === undefined ? null : canonical);
}

/** SHA-256 of the canonical representation, hex encoded. */
export function contentHash(input: unknown): string {
  return createHash("sha256").update(stableStringify(input), "utf8").digest("hex");
}

/** Short display form of a hash, for UI and logs. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
