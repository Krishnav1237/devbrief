// Feature: devbrief, Property 13: Scraper fault isolation
// **Validates: Requirements 3.4, 3.5**

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  processLibraryResults,
  type ScrapeUrlResult,
} from '../../src/steps/scrape.js';
import type { StackLibrary } from '../../src/models/index.js';

// --- Arbitraries ---

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

/** Library name: non-empty alphanumeric with hyphens/underscores/dots */
const arbLibraryName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,29}$/)
  .filter((s) => s.length >= 1);

/** Valid ISO 8601 datetime */
const arbISODatetime = fc
  .date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2099-12-31T23:59:59.999Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/** Markdown content with a version header (produces at least one ChangeEntry) */
const arbVersionMarkdown = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.lorem({ maxCount: 5 }),
  )
  .map(
    ([major, minor, patch, body]) =>
      `## v${major}.${minor}.${patch}\n\n- ${body}`,
  );

/** A successful ScrapeUrlResult: has markdown content, no error */
const arbSuccessResult = fc
  .tuple(arbUrl, arbVersionMarkdown)
  .map(([url, markdown]): ScrapeUrlResult => ({
    url,
    markdown,
  }));

/** A failed ScrapeUrlResult: has error, no markdown */
const arbFailedResult = fc
  .tuple(arbUrl, fc.lorem({ maxCount: 3 }))
  .map(([url, errorMsg]): ScrapeUrlResult => ({
    url,
    markdown: null,
    error: errorMsg,
  }));

/** A ScrapeUrlResult that is either success or failure */
const arbScrapeResult = fc.oneof(arbSuccessResult, arbFailedResult);

/** A mixed array of ScrapeUrlResults with at least one element */
const arbMixedResults = fc.array(arbScrapeResult, { minLength: 1, maxLength: 10 });

/** A StackLibrary with matching URLs for the results */
function arbLibraryForResults(results: ScrapeUrlResult[]): StackLibrary {
  return {
    name: 'test-lib',
    urls: results.map((r) => r.url),
    added_at: new Date().toISOString(),
  };
}

/** Generate a StackLibrary with a given name */
const arbStackLibrary = fc
  .tuple(arbLibraryName, fc.array(arbUrl, { minLength: 1, maxLength: 5 }), arbISODatetime)
  .map(([name, urls, added_at]): StackLibrary => ({ name, urls, added_at }));

const arbRunId = fc.uuid();

describe('Property 13: Scraper fault isolation', () => {
  it('produces entries for all successful results and errors for all failed results, without failures affecting successes', async () => {
    // Suppress console.error from processLibraryResults logging failures
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await fc.assert(
      fc.asyncProperty(
        arbMixedResults,
        arbLibraryName,
        arbRunId,
        arbISODatetime,
        async (results, libName, runId, addedAt) => {
          const library: StackLibrary = {
            name: libName,
            urls: results.map((r) => r.url),
            added_at: addedAt,
          };

          const { entries, errors } = processLibraryResults(library, results, runId);

          // Partition results into successes and failures
          const successResults = results.filter(
            (r) => !r.error && r.markdown !== null,
          );
          const failedResults = results.filter(
            (r) => r.error !== undefined || r.markdown === null,
          );

          // (a) Entries are produced for all successful results.
          // Each successful result produces at least one entry (one per version section).
          // Every entry must trace back to a successful result's URL.
          const successUrls = new Set(successResults.map((r) => r.url));
          for (const entry of entries) {
            expect(successUrls.has(entry.source_url)).toBe(true);
          }

          // Every successful URL should have at least one corresponding entry
          for (const sr of successResults) {
            const matchingEntries = entries.filter(
              (e) => e.source_url === sr.url,
            );
            expect(matchingEntries.length).toBeGreaterThanOrEqual(1);
          }

          // (b) Errors are logged for all failed results.
          // Each failed URL should have a corresponding error mentioning that URL.
          for (const fr of failedResults) {
            const matchingErrors = errors.filter(
              (e) => e.message.includes(fr.url),
            );
            expect(matchingErrors.length).toBeGreaterThanOrEqual(1);
          }

          // (c) Successful entries are not affected by failures.
          // All entries have correct library_name and run_id regardless of failures.
          for (const entry of entries) {
            expect(entry.library_name).toBe(libName);
            expect(entry.run_id).toBe(runId);
            expect(entry.version).toBeDefined();
            expect(entry.raw_content).toBeDefined();
          }

          // The number of entries should be independent of the number of failures:
          // running processLibraryResults with only the successful results should
          // produce the same number of entries.
          if (successResults.length > 0) {
            const successOnlyLibrary: StackLibrary = {
              name: libName,
              urls: successResults.map((r) => r.url),
              added_at: addedAt,
            };
            const successOnly = processLibraryResults(
              successOnlyLibrary,
              successResults,
              runId,
            );
            expect(entries.length).toBe(successOnly.entries.length);
          }
        },
      ),
      { numRuns: 100 },
    );

    vi.restoreAllMocks();
  });
});
