import { z } from 'zod';
import Olostep from 'olostep';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import {
  ChangeEntrySchema,
  StepErrorSchema,
  StackLibrarySchema,
  type ChangeEntry,
  type StepError,
  type StackLibrary,
} from '../models/index.js';

// ---------------------------------------------------------------------------
// Zod schemas for step I/O
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const ScrapeInputSchema = z.object({
  libraries: z.array(StackLibrarySchema),
  runId: z.string().uuid(),
  pipelineStatus: PipelineStatusSchema.optional(),
});
export type ScrapeInput = z.infer<typeof ScrapeInputSchema>;

export const ScrapeOutputSchema = z.object({
  entries: z.array(ChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
});
export type ScrapeOutput = z.infer<typeof ScrapeOutputSchema>;

// ---------------------------------------------------------------------------
// Version extraction
// ---------------------------------------------------------------------------

/**
 * Regex matching common changelog version headers:
 *   ## v2.4.1, ## Release 2.4.1, ## [2.4.1], ## 2.4.1 - 2024-01-15
 */
const VERSION_HEADER_RE =
  /^#{1,3}\s*(?:v|release\s+)?\[?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\]?/im;

/**
 * Global version to split markdown into sections by version headers.
 * Each match marks the start of a new section.
 */
const VERSION_HEADER_GLOBAL_RE =
  /^#{1,3}\s*(?:v|release\s+)?\[?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\]?/gim;

export interface VersionEntry {
  version: string;
  content: string;
}

/**
 * Splits markdown content into sections keyed by version headers.
 * If no version headers are found, returns a single entry with version "unknown".
 */
export function extractVersionEntries(markdown: string): VersionEntry[] {
  if (!markdown || markdown.trim().length === 0) {
    return [{ version: 'unknown', content: '' }];
  }

  // Find all version header positions
  const matches: { version: string; index: number }[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex before use
  VERSION_HEADER_GLOBAL_RE.lastIndex = 0;
  while ((match = VERSION_HEADER_GLOBAL_RE.exec(markdown)) !== null) {
    matches.push({ version: match[1]!, index: match.index });
  }

  if (matches.length === 0) {
    return [{ version: 'unknown', content: markdown.trim() }];
  }

  const entries: VersionEntry[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : markdown.length;
    const sectionContent = markdown.slice(start, end).trim();
    entries.push({
      version: matches[i]!.version,
      content: sectionContent,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// URL scraping logic (exported for testability)
// ---------------------------------------------------------------------------

export interface ScrapeUrlResult {
  url: string;
  markdown: string | null;
  error?: string;
}

/**
 * Scrapes a list of URLs using the Olostep SDK with concurrency limiting.
 * Returns results for each URL (success or failure).
 */
export async function scrapeUrls(
  urls: string[],
  olostepClient: Olostep,
  concurrencyLimit = 5,
): Promise<ScrapeUrlResult[]> {
  const limit = pLimit(concurrencyLimit);

  const tasks = urls.map((url) =>
    limit(async (): Promise<ScrapeUrlResult> => {
      try {
        const result = await olostepClient.scrapes.create({
          url,
          formats: ['markdown'],
          removeCssSelectors: 'default',
        });
        const markdown = result.markdown_content ?? null;
        return { url, markdown };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { url, markdown: null, error: message };
      }
    }),
  );

  const settled = await Promise.allSettled(tasks);

  return settled.map((result, idx) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // Should not happen since each task has its own try/catch, but handle defensively
    return {
      url: urls[idx]!,
      markdown: null,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

/**
 * Processes scrape results for a single library, producing ChangeEntry records
 * and StepError records.
 */
export function processLibraryResults(
  library: StackLibrary,
  results: ScrapeUrlResult[],
  runId: string,
): { entries: ChangeEntry[]; errors: StepError[] } {
  const entries: ChangeEntry[] = [];
  const errors: StepError[] = [];
  const now = new Date().toISOString();

  let successCount = 0;

  for (const result of results) {
    if (result.error || result.markdown === null) {
      const errorMessage = result.error ?? 'No markdown content returned';
      console.error(
        `[scrape] Failed to fetch ${result.url} for ${library.name}: ${errorMessage}`,
      );
      errors.push({
        step: 'scrape',
        library_name: library.name,
        message: `Failed to fetch ${result.url}: ${errorMessage}`,
      });
      continue;
    }

    successCount++;
    const versionEntries = extractVersionEntries(result.markdown);

    for (const ve of versionEntries) {
      entries.push({
        entry_id: uuidv4(),
        run_id: runId,
        library_name: library.name,
        version: ve.version,
        source_url: result.url,
        raw_content: ve.content,
        classification: null,
        summary: null,
        confidence_flag: false,
        scraped_at: now,
      });
    }
  }

  // If ALL URLs for this library failed, mark as scrape_failed
  if (successCount === 0 && results.length > 0) {
    errors.push({
      step: 'scrape',
      library_name: library.name,
      message: `All URLs failed for library "${library.name}"`,
    });
  }

  return { entries, errors };
}

// ---------------------------------------------------------------------------
// Mastra step definition
// ---------------------------------------------------------------------------

/**
 * The scrape step: fetches changelogs for all configured libraries via Olostep,
 * extracts version entries, and produces ChangeEntry records.
 */
export const scrapeStep = {
  id: 'scrape' as const,
  description: 'Fetch changelogs from configured library URLs via Olostep',
  inputSchema: ScrapeInputSchema,
  outputSchema: ScrapeOutputSchema,

  execute: async ({
    inputData,
  }: {
    inputData: ScrapeInput;
  }): Promise<ScrapeOutput> => {
    const { libraries, runId, pipelineStatus } = inputData;

    // Early-exit propagation
    if (pipelineStatus === 'skip_to_finalize') {
      return { entries: [], errors: [], pipelineStatus: 'skip_to_finalize' };
    }

    const apiKey = process.env.OLOSTEP_API_KEY;
    if (!apiKey) {
      console.error('[scrape] OLOSTEP_API_KEY is not set');
      return {
        entries: [],
        errors: [{ step: 'scrape', message: 'OLOSTEP_API_KEY is not configured' }],
        pipelineStatus: 'continue',
      };
    }

    const client = new Olostep({ apiKey });

    const allEntries: ChangeEntry[] = [];
    const allErrors: StepError[] = [];

    // Collect all URLs across all libraries with their library reference
    const urlTasks: { library: StackLibrary; url: string }[] = [];
    for (const lib of libraries) {
      for (const url of lib.urls) {
        urlTasks.push({ library: lib, url });
      }
    }

    // Scrape all URLs with concurrency limiting
    const allUrls = urlTasks.map((t) => t.url);
    const scrapeResults = await scrapeUrls(allUrls, client, 5);

    // Group results back by library
    const resultsByLibrary = new Map<string, ScrapeUrlResult[]>();
    for (let i = 0; i < urlTasks.length; i++) {
      const libName = urlTasks[i]!.library.name;
      if (!resultsByLibrary.has(libName)) {
        resultsByLibrary.set(libName, []);
      }
      resultsByLibrary.get(libName)!.push(scrapeResults[i]!);
    }

    // Process each library's results
    for (const lib of libraries) {
      const results = resultsByLibrary.get(lib.name) ?? [];
      const { entries, errors } = processLibraryResults(lib, results, runId);
      allEntries.push(...entries);
      allErrors.push(...errors);
    }

    console.log(
      `[scrape] Completed: ${allEntries.length} entries from ${libraries.length} libraries, ${allErrors.length} errors`,
    );

    return {
      entries: allEntries,
      errors: allErrors,
      pipelineStatus: 'continue',
    };
  },
};
