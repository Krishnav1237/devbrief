import type { MaintenanceFinding, RiskLabel, ScanResult } from './types.js';

const LABEL_WEIGHT: Record<RiskLabel, number> = {
  'ACTION REQUIRED': 100,
  EOL: 90,
  RISKY: 78,
  'UPGRADE SOON': 64,
  REVIEW: 42,
  SAFE: 5,
};

export function rankFindings(findings: MaintenanceFinding[]): MaintenanceFinding[] {
  return [...findings].sort((a, b) => {
    const aScore = LABEL_WEIGHT[a.label] + a.urgency * 2 + a.impact + a.confidence;
    const bScore = LABEL_WEIGHT[b.label] + b.urgency * 2 + b.impact + b.confidence;
    return bScore - aScore;
  });
}

export function visibleFindings(findings: MaintenanceFinding[]): MaintenanceFinding[] {
  return rankFindings(findings).filter((finding) => !finding.hiddenByDefault);
}

export function hiddenFindings(findings: MaintenanceFinding[]): MaintenanceFinding[] {
  return rankFindings(findings).filter((finding) => finding.hiddenByDefault);
}

export function calculateHealthBreakdown(findings: MaintenanceFinding[]) {
  const visible = findings.filter((finding) => !finding.hiddenByDefault);

  let runtimePenalty = 0;
  let dependencyPenalty = 0;
  let infraPenalty = 0;
  let securityPenalty = 0;

  for (const finding of visible) {
    const penalty = (Math.max(0, LABEL_WEIGHT[finding.label] - 5) / 6) + finding.urgency * 1.5 + finding.impact;
    const cat = finding.category;

    if (cat === 'runtime') {
      runtimePenalty += penalty;
    } else if (cat === 'dependency' || cat === 'vulnerability' || cat === 'continuity') {
      dependencyPenalty += penalty;
    } else if (cat === 'infra') {
      infraPenalty += penalty;
    } else {
      // security, service, ops, cost
      securityPenalty += penalty;
    }
  }

  const runtime = Math.max(0, Math.round(25 - runtimePenalty));
  const dependencies = Math.max(0, Math.round(25 - dependencyPenalty));
  const infrastructure = Math.max(0, Math.round(25 - infraPenalty));
  const security = Math.max(0, Math.round(25 - securityPenalty));

  return {
    runtime,
    dependencies,
    infrastructure,
    security,
  };
}

export function calculateHealthScore(findings: MaintenanceFinding[]): number {
  const breakdown = calculateHealthBreakdown(findings);
  return breakdown.runtime + breakdown.dependencies + breakdown.infrastructure + breakdown.security;
}

export function buildSummary(findings: MaintenanceFinding[]): string {
  const visible = visibleFindings(findings);
  const urgent = visible.filter((finding) =>
    ['ACTION REQUIRED', 'EOL', 'RISKY'].includes(finding.label),
  );

  if (visible.length === 0) {
    return 'SAFE: no current action needed';
  }

  if (urgent.length === 0) {
    if (visible.length <= 3) {
      return `${visible[0].label}: ${visible[0].summary}`;
    }
    return `REVIEW: ${visible.length} non-urgent item${visible.length === 1 ? '' : 's'} to check`;
  }

  return `${urgent[0].label}: ${urgent[0].summary}`;
}

export function buildScanResult(
  command: string,
  projectPath: string,
  findings: MaintenanceFinding[],
  stats: ScanResult['stats'],
): ScanResult {
  // Override hiddenByDefault if the command specifically requests that category
  const mappedFindings = findings.map((f) => {
    if (
      command === f.category ||
      (command === 'risk' &&
        (f.category === 'dependency' || f.category === 'vulnerability' || f.category === 'continuity'))
    ) {
      return { ...f, hiddenByDefault: false };
    }
    return f;
  });

  const visible = visibleFindings(mappedFindings);
  const ignored = hiddenFindings(mappedFindings);
  const breakdown = calculateHealthBreakdown(mappedFindings);
  const score = breakdown.runtime + breakdown.dependencies + breakdown.infrastructure + breakdown.security;

  return {
    command,
    projectPath,
    summary: buildSummary(mappedFindings),
    healthScore: score,
    healthBreakdown: breakdown,
    findings: visible,
    ignored,
    stats,
  };
}
