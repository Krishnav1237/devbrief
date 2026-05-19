/**
 * DevBrief cron scheduler.
 *
 * Manages the recurring trigger using `node-cron`. Reads the cron expression
 * from the `DEVBRIEF_CRON` environment variable (default: `0 7 * * *` — 7 AM daily).
 * The cron runs in the system's local timezone, configurable via the `TZ` env var.
 *
 * Calls the same pipeline entry point as the webhook trigger and `devbrief run` CLI.
 * Respects the "run already in progress" guard.
 *
 * Requirements: 2.1, 2.5
 */

import cron from 'node-cron';
import { isRunInProgress, runDevBriefPipeline } from '../workflow.js';

const DEFAULT_CRON = '0 7 * * *';

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Starts the cron scheduler.
 *
 * @returns The scheduled cron task instance.
 */
export function startScheduler(): ReturnType<typeof cron.schedule> {
  const cronExpression = process.env.DEVBRIEF_CRON || DEFAULT_CRON;

  if (!cron.validate(cronExpression)) {
    throw new Error(
      `Invalid cron expression: "${cronExpression}". Check the DEVBRIEF_CRON environment variable.`,
    );
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    if (isRunInProgress()) {
      console.log('[scheduler] Skipping scheduled run — a pipeline run is already in progress.');
      return;
    }

    console.log('[scheduler] Triggering scheduled pipeline run.');

    try {
      const runRecord = await runDevBriefPipeline('cron');
      console.log(
        `[scheduler] Scheduled run completed: run_id=${runRecord.run_id}, status=${runRecord.status}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Scheduled run failed: ${message}`);
    }
  });

  console.log(`[scheduler] Cron scheduler started with expression: "${cronExpression}"`);

  return scheduledTask;
}

/**
 * Stops the cron scheduler if it is running.
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log('[scheduler] Cron scheduler stopped.');
    scheduledTask = null;
  }
}
