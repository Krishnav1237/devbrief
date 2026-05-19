import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildDigestUrl, publishStep, type PublishInput } from './publish.js';

// ---------------------------------------------------------------------------
// buildDigestUrl tests
// ---------------------------------------------------------------------------

describe('buildDigestUrl', () => {
  it('builds URL with provided tailscale IP and port', () => {
    const url = buildDigestUrl('abc-123', '100.64.0.1', '7890');
    expect(url).toBe('http://100.64.0.1:7890/digest/abc-123');
  });

  it('falls back to localhost when tailscale IP is not provided', () => {
    const url = buildDigestUrl('abc-123', undefined, '8080');
    expect(url).toBe('http://localhost:8080/digest/abc-123');
  });

  it('falls back to localhost when tailscale IP is empty string', () => {
    const url = buildDigestUrl('abc-123', '', '8080');
    expect(url).toBe('http://localhost:8080/digest/abc-123');
  });

  it('uses default port 7890 when port is not provided', () => {
    const url = buildDigestUrl('abc-123', '100.64.0.1');
    expect(url).toBe('http://100.64.0.1:7890/digest/abc-123');
  });

  it('uses default port 7890 when port is empty string', () => {
    const url = buildDigestUrl('abc-123', '100.64.0.1', '');
    expect(url).toBe('http://100.64.0.1:7890/digest/abc-123');
  });

  it('uses localhost and default port when both are missing', () => {
    const url = buildDigestUrl('abc-123');
    expect(url).toBe('http://localhost:7890/digest/abc-123');
  });
});

// ---------------------------------------------------------------------------
// publishStep tests
// ---------------------------------------------------------------------------

describe('publishStep', () => {
  const RUN_ID = '550e8400-e29b-41d4-a716-446655440000';

  const baseInput: PublishInput = {
    briefingScript: 'Good morning! Here is your DevBrief.',
    audioUrl: '/home/user/.devbrief/audio/550e8400-e29b-41d4-a716-446655440000.mp3',
    ttsFailed: false,
    classifiedEntries: [],
    errors: [],
    runId: RUN_ID,
  };

  beforeEach(() => {
    // Clear env vars before each test
    delete process.env.TAILSCALE_IP;
    delete process.env.DEVBRIEF_PORT;
  });

  afterEach(() => {
    delete process.env.TAILSCALE_IP;
    delete process.env.DEVBRIEF_PORT;
    vi.restoreAllMocks();
  });

  it('returns skip_to_finalize when pipelineStatus is skip_to_finalize', async () => {
    const input: PublishInput = {
      ...baseInput,
      pipelineStatus: 'skip_to_finalize',
    };

    const result = await publishStep.execute({ inputData: input });

    expect(result.digestLink).toBeNull();
    expect(result.pipelineStatus).toBe('skip_to_finalize');
    expect(result.briefingScript).toBe(baseInput.briefingScript);
    expect(result.audioUrl).toBe(baseInput.audioUrl);
  });

  it('returns error when briefing script is null', async () => {
    const input: PublishInput = {
      ...baseInput,
      briefingScript: null,
    };

    const result = await publishStep.execute({ inputData: input });

    expect(result.digestLink).toBeNull();
    expect(result.pipelineStatus).toBe('continue');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      step: 'publish',
      message: 'No briefing script available for publishing',
    });
  });

  it('generates digest link with TAILSCALE_IP and DEVBRIEF_PORT from env', async () => {
    process.env.TAILSCALE_IP = '100.64.0.5';
    process.env.DEVBRIEF_PORT = '9000';

    const result = await publishStep.execute({ inputData: baseInput });

    expect(result.digestLink).toBe(`http://100.64.0.5:9000/digest/${RUN_ID}`);
    expect(result.pipelineStatus).toBe('continue');
    expect(result.briefingScript).toBe(baseInput.briefingScript);
    expect(result.audioUrl).toBe(baseInput.audioUrl);
    expect(result.errors).toHaveLength(0);
  });

  it('falls back to localhost when TAILSCALE_IP is not set', async () => {
    const result = await publishStep.execute({ inputData: baseInput });

    expect(result.digestLink).toBe(`http://localhost:7890/digest/${RUN_ID}`);
    expect(result.pipelineStatus).toBe('continue');
  });

  it('uses default port 7890 when DEVBRIEF_PORT is not set', async () => {
    process.env.TAILSCALE_IP = '100.64.0.5';

    const result = await publishStep.execute({ inputData: baseInput });

    expect(result.digestLink).toBe(`http://100.64.0.5:7890/digest/${RUN_ID}`);
  });

  it('handles text-only publishing when TTS failed', async () => {
    process.env.TAILSCALE_IP = '100.64.0.5';

    const input: PublishInput = {
      ...baseInput,
      audioUrl: null,
      ttsFailed: true,
    };

    const result = await publishStep.execute({ inputData: input });

    expect(result.digestLink).toBe(`http://100.64.0.5:7890/digest/${RUN_ID}`);
    expect(result.pipelineStatus).toBe('continue');
    expect(result.audioUrl).toBeNull();
    expect(result.briefingScript).toBe(baseInput.briefingScript);
  });

  it('preserves existing errors in output', async () => {
    const existingErrors = [
      { step: 'tts', message: 'TTS error: rate limited' },
    ];

    const input: PublishInput = {
      ...baseInput,
      errors: existingErrors,
    };

    const result = await publishStep.execute({ inputData: input });

    expect(result.errors).toEqual(existingErrors);
  });

  it('preserves classifiedEntries in output', async () => {
    const entries = [
      {
        entry_id: '11111111-1111-1111-1111-111111111111',
        run_id: RUN_ID,
        library_name: 'react',
        version: '19.0.0',
        source_url: 'https://github.com/facebook/react/releases',
        raw_content: 'Breaking change in React 19',
        classification: 'breaking' as const,
        summary: 'React 19 introduces breaking changes.',
        confidence_flag: false,
        scraped_at: new Date().toISOString(),
      },
    ];

    const input: PublishInput = {
      ...baseInput,
      classifiedEntries: entries,
    };

    const result = await publishStep.execute({ inputData: input });

    expect(result.classifiedEntries).toEqual(entries);
  });

  it('has correct step metadata', () => {
    expect(publishStep.id).toBe('publish');
    expect(publishStep.description).toBe('Publish digest and generate shareable link');
  });
});
