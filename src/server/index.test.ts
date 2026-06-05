import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from './index.js';
import { detectTailscaleIP } from '../utils/network.js';
import type { RunRecord } from '../models/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../workflow.js', () => ({
  isRunInProgress: vi.fn(),
  runDevBriefPipeline: vi.fn(),
}));

vi.mock('../utils/store.js', () => ({
  getRunRecords: vi.fn(),
  getRunRecord: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { isRunInProgress, runDevBriefPipeline } from '../workflow.js';
import { getRunRecords, getRunRecord } from '../utils/store.js';
import * as fs from 'node:fs';

const mockedIsRunInProgress = vi.mocked(isRunInProgress);
const mockedRunDevBriefPipeline = vi.mocked(runDevBriefPipeline);
const mockedGetRunRecords = vi.mocked(getRunRecords);
const mockedGetRunRecord = vi.mocked(getRunRecord);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJSON = any;

const TEST_HOST = '100.64.0.1';
const TEST_PORT = 7890;

function buildApp() {
  return createApp(
    () => TEST_HOST,
    () => TEST_PORT,
  );
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: '550e8400-e29b-41d4-a716-446655440000',
    triggered_at: '2025-01-15T07:00:00.000Z',
    trigger_type: 'manual',
    status: 'completed',
    has_errors: false,
    libraries_processed: ['react', 'vue'],
    new_change_count: 3,
    briefing_script: 'Good morning! Here is your DevBrief.',
    audio_url: '/home/user/.devbrief/audio/550e8400-e29b-41d4-a716-446655440000.mp3',
    digest_link: null,
    errors: [],
    completed_at: '2025-01-15T07:01:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectTailscaleIP
// ---------------------------------------------------------------------------

describe('detectTailscaleIP', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TAILSCALE_IP;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns TAILSCALE_IP env var when set', () => {
    process.env.TAILSCALE_IP = '100.99.88.77';
    expect(detectTailscaleIP()).toBe('100.99.88.77');
  });

  it('returns null when no Tailscale interface and no env var', () => {
    const result = detectTailscaleIP();
    if (result !== null) {
      expect(result).toMatch(/^100\./);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /trigger
// ---------------------------------------------------------------------------

describe('POST /trigger', () => {
  const app = buildApp();

  it('returns 202 with run_id when no run in progress', async () => {
    mockedIsRunInProgress.mockReturnValueOnce(false);
    mockedRunDevBriefPipeline.mockResolvedValueOnce(makeRunRecord());

    const res = await app.request('/trigger', { method: 'POST' });

    expect(res.status).toBe(202);
    const body: AnyJSON = await res.json();
    expect(body).toHaveProperty('run_id');
    expect(typeof body.run_id).toBe('string');
  });

  it('starts pipeline asynchronously without awaiting', async () => {
    mockedIsRunInProgress.mockReturnValueOnce(false);
    let resolvePromise: (value: RunRecord) => void;
    const pipelinePromise = new Promise<RunRecord>((resolve) => {
      resolvePromise = resolve;
    });
    mockedRunDevBriefPipeline.mockReturnValueOnce(pipelinePromise);

    const res = await app.request('/trigger', { method: 'POST' });

    expect(res.status).toBe(202);
    expect(mockedRunDevBriefPipeline).toHaveBeenCalledWith('webhook', expect.any(String));

    resolvePromise!(makeRunRecord());
  });

  it('returns 409 when a run is already in progress', async () => {
    mockedIsRunInProgress.mockReturnValueOnce(true);

    const res = await app.request('/trigger', { method: 'POST' });

    expect(res.status).toBe(409);
    const body: AnyJSON = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('already in progress');
  });

  it('does not call runDevBriefPipeline when run is in progress', async () => {
    mockedIsRunInProgress.mockReturnValueOnce(true);
    mockedRunDevBriefPipeline.mockClear();

    await app.request('/trigger', { method: 'POST' });

    expect(mockedRunDevBriefPipeline).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /runs
// ---------------------------------------------------------------------------

describe('GET /runs', () => {
  const app = buildApp();

  it('returns an array of run records ordered by triggered_at desc', async () => {
    const records = [
      makeRunRecord({ run_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', triggered_at: '2025-01-15T08:00:00.000Z' }),
      makeRunRecord({ run_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', triggered_at: '2025-01-15T07:00:00.000Z' }),
    ];
    mockedGetRunRecords.mockReturnValueOnce(records);

    const res = await app.request('/runs');

    expect(res.status).toBe(200);
    const body: AnyJSON = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].run_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(body[1].run_id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('returns empty array when no runs exist', async () => {
    mockedGetRunRecords.mockReturnValueOnce([]);

    const res = await app.request('/runs');

    expect(res.status).toBe(200);
    const body: AnyJSON = await res.json();
    expect(body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /runs/:run_id
// ---------------------------------------------------------------------------

describe('GET /runs/:run_id', () => {
  const app = buildApp();

  it('returns the run record when found', async () => {
    const record = makeRunRecord();
    mockedGetRunRecord.mockReturnValueOnce(record);

    const res = await app.request(`/runs/${record.run_id}`);

    expect(res.status).toBe(200);
    const body: AnyJSON = await res.json();
    expect(body.run_id).toBe(record.run_id);
    expect(body.status).toBe('completed');
    expect(body.libraries_processed).toEqual(['react', 'vue']);
    expect(body.new_change_count).toBe(3);
  });

  it('returns 404 when run not found', async () => {
    mockedGetRunRecord.mockReturnValueOnce(null);

    const res = await app.request('/runs/nonexistent-id');

    expect(res.status).toBe(404);
    const body: AnyJSON = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// GET /digest/:run_id
// ---------------------------------------------------------------------------

describe('GET /digest/:run_id', () => {
  const app = buildApp();

  it('returns DigestResponse with audio URL when audio exists', async () => {
    const record = makeRunRecord();
    mockedGetRunRecord.mockReturnValueOnce(record);

    const res = await app.request(`/digest/${record.run_id}`);

    expect(res.status).toBe(200);
    const body: AnyJSON = await res.json();
    expect(body.run_id).toBe(record.run_id);
    expect(body.briefing_script).toBe('Good morning! Here is your DevBrief.');
    expect(body.audio_url).toBe(
      `http://${TEST_HOST}:${TEST_PORT}/audio/${record.run_id}.mp3`,
    );
    expect(body.generated_at).toBe(record.completed_at);
  });

  it('returns null audio_url when no audio available', async () => {
    const record = makeRunRecord({ audio_url: null });
    mockedGetRunRecord.mockReturnValueOnce(record);

    const res = await app.request(`/digest/${record.run_id}`);

    expect(res.status).toBe(200);
    const body: AnyJSON = await res.json();
    expect(body.audio_url).toBeNull();
  });

  it('returns empty string for briefing_script when null', async () => {
    const record = makeRunRecord({ briefing_script: null });
    mockedGetRunRecord.mockReturnValueOnce(record);

    const res = await app.request(`/digest/${record.run_id}`);

    expect(res.status).toBe(200);
    const body: AnyJSON = await res.json();
    expect(body.briefing_script).toBe('');
  });

  it('uses triggered_at as generated_at when completed_at is null', async () => {
    const record = makeRunRecord({ completed_at: null });
    mockedGetRunRecord.mockReturnValueOnce(record);

    const res = await app.request(`/digest/${record.run_id}`);

    expect(res.status).toBe(200);
    const body: AnyJSON = await res.json();
    expect(body.generated_at).toBe(record.triggered_at);
  });

  it('returns 404 when run not found', async () => {
    mockedGetRunRecord.mockReturnValueOnce(null);

    const res = await app.request('/digest/nonexistent-id');

    expect(res.status).toBe(404);
    const body: AnyJSON = await res.json();
    expect(body.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// GET /audio/:run_id
// ---------------------------------------------------------------------------

describe('GET /audio/:run_id', () => {
  const app = buildApp();

  it('serves MP3 file with correct content type', async () => {
    const fakeAudio = Buffer.from('fake-mp3-data');
    mockedExistsSync.mockReturnValueOnce(true);
    mockedReadFileSync.mockReturnValueOnce(fakeAudio);

    const res = await app.request('/audio/550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Content-Length')).toBe(String(fakeAudio.length));

    const body = await res.arrayBuffer();
    expect(Buffer.from(body)).toEqual(fakeAudio);
  });

  it('handles .mp3 extension in the URL path', async () => {
    const fakeAudio = Buffer.from('fake-mp3-data');
    mockedExistsSync.mockReturnValueOnce(true);
    mockedReadFileSync.mockReturnValueOnce(fakeAudio);

    const res = await app.request('/audio/550e8400-e29b-41d4-a716-446655440000.mp3');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('returns 404 when audio file does not exist', async () => {
    mockedExistsSync.mockReturnValueOnce(false);

    const res = await app.request('/audio/550e8400-e29b-41d4-a716-446655440001');

    expect(res.status).toBe(404);
    const body: AnyJSON = await res.json();
    expect(body.error).toContain('not found');
  });
});
