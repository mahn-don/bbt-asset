/**
 * Creates or updates an operator account.
 *
 *   npm run admin:create -- you@example.com
 *
 * The password is read from the ADMIN_PASSWORD environment variable, or
 * generated and printed once if unset. It is never passed as an argv value,
 * where it would land in shell history and the process list.
 */
import "../src/lib/load-env";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: npm run admin:create -- you@example.com");
    console.error("Set ADMIN_PASSWORD to choose the password, or one will be generated.");
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD;
  let generated = false;

  if (!password) {
    password = randomBytes(18).toString("base64url");
    generated = true;
  }

  if (password.length < 12) {
    console.error("ADMIN_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

  try {
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, role: "ADMIN" },
      update: { passwordHash, disabled: false },
    });

    console.log(`Account ready: ${user.email} (${user.role})`);
    if (generated) {
      console.log(`Generated password (shown once): ${password}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
