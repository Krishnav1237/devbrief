import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

export const opsScanner: Scanner = {
  name: 'ops',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];
    const scripts = context.packageJson?.scripts ?? {};
    const hasBackupScript = Object.keys(scripts).some((script) => /backup|dump|snapshot/i.test(script));
    const hasHealthScript = Object.keys(scripts).some((script) => /health|smoke|check|probe/i.test(script));

    if (!hasHealthScript) {
      findings.push({
        id: 'ops:missing-health-check',
        category: 'ops',
        label: 'REVIEW',
        title: 'No obvious health/smoke check script',
        summary: 'no health, smoke, check, or probe script found',
        evidence: 'add one lightweight command if this project deploys anywhere',
        recommendation: 'monitor',
        urgency: 3,
        impact: 4,
        confidence: 5,
        effort: '20 min',
        files: context.packageJson ? ['package.json'] : [],
        hiddenByDefault: true,
      });
    }

    if (!hasBackupScript) {
      findings.push({
        id: 'ops:missing-backup-signal',
        category: 'ops',
        label: 'REVIEW',
        title: 'No local backup signal found',
        summary: 'no backup, dump, or snapshot script found',
        evidence: 'ignore if backups are managed outside this repo',
        recommendation: 'monitor',
        urgency: 2,
        impact: 5,
        confidence: 4,
        effort: '20 min',
        files: context.packageJson ? ['package.json'] : [],
        hiddenByDefault: true,
      });
    }

    for (const file of context.workflowFiles) {
      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      if (/schedule:\s*\n\s*-\s*cron:/.test(content) && !/timeout-minutes:/.test(content)) {
        findings.push({
          id: `ops:cron-timeout:${file}`,
          category: 'ops',
          label: 'REVIEW',
          title: 'Scheduled workflow has no timeout',
          summary: 'scheduled CI job may run longer than expected',
          evidence: 'add timeout-minutes to cap cost and stuck jobs',
          recommendation: 'remediate',
          urgency: 4,
          impact: 5,
          confidence: 7,
          effort: '5 min',
          files: [file],
        });
      }
    }

    if (findings.every((finding) => finding.hiddenByDefault)) {
      findings.push({
        id: 'ops:safe',
        category: 'ops',
        label: 'SAFE',
        title: 'No urgent operational risk found',
        summary: 'no urgent local operational risk detected',
        recommendation: 'ignore',
        urgency: 0,
        impact: 0,
        confidence: 6,
        effort: 'none',
        hiddenByDefault: true,
      });
    }

    return findings;
  },
};
