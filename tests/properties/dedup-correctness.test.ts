// Feature: devbrief, Property 6: Deduplication correctness
// **Validates: Requirements 4.2, 4.3**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  deduplicateEntries,
  dedupKey,
  computeContentHash,
} from '../../src/steps/deduplicate.js';
import type { ChangeEntry } from '../../src/models/index.js';

// --- Arbitraries ---

/** Library name: non-empty alphanumeric with hyphens/underscores/dots */
const arbLibraryName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,19}$/)
  .filter((s) => s.length >= 1);

/** Semver-like version string */
const arbVersion = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/** Version that can also be "unknown" */
const arbVersionOrUnknown = fc.oneof(
  { weight: 3, arbitrary: arbVersion },
  { weight: 1, arbitrary: fc.constant('unknown') },
);

/** Valid URL string */
const arbUrl = fc
  .webUrl({ withFragments: false, withQueryParameters: false })
  .filter((url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });

/** Valid ISO 8601 datetime */
const arbISODatetime = fc
  .date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2099-12-31T23:59:59.999Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/** Raw content string (non-empty) */
const arbRawContent = fc.lorem({ maxCount: 10 }).filter((s) => s.length > 0);

/** Generate a ChangeEntry with optional overrides */
function arbChangeEntry(overrides?: Partial<ChangeEntry>): fc.Arbitrary<ChangeEntry> {
  return fc
    .tuple(
      fc.uuid(),
      fc.uuid(),
      arbLibraryName,
      arbVersionOrUnknown,
      arbUrl,
      arbRawContent,
      arbISODatetime,
    )
    .map(([entry_id, run_id, library_name, version, source_url, raw_content, scraped_at]) => ({
      entry_id,
      run_id,
      library_name,
      version,
      source_url,
      raw_content,
      classification: null,
      summary: null,
      confidence_flag: false,
      scraped_at,
      ...overrides,
    }));
}

/** Array of ChangeEntry records */
const arbChangeEntryArray = fc.array(arbChangeEntry(), { minLength: 0, maxLength: 15 });

describe('Property 6: Deduplication correctness', () => {
  it('(a) every entry in newEntries has no matching dedupKey in existing entries', () => {
    fc.assert(
      fc.property(
        arbChangeEntryArray,
        arbChangeEntryArray,
        (scrapedEntries, existingEntries) => {
          const { newEntries } = deduplicateEntries(scrapedEntries, existingEntries);

          const existingKeys = new Set(existingEntries.map((e) => dedupKey(e)));

          // Every new entry must NOT have a matching key in existing entries
          for (const entry of newEntries) {
            const key = dedupKey(entry);
            expect(existingKeys.has(key)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('(b) every scraped entry NOT in newEntries has a matching dedupKey in existing entries or was an intra-batch duplicate', () => {
    fc.assert(
      fc.property(
        arbChangeEntryArray,
        arbChangeEntryArray,
        (scrapedEntries, existingEntries) => {
          const { newEntries } = deduplicateEntries(scrapedEntries, existingEntries);

          const existingKeys = new Set(existingEntries.map((e) => dedupKey(e)));
          const newEntryIds = new Set(newEntries.map((e) => e.entry_id));

          // Track keys seen in the batch to detect intra-batch duplicates
          const seenInBatch = new Set<string>();

          for (const entry of scrapedEntries) {
            const key = dedupKey(entry);
            const isInNewEntries = newEntryIds.has(entry.entry_id);

            if (!isInNewEntries) {
              // Entry was filtered out — it must be either:
              // 1. A duplicate of an existing entry, OR
              // 2. An intra-batch duplicate (same key already seen in this batch)
              const isExistingDuplicate = existingKeys.has(key);
              const isIntraBatchDuplicate = seenInBatch.has(key);
              expect(isExistingDuplicate || isIntraBatchDuplicate).toBe(true);
            }

            seenInBatch.add(key);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('(c) newEntries.length + duplicateCount equals total scraped entries', () => {
    fc.assert(
      fc.property(
        arbChangeEntryArray,
        arbChangeEntryArray,
        (scrapedEntries, existingEntries) => {
          const { newEntries, duplicateCount } = deduplicateEntries(
            scrapedEntries,
            existingEntries,
          );

          expect(newEntries.length + duplicateCount).toBe(scrapedEntries.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('dedup key uses (library_name, version) for known versions and (library_name, content_hash) for unknown versions', () => {
    fc.assert(
      fc.property(
        arbChangeEntry(),
        (entry) => {
          const key = dedupKey(entry);

          if (entry.version === 'unknown') {
            const expectedHash = computeContentHash(entry.raw_content);
            expect(key).toBe(`${entry.library_name}::hash:${expectedHash}`);
          } else {
            expect(key).toBe(`${entry.library_name}::${entry.version}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
