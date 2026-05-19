import { describe, it, expect } from 'vitest';
import { buildPrompt, parseClassificationResponse } from './summarize.js';

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  it('includes the library name in the prompt', () => {
    const prompt = buildPrompt('react', 'Some changelog content');
    expect(prompt).toContain('"react"');
  });

  it('includes the raw content in the prompt', () => {
    const rawContent = '## v18.3.0\n\n- Added new hooks API';
    const prompt = buildPrompt('react', rawContent);
    expect(prompt).toContain(rawContent);
  });

  it('includes classification rules', () => {
    const prompt = buildPrompt('lib', 'content');
    expect(prompt).toContain('"breaking"');
    expect(prompt).toContain('"deprecation"');
    expect(prompt).toContain('"feature"');
    expect(prompt).toContain('"patch"');
  });

  it('includes the JSON response format instruction', () => {
    const prompt = buildPrompt('lib', 'content');
    expect(prompt).toContain('Respond with ONLY a JSON object');
    expect(prompt).toContain('"classification"');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"confidence"');
  });

  it('handles empty library name', () => {
    const prompt = buildPrompt('', 'content');
    expect(prompt).toContain('""');
  });

  it('handles empty raw content', () => {
    const prompt = buildPrompt('lib', '');
    expect(prompt).toContain('---\n\n---');
  });

  it('handles special characters in library name', () => {
    const prompt = buildPrompt('@scope/my-lib', 'content');
    expect(prompt).toContain('"@scope/my-lib"');
  });

  it('handles multi-line raw content', () => {
    const rawContent = '## v1.0.0\n\n- Feature A\n- Feature B\n\n## v0.9.0\n\n- Beta';
    const prompt = buildPrompt('lib', rawContent);
    expect(prompt).toContain('Feature A');
    expect(prompt).toContain('Feature B');
    expect(prompt).toContain('Beta');
  });
});

// ---------------------------------------------------------------------------
// parseClassificationResponse
// ---------------------------------------------------------------------------

describe('parseClassificationResponse', () => {
  it('parses a valid high-confidence breaking response', () => {
    const raw = JSON.stringify({
      classification: 'breaking',
      summary: 'Removed the legacy API endpoint.',
      confidence: 'high',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('breaking');
    expect(result.summary).toBe('Removed the legacy API endpoint.');
    expect(result.confidenceFlag).toBe(false);
  });

  it('parses a valid high-confidence feature response', () => {
    const raw = JSON.stringify({
      classification: 'feature',
      summary: 'Added new hooks API for state management.',
      confidence: 'high',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('feature');
    expect(result.summary).toBe('Added new hooks API for state management.');
    expect(result.confidenceFlag).toBe(false);
  });

  it('parses a valid high-confidence deprecation response', () => {
    const raw = JSON.stringify({
      classification: 'deprecation',
      summary: 'The old render method is deprecated.',
      confidence: 'high',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('deprecation');
    expect(result.summary).toBe('The old render method is deprecated.');
    expect(result.confidenceFlag).toBe(false);
  });

  it('parses a valid high-confidence patch response', () => {
    const raw = JSON.stringify({
      classification: 'patch',
      summary: 'Fixed a memory leak in the event handler.',
      confidence: 'high',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.summary).toBe('Fixed a memory leak in the event handler.');
    expect(result.confidenceFlag).toBe(false);
  });

  it('defaults to patch with confidenceFlag when confidence is low', () => {
    const raw = JSON.stringify({
      classification: 'feature',
      summary: 'Some changes were made.',
      confidence: 'low',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.summary).toBe('Some changes were made.');
    expect(result.confidenceFlag).toBe(true);
  });

  it('defaults to patch with confidenceFlag on invalid JSON', () => {
    const raw = 'This is not JSON at all';
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.confidenceFlag).toBe(true);
  });

  it('defaults to patch with confidenceFlag on empty string', () => {
    const result = parseClassificationResponse('');
    expect(result.classification).toBe('patch');
    expect(result.confidenceFlag).toBe(true);
  });

  it('defaults to patch with confidenceFlag on invalid classification value', () => {
    const raw = JSON.stringify({
      classification: 'critical',
      summary: 'Something happened.',
      confidence: 'high',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.confidenceFlag).toBe(true);
  });

  it('defaults to patch with confidenceFlag on missing summary field', () => {
    const raw = JSON.stringify({
      classification: 'feature',
      confidence: 'high',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.confidenceFlag).toBe(true);
  });

  it('defaults to patch with confidenceFlag on missing confidence field', () => {
    const raw = JSON.stringify({
      classification: 'feature',
      summary: 'Added new feature.',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.confidenceFlag).toBe(true);
  });

  it('extracts JSON from response with surrounding text', () => {
    const raw = `Here is the analysis:
{"classification": "breaking", "summary": "Removed deprecated API.", "confidence": "high"}
Hope this helps!`;
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('breaking');
    expect(result.summary).toBe('Removed deprecated API.');
    expect(result.confidenceFlag).toBe(false);
  });

  it('extracts JSON from markdown code block', () => {
    const raw = '```json\n{"classification": "feature", "summary": "New hooks.", "confidence": "high"}\n```';
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('feature');
    expect(result.summary).toBe('New hooks.');
    expect(result.confidenceFlag).toBe(false);
  });

  it('uses first sentence of raw text as summary on parse failure', () => {
    const raw = 'This is the first sentence. This is the second.';
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.summary).toBe('This is the first sentence.');
    expect(result.confidenceFlag).toBe(true);
  });

  it('handles empty summary in valid JSON by defaulting', () => {
    const raw = JSON.stringify({
      classification: 'feature',
      summary: '',
      confidence: 'high',
    });
    const result = parseClassificationResponse(raw);
    // Empty summary fails Zod min(1) validation, so defaults
    expect(result.classification).toBe('patch');
    expect(result.confidenceFlag).toBe(true);
  });

  it('handles invalid confidence value by defaulting', () => {
    const raw = JSON.stringify({
      classification: 'feature',
      summary: 'Added feature.',
      confidence: 'medium',
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.confidenceFlag).toBe(true);
  });

  it('handles nested JSON objects gracefully', () => {
    const raw = JSON.stringify({
      classification: 'patch',
      summary: 'Fixed bug.',
      confidence: 'high',
      extra: { nested: true },
    });
    // Zod strict mode would fail, but we use .parse which strips extras
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe('patch');
    expect(result.summary).toBe('Fixed bug.');
    expect(result.confidenceFlag).toBe(false);
  });

  it('always returns a valid classification enum value', () => {
    const validClassifications = ['breaking', 'deprecation', 'feature', 'patch'];

    // Test with various malformed inputs
    const inputs = [
      '',
      'garbage',
      '{}',
      '{"classification": "unknown"}',
      'null',
      '42',
      '[]',
    ];

    for (const input of inputs) {
      const result = parseClassificationResponse(input);
      expect(validClassifications).toContain(result.classification);
    }
  });
});
