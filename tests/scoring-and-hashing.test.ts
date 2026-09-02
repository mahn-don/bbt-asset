import { describe, expect, it } from "vitest";
import {
  calculateOpportunityScore,
  clampConfidence,
  clampScore,
  scoreContributions,
} from "@/lib/scoring/opportunity";
import { canonicalize, contentHash, stableStringify } from "@/lib/canonical/hash";
import { opportunityBand } from "@/lib/enums";
import { scopeContentHash } from "@/lib/sync/canonical";
import type { NormalizedScope } from "@/lib/providers/types";

describe("opportunity score", () => {
  it("computes the specified worked example exactly", () => {
    // 0.20*90 + 0.20*80 + 0.20*100 + 0.15*90 + 0.10*60 + 0.10*80 + 0.05*(100-20)
    // = 18 + 16 + 20 + 13.5 + 6 + 8 + 4 = 85.5 -> 86
    const score = calculateOpportunityScore({
      businessValue: 90,
      attackSurface: 80,
      freshness: 100,
      researchPotential: 90,
      complexity: 60,
      policyFit: 80,
      duplicateRisk: 20,
    });

    expect(score).toBe(86);
  });

  it("is deterministic", () => {
    const input = {
      businessValue: 73,
      attackSurface: 41,
      freshness: 12,
      researchPotential: 88,
      complexity: 55,
      policyFit: 60,
      duplicateRisk: 34,
    };

    expect(calculateOpportunityScore(input)).toBe(calculateOpportunityScore(input));
  });

  it("returns 100 for a perfect profile and 0 for the worst", () => {
    expect(
      calculateOpportunityScore({
        businessValue: 100,
        attackSurface: 100,
        freshness: 100,
        researchPotential: 100,
        complexity: 100,
        policyFit: 100,
        duplicateRisk: 0,
      }),
    ).toBe(100);

    expect(
      calculateOpportunityScore({
        businessValue: 0,
        attackSurface: 0,
        freshness: 0,
        researchPotential: 0,
        complexity: 0,
        policyFit: 0,
        duplicateRisk: 100,
      }),
    ).toBe(0);
  });

  it("inverts duplicate risk", () => {
    const base = {
      businessValue: 50,
      attackSurface: 50,
      freshness: 50,
      researchPotential: 50,
      complexity: 50,
      policyFit: 50,
    };

    const lowRisk = calculateOpportunityScore({ ...base, duplicateRisk: 0 });
    const highRisk = calculateOpportunityScore({ ...base, duplicateRisk: 100 });

    expect(lowRisk).toBeGreaterThan(highRisk);
    expect(lowRisk - highRisk).toBe(5); // the 5% weight, exactly
  });

  it("clamps out-of-range and non-finite model output", () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-20)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(Number.POSITIVE_INFINITY)).toBe(0);

    // A model returning nonsense cannot push a score out of range.
    expect(
      calculateOpportunityScore({
        businessValue: 1e9,
        attackSurface: -500,
        freshness: Number.NaN,
        researchPotential: 50,
        complexity: 50,
        policyFit: 50,
        duplicateRisk: -10,
      }),
    ).toBeLessThanOrEqual(100);
  });

  it("clamps confidence into 0..1", () => {
    expect(clampConfidence(1.7)).toBe(1);
    expect(clampConfidence(-0.4)).toBe(0);
    expect(clampConfidence(0.756)).toBe(0.76);
  });

  it("weights sum to 1", () => {
    const contributions = scoreContributions({
      businessValue: 100,
      attackSurface: 100,
      freshness: 100,
      researchPotential: 100,
      complexity: 100,
      policyFit: 100,
      duplicateRisk: 0,
    });

    const totalWeight = contributions.reduce((sum, entry) => sum + entry.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 10);
  });

  it("maps scores to the documented bands", () => {
    expect(opportunityBand(95)).toBe("HIGH");
    expect(opportunityBand(80)).toBe("HIGH");
    expect(opportunityBand(79)).toBe("MEDIUM_HIGH");
    expect(opportunityBand(60)).toBe("MEDIUM_HIGH");
    expect(opportunityBand(59)).toBe("MEDIUM");
    expect(opportunityBand(40)).toBe("MEDIUM");
    expect(opportunityBand(39)).toBe("LOW");
    expect(opportunityBand(0)).toBe("LOW");
  });
});

describe("canonical hashing", () => {
  it("is independent of key order", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it("treats absent and null members as equivalent", () => {
    expect(contentHash({ a: 1, b: null })).toBe(contentHash({ a: 1 }));
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
  });

  it("distinguishes different values", () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash({ a: "1" })).not.toBe(contentHash({ a: 1 }));
  });

  it("respects array order, which is meaningful", () => {
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  });

  it("serialises dates stably", () => {
    const date = new Date("2026-03-01T12:00:00.000Z");
    expect(stableStringify({ at: date })).toBe('{"at":"2026-03-01T12:00:00.000Z"}');
  });

  it("drops non-serialisable members instead of throwing", () => {
    expect(canonicalize({ fn: () => undefined, ok: 1 })).toEqual({ ok: 1 });
    expect(canonicalize({ n: Number.NaN, ok: 1 })).toEqual({ ok: 1 });
  });

  it("produces the same scope hash for the same scope received twice", () => {
    const build = (): NormalizedScope => ({
      externalId: "s1",
      assetIdentifier: "api.example.com",
      assetType: "API",
      scopeStatus: "IN_SCOPE",
      eligibleForSubmission: true,
      eligibleForBounty: true,
      maxSeverity: "HIGH",
      instruction: "In scope.",
    });

    expect(scopeContentHash(build())).toBe(scopeContentHash(build()));
  });

  it("excludes provider timestamps and raw payloads from the scope hash", () => {
    const base: NormalizedScope = {
      externalId: "s1",
      assetIdentifier: "api.example.com",
      assetType: "API",
      scopeStatus: "IN_SCOPE",
      eligibleForSubmission: true,
      eligibleForBounty: true,
      maxSeverity: "HIGH",
      instruction: "In scope.",
    };

    // These fields change on their own and must not look like a scope change.
    const withNoise: NormalizedScope = {
      ...base,
      sourceUpdatedAt: new Date("2026-06-01T00:00:00Z"),
      sourceCreatedAt: new Date("2025-01-01T00:00:00Z"),
      raw: { fetched_at: "2026-06-01T00:00:00Z", anything: "else" },
      providerMetadata: { nativeAssetType: "URL" },
    };

    expect(scopeContentHash(withNoise)).toBe(scopeContentHash(base));
  });

  it("changes the scope hash when meaning changes", () => {
    const base: NormalizedScope = {
      assetIdentifier: "api.example.com",
      assetType: "API",
      scopeStatus: "IN_SCOPE",
      eligibleForSubmission: true,
      eligibleForBounty: true,
    };

    expect(scopeContentHash({ ...base, eligibleForBounty: false })).not.toBe(
      scopeContentHash(base),
    );
    expect(scopeContentHash({ ...base, maxSeverity: "CRITICAL" })).not.toBe(
      scopeContentHash(base),
    );
    expect(scopeContentHash({ ...base, instruction: "changed" })).not.toBe(scopeContentHash(base));
  });
});
