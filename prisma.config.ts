import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 reads the datasource URL from this file rather than from the
// `env()` call in schema.prisma. Loading `.env` here keeps a single source of
// truth for DATABASE_URL across the CLI, the app and the test harness.
import "./src/lib/load-env";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  },
});
