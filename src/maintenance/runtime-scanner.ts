import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';
import { daysUntil, majorOf } from './version-utils.js';

interface RuntimeEol {
  name: string;
  eol: string;
  upgradeTo: string;
}

const NODE_EOL: Record<number, RuntimeEol> = {
  16: { name: 'Node 16', eol: '2023-09-11', upgradeTo: 'Node 22 or 24 LTS' },
  18: { name: 'Node 18', eol: '2025-04-30', upgradeTo: 'Node 22 or 24 LTS' },
  20: { name: 'Node 20', eol: '2026-04-30', upgradeTo: 'Node 22 or 24 LTS' },
  22: { name: 'Node 22', eol: '2027-04-30', upgradeTo: 'Node 24 LTS when ready' },
  24: { name: 'Node 24', eol: '2028-04-30', upgradeTo: 'next LTS before EOL' },
};

const PYTHON_EOL: Record<string, RuntimeEol> = {
  '3.8': { name: 'Python 3.8', eol: '2024-10-07', upgradeTo: 'Python 3.12 or newer' },
  '3.9': { name: 'Python 3.9', eol: '2025-10-31', upgradeTo: 'Python 3.12 or newer' },
  '3.10': { name: 'Python 3.10', eol: '2026-10-31', upgradeTo: 'Python 3.12 or newer' },
  '3.11': { name: 'Python 3.11', eol: '2027-10-31', upgradeTo: 'Python 3.13 or newer later' },
};

const NATIVE_NODE_PACKAGES = new Set([
  'better-sqlite3',
  'bcrypt',
  'canvas',
  'esbuild',
  'node-sass',
  'sharp',
  'sqlite3',
]);

function runtimeFinding(
  id: string,
  runtime: RuntimeEol,
  files: string[],
  now = new Date(),
): MaintenanceFinding {
  const remaining = daysUntil(runtime.eol, now);
  const isEol = remaining < 0;
  const nearing = remaining <= 180;

  return {
    id,
    category: 'runtime',
    label: isEol ? 'EOL' : nearing ? 'UPGRADE SOON' : 'REVIEW',
    title: `${runtime.name} lifecycle`,
    summary: isEol
      ? `${runtime.name} is past EOL (${runtime.eol})`
      : `${runtime.name} reaches EOL on ${runtime.eol} (${remaining} days)`,
    evidence: `smallest safe path: ${runtime.upgradeTo}`,
    recommendation: isEol || nearing ? 'upgrade' : 'monitor',
    urgency: isEol ? 9 : nearing ? 7 : 3,
    impact: isEol ? 8 : nearing ? 6 : 3,
    confidence: 9,
    effort: isEol || nearing ? '1 hour+' : '20 min',
    files,
  };
}

function extractNodeRuntime(context: ProjectContext): Array<{ version: string; file: string }> {
  const versions: Array<{ version: string; file: string }> = [];
  const enginesNode = context.packageJson?.engines?.node;

  if (enginesNode) {
    versions.push({ version: enginesNode, file: 'package.json' });
  }

  for (const file of ['.nvmrc', '.node-version']) {
    const path = join(context.projectPath, file);
    if (existsSync(path)) {
      versions.push({ version: readFileSync(path, 'utf-8').trim(), file });
    }
  }

  for (const dockerFile of context.dockerFiles) {
    let content = '';
    try {
      content = readProjectFile(context, dockerFile);
    } catch {
      continue;
    }
    const match = content.match(/\bnode:(\d+(?:\.\d+)?)/);
    if (match) versions.push({ version: match[1], file: dockerFile });
  }

  for (const workflow of context.workflowFiles) {
    let content = '';
    try {
      content = readProjectFile(context, workflow);
    } catch {
      continue;
    }
    const match = content.match(/node-version:\s*['"]?(\d+(?:\.\d+)?)/);
    if (match) versions.push({ version: match[1], file: workflow });
  }

  return versions;
}

function extractPythonRuntime(context: ProjectContext): Array<{ version: string; file: string }> {
  const versions: Array<{ version: string; file: string }> = [];

  for (const file of context.files.filter((name) =>
    ['.python-version', 'runtime.txt', 'Dockerfile', 'pyproject.toml'].includes(name.split('/').pop() ?? name),
  )) {
    let content = '';
    try {
      content = readProjectFile(context, file);
    } catch {
      continue;
    }

    const name = file.split('/').pop() ?? file;
    const match = name === '.python-version'
      ? content.match(/(\d+\.\d+)/)
      : content.match(/python(?:-|:|=|~|\s)+["']?[~^>=<]*(\d+\.\d+)/i);
    if (match) versions.push({ version: match[1], file });
  }

  return versions;
}

export const runtimeScanner: Scanner = {
  name: 'runtime',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];

    for (const runtime of extractNodeRuntime(context)) {
      const major = majorOf(runtime.version);
      if (!major) continue;

      let eol = NODE_EOL[major];
      if (!eol && major < 16) {
        eol = { name: `Node ${major}`, eol: '2023-09-11', upgradeTo: 'Node 22 or 24 LTS' };
      }
      if (eol) {
        findings.push(runtimeFinding(`runtime:node:${runtime.file}:${major}`, eol, [runtime.file]));
      }
    }

    for (const runtime of extractPythonRuntime(context)) {
      let eol = PYTHON_EOL[runtime.version];
      if (!eol) {
        const val = parseFloat(runtime.version);
        if (!isNaN(val) && val < 3.8) {
          eol = { name: `Python ${runtime.version}`, eol: '2023-06-27', upgradeTo: 'Python 3.12 or newer' };
        }
      }
      if (eol) {
        findings.push(runtimeFinding(`runtime:python:${runtime.file}:${runtime.version}`, eol, [runtime.file]));
      }
    }

    const nativeDeps = context.dependencies.filter((dep) => NATIVE_NODE_PACKAGES.has(dep.name));
    if (nativeDeps.length > 0) {
      findings.push({
        id: 'runtime:native-node-deps',
        category: 'runtime',
        label: 'REVIEW',
        title: 'Native dependencies may affect runtime upgrades',
        summary: `${nativeDeps.map((dep) => dep.name).join(', ')} may need rebuilds on Node upgrades`,
        recommendation: 'review',
        urgency: 4,
        impact: 6,
        confidence: 8,
        effort: '20 min',
        packageName: nativeDeps[0].name,
        files: ['package.json'],
      });
    }

    if (findings.length === 0) {
      findings.push({
        id: 'runtime:safe',
        category: 'runtime',
        label: 'SAFE',
        title: 'No runtime lifecycle issue found',
        summary: 'no pinned EOL runtime detected',
        recommendation: 'ignore',
        urgency: 0,
        impact: 0,
        confidence: 7,
        effort: 'none',
        hiddenByDefault: true,
      });
    }

    return findings;
  },
};
