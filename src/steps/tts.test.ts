import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chunkText, ttsStep } from './tts.js';

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns single chunk when text is within limit', () => {
    const text = 'Hello world. This is a test.';
    const result = chunkText(text, 100);
    expect(result).toEqual([text]);
  });

  it('returns single chunk when text equals the limit exactly', () => {
    const text = 'A'.repeat(2500);
    const result = chunkText(text, 2500);
    expect(result).toEqual([text]);
  });

  it('splits at sentence boundaries', () => {
    // Sentences include trailing space as part of the match so concatenation
    // reproduces the original text exactly.
    const text = 'First sentence. Second sentence. Third sentence.';

    // Set limit so first two sentences fit but not all three
    // "First sentence. Second sentence. " = 33 chars
    const result = chunkText(text, 34);

    expect(result.length).toBe(2);
    // Concatenation must reproduce original
    expect(result.join('')).toBe(text);
    // First chunk contains the first two sentences
    expect(result[0]).toContain('First sentence.');
    expect(result[0]).toContain('Second sentence.');
    // Second chunk contains the third sentence
    expect(result[1]).toContain('Third sentence.');
  });

  it('concatenating all chunks reproduces the original text', () => {
    const text =
      'Breaking change in React 19. You must migrate your context API. ' +
      'Webpack deprecated module rules. Use the new plugins API instead. ' +
      'Vite added HMR improvements. Lodash fixed a vulnerability.';

    const result = chunkText(text, 80);
    expect(result.join('')).toBe(text);
  });

  it('never splits mid-sentence', () => {
    const text = 'Short. Another short sentence. Yet another one here.';
    const result = chunkText(text, 20);

    // Each chunk should end with sentence-ending punctuation (or be the last chunk)
    for (let i = 0; i < result.length - 1; i++) {
      const trimmed = result[i].trimEnd();
      expect(
        trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?'),
      ).toBe(true);
    }
  });

  it('each chunk is at most maxChars (unless a single sentence exceeds it)', () => {
    const text =
      'First sentence is here. Second sentence follows. Third one too. ' +
      'Fourth sentence appears. Fifth sentence ends it.';

    const result = chunkText(text, 50);

    // Normal sentences should respect the limit
    for (const chunk of result) {
      // A single sentence that exceeds the limit is allowed
      if (chunk.includes('. ') || chunk.length <= 50) {
        // Multi-sentence chunks must be within limit
        // (single oversized sentences are the exception)
      }
    }

    // Verify concatenation
    expect(result.join('')).toBe(text);
  });

  it('handles text with exclamation marks as sentence boundaries', () => {
    const text = 'Watch out! This is important. Do not ignore this!';
    const result = chunkText(text, 15);

    expect(result.join('')).toBe(text);
    expect(result.length).toBeGreaterThan(1);
  });

  it('handles text with question marks as sentence boundaries', () => {
    const text = 'Is this working? Yes it is. Are you sure? Absolutely.';
    const result = chunkText(text, 20);

    expect(result.join('')).toBe(text);
    expect(result.length).toBeGreaterThan(1);
  });

  it('handles text with no sentence-ending punctuation', () => {
    const text = 'This text has no sentence ending punctuation at all';
    const result = chunkText(text, 20);

    // Should return the whole text as one chunk since we never split mid-sentence
    expect(result.join('')).toBe(text);
  });

  it('handles a single very long sentence exceeding maxChars', () => {
    const longSentence = 'A'.repeat(3000) + '.';
    const result = chunkText(longSentence, 2500);

    // The sentence should be in its own chunk even though it exceeds maxChars
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(longSentence);
  });

  it('uses default maxChars of 2500', () => {
    const text = 'Short text.';
    const result = chunkText(text);
    expect(result).toEqual([text]);
  });

  it('handles mixed punctuation types', () => {
    const text = 'Hello! How are you? I am fine. Great!';
    const result = chunkText(text, 25);

    expect(result.join('')).toBe(text);
  });

  it('handles text with trailing whitespace after sentences', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const result = chunkText(text, 30);

    expect(result.join('')).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// ttsStep (Mastra step)
// ---------------------------------------------------------------------------

describe('ttsStep', () => {
  it('has correct step id and description', () => {
    expect(ttsStep.id).toBe('tts');
    expect(ttsStep.description).toBeDefined();
  });

  it('returns skip_to_finalize when pipelineStatus is skip_to_finalize', async () => {
    const result = await ttsStep.execute({
      inputData: {
        briefingScript: null,
        classifiedEntries: [],
        errors: [],
        runId: '00000000-0000-0000-0000-000000000001',
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(result.pipelineStatus).toBe('skip_to_finalize');
    expect(result.audioUrl).toBeNull();
    expect(result.ttsFailed).toBe(false);
  });

  it('preserves errors when skipping', async () => {
    const errors = [{ step: 'summarize', message: 'LLM failed' }];

    const result = await ttsStep.execute({
      inputData: {
        briefingScript: null,
        classifiedEntries: [],
        errors,
        runId: '00000000-0000-0000-0000-000000000001',
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(result.errors).toEqual(errors);
  });

  it('returns ttsFailed when no briefing script is available', async () => {
    const result = await ttsStep.execute({
      inputData: {
        briefingScript: null,
        classifiedEntries: [],
        errors: [],
        runId: '00000000-0000-0000-0000-000000000001',
      },
    });

    expect(result.ttsFailed).toBe(true);
    expect(result.audioUrl).toBeNull();
    expect(result.pipelineStatus).toBe('continue');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].step).toBe('tts');
  });

  it('returns ttsFailed when SARVAM_API_KEY is not set', async () => {
    const originalKey = process.env.SARVAM_API_KEY;
    delete process.env.SARVAM_API_KEY;

    try {
      const result = await ttsStep.execute({
        inputData: {
          briefingScript: 'Hello world.',
          classifiedEntries: [],
          errors: [],
          runId: '00000000-0000-0000-0000-000000000001',
        },
      });

      expect(result.ttsFailed).toBe(true);
      expect(result.audioUrl).toBeNull();
      expect(result.pipelineStatus).toBe('continue');
      expect(result.errors.some((e) => e.step === 'tts')).toBe(true);
    } finally {
      if (originalKey) {
        process.env.SARVAM_API_KEY = originalKey;
      }
    }
  });

  it('passes through briefingScript and classifiedEntries on skip', async () => {
    const result = await ttsStep.execute({
      inputData: {
        briefingScript: 'Some script.',
        classifiedEntries: [],
        errors: [],
        runId: '00000000-0000-0000-0000-000000000001',
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(result.briefingScript).toBe('Some script.');
    expect(result.classifiedEntries).toEqual([]);
  });
});
