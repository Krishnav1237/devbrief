import { detectVulnerabilities } from '../utils/vulnerability-detector.js';
import { findPackageUsage } from './impact-analysis.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';
import { majorOf, stripVersionRange } from './version-utils.js';

const ABANDONED_PACKAGES: Record<string, { reason: string; replacement?: string }> = {
  request: { reason: 'deprecated and unmaintained', replacement: 'undici or fetch' },
  'node-sass': { reason: 'deprecated native binding with modern Node compatibility issues', replacement: 'sass' },
  'gulp-util': { reason: 'deprecated package split into smaller modules' },
  leftpad: { reason: 'historically fragile package with little practical value' },
};

const RUNTIME_BREAKAGE_PACKAGES = new Set([
  'node-sass',
  'fibers',
  'fsevents',
  'grpc',
  'node-gyp',
]);

const LICENSE_CONFLICT_PACKAGES = new Set([
  'agpl',
  'gpl',
]);

function depFiles(context: ProjectContext): string[] {
  return context.files.filter((file) =>
    ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(file),
  );
}

export const dependencyRiskScanner: Scanner = {
  name: 'dependency-risk',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];
    const files = depFiles(context);

    if (!context.packageJson) {
      return [{
        id: 'dependency:no-package-json',
        category: 'dependency',
        label: 'SAFE',
        title: 'No Node manifest found',
        summary: 'no package.json found; dependency risk scan skipped',
        recommendation: 'ignore',
        urgency: 0,
        impact: 0,
        confidence: 9,
        effort: 'none',
        hiddenByDefault: true,
      }];
    }

    for (const dep of context.dependencies.filter((dependency) =>
      !dependency.ecosystem || dependency.ecosystem === 'JavaScript/TypeScript',
    )) {
      const normalizedVersion = stripVersionRange(dep.version);
      const major = majorOf(normalizedVersion);
      const health = ABANDONED_PACKAGES[dep.name];

      if (health) {
        findings.push({
          id: `dependency:abandoned:${dep.name}`,
          category: 'continuity',
          label: dep.isDev ? 'REVIEW' : 'RISKY',
          title: `${dep.name} looks abandoned`,
          summary: `${dep.name} is ${health.reason}`,
          evidence: health.replacement ? `consider ${health.replacement}` : undefined,
          recommendation: health.replacement ? 'replace' : 'review',
          urgency: dep.isDev ? 4 : 7,
          impact: dep.isDev ? 3 : 7,
          confidence: 8,
          effort: '1 hour+',
          packageName: dep.name,
          files,
        });
      }

      if (dep.name === 'core-js' && major !== undefined && major < 3) {
        findings.push({
          id: 'dependency:eol:core-js',
          category: 'dependency',
          label: 'EOL',
          title: 'core-js v2 is no longer maintained',
          summary: 'core-js v2 no longer receives normal fixes',
          recommendation: 'upgrade',
          urgency: 8,
          impact: dep.isDev ? 4 : 7,
          confidence: 8,
          effort: '1 hour+',
          packageName: dep.name,
          files,
        });
      }

      if (RUNTIME_BREAKAGE_PACKAGES.has(dep.name)) {
        const usageFiles = findPackageUsage(context, dep.name);
        findings.push({
          id: `dependency:runtime-risk:${dep.name}`,
          category: 'dependency',
          label: dep.name === 'node-sass' ? 'RISKY' : 'REVIEW',
          title: `${dep.name} may break on modern runtimes`,
          summary: `${dep.name} can be sensitive to Node or native module upgrades`,
          evidence: usageFiles.length > 0 ? `${usageFiles.length} source use${usageFiles.length === 1 ? '' : 's'}` : 'native/toolchain dependency',
          recommendation: dep.name === 'node-sass' ? 'replace' : 'review',
          urgency: dep.name === 'node-sass' ? 8 : 5,
          impact: dep.isDev ? 4 : 7,
          confidence: 7,
          effort: dep.name === 'node-sass' ? 'migration likely' : '1 hour+',
          packageName: dep.name,
          files: usageFiles.length > 0 ? usageFiles : files,
        });
      }

      if (LICENSE_CONFLICT_PACKAGES.has(dep.name.toLowerCase())) {
        findings.push({
          id: `dependency:license:${dep.name}`,
          category: 'dependency',
          label: 'REVIEW',
          title: `${dep.name} may need license review`,
          summary: `${dep.name} has a name that suggests a copyleft license package`,
          recommendation: 'review',
          urgency: 3,
          impact: 4,
          confidence: 4,
          effort: '20 min',
          packageName: dep.name,
          files,
          hiddenByDefault: true,
        });
      }
    }

    if (findings.length === 0) {
      findings.push({
        id: 'dependency:safe',
        category: 'dependency',
        label: 'SAFE',
        title: 'Dependency scan clean',
        summary: `${context.dependencies.length} dependencies, no obvious local dependency risk`,
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

export const vulnerabilityIntelligenceScanner: Scanner = {
  name: 'vulnerability-intelligence',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    if (process.env.DEVBRIEF_SKIP_AUDIT === '1') return [];

    const vulnerabilities = await detectVulnerabilities(context.projectPath);
    return vulnerabilities.map((vulnerability) => {
      const dependency = context.dependencies.find((dep) => dep.name === vulnerability.packageName);
      const usageFiles = findPackageUsage(context, vulnerability.packageName);
      const securityLabel = vulnerability.severity === 'CRITICAL' || vulnerability.severity === 'HIGH'
        ? 'ACTION REQUIRED'
        : 'UPGRADE SOON';

      return {
        id: `vulnerability:${vulnerability.packageName}:${vulnerability.cveId ?? vulnerability.summary}`,
        category: 'vulnerability',
        label: securityLabel,
        title: `${vulnerability.packageName} vulnerability`,
        summary: `${vulnerability.packageName} has ${vulnerability.severity.toLowerCase()} security risk`,
        evidence: vulnerability.remediationAvailable
          ? 'patched version appears available'
          : 'no automatic remediation found',
        recommendation: vulnerability.remediationAvailable ? 'upgrade' : 'investigate',
        urgency: securityLabel === 'ACTION REQUIRED' ? 10 : 7,
        impact: dependency?.isDev ? 5 : 9,
        confidence: 8,
        effort: vulnerability.remediationAvailable ? '20 min' : '1 hour+',
        packageName: vulnerability.packageName,
        files: usageFiles.length > 0 ? usageFiles : depFiles(context),
      } satisfies MaintenanceFinding;
    });
  },
};
