// Feature: devbrief, Property 3: Stack remove eliminates the target library
// **Validates: Requirements 1.3**
// Feature: devbrief, Property 4: Stack remove of non-existent library produces an error
// **Validates: Requirements 1.7**

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
const { stackRemove } = await import('../../src/cli/index.js');

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

describe('Property 3: Stack remove eliminates the target library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removing an existing library decreases count by 1 and the name no longer appears', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbStackConfigWithLibraries,
        async (config) => {
          // Pick an existing library name (use the first one)
          const targetName = config.libraries[0].name;
          const originalCount = config.libraries.length;

          // Set up in-memory config
          inMemoryConfig = JSON.parse(JSON.stringify(config));

          // Perform the remove
          await stackRemove(targetName);

          // (a) Total number of libraries decreases by exactly one
          expect(inMemoryConfig.libraries.length).toBe(originalCount - 1);

          // (b) The removed library name no longer appears
          const found = inMemoryConfig.libraries.find(
            (lib) => lib.name === targetName,
          );
          expect(found).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: Stack remove of non-existent library produces an error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removing a non-existent library throws an error and config remains unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbStackConfigWithLibraries,
        arbLibraryName,
        async (config, candidateName) => {
          // Ensure candidateName does NOT exist in the config
          const existingNames = new Set(config.libraries.map((lib) => lib.name));
          fc.pre(!existingNames.has(candidateName));

          // Snapshot the config before the operation
          const configBefore = JSON.parse(JSON.stringify(config));

          // Set up in-memory config
          inMemoryConfig = JSON.parse(JSON.stringify(config));

          // Perform the remove — should throw
          await expect(stackRemove(candidateName)).rejects.toThrow();

          // Config should remain unchanged
          expect(inMemoryConfig.libraries).toEqual(configBefore.libraries);
        },
      ),
      { numRuns: 100 },
    );
  });
});
