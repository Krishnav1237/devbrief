// Feature: devbrief, Property 7: Purge preserves recent entries and removes old ones
// **Validates: Requirements 4.5, 4.6**

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initStore, closeStore, storeEntries, storeRunRecord, getStore } from '../../src/utils/store.js';
import { purgeOldEntries } from '../../src/utils/purge.js';
import type { ChangeEntry, RunRecord } from '../../src/models/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed reference date used as "now" for all purge calls */
const REFERENCE_DATE = new Date('2025-06-15T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Days ago: 0 to 60 days before the reference date */
const arbDaysAgo = fc.integer({ min: 0, max: 60 });

/** Generate an ISO timestamp that is `days` days before the reference date */
function timestampDaysAgo(days: number): string {
  return new Date(REFERENCE_DATE.getTime() - days * DAY_MS).toISOString();
}

/** Library name: non-empty alphanumeric */
const arbLibraryName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,14}$/)
  .filter((s) => s.length >= 1);

/** Semver-like version string */
const arbVersion = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/** Generate a ChangeEntry with a specific age in days */
function arbChangeEntryWithAge(daysAgo: number, index: number): ChangeEntry {
  return {
    entry_id: crypto.randomUUID(),
    run_id: '00000000-0000-0000-0000-000000000001',
    library_name: `lib-${index}`,
    version: `${index}.0.0`,
    source_url: `https://example.com/changelog-${index}`,
    raw_content: `Changelog content for entry ${index}`,
    classification: null,
    summary: null,
    confidence_flag: false,
    scraped_at: timestampDaysAgo(daysAgo),
  };
}

/** Generate a RunRecord with a specific age in days */
function arbRunRecordWithAge(daysAgo: number, index: number): RunRecord {
  return {
    run_id: crypto.randomUUID(),
    triggered_at: timestampDaysAgo(daysAgo),
    trigger_type: 'manual',
    status: 'completed',
    has_errors: false,
    libraries_processed: [`lib-${index}`],
    new_change_count: 1,
    briefing_script: null,
    audio_url: null,
    digest_link: null,
    errors: [],
    completed_at: timestampDaysAgo(daysAgo),
  };
}

/** Arbitrary: array of day-ages for entries (0–60 days ago) */
const arbEntryAges = fc.array(arbDaysAgo, { minLength: 0, maxLength: 10 });

/** Arbitrary: array of day-ages for run records (0–60 days ago) */
const arbRunAges = fc.array(arbDaysAgo, { minLength: 0, maxLength: 10 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countEntries(): number {
  const store = getStore();
  const row = store.prepare('SELECT COUNT(*) as count FROM change_entries').get() as { count: number };
  return row.count;
}

function countRuns(): number {
  const store = getStore();
  const row = store.prepare('SELECT COUNT(*) as count FROM run_records').get() as { count: number };
  return row.count;
}

function getAllEntryTimestamps(): string[] {
  const store = getStore();
  const rows = store.prepare('SELECT scraped_at FROM change_entries').all() as Array<{ scraped_at: string }>;
  return rows.map((r) => r.scraped_at);
}

function getAllRunTimestamps(): string[] {
  const store = getStore();
  const rows = store.prepare('SELECT triggered_at FROM run_records').all() as Array<{ triggered_at: string }>;
  return rows.map((r) => r.triggered_at);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 7: Purge preserves recent entries and removes old ones', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-purge-prop-'));
    dbPath = path.join(tmpDir, 'test.db');
    initStore(dbPath);
  });

  afterEach(() => {
    closeStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const cutoffMs = REFERENCE_DATE.getTime() - 30 * DAY_MS;

  it('all entries older than 30 days are removed after purge', () => {
    fc.assert(
      fc.property(arbEntryAges, arbRunAges, (entryAges, runAges) => {
        // Reset DB for each iteration
        closeStore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-purge-prop-'));
        dbPath = path.join(tmpDir, 'test.db');
        initStore(dbPath);

        // Insert entries with various ages
        const entries = entryAges.map((days, i) => arbChangeEntryWithAge(days, i));
        if (entries.length > 0) storeEntries(entries);

        // Insert run records with various ages
        runAges.forEach((days, i) => {
          storeRunRecord(arbRunRecordWithAge(days, i));
        });

        // Run purge
        purgeOldEntries(REFERENCE_DATE);

        // Verify: no remaining entry has a scraped_at older than 30 days
        const remainingEntryTimestamps = getAllEntryTimestamps();
        for (const ts of remainingEntryTimestamps) {
          const tsMs = new Date(ts).getTime();
          expect(tsMs).toBeGreaterThanOrEqual(cutoffMs);
        }

        // Verify: no remaining run has a triggered_at older than 30 days
        const remainingRunTimestamps = getAllRunTimestamps();
        for (const ts of remainingRunTimestamps) {
          const tsMs = new Date(ts).getTime();
          expect(tsMs).toBeGreaterThanOrEqual(cutoffMs);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all entries within 30 days are retained after purge', () => {
    fc.assert(
      fc.property(arbEntryAges, arbRunAges, (entryAges, runAges) => {
        // Reset DB for each iteration
        closeStore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-purge-prop-'));
        dbPath = path.join(tmpDir, 'test.db');
        initStore(dbPath);

        // Insert entries
        const entries = entryAges.map((days, i) => arbChangeEntryWithAge(days, i));
        if (entries.length > 0) storeEntries(entries);

        // Insert run records
        runAges.forEach((days, i) => {
          storeRunRecord(arbRunRecordWithAge(days, i));
        });

        // Count how many should survive (within 30 days = timestamp >= cutoff)
        const expectedEntryCount = entries.filter(
          (e) => new Date(e.scraped_at).getTime() >= cutoffMs,
        ).length;
        const expectedRunCount = runAges.filter(
          (days) => new Date(timestampDaysAgo(days)).getTime() >= cutoffMs,
        ).length;

        // Run purge
        purgeOldEntries(REFERENCE_DATE);

        // Verify counts match
        expect(countEntries()).toBe(expectedEntryCount);
        expect(countRuns()).toBe(expectedRunCount);
      }),
      { numRuns: 100 },
    );
  });
});
