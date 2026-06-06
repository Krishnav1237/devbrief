import { execFile } from 'child_process';
import { promisify } from 'util';
import { findPackageUsage } from './impact-analysis.js';
import { loadProjectContext } from './project-context.js';
import type { MaintenanceFinding } from './types.js';
import { compareVersions, majorOf, stripVersionRange } from './version-utils.js';
import { fetchWithRegistryClient } from '../utils/registry-client.js';
import { getWhyItMatters } from './explainability.js';

const execFileAsync = promisify(execFile);

function escapeGoModulePath(path: string): string {
  return path.replace(/[A-Z]/g, (match) => '!' + match.toLowerCase());
}

async function fetchLatestVersion(packageName: string, ecosystem: string, projectPath: string): Promise<string | undefined> {
  // Validate package name
  if (!packageName || typeof packageName !== 'string') return undefined;

  try {
    if (ecosystem === 'JavaScript/TypeScript' || ecosystem === 'Unknown') {
      if (!/^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-*~][a-z0-9-*._~]*$/i.test(packageName)) {
        return undefined;
      }
      try {
        const data = await fetchWithRegistryClient<any>(`https://registry.npmjs.org/${packageName}/latest`, { timeout: 5000 });
        if (data && data.version) {
          return data.version;
        }
      } catch {
        // Fall back below
      }

      if (process.env.DEVBRIEF_SKIP_NPM_VIEW === '1') return undefined;
      // Fallback to npm view CLI if registry call fails
      const { stdout } = await execFileAsync('npm', ['view', packageName, 'version'], {
        cwd: projectPath,
        timeout: 8000,
      });
      return stdout.trim() || undefined;
    } else if (ecosystem === 'Python') {
      const data = await fetchWithRegistryClient<any>(`https://pypi.org/pypi/${packageName}/json`, { timeout: 5000 });
      if (data && data.info && data.info.version) {
        return data.info.version;
      }
    } else if (ecosystem === 'Rust') {
      const data = await fetchWithRegistryClient<any>(`https://crates.io/api/v1/crates/${packageName}`, {
        headers: { 'User-Agent': 'DevBrief/1.0 (contact@devbrief.com)' },
        timeout: 5000,
      });
      if (data && data.crate) {
        return data.crate.max_stable_version || data.crate.max_version;
      }
    } else if (ecosystem === 'Go') {
      const escapedPath = escapeGoModulePath(packageName);
      const data = await fetchWithRegistryClient<any>(`https://proxy.golang.org/${escapedPath}/@latest`, { timeout: 5000 });
      if (data && data.Version) {
        return data.Version.replace(/^v/, '');
      }
    }
  } catch (err: any) {
    console.warn(`Failed to fetch latest version for ${packageName} (${ecosystem}): ${err.message}`);
  }

  return undefined;
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
  const ecosystem = dependency?.ecosystem || 'JavaScript/TypeScript';
  
  const target = options?.target ?? await fetchLatestVersion(packageName, ecosystem, context.projectPath);
  const findings: MaintenanceFinding[] = [];
  const manifest = ecosystem === 'Python' ? 'requirements.txt' : ecosystem === 'Rust' ? 'Cargo.toml' : ecosystem === 'Go' ? 'go.mod' : 'package.json';

  if (!dependency) {
    findings.push({
      id: `upgrade:not-installed:${packageName}`,
      category: 'dependency',
      label: 'SAFE',
      title: `${packageName} is not installed`,
      summary: `${packageName} is not in ${manifest}`,
      recommendation: 'ignore',
      urgency: 0,
      impact: 0,
      confidence: 9,
      effort: 'none',
      packageName,
      files: [manifest],
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
      files: [manifest],
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
      files: usageFiles.length > 0 ? usageFiles : [manifest],
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
      files: usageFiles.length > 0 ? usageFiles : [manifest],
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
      files: usageFiles.length > 0 ? usageFiles : [manifest],
    });
  }

  for (const finding of findings) {
    finding.whyItMatters = getWhyItMatters(finding);
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
