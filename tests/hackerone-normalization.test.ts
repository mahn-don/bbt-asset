import { describe, expect, it } from "vitest";
import { HackerOneAdapter } from "@/lib/providers/hackerone";

const adapter = new HackerOneAdapter();

describe("HackerOne program normalization", () => {
  it("maps a public program payload onto the normalized model", () => {
    const program = adapter.normalizeProgram({
      id: "12345",
      type: "program",
      attributes: {
        handle: "example-corp",
        name: "Example Corp",
        currency: "usd",
        submission_state: "open",
        state: "public_mode",
        offers_bounties: true,
        gold_standard_safe_harbor: true,
        policy: "Test the listed assets only.",
        created_at: "2023-04-01T10:00:00.000Z",
        updated_at: "2026-01-15T08:30:00.000Z",
        average_bounty_lower_amount: 500,
        average_bounty_upper_amount: 9000,
      },
    });

    expect(program.externalId).toBe("12345");
    expect(program.handleOrSlug).toBe("example-corp");
    expect(program.name).toBe("Example Corp");
    expect(program.sourceUrl).toBe("https://hackerone.com/example-corp");
    expect(program.status).toBe("ACTIVE");
    expect(program.visibility).toBe("PUBLIC");
    expect(program.currency).toBe("USD");
    expect(program.safeHarbor).toBe("FULL");
    expect(program.bountyMin).toBe(500);
    expect(program.bountyMax).toBe(9000);
    expect(program.sourceUpdatedAt?.toISOString()).toBe("2026-01-15T08:30:00.000Z");
  });

  it("marks a private, paused program correctly", () => {
    const program = adapter.normalizeProgram({
      id: "999",
      attributes: { handle: "private-one", name: "Private", state: "private_mode", submission_state: "paused" },
    });

    expect(program.visibility).toBe("PRIVATE");
    expect(program.status).toBe("PAUSED");
  });

  it("falls back to the handle when no id is present", () => {
    const program = adapter.normalizeProgram({ attributes: { handle: "only-handle", name: "X" } });
    expect(program.externalId).toBe("only-handle");
  });

  it("rejects a payload with neither id nor handle", () => {
    expect(() => adapter.normalizeProgram({ attributes: { name: "Nameless" } })).toThrow(
      /missing both id and handle/i,
    );
  });
});

describe("HackerOne scope normalization", () => {
  it("maps a bounty-eligible URL scope", () => {
    const scope = adapter.normalizeScope({
      id: "778899",
      attributes: {
        asset_type: "URL",
        asset_identifier: "https://Accounts.Example.com/",
        eligible_for_bounty: true,
        eligible_for_submission: true,
        max_severity: "critical",
        instruction: "Authentication flows are in scope.",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    });

    expect(scope.externalId).toBe("778899");
    // Host is lower-cased and the trailing slash removed, so the same asset
    // from two syncs collapses to one row.
    expect(scope.assetIdentifier).toBe("https://accounts.example.com");
    expect(scope.assetType).toBe("URL");
    expect(scope.scopeStatus).toBe("IN_SCOPE");
    expect(scope.eligibleForBounty).toBe(true);
    expect(scope.maxSeverity).toBe("CRITICAL");
    expect(scope.providerMetadata?.nativeAssetType).toBe("URL");
  });

  it("maps provider-native asset types onto the normalized vocabulary", () => {
    const cases: [string, string, string][] = [
      ["GOOGLE_PLAY_APP_ID", "com.example.app", "ANDROID"],
      ["APPLE_STORE_APP_ID", "1234567890", "IOS"],
      ["SOURCE_CODE", "https://github.com/example/repo", "REPOSITORY"],
      ["CIDR", "192.0.2.0/24", "CIDR"],
      ["WILDCARD", "*.example.com", "WILDCARD"],
      ["HARDWARE", "Example Router v2", "OTHER"],
    ];

    for (const [nativeType, identifier, expected] of cases) {
      const scope = adapter.normalizeScope({
        id: "1",
        attributes: {
          asset_type: nativeType,
          asset_identifier: identifier,
          eligible_for_submission: true,
        },
      });
      expect(scope.assetType, `${nativeType} -> ${expected}`).toBe(expected);
    }
  });

  it("refines a generic URL type into API when the identifier says so", () => {
    const scope = adapter.normalizeScope({
      attributes: {
        asset_type: "URL",
        asset_identifier: "https://api.example.com/v2",
        eligible_for_submission: true,
      },
    });
    expect(scope.assetType).toBe("API");
  });

  it("treats an archived scope as out of scope rather than dropping it", () => {
    const scope = adapter.normalizeScope({
      attributes: {
        asset_type: "URL",
        asset_identifier: "https://old.example.com",
        eligible_for_submission: true,
        eligible_for_bounty: true,
        archived_at: "2026-02-01T00:00:00.000Z",
      },
    });

    expect(scope.scopeStatus).toBe("OUT_OF_SCOPE");
    expect(scope.eligibleForSubmission).toBe(false);
    expect(scope.eligibleForBounty).toBe(false);
  });

  it("marks a submission-ineligible scope as out of scope", () => {
    const scope = adapter.normalizeScope({
      attributes: {
        asset_type: "URL",
        asset_identifier: "https://notes.example.com",
        eligible_for_submission: false,
      },
    });
    expect(scope.scopeStatus).toBe("OUT_OF_SCOPE");
  });

  it("rejects a scope payload with no asset identifier", () => {
    expect(() => adapter.normalizeScope({ attributes: { asset_type: "URL" } })).toThrow(
      /missing asset_identifier/i,
    );
  });
});

describe("HackerOne credential validation", () => {
  it("accepts a well-formed credential pair", () => {
    expect(
      adapter.validateCredentials({ apiUsername: "researcher", apiToken: "a".repeat(40) }).valid,
    ).toBe(true);
  });

  it("reports per-field errors", () => {
    const result = adapter.validateCredentials({ apiUsername: "", apiToken: "short" });
    expect(result.valid).toBe(false);
    expect(result.fieldErrors?.apiUsername).toBeDefined();
    expect(result.fieldErrors?.apiToken).toBeDefined();
  });

  it("rejects a username containing a colon, which would break Basic auth", () => {
    const result = adapter.validateCredentials({
      apiUsername: "user:name",
      apiToken: "a".repeat(40),
    });
    expect(result.valid).toBe(false);
  });
});
