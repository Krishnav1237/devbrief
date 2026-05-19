import { z } from 'zod';
import Groq from 'groq-sdk';
import axios from 'axios';
import {
  ChangeEntrySchema,
  ChangeClassificationSchema,
  StepErrorSchema,
  type ChangeEntry,
  type ChangeClassification,
  type StepError,
} from '../models/index.js';
import {
  initStore,
  updateEntryClassification,
} from '../utils/store.js';

// ---------------------------------------------------------------------------
// Zod schemas for step I/O
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const ClassifiedChangeEntrySchema = ChangeEntrySchema.extend({
  classification: ChangeClassificationSchema,
  summary: z.string(),
  confidence_flag: z.boolean(),
});
export type ClassifiedChangeEntry = z.infer<typeof ClassifiedChangeEntrySchema>;

export const SummarizeInputSchema = z.object({
  newEntries: z.array(ChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  duplicateCount: z.number().int().nonnegative(),
  runId: z.string().uuid(),
  pipelineStatus: PipelineStatusSchema.optional(),
});
export type SummarizeInput = z.infer<typeof SummarizeInputSchema>;

export const SummarizeOutputSchema = z.object({
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
});
export type SummarizeOutput = z.infer<typeof SummarizeOutputSchema>;

// ---------------------------------------------------------------------------
// LLM response validation schema
// ---------------------------------------------------------------------------

const LLMResponseSchema = z.object({
  classification: ChangeClassificationSchema,
  summary: z.string().min(1),
  confidence: z.enum(['high', 'low']),
});

// ---------------------------------------------------------------------------
// Pure functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Builds the prompt from the template defined in the design document.
 */
export function buildPrompt(libraryName: string, rawContent: string): string {
  return `You are a developer tools assistant. Analyze the following changelog entry for the library "${libraryName}" and respond with a JSON object.

Changelog content:
---
${rawContent}
---

Respond with ONLY a JSON object in this exact format:
{
  "classification": "breaking" | "deprecation" | "feature" | "patch",
  "summary": "A plain-language summary in 1-3 sentences describing what changed and any action the developer needs to take.",
  "confidence": "high" | "low"
}

Classification rules:
- "breaking": Removes or changes existing API, requires code changes to upgrade
- "deprecation": Marks something as deprecated, will be removed in a future version
- "feature": Adds new functionality, no action required to continue working
- "patch": Bug fixes, performance improvements, documentation updates

If you are unsure about the classification, set confidence to "low".`;
}

/**
 * Extracts the first sentence from a string.
 * Used as a fallback summary when LLM response is malformed.
 */
function extractFirstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'No summary available.';

  // Match up to the first sentence-ending punctuation followed by a space or end of string
  const match = trimmed.match(/^[^.!?]*[.!?]/);
  if (match) {
    return match[0].trim();
  }

  // No sentence-ending punctuation found — take the first 200 chars
  const truncated = trimmed.slice(0, 200);
  return truncated.length < trimmed.length ? `${truncated}...` : truncated;
}

/**
 * Parses and validates the LLM JSON response.
 * On any parse/validation failure, defaults to patch with confidenceFlag: true.
 */
export function parseClassificationResponse(raw: string): {
  classification: ChangeClassification;
  summary: string;
  confidenceFlag: boolean;
} {
  try {
    // Try to extract JSON from the response (LLM may include extra text)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        classification: 'patch',
        summary: extractFirstSentence(raw),
        confidenceFlag: true,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = LLMResponseSchema.parse(parsed);

    // If confidence is low, default to patch with confidenceFlag: true
    if (validated.confidence === 'low') {
      return {
        classification: 'patch',
        summary: validated.summary,
        confidenceFlag: true,
      };
    }

    return {
      classification: validated.classification,
      summary: validated.summary,
      confidenceFlag: false,
    };
  } catch {
    // Any parse or validation error: default to patch
    return {
      classification: 'patch',
      summary: extractFirstSentence(raw),
      confidenceFlag: true,
    };
  }
}

// ---------------------------------------------------------------------------
// LLM call helpers
// ---------------------------------------------------------------------------

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the LLM via Groq SDK.
 */
async function callGroq(prompt: string, apiKey: string): Promise<string> {
  const client = new Groq({ apiKey });
  const response = await client.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 512,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq returned empty response');
  }
  return content;
}

/**
 * Calls the LLM via Ollama HTTP API.
 */
async function callOllama(prompt: string, baseUrl: string): Promise<string> {
  const response = await axios.post(`${baseUrl}/api/generate`, {
    model: 'llama3',
    prompt,
    stream: false,
  });

  const content = response.data?.response;
  if (!content) {
    throw new Error('Ollama returned empty response');
  }
  return content;
}

/**
 * Calls the LLM with a single retry on failure (1-second delay between attempts).
 * Tries Groq first if GROQ_API_KEY is set, otherwise falls back to Ollama.
 */
async function callLLM(prompt: string): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;

  const callFn = groqApiKey
    ? () => callGroq(prompt, groqApiKey)
    : ollamaBaseUrl
      ? () => callOllama(prompt, ollamaBaseUrl)
      : null;

  if (!callFn) {
    throw new Error(
      'No LLM provider configured. Set GROQ_API_KEY or OLLAMA_BASE_URL.',
    );
  }

  try {
    return await callFn();
  } catch (firstError) {
    console.warn(
      `[summarize] LLM call failed, retrying in 1s:`,
      firstError instanceof Error ? firstError.message : String(firstError),
    );
    await delay(1000);
    // Second attempt — let it throw if it fails
    return await callFn();
  }
}

// ---------------------------------------------------------------------------
// Mastra step definition
// ---------------------------------------------------------------------------

/**
 * The summarize step: classifies and summarizes each ChangeEntry using
 * Llama 3 via Groq or Ollama.
 */
export const summarizeStep = {
  id: 'summarize' as const,
  description: 'Classify and summarize change entries using LLM',
  inputSchema: SummarizeInputSchema,
  outputSchema: SummarizeOutputSchema,

  execute: async ({
    inputData,
  }: {
    inputData: SummarizeInput;
  }): Promise<SummarizeOutput> => {
    const { newEntries, errors, pipelineStatus } = inputData;

    // Early-exit propagation
    if (pipelineStatus === 'skip_to_finalize') {
      return {
        classifiedEntries: [],
        errors: errors ?? [],
        pipelineStatus: 'skip_to_finalize',
      };
    }

    // Initialize the store (idempotent)
    initStore();

    const classifiedEntries: ClassifiedChangeEntry[] = [];
    const stepErrors: StepError[] = [...(errors ?? [])];

    for (const entry of newEntries) {
      // Truncate raw_content to 3000 chars to stay within Groq's free tier token limit (8k)
      const truncatedContent = entry.raw_content.slice(0, 3000);
      const prompt = buildPrompt(entry.library_name, truncatedContent);

      let llmResponse: string;
      try {
        llmResponse = await callLLM(prompt);
      } catch (err) {
        // Both attempts failed — mark run as llm_failed
        const message =
          err instanceof Error ? err.message : String(err);
        console.error(`[summarize] LLM failed after retry: ${message}`);
        stepErrors.push({
          step: 'summarize',
          message: `LLM error: ${message}`,
        });

        return {
          classifiedEntries: [],
          errors: stepErrors,
          pipelineStatus: 'skip_to_finalize',
        };
      }

      const { classification, summary, confidenceFlag } =
        parseClassificationResponse(llmResponse);

      const classifiedEntry: ClassifiedChangeEntry = {
        ...entry,
        classification,
        summary,
        confidence_flag: confidenceFlag,
      };

      classifiedEntries.push(classifiedEntry);

      // Update the entry in the store
      updateEntryClassification(
        entry.entry_id,
        classification,
        summary,
        confidenceFlag,
      );
    }

    console.log(
      `[summarize] Classified ${classifiedEntries.length} entries`,
    );

    return {
      classifiedEntries,
      errors: stepErrors,
      pipelineStatus: 'continue',
    };
  },
};
