import { getStore } from './store.js';

/**
 * Purges Change_Entry and Run_Record entries older than 30 days.
 * Called at the very start of each pipeline run (from initRunStep),
 * before any new data is written.
 *
 * @param now - Optional reference date for testability (defaults to current time)
 * @returns Counts of purged entries and run records
 */
export function purgeOldEntries(now?: Date): { purgedEntries: number; purgedRuns: number } {
  const referenceDate = now ?? new Date();
  const cutoff = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const cutoffISO = cutoff.toISOString();

  const store = getStore();

  return store.transaction(() => {
    const entriesResult = store
      .prepare('DELETE FROM change_entries WHERE scraped_at < ?')
      .run(cutoffISO);

    const runsResult = store
      .prepare('DELETE FROM run_records WHERE triggered_at < ?')
      .run(cutoffISO);

    return {
      purgedEntries: entriesResult.changes,
      purgedRuns: runsResult.changes,
    };
  })();
}
