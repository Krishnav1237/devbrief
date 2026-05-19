import { describe, it, expect } from 'vitest';
import {
  countWords,
  groupByClassification,
  generateBriefingScript,
  generateScriptStep,
} from './generate-script.js';
import type { ClassifiedChangeEntry } from './summarize.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<ClassifiedChangeEntry> & { classification: ClassifiedChangeEntry['classification'] },
): ClassifiedChangeEntry {
  return {
    entry_id: '00000000-0000-0000-0000-000000000001',
    run_id: '00000000-0000-0000-0000-000000000002',
    library_name: 'test-lib',
    version: '1.0.0',
    source_url: 'https://example.com/changelog',
    raw_content: 'Some raw content',
    summary: 'A test summary for this entry.',
    confidence_flag: false,
    scraped_at: '2025-01-15T08:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('counts words in a simple sentence', () => {
    expect(countWords('hello world')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \t\n  ')).toBe(0);
  });

  it('handles multiple spaces between words', () => {
    expect(countWords('one   two   three')).toBe(3);
  });

  it('handles newlines and tabs', () => {
    expect(countWords('one\ntwo\tthree')).toBe(3);
  });

  it('counts a single word', () => {
    expect(countWords('hello')).toBe(1);
  });

  it('trims leading and trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// groupByClassification
// ---------------------------------------------------------------------------

describe('groupByClassification', () => {
  it('groups entries into correct classification buckets', () => {
    const entries: ClassifiedChangeEntry[] = [
      makeEntry({ classification: 'breaking', library_name: 'lib-a' }),
      makeEntry({ classification: 'feature', library_name: 'lib-b' }),
      makeEntry({ classification: 'patch', library_name: 'lib-c' }),
      makeEntry({ classification: 'deprecation', library_name: 'lib-d' }),
      makeEntry({ classification: 'breaking', library_name: 'lib-e' }),
    ];

    const groups = groupByClassification(entries);

    expect(groups.breaking).toHaveLength(2);
    expect(groups.deprecation).toHaveLength(1);
    expect(groups.feature).toHaveLength(1);
    expect(groups.patch).toHaveLength(1);
  });

  it('returns empty arrays when no entries exist', () => {
    const groups = groupByClassification([]);

    expect(groups.breaking).toHaveLength(0);
    expect(groups.deprecation).toHaveLength(0);
    expect(groups.feature).toHaveLength(0);
    expect(groups.patch).toHaveLength(0);
  });

  it('handles all entries in one classification', () => {
    const entries = [
      makeEntry({ classification: 'feature', library_name: 'lib-a' }),
      makeEntry({ classification: 'feature', library_name: 'lib-b' }),
    ];

    const groups = groupByClassification(entries);

    expect(groups.feature).toHaveLength(2);
    expect(groups.breaking).toHaveLength(0);
    expect(groups.deprecation).toHaveLength(0);
    expect(groups.patch).toHaveLength(0);
  });

  it('preserves entry data in groups', () => {
    const entry = makeEntry({
      classification: 'breaking',
      library_name: 'react',
      version: '19.0.0',
      summary: 'Major API overhaul.',
    });

    const groups = groupByClassification([entry]);

    expect(groups.breaking[0].library_name).toBe('react');
    expect(groups.breaking[0].version).toBe('19.0.0');
    expect(groups.breaking[0].summary).toBe('Major API overhaul.');
  });
});

// ---------------------------------------------------------------------------
// generateBriefingScript
// ---------------------------------------------------------------------------

describe('generateBriefingScript', () => {
  const fixedDate = new Date('2025-01-15T08:00:00.000Z');

  it('generates a script with greeting and closing for empty entries', () => {
    const script = generateBriefingScript([], fixedDate);

    expect(script).toContain('Good morning!');
    expect(script).toContain('DevBrief for');
    expect(script).toContain("That's your DevBrief for today. Have a great day!");
  });

  it('includes the formatted date in the greeting', () => {
    const script = generateBriefingScript([], fixedDate);

    // The date should be formatted in en-US long format
    expect(script).toContain('January');
    expect(script).toContain('2025');
  });

  it('includes breaking changes section with full summaries', () => {
    const entries = [
      makeEntry({
        classification: 'breaking',
        library_name: 'react',
        version: '19.0.0',
        summary: 'Removed legacy context API. You must migrate to the new context provider.',
      }),
    ];

    const script = generateBriefingScript(entries, fixedDate);

    expect(script).toContain('Heads up — there are some breaking changes you need to know about.');
    expect(script).toContain('react version 19.0.0');
    expect(script).toContain('Removed legacy context API. You must migrate to the new context provider.');
  });

  it('includes deprecation section with full summaries', () => {
    const entries = [
      makeEntry({
        classification: 'deprecation',
        library_name: 'webpack',
        version: '6.0.0',
        summary: 'The module.rules syntax is deprecated. Use the new plugins API instead.',
      }),
    ];

    const script = generateBriefingScript(entries, fixedDate);

    expect(script).toContain('A few deprecation notices to be aware of.');
    expect(script).toContain('webpack version 6.0.0');
    expect(script).toContain('The module.rules syntax is deprecated.');
  });

  it('includes feature section with full summaries when within budget', () => {
    const entries = [
      makeEntry({
        classification: 'feature',
        library_name: 'vite',
        version: '5.1.0',
        summary: 'Added new HMR improvements for faster development.',
      }),
    ];

    const script = generateBriefingScript(entries, fixedDate);

    expect(script).toContain('Some new features landed.');
    expect(script).toContain('vite version 5.1.0');
    // Feature entries should include the full summary when within budget
    expect(script).toContain('Added new HMR improvements');
  });

  it('includes patch section with full summaries when within budget', () => {
    const entries = [
      makeEntry({
        classification: 'patch',
        library_name: 'lodash',
        version: '4.17.22',
        summary: 'Fixed a prototype pollution vulnerability.',
      }),
    ];

    const script = generateBriefingScript(entries, fixedDate);

    expect(script).toContain('And a few patches and fixes.');
    expect(script).toContain('lodash version 4.17.22');
    // Patch entries should include the full summary when within budget
    expect(script).toContain('Fixed a prototype pollution vulnerability.');
  });

  it('orders sections: breaking → deprecation → feature → patch', () => {
    const entries = [
      makeEntry({ classification: 'patch', library_name: 'lib-patch' }),
      makeEntry({ classification: 'breaking', library_name: 'lib-breaking' }),
      makeEntry({ classification: 'feature', library_name: 'lib-feature' }),
      makeEntry({ classification: 'deprecation', library_name: 'lib-deprecation' }),
    ];

    const script = generateBriefingScript(entries, fixedDate);

    const breakingPos = script.indexOf('Heads up');
    const deprecationPos = script.indexOf('deprecation notices');
    const featurePos = script.indexOf('new features landed');
    const patchPos = script.indexOf('patches and fixes');

    expect(breakingPos).toBeLessThan(deprecationPos);
    expect(deprecationPos).toBeLessThan(featurePos);
    expect(featurePos).toBeLessThan(patchPos);
  });

  it('skips empty sections', () => {
    const entries = [
      makeEntry({ classification: 'feature', library_name: 'vite', version: '5.0.0' }),
    ];

    const script = generateBriefingScript(entries, fixedDate);

    expect(script).not.toContain('breaking changes');
    expect(script).not.toContain('deprecation notices');
    expect(script).toContain('new features landed');
    expect(script).not.toContain('patches and fixes');
  });

  it('enforces 350-word budget by omitting feature/patch entries that exceed it', () => {
    // Create many breaking entries with long summaries to consume most of the budget
    const breakingEntries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        classification: 'breaking',
        library_name: `breaking-lib-${i}`,
        version: `${i + 1}.0.0`,
        summary: `This is a critical breaking change that completely removes the old legacy API endpoint and requires all downstream consumers to immediately migrate their code to the new versioned endpoint system with updated authentication tokens and revised request payload formats.`,
      }),
    );

    // Add many feature entries that should be budget-constrained
    const featureEntries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({
        classification: 'feature',
        library_name: `feature-lib-${i}`,
        version: `${i + 1}.0.0`,
        summary: 'Added new functionality.',
      }),
    );

    const script = generateBriefingScript(
      [...breakingEntries, ...featureEntries],
      fixedDate,
    );

    // All breaking entries should be present (priority entries always included)
    for (let i = 0; i < 10; i++) {
      expect(script).toContain(`breaking-lib-${i}`);
    }

    // Not all feature entries should be present due to budget
    const featureLibsIncluded = featureEntries.filter((e) =>
      script.includes(e.library_name),
    );
    expect(featureLibsIncluded.length).toBeLessThan(featureEntries.length);
  });

  it('always includes all breaking and deprecation entries regardless of budget', () => {
    // Create enough breaking/deprecation entries to exceed 350 words
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeEntry({
        classification: 'breaking',
        library_name: `critical-lib-${i}`,
        version: `${i + 1}.0.0`,
        summary: `This breaking change removes the legacy API endpoint and requires all consumers to migrate to the new versioned endpoint immediately.`,
      }),
    );

    const script = generateBriefingScript(entries, fixedDate);

    // All breaking entries should be present even if over budget
    for (let i = 0; i < 15; i++) {
      expect(script).toContain(`critical-lib-${i}`);
    }
  });

  it('uses default date when none provided', () => {
    const script = generateBriefingScript([]);

    // Should contain today's date in some format
    expect(script).toContain('Good morning!');
    expect(script).toContain('DevBrief for');
  });

  it('produces a script with proper paragraph separation', () => {
    const entries = [
      makeEntry({ classification: 'breaking', library_name: 'lib-a' }),
    ];

    const script = generateBriefingScript(entries, fixedDate);

    // Sections should be separated by double newlines
    expect(script).toContain('\n\n');
  });
});

// ---------------------------------------------------------------------------
// generateScriptStep (Mastra step)
// ---------------------------------------------------------------------------

describe('generateScriptStep', () => {
  it('has correct step id and description', () => {
    expect(generateScriptStep.id).toBe('generate-script');
    expect(generateScriptStep.description).toBeDefined();
  });

  it('returns skip_to_finalize when pipelineStatus is skip_to_finalize', async () => {
    const result = await generateScriptStep.execute({
      inputData: {
        classifiedEntries: [],
        errors: [],
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(result.pipelineStatus).toBe('skip_to_finalize');
    expect(result.briefingScript).toBeNull();
    expect(result.classifiedEntries).toHaveLength(0);
  });

  it('preserves errors when skipping', async () => {
    const errors = [{ step: 'summarize', message: 'LLM failed' }];

    const result = await generateScriptStep.execute({
      inputData: {
        classifiedEntries: [],
        errors,
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(result.errors).toEqual(errors);
  });

  it('generates a script and returns continue status', async () => {
    const entries: ClassifiedChangeEntry[] = [
      makeEntry({
        classification: 'breaking',
        library_name: 'react',
        version: '19.0.0',
        summary: 'Removed legacy API.',
      }),
    ];

    const result = await generateScriptStep.execute({
      inputData: {
        classifiedEntries: entries,
        errors: [],
      },
    });

    expect(result.pipelineStatus).toBe('continue');
    expect(result.briefingScript).toBeTruthy();
    expect(result.briefingScript).toContain('react');
    expect(result.classifiedEntries).toEqual(entries);
  });

  it('passes through classifiedEntries in output', async () => {
    const entries: ClassifiedChangeEntry[] = [
      makeEntry({ classification: 'feature', library_name: 'vite' }),
      makeEntry({ classification: 'patch', library_name: 'lodash' }),
    ];

    const result = await generateScriptStep.execute({
      inputData: {
        classifiedEntries: entries,
        errors: [],
      },
    });

    expect(result.classifiedEntries).toEqual(entries);
  });
});
