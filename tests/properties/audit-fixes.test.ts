import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stackAdd, upgradeCommand } from '../../src/cli/index.js';
import { findPackageUsage } from '../../src/maintenance/impact-analysis.js';
import { detectTailscaleIP } from '../../src/utils/network.js';
import { readProjectFile } from '../../src/maintenance/project-context.js';
import { classifyRisk } from '../../src/utils/risk-classifier.js';
import type { ParsedDependency } from '../../src/utils/package-parser.js';

// Mock config-io
vi.mock('../../src/utils/config-io.js', () => ({
  loadStackConfig: vi.fn(async () => ({ libraries: [] })),
  saveStackConfig: vi.fn(async () => {}),
  ensureDevbriefDir: vi.fn(async () => {}),
}));

// Mock project-context functions
vi.mock('../../src/maintenance/project-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/maintenance/project-context.js')>();
  return {
    ...actual,
    readProjectFile: vi.fn(),
  };
});

const mockedReadProjectFile = vi.mocked(readProjectFile);

// Mock vulnerability detector to return mock vulnerabilities
vi.mock('../../src/utils/vulnerability-detector.js', () => ({
  detectVulnerabilities: vi.fn(async () => [
    {
      packageName: 'express',
      affectedVersions: ['<4.19.0'],
      severity: 'CRITICAL',
      cveId: 'CVE-2024-12345',
      summary: 'Critical vuln description',
      remediationAvailable: true,
    },
  ]),
}));

describe('Audit Fixes Verification Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CLI Validations & Argument Injection Safeguards', () => {
    it('stackAdd throws an error on invalid URL protocol', async () => {
      await expect(stackAdd('react', ['ftp://example.com'])).rejects.toThrow(
        'Only HTTP/HTTPS URLs are supported',
      );
    });

    it('stackAdd throws an error on completely malformed URL', async () => {
      await expect(stackAdd('react', ['not-a-url'])).rejects.toThrow(
        'Please verify it is formatted correctly',
      );
    });

    it('upgradeCommand rejects package names starting with hyphens to prevent npm argument injection', async () => {
      await expect(upgradeCommand('--help')).rejects.toThrow(
        'Invalid npm package name format',
      );
      await expect(upgradeCommand('-d')).rejects.toThrow(
        'Invalid npm package name format',
      );
    });
  });

  describe('Non-JS/TS Import Usage Tracking', () => {
    it('findPackageUsage detects Python style package imports', () => {
      const mockContext = {
        sourceFiles: ['main.py', 'utils.py'],
        projectPath: '/dummy',
      } as any;

      mockedReadProjectFile.mockImplementation((ctx, file) => {
        if (file === 'main.py') {
          return 'import requests\nprint("hello")';
        }
        return 'from requests import get';
      });

      const matches = findPackageUsage(mockContext, 'requests');
      expect(matches).toContain('main.py');
      expect(matches).toContain('utils.py');
    });

    it('findPackageUsage detects Rust style use imports', () => {
      const mockContext = {
        sourceFiles: ['main.rs'],
        projectPath: '/dummy',
      } as any;

      mockedReadProjectFile.mockImplementation(() => {
        return 'use tokio::time::sleep;\nfn main() {}';
      });

      const matches = findPackageUsage(mockContext, 'tokio');
      expect(matches).toContain('main.rs');
    });
  });

  describe('Vulnerability Scanner Integration into Risk Classifier', () => {
    it('classifyRisk raises riskLevel to CRITICAL when active vulnerability is found in project dependencies', async () => {
      const userDeps: ParsedDependency[] = [
        {
          name: 'express',
          version: '4.18.2',
          type: 'dependency',
          isDev: false,
        },
      ];

      const result = await classifyRisk(
        'express',
        '4.18.2',
        '## v4.18.2\nSome release notes',
        userDeps,
      );

      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.severityScore).toBe(100); // CRITICAL severity
      expect(result.reasoning).toContain('Active security vulnerabilities detected in project');
      expect(result.recommendations[0]).toContain('Update immediately - active project vulnerability');
    });
  });

  describe('Tailscale IP Utility', () => {
    it('detectTailscaleIP falls back to env variable when set', () => {
      process.env.TAILSCALE_IP = '100.1.2.3';
      expect(detectTailscaleIP()).toBe('100.1.2.3');
    });
  });
});
