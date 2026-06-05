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

export const scannerRegistry: Record<string, Scanner[]> = {
  risk: [dependencyRiskScanner, vulnerabilityIntelligenceScanner, javascriptScanner, pythonScanner, rustScanner, goScanner, javaScanner],
  runtime: [runtimeScanner],
  infra: [infraScanner],
  security: [securityScanner],
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

export async function runMaintenanceScan(
  command: keyof typeof scannerRegistry,
  projectPath?: string,
): Promise<ScanResult> {
  const context = await loadProjectContext(projectPath);
  const cacheKey = `${command}:${context.projectPath}:${context.fingerprint}`;
  const cached = scanCache.get(cacheKey);
  if (cached) return cached;

  const findings: MaintenanceFinding[] = [];

  for (const scanner of scannerRegistry[command]) {
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
