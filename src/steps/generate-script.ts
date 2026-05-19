import { z } from 'zod';
import {
  StepErrorSchema,
  type StepError,
} from '../models/index.js';
import {
  ClassifiedChangeEntrySchema,
  type ClassifiedChangeEntry,
  type PipelineStatus,
} from './summarize.js';

// ---------------------------------------------------------------------------
// Zod schemas for step I/O
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);

export const GenerateScriptInputSchema = z.object({
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema.optional(),
});
export type GenerateScriptInput = z.infer<typeof GenerateScriptInputSchema>;

export const GenerateScriptOutputSchema = z.object({
  briefingScript: z.string().nullable(),
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
});
export type GenerateScriptOutput = z.infer<typeof GenerateScriptOutputSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORD_BUDGET = 350;

const CLASSIFICATION_ORDER: readonly ClassifiedChangeEntry['classification'][] = [
  'breaking',
  'deprecation',
  'feature',
  'patch',
] as const;

// ---------------------------------------------------------------------------
// Section intro templates (conversational spoken-word style)
// ---------------------------------------------------------------------------

const SECTION_INTROS: Record<ClassifiedChangeEntry['classification'], string> = {
  breaking: 'Heads up — there are some breaking changes you need to know about.',
  deprecation: 'A few deprecation notices to be aware of.',
  feature: 'Some new features landed.',
  patch: 'And a few patches and fixes.',
};

// ---------------------------------------------------------------------------
// Pure helper functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Counts words by splitting on whitespace.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Groups classified entries by classification into ordered buckets.
 * Returns an object with arrays for each classification in priority order.
 */
export function groupByClassification(entries: ClassifiedChangeEntry[]): {
  breaking: ClassifiedChangeEntry[];
  deprecation: ClassifiedChangeEntry[];
  feature: ClassifiedChangeEntry[];
  patch: ClassifiedChangeEntry[];
} {
  const groups: {
    breaking: ClassifiedChangeEntry[];
    deprecation: ClassifiedChangeEntry[];
    feature: ClassifiedChangeEntry[];
    patch: ClassifiedChangeEntry[];
  } = {
    breaking: [],
    deprecation: [],
    feature: [],
    patch: [],
  };

  for (const entry of entries) {
    groups[entry.classification].push(entry);
  }

  return groups;
}

/**
 * Formats a single entry's summary line for the script.
 * Uses the pre-generated summary in conversational style.
 */
function formatFullEntry(entry: ClassifiedChangeEntry): string {
  return `${entry.library_name} version ${entry.version}: ${entry.summary}`;
}

/**
 * Formats a brief entry line (library name + version only) for budget-constrained sections.
 */
function formatBriefEntry(entry: ClassifiedChangeEntry): string {
  return `${entry.library_name} version ${entry.version}.`;
}

/**
 * Formats the date for the greeting. Uses the provided date or defaults to today.
 */
function formatDate(date?: Date): string {
  const d = date ?? new Date();
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Generates the full briefing script from classified entries.
 *
 * Template structure:
 *   - Greeting with date
 *   - Breaking changes section (always included in full)
 *   - Deprecation section (always included in full)
 *   - Feature section (full summaries, budget-constrained)
 *   - Patch section (full summaries, budget-constrained)
 *   - Closing
 *
 * Word budget: 350 words total. Breaking and deprecation entries are always
 * included in full. Feature and patch entries include full summaries until
 * the budget is reached, then switch to brief format (library name + version only).
 */
export function generateBriefingScript(
  entries: ClassifiedChangeEntry[],
  date?: Date,
): string {
  const groups = groupByClassification(entries);
  const dateStr = formatDate(date);

  const parts: string[] = [];

  // Greeting
  const greeting = `Good morning! Here's your DevBrief for ${dateStr}.`;
  parts.push(greeting);

  // Track running word count
  let currentWords = countWords(greeting);

  // --- Priority sections: breaking & deprecation (always included in full) ---
  for (const classification of ['breaking', 'deprecation'] as const) {
    const sectionEntries = groups[classification];
    if (sectionEntries.length === 0) continue;

    const intro = SECTION_INTROS[classification];
    parts.push(intro);
    currentWords += countWords(intro);

    for (const entry of sectionEntries) {
      const line = formatFullEntry(entry);
      parts.push(line);
      currentWords += countWords(line);
    }
  }

  // --- Feature & patch sections: full summaries until budget, then brief ---
  for (const classification of ['feature', 'patch'] as const) {
    const sectionEntries = groups[classification];
    if (sectionEntries.length === 0) continue;

    const intro = SECTION_INTROS[classification];
    const introWords = countWords(intro);

    // If we can't even fit the intro, skip the section
    if (currentWords + introWords > WORD_BUDGET) {
      continue;
    }

    parts.push(intro);
    currentWords += introWords;

    for (const entry of sectionEntries) {
      // Try full entry first
      const fullLine = formatFullEntry(entry);
      const fullLineWords = countWords(fullLine);

      if (currentWords + fullLineWords <= WORD_BUDGET) {
        // Full summary fits within budget
        parts.push(fullLine);
        currentWords += fullLineWords;
      } else {
        // Try brief format as fallback
        const briefLine = formatBriefEntry(entry);
        const briefLineWords = countWords(briefLine);

        if (currentWords + briefLineWords <= WORD_BUDGET) {
          parts.push(briefLine);
          currentWords += briefLineWords;
        } else {
          // Can't fit even the brief version — stop adding entries
          break;
        }
      }
    }
  }

  // Closing
  const closing = "That's your DevBrief for today. Have a great day!";
  parts.push(closing);

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Mastra step definition
// ---------------------------------------------------------------------------

/**
 * The generate-script step: builds a briefing script from classified entries
 * using template-based construction (no LLM call).
 *
 * Note: Uses manual pipelineStatus checking for now. Will be refactored to
 * use createSkippableStep() wrapper in Task 13.1.
 */
export const generateScriptStep = {
  id: 'generate-script' as const,
  description: 'Generate briefing script from classified entries',
  inputSchema: GenerateScriptInputSchema,
  outputSchema: GenerateScriptOutputSchema,

  execute: async ({
    inputData,
  }: {
    inputData: GenerateScriptInput;
  }): Promise<GenerateScriptOutput> => {
    const { classifiedEntries, errors, pipelineStatus } = inputData;

    // Early-exit propagation (manual check — will be handled by createSkippableStep in Task 13.1)
    if (pipelineStatus === 'skip_to_finalize') {
      return {
        briefingScript: null,
        classifiedEntries: [],
        errors: errors ?? [],
        pipelineStatus: 'skip_to_finalize',
      };
    }

    const briefingScript = generateBriefingScript(classifiedEntries);

    console.log(
      `[generate-script] Generated briefing script (${countWords(briefingScript)} words)`,
    );

    return {
      briefingScript,
      classifiedEntries,
      errors: errors ?? [],
      pipelineStatus: 'continue',
    };
  },
};
