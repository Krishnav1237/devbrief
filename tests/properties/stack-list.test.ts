// Feature: devbrief, Property 5: Stack list outputs all configured libraries
// **Validates: Requirements 1.4**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { StackConfiguration, StackLibrary } from '../../src/models/index.js';

// In-memory config store used by the mocks
let inMemoryConfig: StackConfiguration;

vi.mock('../../src/utils/config-io.js', () => ({
  loadStackConfig: async (): Promise<StackConfiguration> => {
    return JSON.parse(JSON.stringify(inMemoryConfig));
  },
  saveStackConfig: async (config: StackConfiguration): Promise<void> => {
    inMemoryConfig = config;
  },
}));

// Import after mock setup
const { stackList } = await import('../../src/cli/index.js');

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

// StackConfiguration with unique library names (including empty)
const arbStackConfiguration = fc
  .array(arbStackLibrary, { minLength: 0, maxLength: 10 })
  .map((libs) => {
    const seen = new Set<string>();
    const unique = libs.filter((lib) => {
      if (seen.has(lib.name)) return false;
      seen.add(lib.name);
      return true;
    });
    return { libraries: unique };
  });

describe('Property 5: Stack list outputs all configured libraries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('output contains every library name and every URL from the configuration', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbStackConfiguration,
        async (config) => {
          // Set up in-memory config
          inMemoryConfig = JSON.parse(JSON.stringify(config));

          // Call stackList
          const output = await stackList();

          if (config.libraries.length === 0) {
            // Empty config should show the "No libraries configured" message
            expect(output).toContain('No libraries configured');
          } else {
            // Every library name must appear in the output
            for (const lib of config.libraries) {
              expect(output).toContain(lib.name);

              // Every URL for this library must appear in the output
              for (const url of lib.urls) {
                expect(output).toContain(url);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
