import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  buildCredentialHint,
  decryptCredentials,
  encryptCredentials,
} from "@/lib/crypto/credentials";
import {
  deleteCredentials,
  getIntegrationView,
  loadCredentials,
  saveCredentials,
} from "@/lib/credentials/store";
import { resetDatabase, seedProvider } from "./helpers";
import { logger, redact, sanitizeErrorMessage } from "@/lib/logger";

const SECRET = "hunter2-super-secret-api-token-value";

beforeEach(async () => {
  await resetDatabase();
  await seedProvider("HACKERONE", "HackerOne");
});

describe("credential encryption", () => {
  it("round-trips through the envelope", () => {
    const envelope = encryptCredentials({ apiToken: SECRET }, "provider-integration:HACKERONE");
    const decrypted = decryptCredentials(envelope.ciphertext, "provider-integration:HACKERONE");

    expect(decrypted.apiToken).toBe(SECRET);
  });

  it("never stores the plaintext in the ciphertext", () => {
    const envelope = encryptCredentials({ apiToken: SECRET }, "provider-integration:HACKERONE");
    expect(envelope.ciphertext).not.toContain(SECRET);
    expect(envelope.ciphertext).not.toContain("hunter2");
  });

  it("produces a different ciphertext each time (random nonce)", () => {
    const a = encryptCredentials({ apiToken: SECRET }, "aad");
    const b = encryptCredentials({ apiToken: SECRET }, "aad");
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails authentication when the ciphertext is tampered with", () => {
    const envelope = encryptCredentials({ apiToken: SECRET }, "aad");
    const parts = envelope.ciphertext.split(".");
    const data = Buffer.from(parts[4] as string, "base64");
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[4] = data.toString("base64");

    expect(() => decryptCredentials(parts.join("."), "aad")).toThrow(/decryption failed/i);
  });

  it("refuses a ciphertext bound to a different provider", () => {
    const envelope = encryptCredentials({ apiToken: SECRET }, "provider-integration:HACKERONE");

    // Copying a row between providers must not silently authenticate.
    expect(() =>
      decryptCredentials(envelope.ciphertext, "provider-integration:BUGCROWD"),
    ).toThrow();
  });

  it("stamps the key id so keys can be rotated", () => {
    const envelope = encryptCredentials({ apiToken: SECRET }, "aad");
    expect(envelope.ciphertext.startsWith("v1.")).toBe(true);
    expect(envelope.keyId).toBeTruthy();
    expect(envelope.ciphertext.split(".")[1]).toBe(envelope.keyId);
  });

  it("reads a ciphertext written under a previous key after rotation", () => {
    const original = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
    const originalId = process.env.INTEGRATION_CREDENTIAL_KEY_ID;

    try {
      process.env.INTEGRATION_CREDENTIAL_KEY_ID = "k1";
      process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = "old-key-old-key-old-key-old-key";
      const envelope = encryptCredentials({ apiToken: SECRET }, "aad");

      // Rotate: new active key, old key retained for decryption.
      process.env.INTEGRATION_CREDENTIAL_KEY_ID = "k2";
      process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = "new-key-new-key-new-key-new-key";
      process.env.INTEGRATION_CREDENTIAL_PREVIOUS_KEYS =
        "k1:old-key-old-key-old-key-old-key";

      expect(decryptCredentials(envelope.ciphertext, "aad").apiToken).toBe(SECRET);

      const fresh = encryptCredentials({ apiToken: SECRET }, "aad");
      expect(fresh.keyId).toBe("k2");
    } finally {
      process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = original;
      if (originalId === undefined) delete process.env.INTEGRATION_CREDENTIAL_KEY_ID;
      else process.env.INTEGRATION_CREDENTIAL_KEY_ID = originalId;
      delete process.env.INTEGRATION_CREDENTIAL_PREVIOUS_KEYS;
    }
  });

  it("rejects a master key that is too short to be safe", () => {
    const original = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
    try {
      process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = "short";
      expect(() => encryptCredentials({ apiToken: SECRET }, "aad")).toThrow(/at least 16/i);
    } finally {
      process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = original;
    }
  });
});

describe("credential store", () => {
  it("encrypts at rest and never persists plaintext", async () => {
    await saveCredentials("HACKERONE", { apiUsername: "researcher", apiToken: SECRET });

    const row = await prisma.providerIntegration.findFirstOrThrow();

    expect(row.encryptedCredentials).toBeTruthy();
    expect(row.encryptedCredentials).not.toContain(SECRET);

    // Nothing in the entire row leaks the secret.
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("returns plaintext only through the server-side loader", async () => {
    await saveCredentials("HACKERONE", { apiUsername: "researcher", apiToken: SECRET });

    const credentials = await loadCredentials("HACKERONE");
    expect(credentials?.apiToken).toBe(SECRET);
    expect(credentials?.apiUsername).toBe("researcher");
  });

  it("exposes only a masked hint through the API-facing view", async () => {
    await saveCredentials("HACKERONE", { apiUsername: "researcher", apiToken: SECRET });

    const view = await getIntegrationView("HACKERONE");

    expect(view.configured).toBe(true);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    // At most the final four characters of a long secret are ever shown.
    expect(view.credentialHint).toContain("****");
    expect(view.credentialHint).not.toContain(SECRET);
    expect(view).not.toHaveProperty("encryptedCredentials");
  });

  it("discards credential keys the adapter does not declare", async () => {
    await saveCredentials("HACKERONE", {
      apiUsername: "researcher",
      apiToken: SECRET,
      smuggled: "should-not-persist",
    });

    const credentials = await loadCredentials("HACKERONE");
    expect(credentials).not.toHaveProperty("smuggled");
  });

  it("replaces credentials and bumps the credential version", async () => {
    await saveCredentials("HACKERONE", { apiUsername: "researcher", apiToken: SECRET });
    const first = await prisma.providerIntegration.findFirstOrThrow();

    const replacement = "replacement-token-value-abcdefghij";
    await saveCredentials("HACKERONE", { apiUsername: "researcher2", apiToken: replacement });

    const second = await prisma.providerIntegration.findFirstOrThrow();
    expect(second.credentialVersion).toBe(first.credentialVersion + 1);

    const credentials = await loadCredentials("HACKERONE");
    expect(credentials?.apiToken).toBe(replacement);
    expect(credentials?.apiUsername).toBe("researcher2");
  });

  it("clears everything on disconnect", async () => {
    await saveCredentials("HACKERONE", { apiUsername: "researcher", apiToken: SECRET });
    await deleteCredentials("HACKERONE");

    const row = await prisma.providerIntegration.findFirstOrThrow();
    expect(row.encryptedCredentials).toBeNull();
    expect(row.credentialHint).toBeNull();
    expect(row.enabled).toBe(false);
    expect(row.connectionStatus).toBe("NOT_CONFIGURED");
    expect(await loadCredentials("HACKERONE")).toBeNull();
  });

  it("builds a hint that cannot reconstruct the secret", () => {
    const hint = buildCredentialHint(
      { apiUsername: "researcher", apiToken: SECRET },
      [
        { key: "apiUsername", secret: false, label: "API Username" },
        { key: "apiToken", secret: true, label: "API Token" },
      ],
    );

    expect(hint).toContain("researcher");
    expect(hint).toContain("****");
    expect(hint).not.toContain(SECRET);
    // Only the last 4 characters appear.
    expect(hint).toContain(SECRET.slice(-4));
    expect(hint).not.toContain(SECRET.slice(-8));
  });

  it("fully masks a short secret rather than revealing part of it", () => {
    const hint = buildCredentialHint({ apiToken: "short123" }, [
      { key: "apiToken", secret: true, label: "API Token" },
    ]);

    expect(hint).toBe("API Token: ********");
    expect(hint).not.toContain("123");
  });
});

describe("logging never leaks secrets", () => {
  it("redacts sensitive field names", () => {
    const redacted = redact({
      apiToken: SECRET,
      password: "pw",
      authorization: "Basic abc",
      encryptedCredentials: "v1.k1.x.y.z",
      assetIdentifier: "api.example.com",
      nested: { clientSecret: "s3cret", assetType: "API" },
    }) as Record<string, unknown>;

    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(redacted.apiToken).toBe("[redacted]");
    expect(redacted.password).toBe("[redacted]");
    expect(redacted.authorization).toBe("[redacted]");
    expect(redacted.encryptedCredentials).toBe("[redacted]");
    // Non-sensitive context survives, or the logs would be useless.
    expect(redacted.assetIdentifier).toBe("api.example.com");
    expect((redacted.nested as Record<string, unknown>).clientSecret).toBe("[redacted]");
  });

  it("scrubs inline credentials from error messages", () => {
    expect(sanitizeErrorMessage(new Error(`Authorization: Bearer ${SECRET} failed`))).not.toContain(
      SECRET,
    );
    expect(sanitizeErrorMessage(new Error(`api_key=${SECRET}`))).not.toContain(SECRET);
  });

  it("does not write a secret to the log stream", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const originalLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";

    try {
      logger.info("saving credentials", { provider: "HACKERONE", apiToken: SECRET });
      const written = spy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(written).not.toContain(SECRET);
      expect(written).toContain("[redacted]");
    } finally {
      process.env.LOG_LEVEL = originalLevel;
      spy.mockRestore();
    }
  });
});
