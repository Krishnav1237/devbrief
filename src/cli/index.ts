#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadStackConfig, saveStackConfig } from '../utils/config-io.js';
import type { StackConfiguration, StackLibrary } from '../models/index.js';
import { validateEnvVars } from './env-validation.js';
import { runPipeline } from './run-pipeline.js';
import { runMaintenanceScan } from '../maintenance/engine.js';
import { formatInboxResult, formatQuietScanResult, formatScanResult, formatUpgradeRecommendation, formatWeeklyResult, scanExitCode, formatMarkdownResult } from '../maintenance/output.js';
import { adviseUpgrade } from '../maintenance/upgrade-advisor.js';
import { fetchWithRegistryClient } from '../utils/registry-client.js';

const execAsync = promisify(exec);

interface ScanCommandOptions {
  path?: string;
  expanded?: boolean;
  json?: boolean;
  quiet?: boolean;
  exitCode?: boolean;
  format?: 'text' | 'markdown' | 'json' | 'quiet';
}

interface UpgradeCommandOptions {
  path?: string;
  target?: string;
  json?: boolean;
  quiet?: boolean;
  exitCode?: boolean;
}

/**
 * Lists all libraries in the stack configuration as a formatted table.
 * Returns the formatted output string.
 */
export async function stackList(): Promise<string> {
  const config = await loadStackConfig();

  if (config.libraries.length === 0) {
    return 'No libraries configured. Use `devbrief stack add` to add libraries.';
  }

  const lines: string[] = [];

  // Calculate column widths
  const nameHeader = 'Library';
  const urlsHeader = 'URLs';
  const maxNameLen = Math.max(
    nameHeader.length,
    ...config.libraries.map((lib) => lib.name.length),
  );

  // Header
  lines.push(`${nameHeader.padEnd(maxNameLen)}  ${urlsHeader}`);
  lines.push(`${'─'.repeat(maxNameLen)}  ${'─'.repeat(urlsHeader.length)}`);

  // Rows
  for (const lib of config.libraries) {
    const urlsStr = lib.urls.join(', ');
    lines.push(`${lib.name.padEnd(maxNameLen)}  ${urlsStr}`);
  }

  return lines.join('\n');
}

/**
 * Removes a library from the stack configuration.
 * Throws an error if the library is not found.
 */
export async function stackRemove(libraryName: string): Promise<void> {
  const config = await loadStackConfig();

  const existingIndex = config.libraries.findIndex(
    (lib) => lib.name === libraryName,
  );

  if (existingIndex === -1) {
    throw new Error(`Library "${libraryName}" not found in the stack configuration.`);
  }

  config.libraries.splice(existingIndex, 1);
  await saveStackConfig(config);
}

/**
 * Adds or updates a library in the stack configuration.
 * If the library already exists, replaces its URLs but keeps the original added_at timestamp.
 * If the library is new, adds it with the current timestamp.
 */
export async function stackAdd(libraryName: string, urls: string[]): Promise<void> {
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      throw new Error(`Invalid URL: "${url}". Please verify it is formatted correctly.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid protocol: "${parsed.protocol}". Only HTTP/HTTPS URLs are supported.`);
    }
  }

  const config = await loadStackConfig();

  const existingIndex = config.libraries.findIndex(
    (lib) => lib.name === libraryName,
  );

  if (existingIndex !== -1) {
    // Upsert: replace URLs, keep original added_at
    config.libraries[existingIndex] = {
      ...config.libraries[existingIndex],
      urls,
    };
  } else {
    // New entry
    const entry: StackLibrary = {
      name: libraryName,
      urls,
      added_at: new Date().toISOString(),
    };
    config.libraries.push(entry);
  }

  await saveStackConfig(config);
}

export async function scanCommand(
  command: 'risk' | 'runtime' | 'infra' | 'security' | 'services' | 'ops' | 'cost' | 'doctor',
  options?: ScanCommandOptions,
): Promise<string> {
  const result = await runMaintenanceScan(command, options?.path);
  if (options?.json) return JSON.stringify(result, null, 2);
  if (options?.quiet) return formatQuietScanResult(result);
  return formatScanResult(result, { expanded: options?.expanded });
}

export async function upgradeCommand(
  packageName: string,
  options?: UpgradeCommandOptions,
): Promise<string> {
  const NPM_PACKAGE_NAME_REGEX = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
  if (!NPM_PACKAGE_NAME_REGEX.test(packageName) || packageName.startsWith('-')) {
    throw new Error(`Invalid npm package name format: "${packageName}"`);
  }

  const advice = await adviseUpgrade(packageName, {
    projectPath: options?.path,
    target: options?.target,
  });

  if (options?.json) return JSON.stringify(advice, null, 2);
  if (options?.quiet) return `${advice.verdict}: ${packageName}\nEffort: ${advice.effort}`;

  return formatUpgradeRecommendation(
    packageName,
    advice.verdict,
    advice.findings,
    advice.effort,
    {
      installed: advice.installed,
      target: advice.target,
    },
  );
}

function setScanExitCode(resultCode: 0 | 1 | 2, enabled?: boolean): void {
  if (enabled) process.exitCode = resultCode;
}

async function printScanCommand(
  command: 'risk' | 'runtime' | 'infra' | 'security' | 'services' | 'ops' | 'cost' | 'doctor',
  options: ScanCommandOptions,
): Promise<void> {
  const result = await runMaintenanceScan(command, options.path);
  const format = options.format || (options.json ? 'json' : options.quiet ? 'quiet' : 'text');
  
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === 'quiet') {
    console.log(formatQuietScanResult(result));
  } else if (format === 'markdown') {
    console.log(formatMarkdownResult(result));
  } else {
    console.log(formatScanResult(result, { expanded: options.expanded }));
  }
  setScanExitCode(scanExitCode(result), options.exitCode);
}

async function printUpgradeCommand(packageName: string, options: UpgradeCommandOptions): Promise<void> {
  const NPM_PACKAGE_NAME_REGEX = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
  if (!NPM_PACKAGE_NAME_REGEX.test(packageName)) {
    throw new Error(`Invalid npm package name format: "${packageName}"`);
  }

  const advice = await adviseUpgrade(packageName, {
    projectPath: options.path,
    target: options.target,
  });

  if (options.json) {
    console.log(JSON.stringify(advice, null, 2));
  } else if (options.quiet) {
    console.log(`${advice.verdict}: ${packageName}\nEffort: ${advice.effort}`);
  } else {
    console.log(formatUpgradeRecommendation(
      packageName,
      advice.verdict,
      advice.findings,
      advice.effort,
      {
        installed: advice.installed,
        target: advice.target,
      },
    ));
  }

  if (options.exitCode) {
    process.exitCode = advice.verdict === 'SAFE TO UPGRADE'
      ? 0
      : advice.verdict === 'UPGRADE WITH REVIEW'
        ? 1
        : 2;
  }
}

export async function inboxCommand(options?: { path?: string }): Promise<string> {
  const result = await runMaintenanceScan('doctor', options?.path);
  return formatInboxResult(result);
}

export async function weeklyCommand(options?: { path?: string }): Promise<string> {
  const result = await runMaintenanceScan('doctor', options?.path);
  return formatWeeklyResult(result);
}

function detectPackageManager(dir: string, rootDir: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  let current = dir;
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(current, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(current, 'bun.lockb'))) return 'bun';
    if (fs.existsSync(path.join(current, 'package-lock.json'))) return 'npm';
    if (current === rootDir || current === path.dirname(current)) break;
    current = path.dirname(current);
  }
  return 'npm'; // Default
}

async function fixPythonDependency(manifestPath: string, pkg: string): Promise<string | null> {
  const data = await fetchWithRegistryClient<any>(`https://pypi.org/pypi/${pkg}/json`);
  const latest = data?.info?.version;
  if (!latest) return null;

  if (fs.existsSync(manifestPath)) {
    let content = fs.readFileSync(manifestPath, 'utf-8');
    const regex = new RegExp(`^(${pkg})([<>=!~]=?.*)$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `$1==${latest}`);
      fs.writeFileSync(manifestPath, content, 'utf-8');
      return latest;
    }
  }
  return null;
}

export async function fixCommand(options?: { path?: string; safeOnly?: boolean }): Promise<string> {
  if (!options?.safeOnly) {
    return 'REVIEW: use `devbrief fix --safe-only` so risky upgrades are never applied silently';
  }

  const projectPath = options.path ? path.resolve(options.path) : process.cwd();

  // Check if git directory has uncommitted changes
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd: projectPath });
    if (stdout.trim().length > 0) {
      return [
        'REVIEW: Uncommitted changes detected in repository.',
        'Please commit or stash your work before running the fix command.',
      ].join('\n');
    }
  } catch (err: any) {
    const isGitRepoError = err.message && (
      err.message.includes('not a git repository') ||
      err.message.includes('ENOENT') ||
      err.message.includes('command not found')
    );
    if (!isGitRepoError) {
      return `Error checking git repository status: ${err.message}`;
    }
  }

  const result = await runMaintenanceScan('doctor', projectPath);
  const safeFixes = result.findings.filter((finding) =>
    (finding.recommendation === 'remediate' || finding.recommendation === 'upgrade')
    && finding.confidence >= 8
    && finding.effort === '5 min'
    && finding.packageName
  );

  if (safeFixes.length === 0) {
    return [
      'SAFE: no high-confidence automatic fix found',
      'No files changed.',
      'Next: run `devbrief doctor --expanded` to review evidence.',
    ].join('\n');
  }

  const lines: string[] = [];
  const updatedPackages: string[] = [];
  const modifiedFiles = new Set<string>();

  for (const fix of safeFixes) {
    const pkg = fix.packageName!;
    
    // Resolve which manifest defines this dependency
    const manifestFile = fix.files?.find((file) =>
      file.endsWith('package.json') ||
      file.endsWith('Cargo.toml') ||
      file.endsWith('go.mod') ||
      file.endsWith('requirements.txt')
    );

    const relativeManifestPath = manifestFile || 'package.json';
    const absoluteManifestPath = path.join(projectPath, relativeManifestPath);
    const manifestDir = path.dirname(absoluteManifestPath);

    if (relativeManifestPath.endsWith('package.json')) {
      const pkgManager = detectPackageManager(manifestDir, projectPath);
      
      lines.push(`Upgrading package: ${pkg} using ${pkgManager} in ${path.relative(projectPath, manifestDir) || '.'}...`);
      
      let cmd = '';
      if (pkgManager === 'npm') {
        cmd = `npm install ${pkg}@latest --no-audit`;
      } else if (pkgManager === 'pnpm') {
        cmd = `pnpm add ${pkg}@latest`;
      } else if (pkgManager === 'yarn') {
        cmd = `yarn add ${pkg}@latest`;
      } else if (pkgManager === 'bun') {
        cmd = `bun add ${pkg}@latest`;
      }

      try {
        const { stdout } = await execAsync(cmd, { cwd: manifestDir });
        if (stdout.trim()) lines.push(stdout.trim());
        updatedPackages.push(`${pkg} (${pkgManager})`);
        modifiedFiles.add(relativeManifestPath);
      } catch (err: any) {
        lines.push(`Failed to upgrade ${pkg} in ${manifestDir}: ${err.message}`);
      }
    } else if (relativeManifestPath.endsWith('Cargo.toml')) {
      lines.push(`Upgrading Rust crate: ${pkg} in ${path.relative(projectPath, manifestDir) || '.'}...`);
      try {
        const { stdout } = await execAsync(`cargo add ${pkg}`, { cwd: manifestDir });
        if (stdout.trim()) lines.push(stdout.trim());
        updatedPackages.push(`${pkg} (cargo)`);
        modifiedFiles.add(relativeManifestPath);
      } catch (err: any) {
        lines.push(`Failed to upgrade Rust crate ${pkg} in ${manifestDir}: ${err.message}`);
      }
    } else if (relativeManifestPath.endsWith('go.mod')) {
      lines.push(`Upgrading Go module: ${pkg} in ${path.relative(projectPath, manifestDir) || '.'}...`);
      try {
        const { stdout } = await execAsync(`go get ${pkg}@latest`, { cwd: manifestDir });
        if (stdout.trim()) lines.push(stdout.trim());
        updatedPackages.push(`${pkg} (go)`);
        modifiedFiles.add(relativeManifestPath);
      } catch (err: any) {
        lines.push(`Failed to upgrade Go module ${pkg} in ${manifestDir}: ${err.message}`);
      }
    } else if (relativeManifestPath.endsWith('requirements.txt')) {
      lines.push(`Upgrading Python package: ${pkg} in ${path.relative(projectPath, manifestDir) || '.'}...`);
      try {
        const targetVersion = await fixPythonDependency(absoluteManifestPath, pkg);
        if (targetVersion) {
          lines.push(`Rewrote ${relativeManifestPath} to set ${pkg}==${targetVersion}`);
          
          // Try to run pip install locally if user has it installed
          try {
            await execAsync(`pip install ${pkg}==${targetVersion}`, { cwd: manifestDir });
          } catch {
            // Ignore if local pip environment setup is not present
          }
          
          updatedPackages.push(`${pkg} (pip)`);
          modifiedFiles.add(relativeManifestPath);
        } else {
          lines.push(`Could not resolve latest version for Python package ${pkg}`);
        }
      } catch (err: any) {
        lines.push(`Failed to upgrade Python package ${pkg} in ${manifestDir}: ${err.message}`);
      }
    }
  }

  lines.push(`\nSUCCESS: Processed ${safeFixes.length} safe fixes.`);
  if (updatedPackages.length > 0) {
    lines.push(`Modified packages: ${updatedPackages.join(', ')}`);
    lines.push(`Files changed: ${[...modifiedFiles].join(', ')}`);
  } else {
    lines.push('No packages were modified successfully.');
  }

  return lines.join('\n');
}

// Helper wrapper to handle async action rejections
function runAction(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(`Error:`, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('devbrief')
    .description('Open-source maintenance intelligence engine for developers')
    .version('0.1.0')
    .configureHelp({
      formatHelp: () => {
        const primary = [
          ['doctor', 'Run the smart maintenance radar and show what needs attention first'],
          ['upgrade <package>', 'Advise whether a dependency upgrade is safe for this project'],
          ['runtime', 'Checks runtime EOL lifecycle state (alias: node-upgrade)'],
          ['inbox', 'Lists only urgent items and quick safe wins'],
        ];

        const secondary = [
          ['risk', 'Scan dependency and vulnerability risk'],
          ['infra', 'Check Docker, Compose, and CI runner configurations'],
          ['security', 'Check security posture (committed .env, wildcard CORS, debug flags)'],
          ['services', 'Detect drift in third-party API SDKs'],
          ['weekly', 'Builds a compact weekly plan'],
          ['fix', 'Remediates low-risk, high-confidence local issues'],
        ];

        const legacy = [
          ['stack', 'Manage the library stack configuration'],
          ['run', 'Run the legacy release briefing pipeline manually'],
        ];

        const fmt = (list: string[][]) =>
          list.map(([name, desc]) => `  ${name.padEnd(22)} ${desc}`).join('\n');

        return [
          `Usage: devbrief [command] [options]`,
          '',
          `Open-source maintenance intelligence engine for developers`,
          '',
          `PRIMARY COMMANDS`,
          fmt(primary),
          '',
          `SECONDARY COMMANDS`,
          fmt(secondary),
          '',
          `LEGACY COMMANDS (isolated compatibility only)`,
          fmt(legacy),
          '',
          `Options:`,
          `  -v, --version          output the version number`,
          `  -h, --help             display help for command`,
          '',
          `Run 'devbrief [command] --help' for details on a specific command.`,
        ].join('\n');
      }
    });

  program
    .command('doctor')
    .description('Run the smart maintenance radar and show what needs attention first')
    .option('--path <path>', 'Project path to scan')
    .option('--expanded', 'Show hidden low-signal findings too')
    .option('--json', 'Print machine-readable JSON')
    .option('--quiet', 'Print only summary, health, and next action')
    .option('--exit-code', 'Use automation exit codes: 0 safe, 1 review, 2 risky')
    .option('--format <format>', 'Output format: text, markdown, json, quiet')
    .addHelpText('after', `
Examples:
  $ devbrief doctor
  $ devbrief doctor --path ../my-app
  $ devbrief doctor --expanded
  $ devbrief doctor --json
`)
    .action(runAction(async (options: ScanCommandOptions) => {
      await printScanCommand('doctor', options);
    }));

  program
    .command('risk')
    .description('Scan dependency and vulnerability risk')
    .option('--path <path>', 'Project path to scan')
    .option('--expanded', 'Show hidden low-signal findings too')
    .option('--json', 'Print machine-readable JSON')
    .option('--quiet', 'Print only summary, health, and next action')
    .option('--exit-code', 'Use automation exit codes: 0 safe, 1 review, 2 risky')
    .option('--format <format>', 'Output format: text, markdown, json, quiet')
    .action(runAction(async (options: ScanCommandOptions) => {
      await printScanCommand('risk', options);
    }));

  program
    .command('upgrade')
    .description('Advise whether a dependency upgrade is safe for this project')
    .argument('<package>', 'Package to evaluate')
    .option('--target <version>', 'Target version to evaluate')
    .option('--path <path>', 'Project path to scan')
    .option('--json', 'Print machine-readable JSON')
    .option('--quiet', 'Print only verdict and effort')
    .option('--exit-code', 'Use automation exit codes: 0 safe, 1 review, 2 avoid')
    .addHelpText('after', `
Examples:
  $ devbrief upgrade express
  $ devbrief upgrade express --target 5.0.0
  $ devbrief upgrade typescript --path packages/web
`)
    .action(runAction(async (packageName: string, options: UpgradeCommandOptions) => {
      await printUpgradeCommand(packageName, options);
    }));

  for (const command of ['runtime', 'infra', 'security', 'services'] as const) {
    program
      .command(command)
      .description(`Run the ${command} maintenance scan`)
      .option('--path <path>', 'Project path to scan')
      .option('--expanded', 'Show hidden low-signal findings too')
      .option('--json', 'Print machine-readable JSON')
      .option('--quiet', 'Print only summary, health, and next action')
      .option('--exit-code', 'Use automation exit codes: 0 safe, 1 review, 2 risky')
      .option('--format <format>', 'Output format: text, markdown, json, quiet')
      .action(runAction(async (options: ScanCommandOptions) => {
        await printScanCommand(command, options);
      }));
  }

  program
    .command('node-upgrade')
    .description('Alias for runtime upgrade guidance')
    .option('--path <path>', 'Project path to scan')
    .option('--expanded', 'Show hidden low-signal findings too')
    .option('--json', 'Print machine-readable JSON')
    .option('--quiet', 'Print only summary, health, and next action')
    .option('--exit-code', 'Use automation exit codes: 0 safe, 1 review, 2 risky')
    .option('--format <format>', 'Output format: text, markdown, json, quiet')
    .action(runAction(async (options: ScanCommandOptions) => {
      await printScanCommand('runtime', options);
    }));

  program
    .command('inbox')
    .description('Show the current maintenance inbox')
    .option('--path <path>', 'Project path to scan')
    .option('--json', 'Print machine-readable JSON')
    .option('--quiet', 'Print only summary, health, and next action')
    .option('--exit-code', 'Use automation exit codes: 0 safe, 1 review, 2 risky')
    .action(runAction(async (options: ScanCommandOptions) => {
      const result = await runMaintenanceScan('doctor', options.path);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.quiet) {
        console.log(formatQuietScanResult(result));
      } else {
        console.log(formatInboxResult(result));
      }
      setScanExitCode(scanExitCode(result), options.exitCode);
    }));

  program
    .command('weekly')
    .description('Show a compact weekly maintenance summary')
    .option('--path <path>', 'Project path to scan')
    .option('--json', 'Print machine-readable JSON')
    .option('--quiet', 'Print only summary, health, and next action')
    .option('--exit-code', 'Use automation exit codes: 0 safe, 1 review, 2 risky')
    .action(runAction(async (options: ScanCommandOptions) => {
      const result = await runMaintenanceScan('doctor', options.path);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.quiet) {
        console.log(formatQuietScanResult(result));
      } else {
        console.log(formatWeeklyResult(result));
      }
      setScanExitCode(scanExitCode(result), options.exitCode);
    }));

  program
    .command('fix')
    .description('Apply conservative maintenance fixes')
    .option('--path <path>', 'Project path to scan')
    .option('--safe-only', 'Only apply low-risk, high-confidence fixes')
    .action(runAction(async (options: { path?: string; safeOnly?: boolean }) => {
      console.log(await fixCommand(options));
    }));

  const stack = program
    .command('stack')
    .description('Manage the library stack configuration');

  stack
    .command('add')
    .description('Add or update a library in the stack')
    .argument('<library>', 'Name of the library to add')
    .requiredOption('--urls <urls>', 'Comma-separated list of changelog/release page URLs')
    .action(async (library: string, options: { urls: string }) => {
      try {
        const urls = options.urls.split(',').map((u) => u.trim());
        await stackAdd(library, urls);
        console.log(`Added "${library}" with ${urls.length} URL(s) to the stack.`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  stack
    .command('remove')
    .description('Remove a library from the stack')
    .argument('<library>', 'Name of the library to remove')
    .action(async (library: string) => {
      try {
        await stackRemove(library);
        console.log(`Removed "${library}" from the stack.`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  stack
    .command('list')
    .description('List all libraries in the stack')
    .action(runAction(async () => {
      const output = await stackList();
      console.log(output);
    }));

  program
    .command('run')
    .description('Run the DevBrief pipeline manually (without the HTTP server)')
    .action(runAction(async () => {
      // Load .env file
      dotenv.config();

      // Validate required environment variables
      const validation = validateEnvVars();
      if (!validation.valid) {
        for (const error of validation.errors) {
          console.error(`Error: ${error}`);
        }
        process.exit(1);
      }

      console.log('Starting DevBrief pipeline (manual trigger)...');
      await runPipeline('manual');
      console.log('Pipeline run complete.');
    }));

  return program;
}

// Parse CLI arguments when this file is the entry point.
// Skip when imported by test runners (vitest sets process.env.VITEST).
// The path check handles npx/node execution via bin symlinks.
const isTestEnvironment = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

if (!isTestEnvironment) {
  createProgram().parse();
}
