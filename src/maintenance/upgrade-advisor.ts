import { execFile } from 'child_process';
import { promisify } from 'util';
import { findPackageUsage } from './impact-analysis.js';
import { loadProjectContext } from './project-context.js';
import type { MaintenanceFinding } from './types.js';
import { compareVersions, majorOf, stripVersionRange } from './version-utils.js';

const execFileAsync = promisify(execFile);

async function fetchLatestVersion(packageName: string, projectPath: string): Promise<string | undefined> {
  if (process.env.DEVBRIEF_SKIP_NPM_VIEW === '1') return undefined;

  // Validate package name to prevent npm argument injection
  if (!packageName || typeof packageName !== 'string' || !/^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-*~][a-z0-9-*._~]*$/i.test(packageName)) {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync('npm', ['view', packageName, 'version'], {
      cwd: projectPath,
      timeout: 8000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function upgradeEffort(findings: MaintenanceFinding[]): MaintenanceFinding['effort'] {
  if (findings.some((finding) => finding.effort === 'migration likely')) return 'migration likely';
  if (findings.some((finding) => finding.effort === '1 hour+')) return '1 hour+';
  if (findings.some((finding) => finding.effort === '20 min')) return '20 min';
  return '5 min';
}

function verdict(findings: MaintenanceFinding[]): 'SAFE TO UPGRADE' | 'UPGRADE WITH REVIEW' | 'AVOID FOR NOW' {
  if (findings.some((finding) => finding.label === 'RISKY' || finding.label === 'ACTION REQUIRED')) {
    return 'UPGRADE WITH REVIEW';
  }

  if (findings.some((finding) => finding.label === 'EOL')) {
    return 'UPGRADE WITH REVIEW';
  }

  if (findings.some((finding) => finding.recommendation === 'replace')) {
    return 'AVOID FOR NOW';
  }

  return findings.some((finding) => finding.label === 'REVIEW')
    ? 'UPGRADE WITH REVIEW'
    : 'SAFE TO UPGRADE';
}

export async function adviseUpgrade(
  packageName: string,
  options?: { projectPath?: string; target?: string },
): Promise<{
  packageName: string;
  installed?: string;
  target?: string;
  verdict: 'SAFE TO UPGRADE' | 'UPGRADE WITH REVIEW' | 'AVOID FOR NOW';
  effort: MaintenanceFinding['effort'];
  findings: MaintenanceFinding[];
}> {
  const context = await loadProjectContext(options?.projectPath);
  const dependency = context.dependencies.find((dep) => dep.name === packageName);
  const installed = dependency ? stripVersionRange(dependency.version) : undefined;
  const target = options?.target ?? await fetchLatestVersion(packageName, context.projectPath);
  const findings: MaintenanceFinding[] = [];

  if (!dependency) {
    findings.push({
      id: `upgrade:not-installed:${packageName}`,
      category: 'dependency',
      label: 'SAFE',
      title: `${packageName} is not installed`,
      summary: `${packageName} is not in package.json`,
      recommendation: 'ignore',
      urgency: 0,
      impact: 0,
      confidence: 9,
      effort: 'none',
      packageName,
      files: ['package.json'],
    });
    return {
      packageName,
      verdict: 'SAFE TO UPGRADE',
      effort: 'none',
      findings,
    };
  }

  const usageFiles = findPackageUsage(context, packageName);
  const installedMajor = installed ? majorOf(installed) : undefined;
  const targetMajor = target ? majorOf(target) : undefined;

  if (target && installed && compareVersions(target, installed) <= 0) {
    findings.push({
      id: `upgrade:already-current:${packageName}`,
      category: 'dependency',
      label: 'SAFE',
      title: `${packageName} does not need an upgrade`,
      summary: `${packageName} is already at ${installed}`,
      recommendation: 'ignore',
      urgency: 0,
      impact: 0,
      confidence: 8,
      effort: 'none',
      packageName,
      files: ['package.json'],
    });
  } else if (target && installedMajor !== undefined && targetMajor !== undefined && targetMajor > installedMajor) {
    findings.push({
      id: `upgrade:major:${packageName}`,
      category: 'dependency',
      label: usageFiles.length > 0 ? 'RISKY' : 'REVIEW',
      title: `${packageName} major upgrade`,
      summary: `${packageName} ${installed ?? 'installed'} -> ${target} crosses a major version`,
      evidence: usageFiles.length > 0
        ? `touches code you actually use in ${usageFiles.length} file${usageFiles.length === 1 ? '' : 's'}`
        : 'no direct source usage found',
      recommendation: usageFiles.length > 0 ? 'review' : 'upgrade',
      urgency: 5,
      impact: usageFiles.length > 0 ? 8 : 4,
      confidence: 8,
      effort: usageFiles.length > 3 ? '1 hour+' : '20 min',
      packageName,
      files: usageFiles.length > 0 ? usageFiles : ['package.json'],
    });
  } else {
    findings.push({
      id: `upgrade:minor:${packageName}`,
      category: 'dependency',
      label: 'SAFE',
      title: `${packageName} upgrade appears low risk`,
      summary: target
        ? `${packageName} ${installed ?? 'installed'} -> ${target} does not cross a known major boundary`
        : `${packageName} is installed; target version unavailable offline`,
      evidence: usageFiles.length > 0
        ? `${usageFiles.length} source use${usageFiles.length === 1 ? '' : 's'} found`
        : 'no direct source usage found',
      recommendation: target ? 'upgrade' : 'review',
      urgency: target ? 2 : 1,
      impact: usageFiles.length > 0 ? 4 : 2,
      confidence: target ? 7 : 5,
      effort: usageFiles.length > 3 ? '20 min' : '5 min',
      packageName,
      files: usageFiles.length > 0 ? usageFiles : ['package.json'],
    });
  }

  if (packageName === 'node-sass') {
    findings.push({
      id: 'upgrade:node-sass',
      category: 'dependency',
      label: 'RISKY',
      title: 'node-sass upgrade is usually not the smallest safe fix',
      summary: 'node-sass is deprecated; replacing it with sass is safer than chasing native bindings',
      recommendation: 'replace',
      urgency: 8,
      impact: 8,
      confidence: 9,
      effort: 'migration likely',
      packageName,
      files: usageFiles.length > 0 ? usageFiles : ['package.json'],
    });
  }

  return {
    packageName,
    installed,
    target,
    verdict: verdict(findings),
    effort: upgradeEffort(findings),
    findings,
  };
}
