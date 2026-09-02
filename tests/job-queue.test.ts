import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  claimNextJob,
  completeJob,
  dedupeKeys,
  enqueueJob,
  failJob,
  queueDepth,
  reclaimStalledJobs,
} from "@/lib/jobs/queue";
import { resetDatabase } from "./helpers";

/**
 * Queue semantics: idempotent enqueue and safe claiming. These are what stop a
 * repeated sync from producing duplicate paid AI calls.
 */

beforeEach(async () => {
  await resetDatabase();
});

describe("idempotent enqueue", () => {
  it("does not queue the same work twice while it is pending", async () => {
    const key = dedupeKeys.evaluateScope("scope-1", "hash-1");

    expect(await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: key, payload: {} })).toBe(true);
    expect(await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: key, payload: {} })).toBe(false);

    expect(await prisma.job.count()).toBe(1);
  });

  it("does not re-queue work that is already processing", async () => {
    const key = dedupeKeys.evaluateScope("scope-1", "hash-1");
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: key, payload: {} });
    await claimNextJob("worker-a");

    expect(await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: key, payload: {} })).toBe(false);
    expect(await prisma.job.count()).toBe(1);
  });

  it("re-runs the same key after the previous job finished", async () => {
    const key = dedupeKeys.evaluateScope("scope-1", "hash-1");

    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: key, payload: {} });
    const job = await claimNextJob("worker-a");
    await completeJob(job!.id);

    expect(await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: key, payload: {} })).toBe(true);
    // The row is reused rather than duplicated, keeping the key stable.
    expect(await prisma.job.count()).toBe(1);

    const requeued = await prisma.job.findFirstOrThrow();
    expect(requeued.status).toBe("PENDING");
    expect(requeued.attempts).toBe(0);
  });

  it("treats a different input hash as different work", async () => {
    await enqueueJob({
      type: "EVALUATE_SCOPE",
      dedupeKey: dedupeKeys.evaluateScope("scope-1", "hash-1"),
      payload: {},
    });
    await enqueueJob({
      type: "EVALUATE_SCOPE",
      dedupeKey: dedupeKeys.evaluateScope("scope-1", "hash-2"),
      payload: {},
    });

    expect(await prisma.job.count()).toBe(2);
  });
});

describe("claiming", () => {
  it("claims by priority then age", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "low", payload: { n: 1 }, priority: 200 });
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "high", payload: { n: 2 }, priority: 10 });

    const job = await claimNextJob("worker-a");
    expect(job?.payload.n).toBe(2);
  });

  it("hands the same job to only one worker", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "only", payload: {} });

    const [first, second] = await Promise.all([claimNextJob("worker-a"), claimNextJob("worker-b")]);

    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it("returns null when nothing is available", async () => {
    expect(await claimNextJob("worker-a")).toBeNull();
  });

  it("does not claim a job scheduled for the future", async () => {
    await enqueueJob({
      type: "EVALUATE_SCOPE",
      dedupeKey: "later",
      payload: {},
      availableAt: new Date(Date.now() + 60_000),
    });

    expect(await claimNextJob("worker-a")).toBeNull();
  });

  it("fails a job with a malformed payload without blocking the queue", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "bad", payload: {} });
    await prisma.job.updateMany({ data: { payload: "{not json" } });

    expect(await claimNextJob("worker-a")).toBeNull();

    const job = await prisma.job.findFirstOrThrow();
    expect(job.status).toBe("FAILED");
    expect(job.errorCode).toBe("MALFORMED_PAYLOAD");
  });
});

describe("retry and recovery", () => {
  it("schedules a retry with backoff while attempts remain", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "retry", payload: {}, maxAttempts: 3 });
    const job = await claimNextJob("worker-a");

    await failJob(job!.id, "TRANSIENT", "temporary failure", true);

    const retried = await prisma.job.findFirstOrThrow();
    expect(retried.status).toBe("PENDING");
    expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(retried.errorCode).toBe("TRANSIENT");
  });

  it("fails permanently once attempts are exhausted", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "doomed", payload: {}, maxAttempts: 1 });
    const job = await claimNextJob("worker-a");

    await failJob(job!.id, "PERMANENT", "will not recover", true);

    const failed = await prisma.job.findFirstOrThrow();
    expect(failed.status).toBe("FAILED");
    expect(failed.finishedAt).not.toBeNull();
  });

  it("does not retry a non-retryable failure", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "auth", payload: {}, maxAttempts: 5 });
    const job = await claimNextJob("worker-a");

    // An invalid API key will not fix itself; retrying is pure waste.
    await failJob(job!.id, "AI_AUTH_ERROR", "key rejected", false);

    const failed = await prisma.job.findFirstOrThrow();
    expect(failed.status).toBe("FAILED");
  });

  it("reclaims a job abandoned by a dead worker", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "stalled", payload: {} });
    const job = await claimNextJob("worker-a");

    await prisma.job.update({
      where: { id: job!.id },
      data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    expect(await reclaimStalledJobs()).toBe(1);

    const reclaimed = await prisma.job.findFirstOrThrow();
    expect(reclaimed.status).toBe("PENDING");
    expect(reclaimed.lockedBy).toBeNull();
  });
});

describe("queue depth", () => {
  it("reports pending, processing and failed counts", async () => {
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "a", payload: {} });
    await enqueueJob({ type: "EVALUATE_SCOPE", dedupeKey: "b", payload: {} });
    const job = await claimNextJob("worker-a");
    await failJob(job!.id, "X", "y", false);

    const depth = await queueDepth();
    expect(depth.pending).toBe(1);
    expect(depth.processing).toBe(0);
    expect(depth.failed).toBe(1);
  });
});
