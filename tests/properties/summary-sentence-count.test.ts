// Feature: devbrief, Property 10: Summary sentence count constraint
// **Validates: Requirements 5.2**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseClassificationResponse } from '../../src/steps/summarize.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CLASSIFICATIONS = ['breaking', 'deprecation', 'feature', 'patch'] as const;
const SENTENCE_ENDINGS = /[.!?](?:\s|$)/g;

/**
 * Counts the number of sentences in a text by counting occurrences of
 * sentence-ending punctuation (. ! ?) followed by a space or end of string.
 */
function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(SENTENCE_ENDINGS);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary valid classification value */
const arbClassification = fc.constantFrom(...VALID_CLASSIFICATIONS);

/** Generates a single sentence (word(s) followed by sentence-ending punctuation) */
const arbSentence = fc
  .tuple(
    fc.array(fc.lorem({ maxCount: 3 }), { minLength: 1, maxLength: 6 }),
    fc.constantFrom('.', '!', '?'),
  )
  .map(([words, ending]) => words.join(' ') + ending);

/**
 * Generates a summary with exactly `n` sentences (1-3 range).
 */
function arbSummaryWithSentences(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .array(arbSentence, { minLength: min, maxLength: max })
    .map((sentences) => sentences.join(' '));
}

/**
 * Generates a valid LLM JSON response with a summary of the given sentence count range.
 */
function arbLLMResponseWithSentenceCount(
  minSentences: number,
  maxSentences: number,
): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbClassification,
      arbSummaryWithSentences(minSentences, maxSentences),
      fc.constantFrom('high', 'low'),
    )
    .map(([classification, summary, confidence]) =>
      JSON.stringify({ classification, summary, confidence }),
    );
}

// ---------------------------------------------------------------------------
// Property 10: Summary sentence count constraint
// ---------------------------------------------------------------------------

describe('Property 10: Summary sentence count constraint', () => {
  it('for any valid LLM response with 1-3 sentence summaries, the parsed summary contains no more than 3 sentences', () => {
    fc.assert(
      fc.property(
        arbLLMResponseWithSentenceCount(1, 3),
        (payload) => {
          const result = parseClassificationResponse(payload);

          // The summary should be a non-empty string
          expect(result.summary).toBeTruthy();

          // Count sentences in the returned summary
          const sentenceCount = countSentences(result.summary);

          // The summary should contain no more than 3 sentences
          expect(sentenceCount).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any valid LLM response with exactly 1 sentence, the parsed summary contains exactly 1 sentence', () => {
    fc.assert(
      fc.property(
        arbLLMResponseWithSentenceCount(1, 1),
        (payload) => {
          const result = parseClassificationResponse(payload);

          expect(result.summary).toBeTruthy();
          const sentenceCount = countSentences(result.summary);
          expect(sentenceCount).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any valid LLM response with 1-3 sentences and high confidence, the summary passes through unchanged', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          arbClassification,
          arbSummaryWithSentences(1, 3),
        ),
        ([classification, summary]) => {
          const payload = JSON.stringify({
            classification,
            summary,
            confidence: 'high',
          });

          const result = parseClassificationResponse(payload);

          // With high confidence, the summary should be returned as-is
          expect(result.summary).toBe(summary);

          // And it should still have <= 3 sentences
          const sentenceCount = countSentences(result.summary);
          expect(sentenceCount).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 100 },
    );
  });
});
