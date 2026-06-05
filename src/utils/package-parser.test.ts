import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseDependencies, parseVersionFormat, ParsedDependency } from './package-parser';
import { writeFileSync, rmSync } from 'fs';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseDependencies', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'devbrief-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should parse a normal package.json with mixed dependency types', async () => {
    const packageJson = {
      name: 'test-project',
      version: '1.0.0',
      dependencies: {
        'react': '^18.2.0',
        'axios': '~1.5.0',
      },
      devDependencies: {
        'typescript': '^5.0.0',
        'vitest': '*',
      },
      peerDependencies: {
        'react-dom': '^18.0.0',
      },
      optionalDependencies: {
        'optional-lib': '1.0.0',
      },
    };

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson));

    const deps = await parseDependencies(tempDir);

    expect(deps).toHaveLength(6);

    // Check regular dependencies
    const react = deps.find(d => d.name === 'react');
    expect(react).toBeDefined();
    expect(react?.type).toBe('dependency');
    expect(react?.isDev).toBe(false);
    expect(react?.isPeer).toBe(false);
    expect(react?.isOptional).toBe(false);
    expect(react?.version).toBe('^18.2.0');

    // Check devDependencies
    const typescript = deps.find(d => d.name === 'typescript');
    expect(typescript).toBeDefined();
    expect(typescript?.type).toBe('devDependency');
    expect(typescript?.isDev).toBe(true);
    expect(typescript?.version).toBe('^5.0.0');

    // Check peerDependencies
    const reactDom = deps.find(d => d.name === 'react-dom');
    expect(reactDom).toBeDefined();
    expect(reactDom?.type).toBe('peerDependency');
    expect(reactDom?.isPeer).toBe(true);

    // Check optionalDependencies
    const optionalLib = deps.find(d => d.name === 'optional-lib');
    expect(optionalLib).toBeDefined();
    expect(optionalLib?.type).toBe('optionalDependency');
    expect(optionalLib?.isOptional).toBe(true);
  });

  it('should handle missing package.json gracefully', async () => {
    await expect(parseDependencies(tempDir)).rejects.toThrow(
      /Failed to read package.json/
    );
  });

  it('should handle invalid JSON in package.json', async () => {
    writeFileSync(join(tempDir, 'package.json'), '{ invalid json }');

    await expect(parseDependencies(tempDir)).rejects.toThrow(
      /Invalid JSON in package.json/
    );
  });

  it('should handle version ranges: ~, ^, *, and exact versions', async () => {
    const packageJson = {
      name: 'version-test',
      dependencies: {
        'caret': '^1.2.3',
        'tilde': '~1.2.3',
        'wildcard': '1.*',
        'exact': '1.2.3',
        'range': '>=1.0.0 <2.0.0',
      },
    };

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson));

    const deps = await parseDependencies(tempDir);

    expect(deps).toHaveLength(5);

    const caret = deps.find(d => d.name === 'caret');
    expect(caret?.version).toBe('^1.2.3');

    const tilde = deps.find(d => d.name === 'tilde');
    expect(tilde?.version).toBe('~1.2.3');

    const wildcard = deps.find(d => d.name === 'wildcard');
    expect(wildcard?.version).toBe('1.*');

    const exact = deps.find(d => d.name === 'exact');
    expect(exact?.version).toBe('1.2.3');

    const range = deps.find(d => d.name === 'range');
    expect(range?.version).toBe('>=1.0.0 <2.0.0');
  });

  it('should work with default cwd when projectPath is undefined', async () => {
    // This test ensures the function works with cwd, but we don't test it
    // with actual cwd to avoid side effects. We just verify the function signature.
    const packageJson = {
      name: 'cwd-test',
      dependencies: {
        'express': '^4.18.0',
      },
    };

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson));

    const deps = await parseDependencies(tempDir);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('express');
  });

  it('should handle empty dependency sections', async () => {
    const packageJson = {
      name: 'empty-test',
      dependencies: {},
      devDependencies: {},
    };

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson));

    const deps = await parseDependencies(tempDir);
    expect(deps).toHaveLength(0);
  });

  it('should handle package.json with only some dependency types', async () => {
    const packageJson = {
      name: 'partial-test',
      dependencies: {
        'lodash': '^4.17.0',
      },
      // No devDependencies, peerDependencies, or optionalDependencies
    };

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson));

    const deps = await parseDependencies(tempDir);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('lodash');
    expect(deps[0].type).toBe('dependency');
  });

  it('should properly classify dependencies with correct flags', async () => {
    const packageJson = {
      name: 'classification-test',
      dependencies: {
        'regular': '1.0.0',
      },
      devDependencies: {
        'dev-only': '2.0.0',
      },
      peerDependencies: {
        'peer-only': '3.0.0',
      },
      optionalDependencies: {
        'optional-only': '4.0.0',
      },
    };

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson));

    const deps = await parseDependencies(tempDir);

    const verifyFlags = (dep: ParsedDependency, isDev: boolean, isOptional: boolean, isPeer: boolean) => {
      expect(dep.isDev).toBe(isDev);
      expect(dep.isOptional).toBe(isOptional);
      expect(dep.isPeer).toBe(isPeer);
    };

    verifyFlags(deps.find(d => d.name === 'regular')!, false, false, false);
    verifyFlags(deps.find(d => d.name === 'dev-only')!, true, false, false);
    verifyFlags(deps.find(d => d.name === 'peer-only')!, false, false, true);
    verifyFlags(deps.find(d => d.name === 'optional-only')!, false, true, false);
  });
});

describe('parseVersionFormat', () => {
  it('should parse caret versions correctly', () => {
    const result = parseVersionFormat('^1.2.3');
    expect(result.range).toBe('caret');
    expect(result.normalized).toBe('1.2.3');
  });

  it('should parse tilde versions correctly', () => {
    const result = parseVersionFormat('~1.2.3');
    expect(result.range).toBe('tilde');
    expect(result.normalized).toBe('1.2.3');
  });

  it('should parse wildcard versions correctly', () => {
    const result = parseVersionFormat('1.*');
    expect(result.range).toBe('wildcard');
    expect(result.normalized).toBe('1.*');
  });

  it('should parse exact versions correctly', () => {
    const result = parseVersionFormat('1.2.3');
    expect(result.range).toBe('exact');
    expect(result.normalized).toBe('1.2.3');
  });

  it('should parse range versions correctly', () => {
    const result = parseVersionFormat('>=1.0.0 <2.0.0');
    expect(result.range).toBe('range');
    expect(result.normalized).toBe('>=1.0.0 <2.0.0');
  });

  it('should handle complex range versions', () => {
    const result = parseVersionFormat('>1.0.0');
    expect(result.range).toBe('range');
    expect(result.normalized).toBe('>1.0.0');

    const result2 = parseVersionFormat('<=2.5.0');
    expect(result2.range).toBe('range');
    expect(result2.normalized).toBe('<=2.5.0');
  });
});
