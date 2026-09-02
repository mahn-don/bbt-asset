import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Format: `scrypt$<base64 salt>$<base64 hash>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_BYTES);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1] as string, "base64");
  const expected = Buffer.from(parts[2] as string, "base64");
  if (expected.length !== KEY_BYTES) return false;

  const derived = await scrypt(password, salt, KEY_BYTES);
  return timingSafeEqual(derived, expected);
}

export interface PasswordPolicyResult {
  ok: boolean;
  message?: string;
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 12) {
    return { ok: false, message: "Password must be at least 12 characters." };
  }
  if (password.length > 200) {
    return { ok: false, message: "Password must be at most 200 characters." };
  }
  return { ok: true };
}
