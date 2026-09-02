/**
 * Standalone job worker.
 *
 *   npm run worker
 *
 * Polls the job table, processes AI evaluations and change analyses, and
 * prunes expired sessions. Shuts down cleanly on SIGINT/SIGTERM, finishing the
 * job in flight rather than abandoning it mid-write.
 */
import "../src/lib/load-env";
import { drainJobs } from "../src/lib/jobs/worker";
import { queueDepth, reclaimStalledJobs } from "../src/lib/jobs/queue";
import { pruneExpiredSessions } from "../src/lib/auth/session";
import { logger } from "../src/lib/logger";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? 10);

let running = true;
let draining = false;

function shutdown(signal: string): void {
  logger.info("worker shutting down", { signal });
  running = false;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main(): Promise<void> {
  logger.info("worker started", { pollIntervalMs: POLL_INTERVAL_MS, batchSize: BATCH_SIZE });

  await reclaimStalledJobs();

  let ticksSincePrune = 0;

  while (running) {
    draining = true;
    try {
      const processed = await drainJobs(BATCH_SIZE);

      if (processed === 0) {
        // Idle: prune sessions roughly every 5 minutes of idle time.
        ticksSincePrune += 1;
        if (ticksSincePrune >= Math.ceil((5 * 60_000) / POLL_INTERVAL_MS)) {
          ticksSincePrune = 0;
          const pruned = await pruneExpiredSessions();
          if (pruned > 0) logger.info("pruned expired sessions", { count: pruned });
        }
      } else {
        ticksSincePrune = 0;
        const depth = await queueDepth();
        logger.info("worker batch complete", { processed, ...depth });
      }
    } catch (error) {
      logger.error("worker loop error", { error: error instanceof Error ? error.message : "unknown" });
    } finally {
      draining = false;
    }

    if (!running) break;

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Let an in-flight batch finish before the process exits.
  while (draining) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  logger.info("worker stopped");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
