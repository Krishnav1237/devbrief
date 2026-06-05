import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  ChangeEntrySchema,
  StepErrorSchema,
  type ChangeEntry,
  type StepError,
} from '../models/index.js';
import {
  initStore,
  getExistingEntriesForLibrary,
  storeEntries,
  updateEntryRisk,
} from '../utils/store.js';
import { classifyRisk } from '../utils/risk-classifier.js';
import { parseDependencies, type ParsedDependency } from '../utils/package-parser.js';

// ---------------------------------------------------------------------------
// Zod schemas for step I/O
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const DeduplicateInputSchema = z.object({
  entries: z.array(ChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  runId: z.string().uuid(),
  pipelineStatus: PipelineStatusSchema.optional(),
});
export type DeduplicateInput = z.infer<typeof DeduplicateInputSchema>;

export const DeduplicateOutputSchema = z.object({
  newEntries: z.array(ChangeEntrySchema),
  duplicateCount: z.number().int().nonnegative(),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
});
export type DeduplicateOutput = z.infer<typeof DeduplicateOutputSchema>;

// ---------------------------------------------------------------------------
// Content hash utility
// ---------------------------------------------------------------------------

/**
 * Computes a SHA-256 hash of the first 500 characters of the given content.
 * Used as a dedup component when version is "unknown".
 */
export function computeContentHash(content: string): string {
  const slice = content.slice(0, 500);
  return createHash('sha256').update(slice).digest('hex');
}

// ---------------------------------------------------------------------------
// Pure deduplication logic (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Builds a dedup key for a change entry.
 * - For known versions: `library_name::version`
 * - For unknown versions: `library_name::hash:<sha256 of first 500 chars>`
 */
export function dedupKey(entry: ChangeEntry): string {
  if (entry.version === 'unknown') {
    return `${entry.library_name}::hash:${computeContentHash(entry.raw_content)}`;
  }
  return `${entry.library_name}::${entry.version}`;
}

export interface DeduplicateResult {
  newEntries: ChangeEntry[];
  duplicateCount: number;
}

/**
 * Pure function: given new entries from the scraper and existing entries from
 * the store, returns only the entries that are not duplicates.
 *
 * Dedup key: (library_name, version) — or (library_name, content_hash) when
 * version is "unknown".
 */
export function deduplicateEntries(
  scrapedEntries: ChangeEntry[],
  existingEntries: ChangeEntry[],
): DeduplicateResult {
  // Build a set of existing dedup keys
  const existingKeys = new Set<string>();
  for (const entry of existingEntries) {
    existingKeys.add(dedupKey(entry));
  }

  const newEntries: ChangeEntry[] = [];
  let duplicateCount = 0;

  // Also track keys within the current batch to avoid intra-batch duplicates
  const seenInBatch = new Set<string>();

  for (const entry of scrapedEntries) {
    const key = dedupKey(entry);
    if (existingKeys.has(key) || seenInBatch.has(key)) {
      duplicateCount++;
    } else {
      seenInBatch.add(key);
      newEntries.push(entry);
    }
  }

  return { newEntries, duplicateCount };
}

// ---------------------------------------------------------------------------
// Mastra step definition
// ---------------------------------------------------------------------------

/**
 * The deduplicate step: filters scraped entries against the Change_Store
 * to surface only new changes.
 */
export const deduplicateStep = {
  id: 'deduplicate' as const,
  description: 'Filter scraped entries against stored data to find new changes',
  inputSchema: DeduplicateInputSchema,
  outputSchema: DeduplicateOutputSchema,

  execute: async ({
    inputData,
  }: {
    inputData: DeduplicateInput;
  }): Promise<DeduplicateOutput> => {
    const { entries, errors, runId, pipelineStatus } = inputData;

    // Early-exit propagation
    if (pipelineStatus === 'skip_to_finalize') {
      return {
        newEntries: [],
        duplicateCount: 0,
        errors: errors ?? [],
        pipelineStatus: 'skip_to_finalize',
      };
    }

    // Initialize the store (idempotent)
    initStore();

    // Batch query: fetch existing entries per unique library
    const libraryNames = [...new Set(entries.map((e) => e.library_name))];
    const allExisting: ChangeEntry[] = [];
    for (const libName of libraryNames) {
      const existing = getExistingEntriesForLibrary(libName);
      allExisting.push(...existing);
    }

    // Deduplicate
    const { newEntries, duplicateCount } = deduplicateEntries(entries, allExisting);

    // Parse user's project dependencies for risk classification
    let userDependencies: ParsedDependency[] = [];
    try {
      userDependencies = await parseDependencies();
    } catch (err) {
      console.warn('[deduplicate] Failed to parse dependencies:', err instanceof Error ? err.message : String(err));
    }

    // Classify risk for each new entry
    const entriesWithRisk: ChangeEntry[] = [];
    for (const entry of newEntries) {
      try {
        const riskClass = await classifyRisk(
          entry.library_name,
          entry.version,
          entry.raw_content,
          userDependencies
        );
        
        entriesWithRisk.push({
          ...entry,
          riskLevel: riskClass.riskLevel,
          severityScore: riskClass.severityScore,
          reasoning: riskClass.reasoning,
        });
      } catch (err) {
        console.warn(
          `[deduplicate] Risk classification failed for ${entry.library_name}:`,
          err instanceof Error ? err.message : String(err)
        );
        // Continue without risk classification
        entriesWithRisk.push(entry);
      }
    }

    // Store new entries
    if (entriesWithRisk.length > 0) {
      storeEntries(entriesWithRisk);
    }

    console.log(
      `[deduplicate] ${entriesWithRisk.length} new entries, ${duplicateCount} duplicates filtered`,
    );

    // If no new entries, signal skip
    if (entriesWithRisk.length === 0) {
      return {
        newEntries: [],
        duplicateCount,
        errors: errors ?? [],
        pipelineStatus: 'skip_to_finalize',
      };
    }

    return {
      newEntries: entriesWithRisk,
      duplicateCount,
      errors: errors ?? [],
      pipelineStatus: 'continue',
    };
  },
};
