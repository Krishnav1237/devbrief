import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { purgeOldEntries } from './purge.js';
import { initStore, closeStore, storeEntries, storeRunRecord, getStore } from './store.js';
import type { ChangeEntry, RunRecord } from '../models/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number, referenceDate?: Date): string {
  const ref = referenceDate ?? new Date();
  return new Date(ref.getTime() - days * DAY_MS).toISOString();
}

function makeEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    entry_id: crypto.randomUUID(),
    run_id: '00000000-0000-0000-0000-000000000001',
    library_name: 'react',
    version: '18.3.0',
    source_url: 'https://example.com/changelog',
    raw_content: '## v18.3.0\n\n- New feature',
    classification: null,
    summary: null,
    confidence_flag: false,
    scraped_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: crypto.randomUUID(),
    triggered_at: new Date().toISOString(),
    trigger_type: 'manual',
    status: 'completed',
    has_errors: false,
    libraries_processed: ['react'],
    new_change_count: 1,
    briefing_script: null,
    audio_url: null,
    digest_link: null,
    errors: [],
    completed_at: new Date().toISOString(),
    ...overrides,
  };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('purgeOldEntries', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-purge-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    initStore(dbPath);
  });

  afterEach(() => {
    closeStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const now = new Date('2025-01-15T12:00:00.000Z');

  it('removes change entries older than 30 days', () => {
    const oldEntry = makeEntry({
      scraped_at: daysAgo(31, now),
    });
    const recentEntry = makeEntry({
      scraped_at: daysAgo(10, now),
    });

    storeEntries([oldEntry, recentEntry]);
    expect(countEntries()).toBe(2);

    const result = purgeOldEntries(now);

    expect(result.purgedEntries).toBe(1);
    expect(countEntries()).toBe(1);
  });

  it('removes run records older than 30 days', () => {
    const oldRun = makeRunRecord({
      triggered_at: daysAgo(31, now),
    });
    const recentRun = makeRunRecord({
      triggered_at: daysAgo(10, now),
    });

    storeRunRecord(oldRun);
    storeRunRecord(recentRun);
    expect(countRuns()).toBe(2);

    const result = purgeOldEntries(now);

    expect(result.purgedRuns).toBe(1);
    expect(countRuns()).toBe(1);
  });

  it('preserves entries exactly 30 days old', () => {
    const borderlineEntry = makeEntry({
      scraped_at: daysAgo(30, now),
    });
    const borderlineRun = makeRunRecord({
      triggered_at: daysAgo(30, now),
    });

    storeEntries([borderlineEntry]);
    storeRunRecord(borderlineRun);

    const result = purgeOldEntries(now);

    // Exactly 30 days ago is NOT older than 30 days, so should be preserved
    expect(result.purgedEntries).toBe(0);
    expect(result.purgedRuns).toBe(0);
    expect(countEntries()).toBe(1);
    expect(countRuns()).toBe(1);
  });

  it('returns zero counts when nothing to purge', () => {
    const recentEntry = makeEntry({
      scraped_at: daysAgo(5, now),
    });
    const recentRun = makeRunRecord({
      triggered_at: daysAgo(5, now),
    });

    storeEntries([recentEntry]);
    storeRunRecord(recentRun);

    const result = purgeOldEntries(now);

    expect(result.purgedEntries).toBe(0);
    expect(result.purgedRuns).toBe(0);
    expect(countEntries()).toBe(1);
    expect(countRuns()).toBe(1);
  });

  it('returns zero counts on empty database', () => {
    const result = purgeOldEntries(now);

    expect(result.purgedEntries).toBe(0);
    expect(result.purgedRuns).toBe(0);
  });

  it('purges both entries and runs in a single call', () => {
    const oldEntry = makeEntry({
      scraped_at: daysAgo(45, now),
    });
    const oldRun = makeRunRecord({
      triggered_at: daysAgo(60, now),
    });
    const recentEntry = makeEntry({
      scraped_at: daysAgo(1, now),
    });
    const recentRun = makeRunRecord({
      triggered_at: daysAgo(1, now),
    });

    storeEntries([oldEntry, recentEntry]);
    storeRunRecord(oldRun);
    storeRunRecord(recentRun);

    const result = purgeOldEntries(now);

    expect(result.purgedEntries).toBe(1);
    expect(result.purgedRuns).toBe(1);
    expect(countEntries()).toBe(1);
    expect(countRuns()).toBe(1);
  });

  it('defaults to current time when no argument provided', () => {
    // Insert an entry from 31 days ago (relative to actual now)
    const oldEntry = makeEntry({
      scraped_at: daysAgo(31),
    });
    const recentEntry = makeEntry({
      scraped_at: daysAgo(1),
    });

    storeEntries([oldEntry, recentEntry]);

    const result = purgeOldEntries();

    expect(result.purgedEntries).toBe(1);
    expect(countEntries()).toBe(1);
  });

  it('purges multiple old entries at once', () => {
    const entries = [
      makeEntry({ scraped_at: daysAgo(31, now), version: '1.0.0' }),
      makeEntry({ scraped_at: daysAgo(40, now), version: '2.0.0' }),
      makeEntry({ scraped_at: daysAgo(60, now), version: '3.0.0' }),
      makeEntry({ scraped_at: daysAgo(5, now), version: '4.0.0' }),
    ];

    storeEntries(entries);
    expect(countEntries()).toBe(4);

    const result = purgeOldEntries(now);

    expect(result.purgedEntries).toBe(3);
    expect(countEntries()).toBe(1);
  });
});
