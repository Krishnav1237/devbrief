// Feature: devbrief, Property 8: Classification parsing produces exactly one valid enum value
// **Validates: Requirements 5.1**
// Feature: devbrief, Property 9: Low-confidence classification defaults to patch
// **Validates: Requirements 5.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseClassificationResponse } from '../../src/steps/summarize.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CLASSIFICATIONS = ['breaking', 'deprecation', 'feature', 'patch'] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary valid classification value */
const arbClassification = fc.constantFrom(...VALID_CLASSIFICATIONS);

/** Arbitrary confidence value */
const arbConfidence = fc.constantFrom('high', 'low');

/** Arbitrary non-empty summary string */
const arbSummary = fc.lorem({ maxCount: 5 }).filter((s) => s.length > 0);

/**
 * Generates a well-formed LLM JSON response string with the given overrides.
 */
function arbValidLLMResponse(overrides?: {
  classification?: fc.Arbitrary<string>;
  summary?: fc.Arbitrary<string>;
  confidence?: fc.Arbitrary<string>;
}): fc.Arbitrary<string> {
  return fc
    .tuple(
      overrides?.classification ?? arbClassification,
      overrides?.summary ?? arbSummary,
      overrides?.confidence ?? arbConfidence,
    )
    .map(([classification, summary, confidence]) =>
      JSON.stringify({ classification, summary, confidence }),
    );
}

/**
 * Generates arbitrary strings that may or may not be valid JSON.
 * Includes: random text, empty strings, partial JSON, valid JSON with wrong shape,
 * numbers, arrays, booleans, null, etc.
 */
const arbArbitraryPayload = fc.oneof(
  // Completely random strings
  fc.string(),
  // Empty string
  fc.constant(''),
  // Valid JSON but wrong shape (object with random keys)
  fc.dictionary(fc.string(), fc.string()).map((d) => JSON.stringify(d)),
  // Valid JSON array
  fc.array(fc.string()).map((a) => JSON.stringify(a)),
  // JSON primitives
  fc.constant('null'),
  fc.constant('true'),
  fc.constant('false'),
  fc.integer().map(String),
  // Partial / broken JSON
  fc.constant('{'),
  fc.constant('{"classification":'),
  fc.constant('{"classification": "breaking"'),
  // Valid LLM response (should also produce valid output)
  arbValidLLMResponse(),
  // Valid JSON with invalid classification values
  fc
    .tuple(fc.string(), arbSummary, arbConfidence)
    .map(([cls, summary, confidence]) =>
      JSON.stringify({ classification: cls, summary, confidence }),
    ),
  // JSON with missing fields
  fc.tuple(arbClassification).map(([cls]) => JSON.stringify({ classification: cls })),
  arbSummary.map((s) => JSON.stringify({ summary: s })),
  // JSON wrapped in extra text (like LLM sometimes does)
  arbValidLLMResponse().map((json) => `Here is the result:\n${json}\nDone.`),
);

// ---------------------------------------------------------------------------
// Property 8: Classification parsing produces exactly one valid enum value
// ---------------------------------------------------------------------------

describe('Property 8: Classification parsing produces exactly one valid enum value', () => {
  it('for any arbitrary string input, parseClassificationResponse always returns exactly one valid classification', () => {
    fc.assert(
      fc.property(arbArbitraryPayload, (payload) => {
        const result = parseClassificationResponse(payload);

        // Must have a classification field
        expect(result).toHaveProperty('classification');

        // Classification must be exactly one of the valid enum values
        expect(VALID_CLASSIFICATIONS).toContain(result.classification);
      }),
      { numRuns: 100 },
    );
  });

  it('for malformed JSON, defaults classification to "patch"', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          // Filter to strings that don't contain valid JSON with a valid classification
          try {
            const match = s.match(/\{[\s\S]*\}/);
            if (!match) return true;
            const parsed = JSON.parse(match[0]);
            return !['breaking', 'deprecation', 'feature', 'patch'].includes(
              parsed.classification,
            );
          } catch {
            return true;
          }
        }),
        (malformedInput) => {
          const result = parseClassificationResponse(malformedInput);
          expect(result.classification).toBe('patch');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for empty strings, defaults classification to "patch"', () => {
    const result = parseClassificationResponse('');
    expect(result.classification).toBe('patch');
    expect(VALID_CLASSIFICATIONS).toContain(result.classification);
  });
});

// ---------------------------------------------------------------------------
// Property 9: Low-confidence classification defaults to patch
// ---------------------------------------------------------------------------

describe('Property 9: Low-confidence classification defaults to patch', () => {
  it('for any valid JSON response with confidence "low", classification is always "patch" and confidenceFlag is true', () => {
    fc.assert(
      fc.property(
        arbClassification,
        arbSummary,
        (classification, summary) => {
          const payload = JSON.stringify({
            classification,
            summary,
            confidence: 'low',
          });

          const result = parseClassificationResponse(payload);

          // Regardless of the original classification, low confidence forces "patch"
          expect(result.classification).toBe('patch');
          expect(result.confidenceFlag).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any valid JSON response with confidence "high", classification matches the input and confidenceFlag is false', () => {
    fc.assert(
      fc.property(
        arbClassification,
        arbSummary,
        (classification, summary) => {
          const payload = JSON.stringify({
            classification,
            summary,
            confidence: 'high',
          });

          const result = parseClassificationResponse(payload);

          // High confidence preserves the original classification
          expect(result.classification).toBe(classification);
          expect(result.confidenceFlag).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
