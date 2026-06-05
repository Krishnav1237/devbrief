import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../utils/vulnerability-detector.js', () => ({
  detectVulnerabilities: vi.fn(async () => []),
}));
import {
  computeContentHash,
  dedupKey,
  deduplicateEntries,
  deduplicateStep,
} from './deduplicate.js';
import {
  initStore,
  closeStore,
  getExistingEntriesForLibrary,
} from '../utils/store.js';
import type { ChangeEntry } from '../models/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    entry_id: crypto.randomUUID(),
    run_id: '00000000-0000-0000-0000-000000000001',
    library_name: 'react',
    version: '18.3.0',
    source_url: 'https://example.com/changelog',
    raw_content: '## v18.3.0\n\n- New feature',
    classification: null,
    summary: null,
    confidence_flag: false,
    scraped_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeContentHash
// ---------------------------------------------------------------------------

describe('computeContentHash', () => {
  it('returns a SHA-256 hex string', () => {
    const hash = computeContentHash('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses only the first 500 characters', () => {
    const longContent = 'a'.repeat(1000);
    const shortContent = 'a'.repeat(500);
    expect(computeContentHash(longContent)).toBe(computeContentHash(shortContent));
  });

  it('produces different hashes for different content', () => {
    expect(computeContentHash('content A')).not.toBe(computeContentHash('content B'));
  });

  it('handles empty string', () => {
    const hash = computeContentHash('');
    const expected = createHash('sha256').update('').digest('hex');
    expect(hash).toBe(expected);
  });

  it('handles content shorter than 500 chars', () => {
    const content = 'short';
    const expected = createHash('sha256').update('short').digest('hex');
    expect(computeContentHash(content)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// dedupKey
// ---------------------------------------------------------------------------

describe('dedupKey', () => {
  it('uses library_name::version for known versions', () => {
    const entry = makeEntry({ library_name: 'react', version: '18.3.0' });
    expect(dedupKey(entry)).toBe('react::18.3.0');
  });

  it('uses library_name::hash:<sha256> for unknown versions', () => {
    const entry = makeEntry({
      library_name: 'some-lib',
      version: 'unknown',
      raw_content: 'Some changelog text',
    });
    const expectedHash = computeContentHash('Some changelog text');
    expect(dedupKey(entry)).toBe(`some-lib::hash:${expectedHash}`);
  });

  it('produces different keys for different libraries with same version', () => {
    const a = makeEntry({ library_name: 'react', version: '1.0.0' });
    const b = makeEntry({ library_name: 'vue', version: '1.0.0' });
    expect(dedupKey(a)).not.toBe(dedupKey(b));
  });

  it('produces same key regardless of source_url', () => {
    const a = makeEntry({ source_url: 'https://example.com/a' });
    const b = makeEntry({ source_url: 'https://example.com/b' });
    expect(dedupKey(a)).toBe(dedupKey(b));
  });
});

// ---------------------------------------------------------------------------
// deduplicateEntries (pure function)
// ---------------------------------------------------------------------------

describe('deduplicateEntries', () => {
  it('returns all entries when no existing entries', () => {
    const scraped = [
      makeEntry({ version: '1.0.0' }),
      makeEntry({ version: '2.0.0' }),
    ];
    const result = deduplicateEntries(scraped, []);
    expect(result.newEntries).toHaveLength(2);
    expect(result.duplicateCount).toBe(0);
  });

  it('filters out entries that match existing (library_name, version)', () => {
    const existing = [makeEntry({ version: '1.0.0' })];
    const scraped = [
      makeEntry({ version: '1.0.0' }),
      makeEntry({ version: '2.0.0' }),
    ];
    const result = deduplicateEntries(scraped, existing);
    expect(result.newEntries).toHaveLength(1);
    expect(result.newEntries[0]!.version).toBe('2.0.0');
    expect(result.duplicateCount).toBe(1);
  });

  it('does not consider source_url in dedup key', () => {
    const existing = [
      makeEntry({ version: '1.0.0', source_url: 'https://example.com/page-a' }),
    ];
    const scraped = [
      makeEntry({ version: '1.0.0', source_url: 'https://example.com/page-b' }),
    ];
    const result = deduplicateEntries(scraped, existing);
    expect(result.newEntries).toHaveLength(0);
    expect(result.duplicateCount).toBe(1);
  });

  it('uses content hash for unknown versions', () => {
    const content = 'Some changelog without version headers';
    const existing = [
      makeEntry({ version: 'unknown', raw_content: content }),
    ];
    const scraped = [
      makeEntry({ version: 'unknown', raw_content: content }),
    ];
    const result = deduplicateEntries(scraped, existing);
    expect(result.newEntries).toHaveLength(0);
    expect(result.duplicateCount).toBe(1);
  });

  it('treats unknown versions with different content as distinct', () => {
    const existing = [
      makeEntry({ version: 'unknown', raw_content: 'Old content' }),
    ];
    const scraped = [
      makeEntry({ version: 'unknown', raw_content: 'New content' }),
    ];
    const result = deduplicateEntries(scraped, existing);
    expect(result.newEntries).toHaveLength(1);
    expect(result.duplicateCount).toBe(0);
  });

  it('handles intra-batch duplicates', () => {
    const scraped = [
      makeEntry({ version: '1.0.0', source_url: 'https://example.com/a' }),
      makeEntry({ version: '1.0.0', source_url: 'https://example.com/b' }),
    ];
    const result = deduplicateEntries(scraped, []);
    expect(result.newEntries).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });

  it('returns empty when all entries are duplicates', () => {
    const existing = [
      makeEntry({ version: '1.0.0' }),
      makeEntry({ version: '2.0.0' }),
    ];
    const scraped = [
      makeEntry({ version: '1.0.0' }),
      makeEntry({ version: '2.0.0' }),
    ];
    const result = deduplicateEntries(scraped, existing);
    expect(result.newEntries).toHaveLength(0);
    expect(result.duplicateCount).toBe(2);
  });

  it('handles entries from different libraries independently', () => {
    const existing = [
      makeEntry({ library_name: 'react', version: '1.0.0' }),
    ];
    const scraped = [
      makeEntry({ library_name: 'react', version: '1.0.0' }),
      makeEntry({ library_name: 'vue', version: '1.0.0' }),
    ];
    const result = deduplicateEntries(scraped, existing);
    expect(result.newEntries).toHaveLength(1);
    expect(result.newEntries[0]!.library_name).toBe('vue');
    expect(result.duplicateCount).toBe(1);
  });

  it('handles empty scraped entries', () => {
    const result = deduplicateEntries([], [makeEntry()]);
    expect(result.newEntries).toHaveLength(0);
    expect(result.duplicateCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deduplicateStep (integration with SQLite)
// ---------------------------------------------------------------------------

describe('deduplicateStep', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    initStore(dbPath);
  });

  afterEach(() => {
    closeStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const runId = '00000000-0000-0000-0000-000000000001';

  it('returns new entries and stores them in the database', async () => {
    const entries = [
      makeEntry({ version: '1.0.0', run_id: runId }),
      makeEntry({ version: '2.0.0', run_id: runId }),
    ];

    const result = await deduplicateStep.execute({
      inputData: {
        entries,
        errors: [],
        runId,
      },
    });

    expect(result.newEntries).toHaveLength(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.pipelineStatus).toBe('continue');

    // Verify entries were stored
    const stored = getExistingEntriesForLibrary('react');
    expect(stored).toHaveLength(2);
  });

  it('filters duplicates on second run', async () => {
    const firstRunEntries = [
      makeEntry({ version: '1.0.0', run_id: runId }),
    ];

    await deduplicateStep.execute({
      inputData: {
        entries: firstRunEntries,
        errors: [],
        runId,
      },
    });

    const secondRunId = '00000000-0000-0000-0000-000000000002';
    const secondRunEntries = [
      makeEntry({ version: '1.0.0', run_id: secondRunId }),
      makeEntry({ version: '2.0.0', run_id: secondRunId }),
    ];

    const result = await deduplicateStep.execute({
      inputData: {
        entries: secondRunEntries,
        errors: [],
        runId: secondRunId,
      },
    });

    expect(result.newEntries).toHaveLength(1);
    expect(result.newEntries[0]!.version).toBe('2.0.0');
    expect(result.duplicateCount).toBe(1);
    expect(result.pipelineStatus).toBe('continue');
  });

  it('sets pipelineStatus to skip_to_finalize when no new entries', async () => {
    const firstRunEntries = [
      makeEntry({ version: '1.0.0', run_id: runId }),
    ];

    await deduplicateStep.execute({
      inputData: {
        entries: firstRunEntries,
        errors: [],
        runId,
      },
    });

    const secondRunId = '00000000-0000-0000-0000-000000000002';
    const result = await deduplicateStep.execute({
      inputData: {
        entries: [makeEntry({ version: '1.0.0', run_id: secondRunId })],
        errors: [],
        runId: secondRunId,
      },
    });

    expect(result.newEntries).toHaveLength(0);
    expect(result.duplicateCount).toBe(1);
    expect(result.pipelineStatus).toBe('skip_to_finalize');
  });

  it('propagates skip_to_finalize from upstream', async () => {
    const result = await deduplicateStep.execute({
      inputData: {
        entries: [makeEntry({ run_id: runId })],
        errors: [],
        runId,
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(result.newEntries).toHaveLength(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.pipelineStatus).toBe('skip_to_finalize');

    // Verify nothing was stored
    const stored = getExistingEntriesForLibrary('react');
    expect(stored).toHaveLength(0);
  });

  it('passes through errors from upstream', async () => {
    const upstreamErrors = [
      { step: 'scrape', library_name: 'broken-lib', message: 'Timeout' },
    ];

    const result = await deduplicateStep.execute({
      inputData: {
        entries: [makeEntry({ run_id: runId })],
        errors: upstreamErrors,
        runId,
      },
    });

    expect(result.errors).toEqual(upstreamErrors);
  });

  it('handles batch query for multiple libraries', async () => {
    const entries = [
      makeEntry({ library_name: 'react', version: '1.0.0', run_id: runId }),
      makeEntry({ library_name: 'vue', version: '3.0.0', run_id: runId }),
      makeEntry({ library_name: 'angular', version: '17.0.0', run_id: runId }),
    ];

    const result = await deduplicateStep.execute({
      inputData: {
        entries,
        errors: [],
        runId,
      },
    });

    expect(result.newEntries).toHaveLength(3);
    expect(result.duplicateCount).toBe(0);
    expect(result.pipelineStatus).toBe('continue');
  });
});
