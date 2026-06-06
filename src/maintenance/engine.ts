import { dependencyRiskScanner, vulnerabilityIntelligenceScanner } from './dependency-scanner.js';
import { costScanner } from './cost-scanner.js';
import { firstRunScanner } from './first-run-scanner.js';
import { goScanner } from './go-scanner.js';
import { infraScanner } from './infra-scanner.js';
import { javaScanner } from './java-scanner.js';
import { javascriptScanner } from './javascript-scanner.js';
import { opsScanner } from './ops-scanner.js';
import { loadProjectContext } from './project-context.js';
import { buildScanResult } from './recommendation-engine.js';
import { pythonScanner } from './python-scanner.js';
import { rustScanner } from './rust-scanner.js';
import { runtimeScanner } from './runtime-scanner.js';
import { securityScanner } from './security-scanner.js';
import { serviceScanner } from './service-scanner.js';
import { getWhyItMatters } from './explainability.js';
import type { FindingCategory, MaintenanceFinding, ProjectContext, ScanResult, Scanner } from './types.js';
import { vibeSecurityScanner, vibeDependencyScanner } from './vibe-scanner.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { typosquattingScanner } from './typosquatting-scanner.js';

async function loadScannerPlugins(projectPath: string): Promise<Scanner[]> {
  const homeDir = os.homedir();
  const globalPluginsDir = path.join(homeDir, '.devbrief', 'plugins');
  const localPluginsDir = path.join(projectPath, '.devbrief', 'plugins');
  
  const dirs = [globalPluginsDir, localPluginsDir];
  const plugins: Scanner[] = [];

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
            const absolutePath = path.join(dir, file);
            const fileUrl = pathToFileURL(absolutePath).href;
            const module = await import(fileUrl);
            const scanner = module.default || module.scanner;
            if (scanner && typeof scanner.name === 'string' && typeof scanner.scan === 'function') {
              plugins.push(scanner);
            }
          }
        }
      } catch (err: any) {
        console.warn(`[engine] Failed to load plugin from ${dir}: ${err.message}`);
      }
    }
  }

  return plugins;
}

export const scannerRegistry: Record<string, Scanner[]> = {
  risk: [dependencyRiskScanner, vulnerabilityIntelligenceScanner, javascriptScanner, pythonScanner, rustScanner, goScanner, javaScanner, vibeDependencyScanner, typosquattingScanner],
  runtime: [runtimeScanner],
  infra: [infraScanner],
  security: [securityScanner, vibeSecurityScanner, typosquattingScanner],
  services: [serviceScanner],
  ops: [opsScanner],
  cost: [costScanner],
  doctor: [
    firstRunScanner,
    dependencyRiskScanner,
    vulnerabilityIntelligenceScanner,
    javascriptScanner,
    pythonScanner,
    rustScanner,
    goScanner,
    javaScanner,
    runtimeScanner,
    infraScanner,
    securityScanner,
    serviceScanner,
    opsScanner,
    costScanner,
    vibeSecurityScanner,
    vibeDependencyScanner,
    typosquattingScanner,
  ],
};

const scanCache = new Map<string, ScanResult>();

function scannerFailure(scanner: Scanner, error: unknown): MaintenanceFinding {
  return {
    id: `scanner-failure:${scanner.name}`,
    category: 'ops',
    label: 'REVIEW',
    title: `${scanner.name} scan failed`,
    summary: `${scanner.name} could not complete`,
    evidence: error instanceof Error ? error.message : 'unknown scanner failure',
    recommendation: 'investigate',
    urgency: 3,
    impact: 3,
    confidence: 8,
    effort: '20 min',
  };
}

async function getGitState(projectPath: string): Promise<{ head: string; status: string } | null> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: projectPath });
    const { stdout: headStdout } = await execAsync('git rev-parse HEAD', { cwd: projectPath });
    const { stdout: statusStdout } = await execAsync('git status --porcelain', { cwd: projectPath });
    return {
      head: headStdout.trim(),
      status: statusStdout.trim(),
    };
  } catch {
    return null;
  }
}

async function getCacheDir(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse --git-common-dir', { cwd: projectPath });
    const gitDir = stdout.trim();
    return path.resolve(projectPath, gitDir);
  } catch {
    const fallback = path.join(projectPath, '.devbrief');
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  }
}

interface PersistentCacheEntry {
  gitHead: string;
  gitStatus: string;
  command: string;
  result: ScanResult;
}

async function readPersistentCache(projectPath: string, command: string): Promise<ScanResult | null> {
  try {
    const gitState = await getGitState(projectPath);
    if (!gitState) return null;

    const cacheDir = await getCacheDir(projectPath);
    const cacheFile = path.join(cacheDir, `scan-cache-${command}.json`);

    if (fs.existsSync(cacheFile)) {
      const content = fs.readFileSync(cacheFile, 'utf-8');
      const entry = JSON.parse(content) as PersistentCacheEntry;

      if (
        entry.gitHead === gitState.head &&
        entry.gitStatus === '' &&
        gitState.status === '' &&
        entry.command === command
      ) {
        return entry.result;
      }
    }
  } catch {
    // Fail silently on cache read errors
  }
  return null;
}

async function writePersistentCache(projectPath: string, command: string, result: ScanResult): Promise<void> {
  try {
    const gitState = await getGitState(projectPath);
    if (!gitState) return;

    const cacheDir = await getCacheDir(projectPath);
    const cacheFile = path.join(cacheDir, `scan-cache-${command}.json`);

    const entry: PersistentCacheEntry = {
      gitHead: gitState.head,
      gitStatus: gitState.status,
      command,
      result,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // Fail silently on cache write errors
  }
}

export async function runMaintenanceScan(
  command: keyof typeof scannerRegistry,
  projectPath?: string,
): Promise<ScanResult> {
  const resolvedPath = path.resolve(projectPath ?? process.cwd());

  // Try reading persistent cache first (takes ~15ms)
  const cachedResult = await readPersistentCache(resolvedPath, command);
  if (cachedResult) return cachedResult;

  const context = await loadProjectContext(resolvedPath);
  const cacheKey = `${command}:${context.projectPath}:${context.fingerprint}`;
  const cached = scanCache.get(cacheKey);
  if (cached) return cached;

  const findings: MaintenanceFinding[] = [];

  const loadedPlugins = await loadScannerPlugins(resolvedPath);
  const activeScanners = [...scannerRegistry[command]];
  for (const plugin of loadedPlugins) {
    const categories: string[] = (plugin as any).categories || ['doctor'];
    if (categories.includes(command) || command === 'doctor') {
      activeScanners.push(plugin);
    }
  }

  for (const scanner of activeScanners) {
    try {
      const scannerFindings = await scanner.scan(context);
      for (const finding of scannerFindings) {
        finding.whyItMatters = getWhyItMatters(finding);
        findings.push(finding);
      }
    } catch (error) {
      const failureFinding = scannerFailure(scanner, error);
      failureFinding.whyItMatters = getWhyItMatters(failureFinding);
      findings.push(failureFinding);
    }
  }

  const result = buildScanResult(command, context.projectPath, findings, {
    dependencies: context.dependencies.length,
    files: context.files.length,
    packageManagers: context.profile.packageManagers,
    ecosystems: context.profile.ecosystems,
    projectKinds: context.profile.projectKinds,
    projectRoots: context.profile.projectRoots,
    runtimeIndicators: context.profile.runtimeIndicators.length,
    infraSignals: context.profile.infraSignals.length,
    securitySignals: context.profile.securitySignals.length,
    serviceSignals: context.profile.serviceSignals.length,
    scannedAt: new Date().toISOString(),
  });

  scanCache.set(cacheKey, result);
  await writePersistentCache(resolvedPath, command, result);
  return result;
}

export function categoryCommand(category: FindingCategory): keyof typeof scannerRegistry {
  if (category === 'dependency' || category === 'vulnerability' || category === 'continuity') {
    return 'risk';
  }
  if (category === 'service') return 'services';
  return category as keyof typeof scannerRegistry;
}

export { loadProjectContext };
export type { ProjectContext };
