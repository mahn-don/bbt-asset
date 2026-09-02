import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma";

/**
 * Prisma client singleton.
 *
 * Prisma 7 requires an explicit driver adapter. Next.js dev-mode hot reload
 * would otherwise open a new SQLite handle on every recompile, so the instance
 * is cached on globalThis outside production.
 */

declare global {
  var __bbiPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set - cannot open the database.");
  }

  const adapter = new PrismaBetterSqlite3({ url });

  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalThis.__bbiPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__bbiPrisma = prisma;
}
