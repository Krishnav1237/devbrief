// Feature: devbrief, Property 15: Run history ordering and completeness
// **Validates: Requirements 10.1, 10.2**

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  initStore,
  closeStore,
  storeRunRecord,
  getRunRecords,
  getRunRecord,
} from '../../src/utils/store.js';
import type { RunRecord } from '../../src/models/index.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a valid ISO 8601 datetime string within a wide range */
const arbISODatetime = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/** Valid run status values */
const arbRunStatus = fc.constantFrom(
  'in_progress' as const,
  'completed' as const,
  'no_new_changes' as const,
  'no_stack_configured' as const,
  'llm_failed' as const,
);

/** Valid trigger type values */
const arbTriggerType = fc.constantFrom(
  'cron' as const,
  'webhook' as const,
  'manual' as const,
);

/** Library name: non-empty alphanumeric */
const arbLibraryName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,14}$/)
  .filter((s) => s.length >= 1);

/** Step error arbitrary */
const arbStepError = fc.record({
  step: fc.constantFrom('scrape', 'summarize', 'tts', 'publish', 'notify'),
  message: fc.string({ minLength: 1, maxLength: 50 }),
});

/** Generate a RunRecord with a specific triggered_at timestamp and unique run_id */
const arbRunRecord = fc.record({
  run_id: fc.uuid(),
  triggered_at: arbISODatetime,
  trigger_type: arbTriggerType,
  status: arbRunStatus,
  has_errors: fc.boolean(),
  libraries_processed: fc.array(arbLibraryName, { minLength: 0, maxLength: 5 }),
  new_change_count: fc.integer({ min: 0, max: 100 }),
  briefing_script: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  audio_url: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  digest_link: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  errors: fc.array(arbStepError, { minLength: 0, maxLength: 3 }),
  completed_at: fc.option(arbISODatetime, { nil: null }),
});

/** Generate an array of RunRecords with unique run_ids */
const arbRunRecords = fc
  .array(arbRunRecord, { minLength: 1, maxLength: 15 })
  .map((records) => {
    // Ensure unique run_ids
    const seen = new Set<string>();
    return records.filter((r) => {
      if (seen.has(r.run_id)) return false;
      seen.add(r.run_id);
      return true;
    });
  })
  .filter((records) => records.length >= 1);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 15: Run history ordering and completeness', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-runhist-prop-'));
    dbPath = path.join(tmpDir, 'test.db');
    initStore(dbPath);
  });

  afterEach(() => {
    closeStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getRunRecords() returns runs in descending order by triggered_at', () => {
    fc.assert(
      fc.property(arbRunRecords, (records) => {
        // Reset DB for each iteration
        closeStore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-runhist-prop-'));
        dbPath = path.join(tmpDir, 'test.db');
        initStore(dbPath);

        // Store all records
        for (const record of records) {
          storeRunRecord(record);
        }

        // Retrieve records
        const retrieved = getRunRecords();

        // (a) All stored records are returned
        expect(retrieved.length).toBe(records.length);

        // (b) Records are in descending order by triggered_at
        for (let i = 1; i < retrieved.length; i++) {
          const prev = new Date(retrieved[i - 1].triggered_at).getTime();
          const curr = new Date(retrieved[i].triggered_at).getTime();
          expect(prev).toBeGreaterThanOrEqual(curr);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('getRunRecord(runId) returns all required fields for each stored record', () => {
    fc.assert(
      fc.property(arbRunRecords, (records) => {
        // Reset DB for each iteration
        closeStore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-runhist-prop-'));
        dbPath = path.join(tmpDir, 'test.db');
        initStore(dbPath);

        // Store all records
        for (const record of records) {
          storeRunRecord(record);
        }

        // For each stored record, verify getRunRecord returns all required fields
        for (const original of records) {
          const retrieved = getRunRecord(original.run_id);

          // Record must be found
          expect(retrieved).not.toBeNull();

          // Required fields: timestamp, status, libraries processed, new change count, errors
          expect(retrieved!.triggered_at).toBe(original.triggered_at);
          expect(retrieved!.status).toBe(original.status);
          expect(retrieved!.libraries_processed).toEqual(original.libraries_processed);
          expect(retrieved!.new_change_count).toBe(original.new_change_count);
          expect(retrieved!.errors).toEqual(original.errors);

          // Additional fields should also round-trip correctly
          expect(retrieved!.run_id).toBe(original.run_id);
          expect(retrieved!.trigger_type).toBe(original.trigger_type);
          expect(retrieved!.has_errors).toBe(original.has_errors);
          expect(retrieved!.briefing_script).toBe(original.briefing_script);
          expect(retrieved!.audio_url).toBe(original.audio_url);
          expect(retrieved!.digest_link).toBe(original.digest_link);
          expect(retrieved!.completed_at).toBe(original.completed_at);
        }
      }),
      { numRuns: 100 },
    );
  });
});
