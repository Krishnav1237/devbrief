// Feature: devbrief, Property 2: Stack add upsert preserves uniqueness
// **Validates: Requirements 1.6**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { StackConfiguration, StackLibrary } from '../../src/models/index.js';

// In-memory config store used by the mocks
let inMemoryConfig: StackConfiguration;

vi.mock('../../src/utils/config-io.js', () => ({
  loadStackConfig: async (): Promise<StackConfiguration> => {
    // Return a deep copy so the function under test can mutate freely
    return JSON.parse(JSON.stringify(inMemoryConfig));
  },
  saveStackConfig: async (config: StackConfiguration): Promise<void> => {
    inMemoryConfig = config;
  },
}));

// Import after mock setup
const { stackAdd } = await import('../../src/cli/index.js');

// --- Arbitraries ---

// Valid ISO 8601 datetime
const arbISODatetime = fc
  .date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2099-12-31T23:59:59.999Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

// Valid URL string
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

// Non-empty array of valid URLs
const arbUrls = fc.array(arbUrl, { minLength: 1, maxLength: 5 });

// Library name: non-empty alphanumeric with hyphens/underscores/dots
const arbLibraryName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,49}$/)
  .filter((s) => s.length >= 1);

// Single StackLibrary
const arbStackLibrary = fc.record({
  name: arbLibraryName,
  urls: arbUrls,
  added_at: arbISODatetime,
});

// StackConfiguration with at least one library and unique names
const arbStackConfigWithLibraries = fc
  .array(arbStackLibrary, { minLength: 1, maxLength: 10 })
  .map((libs) => {
    const seen = new Set<string>();
    const unique = libs.filter((lib) => {
      if (seen.has(lib.name)) return false;
      seen.add(lib.name);
      return true;
    });
    // Ensure at least one library remains after dedup
    return { libraries: unique.length > 0 ? unique : [libs[0]] };
  });

describe('Property 2: Stack add upsert preserves uniqueness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserting an existing library preserves library count, updates URLs, and leaves other libraries unaffected', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbStackConfigWithLibraries,
        arbUrls,
        async (config, newUrls) => {
          // Pick an existing library name (use the first one)
          const targetName = config.libraries[0].name;
          const originalCount = config.libraries.length;

          // Snapshot other libraries before the operation
          const othersBefore = config.libraries
            .filter((lib) => lib.name !== targetName)
            .map((lib) => ({ ...lib }));

          // Set up in-memory config
          inMemoryConfig = JSON.parse(JSON.stringify(config));

          // Perform the upsert
          await stackAdd(targetName, newUrls);

          // (a) Total number of libraries is unchanged
          expect(inMemoryConfig.libraries.length).toBe(originalCount);

          // (b) The entry for that name contains the new URLs
          const updatedEntry = inMemoryConfig.libraries.find(
            (lib) => lib.name === targetName,
          );
          expect(updatedEntry).toBeDefined();
          expect(updatedEntry!.urls).toEqual(newUrls);

          // (c) Other libraries are unaffected
          const othersAfter = inMemoryConfig.libraries.filter(
            (lib) => lib.name !== targetName,
          );
          expect(othersAfter).toEqual(othersBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
