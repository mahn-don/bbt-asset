/**
 * Seeds the Provider rows and their integration stubs.
 *
 * Idempotent: safe to run on every deploy.
 */
import "../src/lib/load-env";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma";
import { PROVIDER_SEED } from "../src/lib/providers/registry";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

  try {
    for (const entry of PROVIDER_SEED) {
      const provider = await prisma.provider.upsert({
        where: { slug: entry.slug },
        create: { slug: entry.slug, name: entry.name, enabled: true },
        update: { name: entry.name },
      });

      const existing = await prisma.providerIntegration.findUnique({
        where: { providerId: provider.id },
      });

      if (!existing) {
        await prisma.providerIntegration.create({
          data: {
            providerId: provider.id,
            // The manual provider needs no credentials, so it is ready at once.
            enabled: entry.slug === "MANUAL",
            connectionStatus: entry.slug === "MANUAL" ? "READY" : "NOT_CONFIGURED",
          },
        });
      }

      console.log(`seeded provider ${entry.slug}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
