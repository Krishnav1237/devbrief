import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StackConfiguration } from '../models/index.js';

// Mock config-io before importing the module under test
const mockLoadStackConfig = vi.fn<() => Promise<StackConfiguration>>();
const mockSaveStackConfig = vi.fn<(config: StackConfiguration) => Promise<void>>();

vi.mock('../utils/config-io.js', () => ({
  loadStackConfig: (...args: unknown[]) => mockLoadStackConfig(...(args as [])),
  saveStackConfig: (...args: unknown[]) => mockSaveStackConfig(...(args as [StackConfiguration])),
}));

const { stackAdd, stackRemove, stackList } = await import('./index.js');

describe('stackAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveStackConfig.mockResolvedValue(undefined);
  });

  it('adds a new library to an empty config', async () => {
    mockLoadStackConfig.mockResolvedValue({ libraries: [] });

    await stackAdd('react', ['https://github.com/facebook/react/releases']);

    expect(mockSaveStackConfig).toHaveBeenCalledOnce();
    const saved = mockSaveStackConfig.mock.calls[0][0];
    expect(saved.libraries).toHaveLength(1);
    expect(saved.libraries[0].name).toBe('react');
    expect(saved.libraries[0].urls).toEqual(['https://github.com/facebook/react/releases']);
    expect(saved.libraries[0].added_at).toBeDefined();
    // Verify added_at is a valid ISO 8601 timestamp
    expect(new Date(saved.libraries[0].added_at).toISOString()).toBe(saved.libraries[0].added_at);
  });

  it('adds a new library alongside existing ones', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'vue', urls: ['https://github.com/vuejs/core/releases'], added_at: '2024-01-01T00:00:00.000Z' },
      ],
    });

    await stackAdd('react', ['https://github.com/facebook/react/releases']);

    const saved = mockSaveStackConfig.mock.calls[0][0];
    expect(saved.libraries).toHaveLength(2);
    expect(saved.libraries[0].name).toBe('vue');
    expect(saved.libraries[1].name).toBe('react');
  });

  it('upserts an existing library by replacing URLs', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'react', urls: ['https://old-url.com'], added_at: '2024-01-01T00:00:00.000Z' },
      ],
    });

    await stackAdd('react', ['https://new-url.com/releases', 'https://new-url.com/changelog']);

    const saved = mockSaveStackConfig.mock.calls[0][0];
    expect(saved.libraries).toHaveLength(1);
    expect(saved.libraries[0].name).toBe('react');
    expect(saved.libraries[0].urls).toEqual(['https://new-url.com/releases', 'https://new-url.com/changelog']);
  });

  it('preserves the original added_at timestamp on upsert', async () => {
    const originalTimestamp = '2024-01-15T10:30:00.000Z';
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'react', urls: ['https://old-url.com'], added_at: originalTimestamp },
      ],
    });

    await stackAdd('react', ['https://new-url.com']);

    const saved = mockSaveStackConfig.mock.calls[0][0];
    expect(saved.libraries[0].added_at).toBe(originalTimestamp);
  });

  it('does not affect other libraries when upserting', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'vue', urls: ['https://vue-url.com'], added_at: '2024-01-01T00:00:00.000Z' },
        { name: 'react', urls: ['https://old-react-url.com'], added_at: '2024-02-01T00:00:00.000Z' },
        { name: 'angular', urls: ['https://angular-url.com'], added_at: '2024-03-01T00:00:00.000Z' },
      ],
    });

    await stackAdd('react', ['https://new-react-url.com']);

    const saved = mockSaveStackConfig.mock.calls[0][0];
    expect(saved.libraries).toHaveLength(3);
    expect(saved.libraries[0]).toEqual({ name: 'vue', urls: ['https://vue-url.com'], added_at: '2024-01-01T00:00:00.000Z' });
    expect(saved.libraries[1].name).toBe('react');
    expect(saved.libraries[1].urls).toEqual(['https://new-react-url.com']);
    expect(saved.libraries[2]).toEqual({ name: 'angular', urls: ['https://angular-url.com'], added_at: '2024-03-01T00:00:00.000Z' });
  });
});

describe('stackRemove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveStackConfig.mockResolvedValue(undefined);
  });

  it('removes an existing library from the config', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'react', urls: ['https://github.com/facebook/react/releases'], added_at: '2024-01-01T00:00:00.000Z' },
      ],
    });

    await stackRemove('react');

    expect(mockSaveStackConfig).toHaveBeenCalledOnce();
    const saved = mockSaveStackConfig.mock.calls[0][0];
    expect(saved.libraries).toHaveLength(0);
  });

  it('removes only the target library, leaving others intact', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'vue', urls: ['https://vue-url.com'], added_at: '2024-01-01T00:00:00.000Z' },
        { name: 'react', urls: ['https://react-url.com'], added_at: '2024-02-01T00:00:00.000Z' },
        { name: 'angular', urls: ['https://angular-url.com'], added_at: '2024-03-01T00:00:00.000Z' },
      ],
    });

    await stackRemove('react');

    const saved = mockSaveStackConfig.mock.calls[0][0];
    expect(saved.libraries).toHaveLength(2);
    expect(saved.libraries[0]).toEqual({ name: 'vue', urls: ['https://vue-url.com'], added_at: '2024-01-01T00:00:00.000Z' });
    expect(saved.libraries[1]).toEqual({ name: 'angular', urls: ['https://angular-url.com'], added_at: '2024-03-01T00:00:00.000Z' });
  });

  it('throws an error when removing a library that does not exist', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'react', urls: ['https://react-url.com'], added_at: '2024-01-01T00:00:00.000Z' },
      ],
    });

    await expect(stackRemove('nonexistent')).rejects.toThrow(
      'Library "nonexistent" not found in the stack configuration.',
    );
    expect(mockSaveStackConfig).not.toHaveBeenCalled();
  });

  it('throws an error when removing from an empty config', async () => {
    mockLoadStackConfig.mockResolvedValue({ libraries: [] });

    await expect(stackRemove('react')).rejects.toThrow(
      'Library "react" not found in the stack configuration.',
    );
    expect(mockSaveStackConfig).not.toHaveBeenCalled();
  });
});

describe('stackList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a helpful message when no libraries are configured', async () => {
    mockLoadStackConfig.mockResolvedValue({ libraries: [] });

    const output = await stackList();

    expect(output).toBe('No libraries configured. Use `devbrief stack add` to add libraries.');
  });

  it('returns a formatted table with a single library', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'react', urls: ['https://github.com/facebook/react/releases'], added_at: '2024-01-01T00:00:00.000Z' },
      ],
    });

    const output = await stackList();

    expect(output).toContain('Library');
    expect(output).toContain('URLs');
    expect(output).toContain('react');
    expect(output).toContain('https://github.com/facebook/react/releases');
  });

  it('returns a formatted table with multiple libraries', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'react', urls: ['https://github.com/facebook/react/releases'], added_at: '2024-01-01T00:00:00.000Z' },
        { name: 'vue', urls: ['https://github.com/vuejs/core/releases'], added_at: '2024-02-01T00:00:00.000Z' },
      ],
    });

    const output = await stackList();
    const lines = output.split('\n');

    // Header + separator + 2 data rows
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('Library');
    expect(lines[0]).toContain('URLs');
    // Separator line
    expect(lines[1]).toContain('─');
    // Data rows
    expect(lines[2]).toContain('react');
    expect(lines[3]).toContain('vue');
  });

  it('displays multiple URLs for a library as comma-separated', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        {
          name: 'react',
          urls: ['https://github.com/facebook/react/releases', 'https://react.dev/changelog'],
          added_at: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const output = await stackList();

    expect(output).toContain('https://github.com/facebook/react/releases, https://react.dev/changelog');
  });

  it('aligns columns based on the longest library name', async () => {
    mockLoadStackConfig.mockResolvedValue({
      libraries: [
        { name: 'react', urls: ['https://react-url.com'], added_at: '2024-01-01T00:00:00.000Z' },
        { name: 'a-very-long-library-name', urls: ['https://long-url.com'], added_at: '2024-02-01T00:00:00.000Z' },
      ],
    });

    const output = await stackList();
    const lines = output.split('\n');

    // The "react" row should be padded to match the longest name
    const reactLine = lines.find((l) => l.includes('react') && !l.includes('a-very'));
    const longLine = lines.find((l) => l.includes('a-very-long-library-name'));

    expect(reactLine).toBeDefined();
    expect(longLine).toBeDefined();

    // Both URL columns should start at the same position
    const reactUrlStart = reactLine!.indexOf('https://react-url.com');
    const longUrlStart = longLine!.indexOf('https://long-url.com');
    expect(reactUrlStart).toBe(longUrlStart);
  });
});
