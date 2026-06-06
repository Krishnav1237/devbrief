import type { MaintenanceFinding, ScanResult } from './types.js';
import { calculateHealthScore } from './recommendation-engine.js';

function compactFileList(files?: string[]): string {
  if (!files || files.length === 0) return '';
  const shown = files.slice(0, 3).join(', ');
  const suffix = files.length > 3 ? ` (+${files.length - 3} more)` : '';
  return ` [${shown}${suffix}]`;
}

function getConfidenceLabel(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 8) return 'High';
  if (score >= 5) return 'Medium';
  return 'Low';
}

export function formatFinding(finding: MaintenanceFinding): string {
  const files = compactFileList(finding.files);
  const filesStr = files ? ` ${files}` : '';
  const confidenceLabel = getConfidenceLabel(finding.confidence);
  const whyStr = finding.whyItMatters ? `\n  Why this matters: ${finding.whyItMatters}` : '';
  const evidence = finding.evidence ? `\n  Evidence: ${finding.evidence}` : '';

  return `${finding.label}: ${finding.summary}${filesStr}${evidence}\n  Decision: ${finding.recommendation}, ${finding.effort}, confidence: ${confidenceLabel}${whyStr}`;
}

function formatList(values?: string[]): string {
  if (!values || values.length === 0) return 'none detected';
  return values.join(', ');
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatScanCoverage(result: ScanResult): string {
  const signalParts = [
    `${result.stats.runtimeIndicators ?? 0} runtime`,
    `${result.stats.infraSignals ?? 0} infra`,
    `${result.stats.securitySignals ?? 0} config/security`,
    `${result.stats.serviceSignals ?? 0} service`,
  ];

  return [
    `Detected: ${formatList(result.stats.ecosystems)}${result.stats.projectKinds?.length ? ` (${formatList(result.stats.projectKinds)})` : ''}`,
    `Package manager: ${formatList(result.stats.packageManagers)}`,
    ...(result.stats.projectRoots && result.stats.projectRoots.length > 1
      ? [`Project roots: ${result.stats.projectRoots.slice(0, 6).join(', ')}${result.stats.projectRoots.length > 6 ? ` (+${result.stats.projectRoots.length - 6} more)` : ''}`]
      : []),
    `Scanned: ${countLabel(result.stats.files ?? 0, 'file')}, ${countLabel(result.stats.dependencies ?? 0, 'dependency', 'dependencies')}, ${signalParts.join(', ')} signals`,
  ].join('\n');
}

function formatNextAction(result: ScanResult): string {
  const top = result.findings.find((finding) => finding.recommendation !== 'ignore');
  if (!top) return 'Next: no action needed';
  return `Next: ${top.recommendation} - ${top.summary} (${top.effort})`;
}

function formatHealthBreakdown(result: ScanResult): string {
  if (!result.healthBreakdown) return '';
  return [
    `Breakdown:`,
    `  Runtime Lifecycle:   ${result.healthBreakdown.runtime}/25`,
    `  Dependency Risk:     ${result.healthBreakdown.dependencies}/25`,
    `  Infrastructure:      ${result.healthBreakdown.infrastructure}/25`,
    `  Security & Services: ${result.healthBreakdown.security}/25`,
  ].join('\n');
}

function formatMonorepoBreakdown(result: ScanResult): string {
  if (!result.stats.projectRoots || result.stats.projectRoots.length <= 1) return '';

  const lines: string[] = ['', 'Project Health Breakdown:'];
  for (const root of result.stats.projectRoots) {
    const rootFindings = result.findings.filter((f) => {
      if (!f.files || f.files.length === 0) {
        return root === '.';
      }
      return f.files.some((file) => {
        if (root === '.') return !file.includes('/');
        return file.startsWith(root + '/');
      });
    });
    const score = calculateHealthScore(rootFindings);
    const displayName = root === '.' ? 'root' : root;
    lines.push(`  ${displayName.padEnd(16)} ${score}/100`);
  }
  return lines.join('\n');
}

export function formatScanResult(result: ScanResult, options?: { expanded?: boolean }): string {
  const breakdownStr = formatHealthBreakdown(result);
  const monorepoStr = formatMonorepoBreakdown(result);

  const lines: string[] = [
    result.summary,
    `Health: ${result.healthScore}/100`,
  ];
  if (breakdownStr) lines.push(breakdownStr);
  if (monorepoStr) lines.push(monorepoStr);

  lines.push('', formatScanCoverage(result), '');

  if (result.findings.length === 0) {
    lines.push('SAFE: no urgent, risky, or project-specific maintenance work found');
  } else {
    for (const finding of result.findings.slice(0, options?.expanded ? 50 : 8)) {
      lines.push(formatFinding(finding));
      lines.push('');
    }
  }

  if (!options?.expanded && result.ignored.length > 0) {
    lines.push(`Ignored: ${result.ignored.length} low-signal item${result.ignored.length === 1 ? '' : 's'} hidden by default`);
  }

  lines.push(formatNextAction(result));

  return lines.join('\n');
}

export function formatQuietScanResult(result: ScanResult): string {
  return [
    result.summary,
    `Health: ${result.healthScore}/100`,
    formatNextAction(result),
  ].join('\n');
}

export function scanExitCode(result: ScanResult): 0 | 1 | 2 {
  if (result.findings.some((finding) =>
    ['ACTION REQUIRED', 'EOL', 'RISKY'].includes(finding.label),
  )) {
    return 2;
  }

  if (result.findings.some((finding) => finding.recommendation !== 'ignore')) {
    return 1;
  }

  return 0;
}

export function formatInboxResult(result: ScanResult): string {
  const urgent = result.findings.filter((finding) =>
    ['ACTION REQUIRED', 'EOL', 'RISKY'].includes(finding.label),
  );
  const safeWins = result.findings.filter((finding) =>
    finding.label === 'UPGRADE SOON' || (finding.effort === '5 min' && finding.recommendation !== 'ignore'),
  );

  const breakdownStr = formatHealthBreakdown(result);
  const monorepoStr = formatMonorepoBreakdown(result);

  const lines = [
    urgent.length === 0 ? 'SAFE: no urgent maintenance items' : `${urgent[0].label}: ${urgent[0].summary}`,
    `Health: ${result.healthScore}/100`,
  ];
  if (breakdownStr) lines.push(breakdownStr);
  if (monorepoStr) lines.push(monorepoStr);

  lines.push('', formatScanCoverage(result), '');

  lines.push('Urgent:');
  if (urgent.length) {
    for (const finding of urgent.slice(0, 5)) {
      lines.push(formatFinding(finding));
      lines.push('');
    }
  } else {
    lines.push('SAFE: nothing urgent', '');
  }

  lines.push('Safe wins:');
  if (safeWins.length) {
    for (const finding of safeWins.slice(0, 5)) {
      lines.push(formatFinding(finding));
      lines.push('');
    }
  } else {
    lines.push('SAFE: no quick fix needed', '');
  }

  lines.push(`Ignored: ${result.ignored.length} low-signal item${result.ignored.length === 1 ? '' : 's'} hidden by default`);
  lines.push(formatNextAction(result));

  return lines.join('\n');
}

export function formatWeeklyResult(result: ScanResult): string {
  const planned = result.findings.filter((finding) =>
    finding.recommendation !== 'ignore' && finding.label !== 'SAFE',
  );

  const breakdownStr = formatHealthBreakdown(result);
  const monorepoStr = formatMonorepoBreakdown(result);

  const lines = [
    planned.length === 0 ? 'SAFE: no maintenance work needed this week' : `REVIEW: ${planned.length} maintenance item${planned.length === 1 ? '' : 's'} to plan`,
    `Health: ${result.healthScore}/100`,
  ];
  if (breakdownStr) lines.push(breakdownStr);
  if (monorepoStr) lines.push(monorepoStr);

  lines.push('', formatScanCoverage(result), '');

  lines.push('This week:');
  if (planned.length) {
    for (const finding of planned.slice(0, 5)) {
      lines.push(formatFinding(finding));
      lines.push('');
    }
  } else {
    lines.push('SAFE: keep current setup', '');
  }

  lines.push(`Batch later: ${result.ignored.length} low-signal item${result.ignored.length === 1 ? '' : 's'}`);
  lines.push(formatNextAction(result));

  return lines.join('\n');
}

export function formatUpgradeRecommendation(
  packageName: string,
  verdict: 'SAFE TO UPGRADE' | 'UPGRADE WITH REVIEW' | 'AVOID FOR NOW',
  findings: MaintenanceFinding[],
  effort: MaintenanceFinding['effort'],
  versions?: { installed?: string; target?: string },
): string {
  const lines = [
    `${verdict}: ${packageName}`,
    `Installed: ${versions?.installed ?? 'not installed'}`,
    `Target: ${versions?.target ?? 'unknown offline'}`,
    `Effort: ${effort}`,
    '',
  ];

  for (const finding of findings.slice(0, 8)) {
    lines.push(formatFinding(finding));
    lines.push('');
  }

  if (findings.length === 0) {
    lines.push('SAFE: no project-specific usage or obvious compatibility risk found');
  }

  return lines.join('\n');
}

export function formatMarkdownResult(result: ScanResult): string {
  const breakdown = result.healthBreakdown;
  const breakdownTable = breakdown
    ? [
        '| Category | Score |',
        '| --- | --- |',
        `| **Runtime Lifecycle** | ${breakdown.runtime}/25 |`,
        `| **Dependency Risk** | ${breakdown.dependencies}/25 |`,
        `| **Infrastructure** | ${breakdown.infrastructure}/25 |`,
        `| **Security & Services** | ${breakdown.security}/25 |`,
      ].join('\n')
    : '';

  const findingsList = result.findings.map((finding) => {
    const files = finding.files && finding.files.length > 0
      ? ` (\`${finding.files.slice(0, 3).join(', ')}\`${finding.files.length > 3 ? ` + ${finding.files.length - 3} more` : ''})`
      : '';
    const details = [
      `- **Verdict / Action**: ${finding.recommendation}`,
      `- **Effort**: ${finding.effort}`,
      `- **Confidence**: ${getConfidenceLabel(finding.confidence)}`,
      finding.evidence ? `- **Evidence**: ${finding.evidence}` : '',
      finding.whyItMatters ? `- **Why this matters**: ${finding.whyItMatters}` : '',
    ].filter(Boolean).join('\n');

    return [
      `### :warning: **${finding.label}**: ${finding.summary}${files}`,
      '',
      '<details>',
      '<summary>View details</summary>',
      '',
      details,
      '',
      '</details>',
      '',
    ].join('\n');
  }).join('\n');

  return [
    '# DevBrief Project Maintenance Report',
    '',
    `**Summary:** ${result.summary}`,
    `**Health Score:** ${result.healthScore}/100`,
    '',
    breakdownTable,
    '',
    '## Findings',
    '',
    findingsList || '*No findings detected. Your project is completely safe!*',
    '',
    '---',
    '*Generated by DevBrief Project Maintenance Intelligence.*',
  ].join('\n').trim();
}
