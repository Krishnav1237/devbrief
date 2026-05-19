// Feature: devbrief, Property 11: Briefing script classification ordering
// **Validates: Requirements 6.2, 6.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateBriefingScript, groupByClassification } from '../../src/steps/generate-script.js';
import type { ClassifiedChangeEntry } from '../../src/steps/summarize.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLASSIFICATIONS = ['breaking', 'deprecation', 'feature', 'patch'] as const;
type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * The required ordering of classification sections in the briefing script.
 */
const CLASSIFICATION_ORDER: Classification[] = ['breaking', 'deprecation', 'feature', 'patch'];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary classification value */
const arbClassification = fc.constantFrom<Classification>(...CLASSIFICATIONS);

/** Arbitrary short library name (avoids huge strings that blow up word budget) */
const arbLibraryName = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter((s) => s.length >= 1);

/** Arbitrary semver-like version */
const arbVersion = fc
  .tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }))
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/** Arbitrary short summary (1-2 sentences, keeps word count manageable) */
const arbSummary = fc
  .stringMatching(/^[A-Z][a-z ]{5,40}\.$/)
  .filter((s) => s.length >= 7);

/**
 * Generates a single ClassifiedChangeEntry with the given classification.
 */
function arbClassifiedEntry(classification?: fc.Arbitrary<Classification>): fc.Arbitrary<ClassifiedChangeEntry> {
  return fc
    .tuple(
      fc.uuid(),
      fc.uuid(),
      arbLibraryName,
      arbVersion,
      arbSummary,
      classification ?? arbClassification,
    )
    .map(([entryId, runId, libName, version, summary, cls]) => ({
      entry_id: entryId,
      run_id: runId,
      library_name: libName,
      version,
      source_url: `https://example.com/${libName}/releases`,
      raw_content: `Release ${version} of ${libName}`,
      classification: cls,
      summary,
      confidence_flag: false,
      scraped_at: new Date().toISOString(),
    }));
}

/** Arbitrary array of ClassifiedChangeEntry with mixed classifications */
const arbEntries = fc.array(arbClassifiedEntry(), { minLength: 0, maxLength: 20 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Section intro markers used in the briefing script, keyed by classification.
 * These match the SECTION_INTROS in generate-script.ts.
 */
const SECTION_MARKERS: Record<Classification, string> = {
  breaking: 'Heads up',
  deprecation: 'deprecation notices',
  feature: 'new features landed',
  patch: 'patches and fixes',
};

/**
 * Returns the index of the first occurrence of a section marker in the script,
 * or -1 if not found.
 */
function sectionPosition(script: string, classification: Classification): number {
  return script.indexOf(SECTION_MARKERS[classification]);
}

// ---------------------------------------------------------------------------
// Property 11: Briefing script classification ordering
// ---------------------------------------------------------------------------

describe('Property 11: Briefing script classification ordering', () => {
  const fixedDate = new Date('2025-01-15T08:00:00.000Z');

  it('groupByClassification always produces the four classification buckets', () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const groups = groupByClassification(entries);

        // All four buckets must exist
        expect(groups).toHaveProperty('breaking');
        expect(groups).toHaveProperty('deprecation');
        expect(groups).toHaveProperty('feature');
        expect(groups).toHaveProperty('patch');

        // Total entries across all groups must equal input length
        const totalGrouped =
          groups.breaking.length +
          groups.deprecation.length +
          groups.feature.length +
          groups.patch.length;
        expect(totalGrouped).toBe(entries.length);
      }),
      { numRuns: 100 },
    );
  });

  it('sections present in the briefing script appear in the order: breaking → deprecation → feature → patch', () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const script = generateBriefingScript(entries, fixedDate);

        // Collect positions of sections that are actually present
        const presentSections: { classification: Classification; position: number }[] = [];
        for (const cls of CLASSIFICATION_ORDER) {
          const pos = sectionPosition(script, cls);
          if (pos !== -1) {
            presentSections.push({ classification: cls, position: pos });
          }
        }

        // Verify that the present sections appear in the correct relative order
        for (let i = 1; i < presentSections.length; i++) {
          expect(presentSections[i].position).toBeGreaterThan(presentSections[i - 1].position);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all breaking and deprecation entries are always present in the script regardless of word budget', () => {
    // Use entries with longer summaries to stress the word budget
    const arbLongSummary = fc.constant('This is a significant change that affects the entire codebase.');

    const arbMixedEntries = fc
      .tuple(
        fc.array(arbClassifiedEntry(fc.constant('breaking' as Classification)), { minLength: 1, maxLength: 8 }),
        fc.array(arbClassifiedEntry(fc.constant('deprecation' as Classification)), { minLength: 1, maxLength: 8 }),
        fc.array(arbClassifiedEntry(fc.constant('feature' as Classification)), { minLength: 0, maxLength: 5 }),
        fc.array(arbClassifiedEntry(fc.constant('patch' as Classification)), { minLength: 0, maxLength: 5 }),
      )
      .map(([breaking, deprecation, feature, patch]) => [...breaking, ...deprecation, ...feature, ...patch]);

    fc.assert(
      fc.property(arbMixedEntries, (entries) => {
        const script = generateBriefingScript(entries, fixedDate);
        const groups = groupByClassification(entries);

        // Every breaking entry's library name and version must appear in the script
        for (const entry of groups.breaking) {
          expect(script).toContain(entry.library_name);
          expect(script).toContain(entry.version);
        }

        // Every deprecation entry's library name and version must appear in the script
        for (const entry of groups.deprecation) {
          expect(script).toContain(entry.library_name);
          expect(script).toContain(entry.version);
        }
      }),
      { numRuns: 100 },
    );
  });
});
