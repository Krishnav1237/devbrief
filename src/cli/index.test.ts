import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { StackConfiguration } from '../models/index.js';

// Mock config-io before importing the module under test
const mockLoadStackConfig = vi.fn<() => Promise<StackConfiguration>>();
const mockSaveStackConfig = vi.fn<(config: StackConfiguration) => Promise<void>>();

vi.mock('../utils/config-io.js', () => ({
  loadStackConfig: (...args: unknown[]) => mockLoadStackConfig(...(args as [])),
  saveStackConfig: (...args: unknown[]) => mockSaveStackConfig(...(args as [StackConfiguration])),
}));

const mockRunMaintenanceScan = vi.fn();
vi.mock('../maintenance/engine.js', () => ({
  runMaintenanceScan: (...args: any[]) => mockRunMaintenanceScan(...args),
}));

const mockExec = vi.fn();
let mockGitStatusStdout = '';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: (...args: any[]) => {
      const cmd = args[0];
      mockExec(...args);
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        if (cmd === 'git status --porcelain') {
          cb(null, { stdout: mockGitStatusStdout });
        } else {
          cb(null, { stdout: 'Mocked upgrade output' });
        }
      }
    }
  };
});

const { stackAdd, stackRemove, stackList, fixCommand } = await import('./index.js');

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

describe('fixCommand', () => {
  const tempDir = path.resolve(process.cwd(), 'temp-fix-test');

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitStatusStdout = '';
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('requires safeOnly option to run', async () => {
    const res = await fixCommand({ path: tempDir });
    expect(res).toContain('REVIEW: use `devbrief fix --safe-only`');
  });

  it('handles empty safe fixes gracefully', async () => {
    mockRunMaintenanceScan.mockResolvedValue({
      findings: [],
    });
    const res = await fixCommand({ path: tempDir, safeOnly: true });
    expect(res).toContain('SAFE: no high-confidence automatic fix found');
  });

  it('executes safe fixes correctly for npm projects', async () => {
    // Write package.json and package-lock.json to mock npm project
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{}', 'utf-8');

    mockRunMaintenanceScan.mockResolvedValue({
      findings: [
        {
          id: 'vuln:lodash',
          category: 'vulnerability',
          label: 'ACTION REQUIRED',
          title: 'lodash vuln',
          summary: 'lodash vuln',
          recommendation: 'remediate',
          urgency: 10,
          impact: 9,
          confidence: 9,
          effort: '5 min',
          packageName: 'lodash',
          files: ['package.json'],
        },
      ],
    });

    const res = await fixCommand({ path: tempDir, safeOnly: true });
    expect(res).toContain('Upgrading package: lodash using npm in .');
    expect(res).toContain('SUCCESS: Processed 1 safe fixes');
    expect(res).toContain('Modified packages: lodash (npm)');
    expect(res).toContain('Files changed: package.json');

    expect(mockExec).toHaveBeenCalled();
  });

  it('handles monorepo workspaces and executes updates in package subdirectories', async () => {
    const subAppDir = path.join(tempDir, 'apps', 'web');
    fs.mkdirSync(subAppDir, { recursive: true });
    fs.writeFileSync(path.join(subAppDir, 'package.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(subAppDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0', 'utf-8');

    mockRunMaintenanceScan.mockResolvedValue({
      findings: [
        {
          id: 'vuln:axios',
          category: 'vulnerability',
          label: 'ACTION REQUIRED',
          title: 'axios vuln',
          summary: 'axios vuln',
          recommendation: 'upgrade',
          urgency: 10,
          impact: 9,
          confidence: 9,
          effort: '5 min',
          packageName: 'axios',
          files: ['apps/web/package.json'],
        },
      ],
    });

    const res = await fixCommand({ path: tempDir, safeOnly: true });
    expect(res).toContain('Upgrading package: axios using pnpm in apps/web');
    expect(res).toContain('SUCCESS: Processed 1 safe fixes');
    expect(res).toContain('Modified packages: axios (pnpm)');
    expect(res).toContain('Files changed: apps/web/package.json');

    expect(mockExec).toHaveBeenCalled();
  });

  it('supports Rust (cargo) workspace safe fixes', async () => {
    const rustDir = path.join(tempDir, 'packages', 'rust-lib');
    fs.mkdirSync(rustDir, { recursive: true });
    fs.writeFileSync(path.join(rustDir, 'Cargo.toml'), '[package]', 'utf-8');

    mockRunMaintenanceScan.mockResolvedValue({
      findings: [
        {
          id: 'vuln:serde',
          category: 'vulnerability',
          label: 'ACTION REQUIRED',
          title: 'serde vuln',
          summary: 'serde vuln',
          recommendation: 'upgrade',
          urgency: 10,
          impact: 9,
          confidence: 9,
          effort: '5 min',
          packageName: 'serde',
          files: ['packages/rust-lib/Cargo.toml'],
        },
      ],
    });

    const res = await fixCommand({ path: tempDir, safeOnly: true });
    expect(res).toContain('Upgrading Rust crate: serde in packages/rust-lib');
    expect(res).toContain('SUCCESS: Processed 1 safe fixes');
    expect(res).toContain('Modified packages: serde (cargo)');
    expect(res).toContain('Files changed: packages/rust-lib/Cargo.toml');
  });

  it('supports Go modules workspace safe fixes', async () => {
    const goDir = path.join(tempDir, 'packages', 'go-lib');
    fs.mkdirSync(goDir, { recursive: true });
    fs.writeFileSync(path.join(goDir, 'go.mod'), 'module go-lib', 'utf-8');

    mockRunMaintenanceScan.mockResolvedValue({
      findings: [
        {
          id: 'vuln:uuid',
          category: 'vulnerability',
          label: 'ACTION REQUIRED',
          title: 'uuid vuln',
          summary: 'uuid vuln',
          recommendation: 'upgrade',
          urgency: 10,
          impact: 9,
          confidence: 9,
          effort: '5 min',
          packageName: 'github.com/google/uuid',
          files: ['packages/go-lib/go.mod'],
        },
      ],
    });

    const res = await fixCommand({ path: tempDir, safeOnly: true });
    expect(res).toContain('Upgrading Go module: github.com/google/uuid in packages/go-lib');
    expect(res).toContain('SUCCESS: Processed 1 safe fixes');
    expect(res).toContain('Modified packages: github.com/google/uuid (go)');
    expect(res).toContain('Files changed: packages/go-lib/go.mod');
  });

  it('supports Python (pip) requirements rewriting safe fixes', async () => {
    const pythonDir = path.join(tempDir, 'packages', 'py-app');
    fs.mkdirSync(pythonDir, { recursive: true });
    fs.writeFileSync(path.join(pythonDir, 'requirements.txt'), 'requests==2.31.0\n', 'utf-8');

    mockRunMaintenanceScan.mockResolvedValue({
      findings: [
        {
          id: 'vuln:requests',
          category: 'vulnerability',
          label: 'ACTION REQUIRED',
          title: 'requests vuln',
          summary: 'requests vuln',
          recommendation: 'upgrade',
          urgency: 10,
          impact: 9,
          confidence: 9,
          effort: '5 min',
          packageName: 'requests',
          files: ['packages/py-app/requirements.txt'],
        },
      ],
    });

    const registryClient = await import('../utils/registry-client.js');
    const registrySpy = vi.spyOn(registryClient, 'fetchWithRegistryClient');
    registrySpy.mockResolvedValue({ info: { version: '2.32.3' } });

    const res = await fixCommand({ path: tempDir, safeOnly: true });
    expect(res).toContain('Upgrading Python package: requests in packages/py-app');
    expect(res).toContain('Rewrote packages/py-app/requirements.txt to set requests==2.32.3');
    expect(res).toContain('SUCCESS: Processed 1 safe fixes');
    expect(res).toContain('Modified packages: requests (pip)');
    expect(res).toContain('Files changed: packages/py-app/requirements.txt');

    const updatedManifest = fs.readFileSync(path.join(pythonDir, 'requirements.txt'), 'utf-8');
    expect(updatedManifest).toContain('requests==2.32.3');

    registrySpy.mockRestore();
  });

  it('aborts and warns if there are uncommitted changes in the repository', async () => {
    mockGitStatusStdout = 'M package.json'; // simulate modified file
    const res = await fixCommand({ path: tempDir, safeOnly: true });
    expect(res).toContain('REVIEW: Uncommitted changes detected in repository.');
    expect(res).toContain('Please commit or stash your work');
    expect(mockRunMaintenanceScan).not.toHaveBeenCalled();
  });
});
