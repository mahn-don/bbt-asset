import "server-only";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { logger, sanitizeErrorMessage } from "@/lib/logger";
import { getAdapter } from "@/lib/providers/registry";
import { ProviderHttpError } from "@/lib/providers/http-client";
import { loadCredentials, setConnectionStatus } from "@/lib/credentials/store";
import { stableStringify } from "@/lib/canonical/hash";
import {
  canonicalProgram,
  canonicalProgramFromRow,
  canonicalScope,
  canonicalScopeFromRow,
  programContentHash,
  scopeContentHash,
} from "@/lib/sync/canonical";
import { diffPrograms, diffScopes, importanceForNewScope } from "@/lib/sync/change-detection";
import { enqueueScopeEvaluation } from "@/lib/ai/evaluate";
import { dedupeKeys, enqueueJob } from "@/lib/jobs/queue";
import type {
  FetchContext,
  NormalizedProgram,
  NormalizedScope,
  ProviderAdapter,
} from "@/lib/providers/types";
import type { ChangeImportance, ChangeType, SyncStatus, SyncTriggerType } from "@/lib/enums";
import { getAiSettings } from "@/lib/ai/settings";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

/**
 * The sync pipeline.
 *
 *   provider API -> adapter -> normalizer -> canonical hash -> upsert
 *     -> scope versioning -> change detection -> AI queue
 *
 * Design commitments:
 *  - Idempotent. Re-running an identical sync creates no duplicate rows, no
 *    new ScopeVersion, no ChangeEvent and no AI job. Only `lastSeenAt` moves.
 *  - Partial failure tolerant. One broken program does not fail the provider
 *    run; the run ends PARTIAL with the error recorded.
 *  - AI-independent. Evaluations are queued after the data is committed, and
 *    an AI failure can never fail a sync.
 */

export interface SyncOptions {
  triggerType: SyncTriggerType;
  /** Restrict the run to a single program handle (used by manual re-sync). */
  programHandle?: string;
  signal?: AbortSignal;
  /**
   * Language for AI evaluations queued by this run. Fixed at enqueue time so a
   * background worker still produces the language the operator asked for.
   */
  language?: Locale;
}

export interface SyncResult {
  syncRunId: string;
  status: SyncStatus;
  programsReceived: number;
  programsCreated: number;
  programsUpdated: number;
  scopesReceived: number;
  scopesCreated: number;
  scopesUpdated: number;
  scopesRemoved: number;
  changesDetected: number;
  aiJobsEnqueued: number;
  errorCode?: string;
  errorSummary?: string;
}

interface Counters {
  programsReceived: number;
  programsCreated: number;
  programsUpdated: number;
  scopesReceived: number;
  scopesCreated: number;
  scopesUpdated: number;
  scopesRemoved: number;
  changesDetected: number;
  aiJobsEnqueued: number;
  rateLimitCount: number;
  retryCount: number;
}

function emptyCounters(): Counters {
  return {
    programsReceived: 0,
    programsCreated: 0,
    programsUpdated: 0,
    scopesReceived: 0,
    scopesCreated: 0,
    scopesUpdated: 0,
    scopesRemoved: 0,
    changesDetected: 0,
    aiJobsEnqueued: 0,
    rateLimitCount: 0,
    retryCount: 0,
  };
}

export async function runProviderSync(
  providerSlug: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const adapter = getAdapter(providerSlug);

  const provider = await prisma.provider.findUnique({
    where: { slug: providerSlug.toUpperCase() },
    include: { integration: true },
  });

  if (!provider) throw new Error(`Provider "${providerSlug}" is not registered.`);

  const syncRun = await prisma.syncRun.create({
    data: {
      providerId: provider.id,
      triggerType: options.triggerType,
      status: "RUNNING",
    },
  });

  const log = logger.child({ provider: provider.slug, syncRunId: syncRun.id });
  const counters = emptyCounters();
  const errors: string[] = [];

  await prisma.providerIntegration.updateMany({
    where: { providerId: provider.id },
    data: { lastAttemptedSyncAt: new Date() },
  });

  try {
    const capabilities = adapter.getCapabilities();

    if (!capabilities.listPrograms) {
      // Manual provider: nothing to fetch, and that is a success, not a failure.
      return await finishRun(syncRun.id, provider.id, "SUCCESS", counters, undefined, log, {
        note: "Provider does not support API program listing.",
      });
    }

    if (!provider.enabled || provider.integration?.enabled === false) {
      return await finishRun(
        syncRun.id,
        provider.id,
        "FAILED",
        counters,
        { code: "DISABLED", summary: "The integration is disabled." },
        log,
      );
    }

    const credentials = await loadCredentials(provider.slug);
    if (credentials === null) {
      await setConnectionStatus(provider.slug, "NOT_CONFIGURED", {
        code: "NO_CREDENTIALS",
        summary: "No credentials are stored for this provider.",
      });
      return await finishRun(
        syncRun.id,
        provider.id,
        "FAILED",
        counters,
        { code: "NO_CREDENTIALS", summary: "No credentials are stored for this provider." },
        log,
      );
    }

    const context: FetchContext = { credentials, signal: options.signal };

    const programs = await collectPrograms(adapter, context, options, log);
    counters.programsReceived = programs.length;

    for (const program of programs) {
      try {
        await syncProgram(
          adapter,
          context,
          provider.id,
          provider.slug,
          syncRun.id,
          program,
          counters,
          log,
          options.language ?? DEFAULT_LOCALE,
        );
      } catch (error) {
        // A single failing program must not abort the whole provider run.
        const summary = sanitizeErrorMessage(error, 200);
        errors.push(`${program.handleOrSlug}: ${summary}`);
        log.warn("program sync failed", { programHandle: program.handleOrSlug, error: summary });

        // An auth failure is not program-specific - stop early rather than
        // hammering the API with a credential it has already rejected.
        if (error instanceof ProviderHttpError && (error.status === 401 || error.status === 403)) {
          throw error;
        }
      }
    }

    await setConnectionStatus(provider.slug, "CONNECTED", undefined);
    await prisma.providerIntegration.updateMany({
      where: { providerId: provider.id },
      data: { lastSuccessfulSyncAt: new Date() },
    });

    const status: SyncStatus = errors.length > 0 ? "PARTIAL" : "SUCCESS";
    return await finishRun(
      syncRun.id,
      provider.id,
      status,
      counters,
      errors.length > 0
        ? { code: "PARTIAL_FAILURE", summary: `${errors.length} program(s) failed: ${errors.slice(0, 3).join("; ")}` }
        : undefined,
      log,
    );
  } catch (error) {
    const summary = sanitizeErrorMessage(error, 300);
    const code = error instanceof ProviderHttpError ? error.code : "SYNC_ERROR";

    if (error instanceof ProviderHttpError) {
      counters.rateLimitCount += error.rateLimitCount;
      counters.retryCount += error.retryCount;
      await setConnectionStatus(provider.slug, error.connectionStatus, { code, summary });
    } else {
      await setConnectionStatus(provider.slug, "API_ERROR", { code, summary });
    }

    log.error("provider sync failed", { code, error: summary });

    // Programs already imported before the failure are kept; the run is
    // PARTIAL rather than FAILED when real work was committed.
    const status: SyncStatus = counters.programsReceived > 0 && counters.scopesReceived > 0 ? "PARTIAL" : "FAILED";
    return await finishRun(syncRun.id, provider.id, status, counters, { code, summary }, log);
  }
}

async function collectPrograms(
  adapter: ProviderAdapter,
  context: FetchContext,
  options: SyncOptions,
  log: ReturnType<typeof logger.child>,
): Promise<NormalizedProgram[]> {
  if (options.programHandle) {
    const program = await adapter.fetchProgram(context, options.programHandle);
    return program ? [program] : [];
  }

  const programs: NormalizedProgram[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = await adapter.fetchPrograms(context, cursor);
    programs.push(...page.programs);
    pages += 1;

    const next = page.nextCursor;

    // Pagination safety: a provider that echoes the same cursor, or paginates
    // without end, must not spin forever.
    if (next && seenCursors.has(next)) {
      log.warn("pagination cursor repeated; stopping program pagination", { cursor: next });
      break;
    }
    if (next) seenCursors.add(next);
    cursor = next;

    if (pages >= serverEnv.syncPageLimit) {
      log.warn("program pagination hit the page limit", { pages });
      break;
    }
  } while (cursor);

  return programs;
}

async function syncProgram(
  adapter: ProviderAdapter,
  context: FetchContext,
  providerId: string,
  providerSlug: string,
  syncRunId: string,
  normalized: NormalizedProgram,
  counters: Counters,
  log: ReturnType<typeof logger.child>,
  language: Locale,
): Promise<void> {
  const now = new Date();
  const hash = programContentHash(normalized);

  const existing = await prisma.program.findUnique({
    where: { providerId_externalId: { providerId, externalId: normalized.externalId } },
  });

  let programId: string;
  const programChanges: { changeType: ChangeType; fieldName?: string; oldValue?: string; newValue?: string; importance: ChangeImportance }[] = [];

  if (!existing) {
    const created = await prisma.program.create({
      data: {
        providerId,
        externalId: normalized.externalId,
        handleOrSlug: normalized.handleOrSlug,
        name: normalized.name,
        sourceUrl: normalized.sourceUrl ?? null,
        status: normalized.status,
        visibility: normalized.visibility,
        policy: normalized.policy ?? null,
        bountyMin: normalized.bountyMin ?? null,
        bountyMax: normalized.bountyMax ?? null,
        currency: normalized.currency ?? null,
        safeHarbor: normalized.safeHarbor ?? null,
        sourceCreatedAt: normalized.sourceCreatedAt ?? null,
        sourceUpdatedAt: normalized.sourceUpdatedAt ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSyncedAt: now,
        contentHash: hash,
      },
    });
    programId = created.id;
    counters.programsCreated += 1;
  } else {
    programId = existing.id;

    if (existing.contentHash === hash) {
      // Nothing meaningful changed: touch liveness only.
      await prisma.program.update({
        where: { id: existing.id },
        data: { lastSeenAt: now, lastSyncedAt: now },
      });
    } else {
      programChanges.push(
        ...diffPrograms(canonicalProgramFromRow(existing), canonicalProgram(normalized)),
      );

      await prisma.program.update({
        where: { id: existing.id },
        data: {
          handleOrSlug: normalized.handleOrSlug,
          name: normalized.name,
          sourceUrl: normalized.sourceUrl ?? null,
          status: normalized.status,
          visibility: normalized.visibility,
          policy: normalized.policy ?? null,
          bountyMin: normalized.bountyMin ?? null,
          bountyMax: normalized.bountyMax ?? null,
          currency: normalized.currency ?? null,
          safeHarbor: normalized.safeHarbor ?? null,
          sourceCreatedAt: normalized.sourceCreatedAt ?? null,
          sourceUpdatedAt: normalized.sourceUpdatedAt ?? null,
          lastSeenAt: now,
          lastSyncedAt: now,
          contentHash: hash,
        },
      });
      counters.programsUpdated += 1;
    }
  }

  for (const change of programChanges) {
    await recordChange(providerId, programId, null, syncRunId, change, counters, language);
  }

  if (!adapter.getCapabilities().listScopes) return;

  const scopes = await collectScopes(adapter, context, normalized, log);
  counters.scopesReceived += scopes.length;

  await syncScopes(providerId, providerSlug, programId, syncRunId, scopes, counters, log, language);
}

async function collectScopes(
  adapter: ProviderAdapter,
  context: FetchContext,
  program: NormalizedProgram,
  log: ReturnType<typeof logger.child>,
): Promise<NormalizedScope[]> {
  const scopes: NormalizedScope[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = await adapter.fetchScopes(context, program, cursor);
    scopes.push(...page.scopes);
    pages += 1;

    const next = page.nextCursor;
    if (next && seenCursors.has(next)) {
      log.warn("pagination cursor repeated; stopping scope pagination", {
        programHandle: program.handleOrSlug,
      });
      break;
    }
    if (next) seenCursors.add(next);
    cursor = next;

    if (pages >= serverEnv.syncPageLimit) {
      log.warn("scope pagination hit the page limit", { programHandle: program.handleOrSlug, pages });
      break;
    }
  } while (cursor);

  return scopes;
}

/**
 * Reconciles the fetched scope set against what is stored, producing versions,
 * change events and AI jobs only where something actually changed.
 */
export async function syncScopes(
  providerId: string,
  providerSlug: string,
  programId: string,
  syncRunId: string | null,
  scopes: NormalizedScope[],
  counters: Counters,
  log: ReturnType<typeof logger.child>,
  language: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const now = new Date();

  const existingScopes = await prisma.scope.findMany({ where: { programId } });
  const existingByKey = new Map(
    existingScopes.map((scope) => [`${scope.assetIdentifier}::${scope.assetType}`, scope]),
  );

  const seenKeys = new Set<string>();
  const scopesNeedingEvaluation: string[] = [];

  for (const normalized of scopes) {
    const key = `${normalized.assetIdentifier}::${normalized.assetType}`;

    // A provider can list the same asset twice in one payload; the first wins.
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const hash = scopeContentHash(normalized);
    const existing = existingByKey.get(key);

    if (!existing) {
      const created = await prisma.scope.create({
        data: {
          programId,
          externalId: normalized.externalId ?? null,
          assetIdentifier: normalized.assetIdentifier,
          assetType: normalized.assetType,
          scopeStatus: normalized.scopeStatus,
          eligibleForSubmission: normalized.eligibleForSubmission,
          eligibleForBounty: normalized.eligibleForBounty,
          maxSeverity: normalized.maxSeverity ?? null,
          instruction: normalized.instruction ?? null,
          providerMetadata: normalized.providerMetadata
            ? stableStringify(normalized.providerMetadata)
            : null,
          sourceCreatedAt: normalized.sourceCreatedAt ?? null,
          sourceUpdatedAt: normalized.sourceUpdatedAt ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          contentHash: hash,
          version: 1,
        },
      });

      await prisma.scopeVersion.create({
        data: {
          scopeId: created.id,
          version: 1,
          canonicalSnapshot: stableStringify(canonicalScope(normalized)),
          providerSnapshot: normalized.raw ? stableStringify(normalized.raw) : null,
          contentHash: hash,
          validFrom: now,
        },
      });

      await recordChange(
        providerId,
        programId,
        created.id,
        syncRunId,
        {
          changeType: "ASSET_ADDED",
          newValue: normalized.assetIdentifier,
          importance: importanceForNewScope(canonicalScope(normalized)),
        },
        counters,
        language,
      );

      counters.scopesCreated += 1;
      scopesNeedingEvaluation.push(created.id);
      continue;
    }

    // --- Existing scope --------------------------------------------------

    if (existing.contentHash === hash && existing.scopeStatus !== "REMOVED") {
      // Idempotent path: identical content. Only liveness is updated.
      await prisma.scope.update({
        where: { id: existing.id },
        data: { lastSeenAt: now },
      });
      continue;
    }

    const previousCanonical = canonicalScopeFromRow(existing);
    const nextCanonical = canonicalScope(normalized);
    const changes = diffScopes(previousCanonical, nextCanonical);

    // A scope that had been removed and is now present again is a re-add.
    const wasRemoved = existing.scopeStatus === "REMOVED";
    const nextVersion = existing.version + 1;

    await prisma.$transaction([
      prisma.scopeVersion.updateMany({
        where: { scopeId: existing.id, validTo: null },
        data: { validTo: now },
      }),
      prisma.scopeVersion.create({
        data: {
          scopeId: existing.id,
          version: nextVersion,
          canonicalSnapshot: stableStringify(nextCanonical),
          providerSnapshot: normalized.raw ? stableStringify(normalized.raw) : null,
          contentHash: hash,
          validFrom: now,
        },
      }),
      prisma.scope.update({
        where: { id: existing.id },
        data: {
          externalId: normalized.externalId ?? null,
          scopeStatus: normalized.scopeStatus,
          eligibleForSubmission: normalized.eligibleForSubmission,
          eligibleForBounty: normalized.eligibleForBounty,
          maxSeverity: normalized.maxSeverity ?? null,
          instruction: normalized.instruction ?? null,
          providerMetadata: normalized.providerMetadata
            ? stableStringify(normalized.providerMetadata)
            : null,
          sourceCreatedAt: normalized.sourceCreatedAt ?? null,
          sourceUpdatedAt: normalized.sourceUpdatedAt ?? null,
          lastSeenAt: now,
          removedAt: null,
          contentHash: hash,
          version: nextVersion,
        },
      }),
    ]);

    if (wasRemoved) {
      await recordChange(
        providerId,
        programId,
        existing.id,
        syncRunId,
        {
          changeType: "ASSET_ADDED",
          newValue: normalized.assetIdentifier,
          importance: importanceForNewScope(nextCanonical),
        },
        counters,
        language,
      );
    }

    for (const change of changes) {
      await recordChange(providerId, programId, existing.id, syncRunId, change, counters, language);
    }

    counters.scopesUpdated += 1;
    scopesNeedingEvaluation.push(existing.id);
  }

  // --- Removals ---------------------------------------------------------
  for (const [key, existing] of existingByKey) {
    if (seenKeys.has(key)) continue;
    if (existing.scopeStatus === "REMOVED") continue; // already handled

    const removedCanonical = { ...canonicalScopeFromRow(existing), scopeStatus: "REMOVED" as const };
    const nextVersion = existing.version + 1;

    await prisma.$transaction([
      prisma.scopeVersion.updateMany({
        where: { scopeId: existing.id, validTo: null },
        data: { validTo: now },
      }),
      prisma.scopeVersion.create({
        data: {
          scopeId: existing.id,
          version: nextVersion,
          canonicalSnapshot: stableStringify(removedCanonical),
          contentHash: existing.contentHash,
          validFrom: now,
        },
      }),
      prisma.scope.update({
        where: { id: existing.id },
        data: {
          // History is preserved; the row is never deleted.
          scopeStatus: "REMOVED",
          removedAt: now,
          eligibleForSubmission: false,
          eligibleForBounty: false,
          version: nextVersion,
        },
      }),
    ]);

    await recordChange(
      providerId,
      programId,
      existing.id,
      syncRunId,
      {
        changeType: "ASSET_REMOVED",
        oldValue: existing.assetIdentifier,
        importance: "HIGH",
      },
      counters,
      language,
    );

    counters.scopesRemoved += 1;
    scopesNeedingEvaluation.push(existing.id);
  }

  // --- AI queueing (after the data is committed) -------------------------
  // Configuration lives in Settings -> AI; a failure here must never fail a sync.
  let autoEvaluate = true;
  try {
    const aiSettings = await getAiSettings();
    autoEvaluate = aiSettings.autoEvaluateNewScopes || aiSettings.autoReevaluateChangedScopes;
  } catch (error) {
    log.warn("could not read AI settings; skipping evaluation queueing", {
      error: sanitizeErrorMessage(error, 160),
    });
    autoEvaluate = false;
  }

  if (autoEvaluate) {
    for (const scopeId of scopesNeedingEvaluation) {
      try {
        const result = await enqueueScopeEvaluation(scopeId, { language });
        if (result.enqueued) counters.aiJobsEnqueued += 1;
      } catch (error) {
        // AI must never fail a sync.
        log.warn("failed to queue ai evaluation", {
          scopeId,
          error: sanitizeErrorMessage(error, 160),
        });
      }
    }
  }
}

async function recordChange(
  providerId: string,
  programId: string | null,
  scopeId: string | null,
  syncRunId: string | null,
  change: {
    changeType: ChangeType;
    fieldName?: string;
    oldValue?: string;
    newValue?: string;
    importance: ChangeImportance;
  },
  counters: Counters,
  language: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const created = await prisma.changeEvent.create({
    data: {
      providerId,
      programId,
      scopeId,
      changeType: change.changeType,
      fieldName: change.fieldName ?? null,
      oldValue: truncateValue(change.oldValue),
      newValue: truncateValue(change.newValue),
      importance: change.importance,
      syncRunId,
    },
  });

  counters.changesDetected += 1;

  const aiSettings = await getAiSettings().catch(() => null);

  if (aiSettings?.enabled && aiSettings.changeAnalysisEnabled) {
    await enqueueJob({
      type: "ANALYZE_CHANGE",
      dedupeKey: dedupeKeys.analyzeChange(created.id),
      payload: { changeEventId: created.id, language },
      priority: change.importance === "CRITICAL_ATTENTION" || change.importance === "HIGH" ? 50 : 150,
    }).catch(() => undefined);
  }
}

function truncateValue(value: string | undefined, max = 2000): string | null {
  if (value === undefined) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function finishRun(
  syncRunId: string,
  providerId: string,
  status: SyncStatus,
  counters: Counters,
  error: { code: string; summary: string } | undefined,
  log: ReturnType<typeof logger.child>,
  metadata?: Record<string, unknown>,
): Promise<SyncResult> {
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      status,
      finishedAt: new Date(),
      programsReceived: counters.programsReceived,
      programsCreated: counters.programsCreated,
      programsUpdated: counters.programsUpdated,
      scopesReceived: counters.scopesReceived,
      scopesCreated: counters.scopesCreated,
      scopesUpdated: counters.scopesUpdated,
      scopesRemoved: counters.scopesRemoved,
      changesDetected: counters.changesDetected,
      aiJobsEnqueued: counters.aiJobsEnqueued,
      rateLimitCount: counters.rateLimitCount,
      retryCount: counters.retryCount,
      errorCode: error?.code ?? null,
      errorSummary: error?.summary ?? null,
      metadata: metadata ? stableStringify(metadata) : null,
    },
  });

  log.info("sync run finished", { status, ...counters });

  return {
    syncRunId,
    status,
    programsReceived: counters.programsReceived,
    programsCreated: counters.programsCreated,
    programsUpdated: counters.programsUpdated,
    scopesReceived: counters.scopesReceived,
    scopesCreated: counters.scopesCreated,
    scopesUpdated: counters.scopesUpdated,
    scopesRemoved: counters.scopesRemoved,
    changesDetected: counters.changesDetected,
    aiJobsEnqueued: counters.aiJobsEnqueued,
    errorCode: error?.code,
    errorSummary: error?.summary,
  };
}

export { emptyCounters };
export type { Counters };
