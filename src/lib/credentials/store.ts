import "server-only";
import { prisma } from "@/lib/db";
import { buildCredentialHint, decryptCredentials, encryptCredentials } from "@/lib/crypto/credentials";
import { getAdapter } from "@/lib/providers/registry";
import type { ProviderCredentials } from "@/lib/providers/types";
import type { ConnectionStatus, ProviderSlug } from "@/lib/enums";
import { logger } from "@/lib/logger";

/**
 * The only path through which provider credentials are written or read.
 *
 * Plaintext credentials exist solely inside this module's return values, which
 * are consumed by adapters on the server. Nothing here is ever returned to a
 * route handler's JSON response - the API layer works with the redacted view
 * from `getIntegrationView` instead.
 */

export interface IntegrationView {
  providerSlug: ProviderSlug;
  providerName: string;
  enabled: boolean;
  connectionStatus: ConnectionStatus;
  configured: boolean;
  /** Masked, non-reversible summary such as `API Token: ****3f9a`. */
  credentialHint: string | null;
  credentialVersion: number;
  lastTestedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastAttemptedSyncAt: Date | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
}

/** Additional authenticated data binding a ciphertext to its provider row. */
function aadFor(providerSlug: string): string {
  return `provider-integration:${providerSlug.toUpperCase()}`;
}

export async function ensureIntegration(providerSlug: string) {
  const slug = providerSlug.toUpperCase();

  // The adapter registry is the source of truth for which providers exist, so
  // an adapter without a database row is a seeding gap, not a user error. The
  // row is created on demand - otherwise adding an adapter without re-running
  // the seed would 500 the whole integrations page.
  const adapter = getAdapter(slug);

  let provider = await prisma.provider.findUnique({
    where: { slug },
    include: { integration: true },
  });

  if (!provider) {
    await prisma.provider.upsert({
      where: { slug },
      create: { slug, name: adapter.displayName, enabled: true },
      update: {},
    });

    provider = await prisma.provider.findUniqueOrThrow({
      where: { slug },
      include: { integration: true },
    });
  }

  if (provider.integration) return { provider, integration: provider.integration };

  const requiresCredentials = adapter.getCapabilities().requiresCredentials;

  const integration = await prisma.providerIntegration.create({
    data: {
      providerId: provider.id,
      // A credential-free provider (MANUAL) is usable the moment it exists.
      enabled: !requiresCredentials,
      connectionStatus: requiresCredentials ? "NOT_CONFIGURED" : "READY",
    },
  });

  return { provider, integration };
}

export async function saveCredentials(
  providerSlug: string,
  credentials: ProviderCredentials,
): Promise<void> {
  const adapter = getAdapter(providerSlug);
  const { integration } = await ensureIntegration(providerSlug);

  const schema = adapter.credentialSchema();

  // Only persist fields the adapter actually declares - a caller cannot smuggle
  // arbitrary keys into the encrypted blob.
  const filtered: ProviderCredentials = {};
  for (const field of schema.fields) {
    const value = credentials[field.key];
    if (typeof value === "string" && value.trim() !== "") {
      filtered[field.key] = value.trim();
    }
  }

  const envelope = encryptCredentials(filtered, aadFor(providerSlug));
  const hint = buildCredentialHint(
    filtered,
    schema.fields.map((field) => ({ key: field.key, secret: field.secret, label: field.label })),
  );

  await prisma.providerIntegration.update({
    where: { id: integration.id },
    data: {
      encryptedCredentials: envelope.ciphertext,
      credentialKeyId: envelope.keyId,
      credentialVersion: { increment: 1 },
      credentialHint: hint || null,
      connectionStatus: "NOT_CONFIGURED",
      lastErrorCode: null,
      lastErrorSummary: null,
    },
  });

  logger.info("provider credentials saved", {
    provider: providerSlug,
    fields: Object.keys(filtered).length,
  });
}

export async function deleteCredentials(providerSlug: string): Promise<void> {
  const { integration } = await ensureIntegration(providerSlug);

  await prisma.providerIntegration.update({
    where: { id: integration.id },
    data: {
      encryptedCredentials: null,
      credentialKeyId: null,
      credentialHint: null,
      enabled: false,
      connectionStatus: "NOT_CONFIGURED",
      lastTestedAt: null,
      lastErrorCode: null,
      lastErrorSummary: null,
    },
  });

  logger.info("provider credentials deleted", { provider: providerSlug });
}

/**
 * Returns decrypted credentials for server-side adapter use.
 * Returns an empty object for providers that need no credentials.
 */
export async function loadCredentials(providerSlug: string): Promise<ProviderCredentials | null> {
  const adapter = getAdapter(providerSlug);
  if (!adapter.getCapabilities().requiresCredentials) return {};

  const { integration } = await ensureIntegration(providerSlug);
  if (!integration.encryptedCredentials) return null;

  return decryptCredentials(integration.encryptedCredentials, aadFor(providerSlug));
}

export async function hasCredentials(providerSlug: string): Promise<boolean> {
  const adapter = getAdapter(providerSlug);
  if (!adapter.getCapabilities().requiresCredentials) return true;

  const { integration } = await ensureIntegration(providerSlug);
  return Boolean(integration.encryptedCredentials);
}

export async function setConnectionStatus(
  providerSlug: string,
  status: ConnectionStatus,
  error?: { code?: string; summary?: string },
): Promise<void> {
  const { integration } = await ensureIntegration(providerSlug);

  await prisma.providerIntegration.update({
    where: { id: integration.id },
    data: {
      connectionStatus: status,
      lastTestedAt: new Date(),
      lastErrorCode: error?.code ?? null,
      lastErrorSummary: error?.summary ?? null,
    },
  });
}

export async function setEnabled(providerSlug: string, enabled: boolean): Promise<void> {
  const { integration } = await ensureIntegration(providerSlug);

  const requiresCredentials = getAdapter(providerSlug).getCapabilities().requiresCredentials;
  const configured = Boolean(integration.encryptedCredentials) || !requiresCredentials;

  // DISABLED is an explicit operator state, distinct from a failure. On enable,
  // a previously verified connection keeps its CONNECTED status rather than
  // being downgraded; anything unverified reverts to NOT_CONFIGURED so the card
  // never claims a connection that has not been tested.
  let connectionStatus: ConnectionStatus;
  if (!enabled) {
    connectionStatus = "DISABLED";
  } else if (
    configured &&
    (integration.connectionStatus === "CONNECTED" || integration.connectionStatus === "READY")
  ) {
    connectionStatus = integration.connectionStatus as ConnectionStatus;
  } else if (configured) {
    connectionStatus =
      integration.connectionStatus === "DISABLED"
        ? "NOT_CONFIGURED"
        : (integration.connectionStatus as ConnectionStatus);
  } else {
    connectionStatus = "NOT_CONFIGURED";
  }

  await prisma.providerIntegration.update({
    where: { id: integration.id },
    data: { enabled, connectionStatus },
  });
}

/** Redacted integration state safe to return over the API. */
export async function getIntegrationView(providerSlug: string): Promise<IntegrationView> {
  const { provider, integration } = await ensureIntegration(providerSlug);

  return {
    providerSlug: provider.slug as ProviderSlug,
    providerName: provider.name,
    enabled: integration.enabled,
    connectionStatus: integration.connectionStatus as ConnectionStatus,
    configured: Boolean(integration.encryptedCredentials),
    credentialHint: integration.credentialHint,
    credentialVersion: integration.credentialVersion,
    lastTestedAt: integration.lastTestedAt,
    lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt,
    lastAttemptedSyncAt: integration.lastAttemptedSyncAt,
    lastErrorCode: integration.lastErrorCode,
    lastErrorSummary: integration.lastErrorSummary,
  };
}
