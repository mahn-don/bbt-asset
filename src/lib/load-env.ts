/**
 * Loads `.env` for contexts that Next.js does not bootstrap itself: the Prisma
 * CLI, the standalone worker and the test harness.
 *
 * Also normalises a relative SQLite `DATABASE_URL` into an absolute path.
 * Prisma resolves relative SQLite paths against different base directories
 * depending on entry point (CLI vs. runtime vs. Vitest fork), which silently
 * produces two different database files. Absolutising it once here removes
 * that entire class of bug.
 */
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();

function loadDotEnv(): void {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  // Node >= 20.12 ships an env-file parser; avoid a dotenv dependency.
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
      return;
    } catch {
      // fall through to the manual parser
    }
  }

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function absolutiseSqliteUrl(): void {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return;

  const filePath = url.slice("file:".length);
  if (filePath === ":memory:" || path.isAbsolute(filePath)) return;

  const absolute = path.resolve(PROJECT_ROOT, filePath);
  process.env.DATABASE_URL = `file:${absolute.split(path.sep).join("/")}`;
}

loadDotEnv();
absolutiseSqliteUrl();

export {};
