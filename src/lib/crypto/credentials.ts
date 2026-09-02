import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Authenticated encryption for provider credentials.
 *
 * AES-256-GCM from Node's standard library - no custom cryptography. The
 * master key lives in the environment (INTEGRATION_CREDENTIAL_ENCRYPTION_KEY),
 * never in the database, and every envelope records the key id that produced
 * it so keys can be rotated without a rewrite of stored rows.
 *
 * Envelope format (stored as a single string):
 *   v1.<keyId>.<base64 iv>.<base64 authTag>.<base64 ciphertext>
 *
 * The provider slug is bound in as GCM additional authenticated data, so a
 * ciphertext copied from one provider's row to another fails to decrypt rather
 * than silently authenticating against the wrong service.
 */

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32;
const HKDF_INFO = "bbi:integration-credentials:v1";

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

/**
 * Derives a 32-byte AES key from the configured master secret via HKDF, so an
 * operator-supplied passphrase of any length yields a correctly sized key
 * without truncating or padding it by hand.
 */
function deriveKey(secret: string, keyId: string): Buffer {
  if (secret.length < 16) {
    throw new CredentialCryptoError(
      "INTEGRATION_CREDENTIAL_ENCRYPTION_KEY must be at least 16 characters.",
    );
  }
  const salt = Buffer.from(`bbi-credential-salt:${keyId}`, "utf8");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), salt, Buffer.from(HKDF_INFO, "utf8"), KEY_BYTES));
}

interface KeyEntry {
  keyId: string;
  key: Buffer;
}

function activeKey(): KeyEntry {
  const keyId = serverEnv.credentialKeyId;
  return { keyId, key: deriveKey(serverEnv.credentialEncryptionKey, keyId) };
}

/** Active key first, then any configured previous keys (for rotation). */
function decryptionKeys(): KeyEntry[] {
  const keys: KeyEntry[] = [activeKey()];

  const previous = serverEnv.credentialPreviousKeys;
  if (previous) {
    for (const pair of previous.split(",")) {
      const separator = pair.indexOf(":");
      if (separator <= 0) continue;
      const keyId = pair.slice(0, separator).trim();
      const secret = pair.slice(separator + 1).trim();
      if (!keyId || !secret) continue;
      try {
        keys.push({ keyId, key: deriveKey(secret, keyId) });
      } catch {
        // A malformed rotation entry must not break decryption of the rest.
      }
    }
  }

  return keys;
}

export interface EncryptedEnvelope {
  ciphertext: string;
  keyId: string;
  version: number;
}

export function encryptCredentials(
  plaintext: Record<string, string>,
  aad: string,
): EncryptedEnvelope {
  const { keyId, key } = activeKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const serialized = Buffer.from(JSON.stringify(plaintext), "utf8");
  const encrypted = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: [
      ENVELOPE_VERSION,
      keyId,
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64"),
    ].join("."),
    keyId,
    version: 1,
  };
}

export function decryptCredentials(envelope: string, aad: string): Record<string, string> {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) {
    throw new CredentialCryptoError("Stored credential envelope is malformed.");
  }

  const [, envelopeKeyId, ivB64, tagB64, dataB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const candidates = decryptionKeys().filter((entry) => entry.keyId === envelopeKeyId);
  if (candidates.length === 0) {
    throw new CredentialCryptoError(
      `No encryption key configured for key id "${envelopeKeyId}". ` +
        "Set INTEGRATION_CREDENTIAL_PREVIOUS_KEYS if the key was rotated.",
    );
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", candidate.key, Buffer.from(ivB64, "base64"));
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final(),
      ]);
      const parsed: unknown = JSON.parse(decrypted.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new CredentialCryptoError("Decrypted credential payload has an unexpected shape.");
      }
      return parsed as Record<string, string>;
    } catch (error) {
      lastError = error;
    }
  }

  throw new CredentialCryptoError(
    lastError instanceof CredentialCryptoError
      ? lastError.message
      : "Credential decryption failed (wrong key or tampered ciphertext).",
  );
}

/**
 * Builds a non-reversible display hint, e.g. `researcher@example.com / ****3f9a`.
 * Only the last 4 characters of a secret are ever exposed, and only when the
 * secret is long enough that those 4 characters do not materially help an
 * attacker reconstruct it.
 */
export function buildCredentialHint(
  credentials: Record<string, string>,
  fields: { key: string; secret: boolean; label: string }[],
): string {
  const parts: string[] = [];

  for (const field of fields) {
    const value = credentials[field.key];
    if (!value) continue;
    if (!field.secret) {
      parts.push(`${field.label}: ${value.length > 60 ? `${value.slice(0, 57)}...` : value}`);
    } else {
      parts.push(`${field.label}: ${value.length >= 12 ? `****${value.slice(-4)}` : "********"}`);
    }
  }

  return parts.join(" · ");
}

/** Constant-time string comparison for tokens and hashes. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
