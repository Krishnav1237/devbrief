// Feature: devbrief, Property 12: TTS text chunking preserves content and respects limits
// **Validates: Requirements 7.2**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { chunkText } from '../../src/steps/tts.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARS = 2500;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a single sentence ending with ., !, or ? followed by a space */
const arbSentence = fc
  .tuple(
    fc.lorem({ maxCount: 10, mode: 'words' }),
    fc.constantFrom('.', '!', '?'),
  )
  .map(([words, punct]) => `${words}${punct} `);

/** Generates text composed of multiple sentences */
const arbSentenceText = fc
  .array(arbSentence, { minLength: 1, maxLength: 30 })
  .map((sentences) => sentences.join(''));

/** Generates arbitrary non-empty strings (may not have sentence boundaries) */
const arbArbitraryText = fc.string({ minLength: 1, maxLength: 5000 });

// ---------------------------------------------------------------------------
// Property 12: TTS text chunking preserves content and respects limits
// ---------------------------------------------------------------------------

describe('Property 12: TTS text chunking preserves content and respects limits', () => {
  it('(a) each chunk is at most 2500 characters unless a single sentence exceeds it', () => {
    fc.assert(
      fc.property(arbSentenceText, (text) => {
        const chunks = chunkText(text, MAX_CHARS);

        for (const chunk of chunks) {
          if (chunk.length > MAX_CHARS) {
            // A chunk may exceed the limit only if it is a single sentence
            // that itself exceeds the limit. Verify it doesn't contain
            // multiple sentence boundaries (i.e., it's one oversized sentence).
            const sentenceEndings = chunk.match(/[.!?]\s/g);
            // At most one trailing sentence-ending punctuation is allowed
            // (the sentence's own ending). If there are multiple, the chunk
            // was not properly split.
            expect(
              sentenceEndings === null || sentenceEndings.length <= 1,
            ).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('(b) chunks are split at sentence boundaries (no sentence is split mid-way)', () => {
    fc.assert(
      fc.property(arbSentenceText, (text) => {
        const chunks = chunkText(text, MAX_CHARS);

        // Each chunk boundary should align with a sentence boundary.
        // For sentence-based text, every chunk (except possibly the last)
        // should end with sentence-ending punctuation followed by a space,
        // or end with sentence-ending punctuation at the string end.
        for (let i = 0; i < chunks.length - 1; i++) {
          const chunk = chunks[i];
          // The chunk should end at a sentence boundary: last non-space char
          // should be a sentence-ending punctuation mark
          const trimmed = chunk.trimEnd();
          const lastChar = trimmed[trimmed.length - 1];
          expect(['.', '!', '?']).toContain(lastChar);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('(c) concatenating all chunks reproduces the original text', () => {
    fc.assert(
      fc.property(arbSentenceText, (text) => {
        const chunks = chunkText(text, MAX_CHARS);
        const reconstructed = chunks.join('');
        expect(reconstructed).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('concatenation preserves content for arbitrary text (not just sentences)', () => {
    fc.assert(
      fc.property(arbArbitraryText, (text) => {
        const chunks = chunkText(text, MAX_CHARS);
        const reconstructed = chunks.join('');
        expect(reconstructed).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('empty text produces no chunks', () => {
    const chunks = chunkText('', MAX_CHARS);
    expect(chunks).toEqual([]);
  });

  it('text within the limit produces a single chunk', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: MAX_CHARS }),
        (text) => {
          const chunks = chunkText(text, MAX_CHARS);
          expect(chunks.length).toBe(1);
          expect(chunks[0]).toBe(text);
        },
      ),
      { numRuns: 100 },
    );
  });
});
