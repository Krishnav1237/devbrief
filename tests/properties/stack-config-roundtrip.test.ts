// Feature: devbrief, Property 1: Stack Configuration round-trip
// **Validates: Requirements 1.2, 1.5**

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Mock os.homedir to use a temp directory
const testDir = join(tmpdir(), `devbrief-pbt-roundtrip-${randomUUID()}`);

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: () => testDir,
  };
});

// Import after mock setup
const { saveStackConfig, loadStackConfig } = await import('../../src/utils/config-io.js');

// Arbitrary for a valid ISO 8601 datetime string
const arbISODatetime = fc
  .date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2099-12-31T23:59:59.999Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

// Arbitrary for a valid URL string
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

// Arbitrary for a non-empty array of valid URLs
const arbUrls = fc.array(arbUrl, { minLength: 1, maxLength: 5 });

// Arbitrary for a valid library name (non-empty alphanumeric with hyphens/underscores/dots)
const arbLibraryName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,49}$/)
  .filter((s) => s.length >= 1);

// Arbitrary for a single StackLibrary
const arbStackLibrary = fc.record({
  name: arbLibraryName,
  urls: arbUrls,
  added_at: arbISODatetime,
});

// Arbitrary for a StackConfiguration with unique library names
const arbStackConfiguration = fc
  .array(arbStackLibrary, { minLength: 0, maxLength: 10 })
  .map((libs) => {
    // Ensure unique library names by deduplicating
    const seen = new Set<string>();
    const unique = libs.filter((lib) => {
      if (seen.has(lib.name)) return false;
      seen.add(lib.name);
      return true;
    });
    return { libraries: unique };
  });

describe('Property 1: Stack Configuration round-trip', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('writing a StackConfiguration to disk and loading it back produces a deeply equal object', async () => {
    await fc.assert(
      fc.asyncProperty(arbStackConfiguration, async (config) => {
        await saveStackConfig(config);
        const loaded = await loadStackConfig();
        expect(loaded).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });
});
