import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Creates a dedicated SQLite database for the test run and applies the real
 * migrations to it, so tests exercise the same schema the app ships.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const root = process.cwd();
  const tmpDir = path.join(root, "tests", ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const dbPath = path.join(tmpDir, "test.db");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }

  const url = `file:${dbPath.split(path.sep).join("/")}`;

  process.env.DATABASE_URL = url;
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY =
    "test-only-encryption-key-not-used-in-production";
  process.env.SESSION_SECRET = "test-only-session-secret";
  // Deterministic, offline evaluation: tests must never make paid API calls.
  process.env.AI_PROVIDER = "heuristic";
  process.env.LOG_LEVEL = "error";

  execSync("npx prisma migrate deploy", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  return async () => {
    // Leave the file behind on failure for inspection; it is gitignored.
  };
}
