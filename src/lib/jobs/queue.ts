import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { JobType } from "@/lib/enums";
import { logger } from "@/lib/logger";

/**
 * Database-backed job queue.
 *
 * Deliberately broker-free: the deployment target is a single-operator research
 * tool, and a Postgres/Redis dependency would be more operational burden than
 * the workload justifies. Two properties matter and are enforced here:
 *
 *  - Idempotent enqueue. `dedupeKey` is unique, so the same logical unit of
 *    work cannot be queued twice - this is what stops a repeated sync from
 *    producing duplicate AI calls.
 *  - Safe claiming. Workers claim jobs with a compare-and-set update guarded on
 *    `status: PENDING`, so two workers cannot run the same job.
 */

export interface EnqueueOptions {
  type: JobType;
  dedupeKey: string;
  payload: Record<string, unknown>;
  priority?: number;
  availableAt?: Date;
  maxAttempts?: number;
}

export interface ClaimedJob {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Enqueues a job unless an equivalent one is already pending or running.
 * Returns true when a new job was created.
 */
export async function enqueueJob(options: EnqueueOptions): Promise<boolean> {
  const existing = await prisma.job.findUnique({ where: { dedupeKey: options.dedupeKey } });

  if (existing) {
    // A live job already covers this work.
    if (existing.status === "PENDING" || existing.status === "PROCESSING") return false;

    // A previous attempt finished; reset the row so the key stays stable.
    await prisma.job.update({
      where: { id: existing.id },
      data: {
        type: options.type,
        payload: JSON.stringify(options.payload),
        status: "PENDING",
        priority: options.priority ?? 100,
        availableAt: options.availableAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 3,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lockedBy: null,
        lockedAt: null,
        errorCode: null,
        errorSummary: null,
      },
    });
    return true;
  }

  try {
    await prisma.job.create({
      data: {
        type: options.type,
        dedupeKey: options.dedupeKey,
        payload: JSON.stringify(options.payload),
        priority: options.priority ?? 100,
        availableAt: options.availableAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 3,
      },
    });
    return true;
  } catch {
    // Lost a race against a concurrent enqueue of the same key - which is
    // exactly the outcome the unique constraint exists to produce.
    return false;
  }
}

/**
 * Atomically claims the next runnable job.
 *
 * SQLite has no SKIP LOCKED, so this uses an optimistic claim: select a
 * candidate, then update it only if it is still PENDING. A loser of the race
 * simply retries with the next candidate.
 */
export async function claimNextJob(workerId: string = randomUUID()): Promise<ClaimedJob | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await prisma.job.findFirst({
      where: { status: "PENDING", availableAt: { lte: new Date() } },
      orderBy: [{ priority: "asc" }, { availableAt: "asc" }, { createdAt: "asc" }],
    });

    if (!candidate) return null;

    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
        lockedBy: workerId,
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 1) {
      const job = await prisma.job.findUnique({ where: { id: candidate.id } });
      if (!job) continue;

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(job.payload) as Record<string, unknown>;
      } catch {
        await failJob(job.id, "MALFORMED_PAYLOAD", "Job payload was not valid JSON.", false);
        continue;
      }

      return {
        id: job.id,
        type: job.type as JobType,
        payload,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      };
    }
  }

  return null;
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "COMPLETED", finishedAt: new Date(), lockedBy: null, lockedAt: null },
  });
}

/**
 * Marks a job failed. When `retryable` and attempts remain, the job returns to
 * PENDING with exponential backoff instead.
 */
export async function failJob(
  jobId: string,
  code: string,
  summary: string,
  retryable = true,
): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  const canRetry = retryable && job.attempts < job.maxAttempts;

  if (canRetry) {
    const delayMs = Math.min(60_000 * 2 ** (job.attempts - 1), 30 * 60_000);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        availableAt: new Date(Date.now() + delayMs),
        lockedBy: null,
        lockedAt: null,
        errorCode: code,
        errorSummary: summary,
      },
    });
    logger.warn("job scheduled for retry", { jobId, attempts: job.attempts, delayMs, code });
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      lockedBy: null,
      lockedAt: null,
      errorCode: code,
      errorSummary: summary,
    },
  });
  logger.error("job failed permanently", { jobId, code });
}

/**
 * Returns jobs stuck in PROCESSING (e.g. a worker was killed) to PENDING.
 */
export async function reclaimStalledJobs(olderThanMs = 10 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.job.updateMany({
    where: { status: "PROCESSING", lockedAt: { lt: cutoff } },
    data: { status: "PENDING", lockedBy: null, lockedAt: null },
  });

  if (result.count > 0) {
    logger.warn("reclaimed stalled jobs", { count: result.count });
  }
  return result.count;
}

export async function queueDepth(): Promise<{ pending: number; processing: number; failed: number }> {
  const [pending, processing, failed] = await Promise.all([
    prisma.job.count({ where: { status: "PENDING" } }),
    prisma.job.count({ where: { status: "PROCESSING" } }),
    prisma.job.count({ where: { status: "FAILED" } }),
  ]);
  return { pending, processing, failed };
}

/** Stable dedupe keys - the AI input hash makes re-evaluation self-deduplicating. */
export const dedupeKeys = {
  evaluateScope: (scopeId: string, inputHash: string) => `EVALUATE_SCOPE:${scopeId}:${inputHash}`,
  analyzeChange: (changeEventId: string) => `ANALYZE_CHANGE:${changeEventId}`,
  summarizePolicy: (programId: string, policyHash: string) =>
    `SUMMARIZE_POLICY:${programId}:${policyHash}`,
};
