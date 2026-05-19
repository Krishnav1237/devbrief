import { describe, it, expect } from 'vitest';
import {
  extractVersionEntries,
  processLibraryResults,
  type ScrapeUrlResult,
} from './scrape.js';
import type { StackLibrary } from '../models/index.js';

// ---------------------------------------------------------------------------
// extractVersionEntries
// ---------------------------------------------------------------------------

describe('extractVersionEntries', () => {
  it('returns a single "unknown" entry for empty string', () => {
    const result = extractVersionEntries('');
    expect(result).toEqual([{ version: 'unknown', content: '' }]);
  });

  it('returns a single "unknown" entry for whitespace-only string', () => {
    const result = extractVersionEntries('   \n\n  ');
    expect(result).toEqual([{ version: 'unknown', content: '' }]);
  });

  it('returns "unknown" when no version headers are present', () => {
    const md = 'Some changelog text without version headers.\n\nMore text here.';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('unknown');
    expect(result[0]!.content).toBe(md.trim());
  });

  it('extracts a single version from ## v2.4.1 header', () => {
    const md = '## v2.4.1\n\n- Fixed a bug\n- Added feature';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('2.4.1');
    expect(result[0]!.content).toContain('Fixed a bug');
  });

  it('extracts version from ## Release 2.4.1 header', () => {
    const md = '## Release 2.4.1\n\n- Fixed a bug';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('2.4.1');
  });

  it('extracts version from ## [2.4.1] header (bracketed)', () => {
    const md = '## [2.4.1]\n\n- Fixed a bug';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('2.4.1');
  });

  it('extracts version from ## 2.4.1 - 2024-01-15 header', () => {
    const md = '## 2.4.1 - 2024-01-15\n\n- Fixed a bug';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('2.4.1');
  });

  it('extracts pre-release version like 3.0.0-beta.1', () => {
    const md = '## v3.0.0-beta.1\n\n- Beta release';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('3.0.0-beta.1');
  });

  it('splits multiple version sections correctly', () => {
    const md = [
      '## v3.0.0',
      '',
      '- Breaking change',
      '',
      '## v2.5.0',
      '',
      '- New feature',
      '',
      '## v2.4.1',
      '',
      '- Bug fix',
    ].join('\n');

    const result = extractVersionEntries(md);
    expect(result).toHaveLength(3);
    expect(result[0]!.version).toBe('3.0.0');
    expect(result[0]!.content).toContain('Breaking change');
    expect(result[1]!.version).toBe('2.5.0');
    expect(result[1]!.content).toContain('New feature');
    expect(result[2]!.version).toBe('2.4.1');
    expect(result[2]!.content).toContain('Bug fix');
  });

  it('handles # (h1) and ### (h3) version headers', () => {
    const md = '# v1.0.0\n\nInitial release\n\n### v0.9.0\n\nPre-release';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(2);
    expect(result[0]!.version).toBe('1.0.0');
    expect(result[1]!.version).toBe('0.9.0');
  });

  it('handles two-part version numbers like 2.0', () => {
    const md = '## v2.0\n\nMajor update';
    const result = extractVersionEntries(md);
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('2.0');
  });

  it('does not split on content before the first version header', () => {
    const md = [
      '# Changelog',
      '',
      'All notable changes.',
      '',
      '## v2.0.0',
      '',
      '- Major update',
    ].join('\n');

    const result = extractVersionEntries(md);
    // Only the version section is returned; preamble is not a separate entry
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe('2.0.0');
    expect(result[0]!.content).toContain('Major update');
  });
});

// ---------------------------------------------------------------------------
// processLibraryResults
// ---------------------------------------------------------------------------

describe('processLibraryResults', () => {
  const makeLibrary = (name: string, urls: string[]): StackLibrary => ({
    name,
    urls,
    added_at: new Date().toISOString(),
  });

  const runId = '00000000-0000-0000-0000-000000000001';

  it('produces entries for successful scrapes', () => {
    const lib = makeLibrary('react', ['https://example.com/changelog']);
    const results: ScrapeUrlResult[] = [
      { url: 'https://example.com/changelog', markdown: '## v18.3.0\n\n- New feature' },
    ];

    const { entries, errors } = processLibraryResults(lib, results, runId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.library_name).toBe('react');
    expect(entries[0]!.version).toBe('18.3.0');
    expect(entries[0]!.run_id).toBe(runId);
    expect(entries[0]!.source_url).toBe('https://example.com/changelog');
    expect(entries[0]!.classification).toBeNull();
    expect(entries[0]!.summary).toBeNull();
    expect(entries[0]!.confidence_flag).toBe(false);
    expect(errors).toHaveLength(0);
  });

  it('logs errors for failed URLs', () => {
    const lib = makeLibrary('react', ['https://example.com/changelog']);
    const results: ScrapeUrlResult[] = [
      { url: 'https://example.com/changelog', markdown: null, error: 'Network error' },
    ];

    const { entries, errors } = processLibraryResults(lib, results, runId);
    expect(entries).toHaveLength(0);
    // Two errors: one per-URL failure + one "all URLs failed"
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.message.includes('Network error'))).toBe(true);
  });

  it('marks library as scrape_failed when all URLs fail', () => {
    const lib = makeLibrary('react', [
      'https://example.com/a',
      'https://example.com/b',
    ]);
    const results: ScrapeUrlResult[] = [
      { url: 'https://example.com/a', markdown: null, error: 'Timeout' },
      { url: 'https://example.com/b', markdown: null, error: 'DNS error' },
    ];

    const { entries, errors } = processLibraryResults(lib, results, runId);
    expect(entries).toHaveLength(0);
    expect(errors.some((e) => e.message.includes('All URLs failed'))).toBe(true);
  });

  it('produces entries from successful URLs even when some fail', () => {
    const lib = makeLibrary('react', [
      'https://example.com/good',
      'https://example.com/bad',
    ]);
    const results: ScrapeUrlResult[] = [
      { url: 'https://example.com/good', markdown: '## v1.0.0\n\n- Works' },
      { url: 'https://example.com/bad', markdown: null, error: 'Failed' },
    ];

    const { entries, errors } = processLibraryResults(lib, results, runId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.version).toBe('1.0.0');
    // Per-URL error but NOT "all URLs failed"
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('Failed');
    expect(errors.some((e) => e.message.includes('All URLs failed'))).toBe(false);
  });

  it('assigns "unknown" version when markdown has no version headers', () => {
    const lib = makeLibrary('some-lib', ['https://example.com/notes']);
    const results: ScrapeUrlResult[] = [
      { url: 'https://example.com/notes', markdown: 'Just some release notes without headers.' },
    ];

    const { entries, errors } = processLibraryResults(lib, results, runId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.version).toBe('unknown');
    expect(errors).toHaveLength(0);
  });

  it('generates valid UUIDs for entry_id', () => {
    const lib = makeLibrary('lib', ['https://example.com/cl']);
    const results: ScrapeUrlResult[] = [
      { url: 'https://example.com/cl', markdown: '## v1.0.0\n\nContent' },
    ];

    const { entries } = processLibraryResults(lib, results, runId);
    expect(entries[0]!.entry_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('produces multiple entries from a single URL with multiple versions', () => {
    const lib = makeLibrary('lib', ['https://example.com/cl']);
    const md = '## v2.0.0\n\nBreaking\n\n## v1.1.0\n\nFeature\n\n## v1.0.0\n\nInitial';
    const results: ScrapeUrlResult[] = [
      { url: 'https://example.com/cl', markdown: md },
    ];

    const { entries, errors } = processLibraryResults(lib, results, runId);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.version)).toEqual(['2.0.0', '1.1.0', '1.0.0']);
    expect(errors).toHaveLength(0);
  });
});
