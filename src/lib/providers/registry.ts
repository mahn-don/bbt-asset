import "server-only";
import type { ProviderAdapter } from "@/lib/providers/types";
import type { ProviderSlug } from "@/lib/enums";
import { PROVIDER_SLUGS } from "@/lib/enums";
import { HackerOneAdapter } from "@/lib/providers/hackerone";
import { BugcrowdAdapter } from "@/lib/providers/bugcrowd";
import { IntigritiAdapter } from "@/lib/providers/intigriti";
import { YesWeHackAdapter } from "@/lib/providers/yeswehack";
import { ManualAdapter } from "@/lib/providers/manual";

/**
 * Provider registry.
 *
 * Adding a provider means implementing ProviderAdapter and registering it
 * here - nothing else in the application needs to change.
 */

const adapters: Record<ProviderSlug, ProviderAdapter> = {
  HACKERONE: new HackerOneAdapter(),
  BUGCROWD: new BugcrowdAdapter(),
  INTIGRITI: new IntigritiAdapter(),
  YESWEHACK: new YesWeHackAdapter(),
  MANUAL: new ManualAdapter(),
};

export function getAdapter(slug: string): ProviderAdapter {
  const adapter = adapters[slug.toUpperCase() as ProviderSlug];
  if (!adapter) {
    throw new Error(`No provider adapter registered for "${slug}".`);
  }
  return adapter;
}

export function tryGetAdapter(slug: string): ProviderAdapter | null {
  return adapters[slug.toUpperCase() as ProviderSlug] ?? null;
}

export function listAdapters(): ProviderAdapter[] {
  return PROVIDER_SLUGS.map((slug) => adapters[slug]);
}

/** Display metadata used to seed the Provider table. */
export const PROVIDER_SEED: { slug: ProviderSlug; name: string }[] = [
  { slug: "HACKERONE", name: "HackerOne" },
  { slug: "BUGCROWD", name: "Bugcrowd" },
  { slug: "INTIGRITI", name: "Intigriti" },
  { slug: "YESWEHACK", name: "YesWeHack" },
  { slug: "MANUAL", name: "Manual" },
];
