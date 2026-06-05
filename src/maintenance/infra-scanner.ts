import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

function finding(
  id: string,
  label: MaintenanceFinding['label'],
  summary: string,
  evidence: string,
  files: string[],
  recommendation: MaintenanceFinding['recommendation'] = 'upgrade',
): MaintenanceFinding {
  return {
    id,
    category: 'infra',
    label,
    title: summary,
    summary,
    evidence,
    recommendation,
    urgency: label === 'EOL' ? 8 : label === 'RISKY' ? 7 : 5,
    impact: label === 'EOL' ? 8 : 6,
    confidence: 8,
    effort: '20 min',
    files,
  };
}

export const infraScanner: Scanner = {
  name: 'infra',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];

    for (const file of [...context.dockerFiles, ...context.workflowFiles, ...context.files.filter((name) => name.endsWith('.tf'))]) {
      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      const nodeMatch = content.match(/FROM\s+node:(\d+)(?:\D|$)/i);
      if (nodeMatch) {
        const major = parseInt(nodeMatch[1], 10);
        if (major < 22) {
          findings.push(finding(
            `infra:docker-node:${file}`,
            'EOL',
            'Docker image pins an EOL or recently EOL Node runtime',
            'use a supported LTS image and test native dependencies',
            [file],
          ));
        }
      }

      if (/FROM\s+.*:latest\b/i.test(content)) {
        findings.push(finding(
          `infra:docker-latest:${file}`,
          'REVIEW',
          'Docker image uses a floating latest tag',
          'pin a major/minor tag or digest for reproducible builds',
          [file],
          'review',
        ));
      }

      if (/ubuntu-(18\.04|20\.04)/.test(content)) {
        findings.push(finding(
          `infra:ubuntu-runner:${file}`,
          'UPGRADE SOON',
          'CI uses an old Ubuntu runner image',
          'move to ubuntu-24.04 when compatible',
          [file],
        ));
      }

      const oldActions = content.matchAll(/uses:\s*([^@\s]+)@(v[123]|master|main)\b/g);
      for (const match of oldActions) {
        const action = match[1];
        const version = match[2];
        findings.push(finding(
          `infra:action:${file}:${action}:${version}`,
          version === 'v1' || version === 'v2' ? 'UPGRADE SOON' : 'REVIEW',
          `${action}@${version} should be reviewed`,
          version === 'master' || version === 'main'
            ? 'branch-pinned actions can change without review'
            : 'older action major may run on deprecated Node internals',
          [file],
          version === 'master' || version === 'main' ? 'review' : 'upgrade',
        ));
      }

      if (/privileged:\s*true/.test(content)) {
        findings.push(finding(
          `infra:privileged:${file}`,
          'RISKY',
          'Container runs in privileged mode',
          'keep only if the workload truly needs host-level access',
          [file],
          'investigate',
        ));
      }

      if (/prevent_destroy\s*=\s*false/.test(content)) {
        findings.push(finding(
          `infra:terraform-destroy:${file}`,
          'REVIEW',
          'Terraform explicitly allows destructive replacement',
          'confirm lifecycle policy before production use',
          [file],
          'review',
        ));
      }
    }

    if (findings.length === 0) {
      findings.push({
        id: 'infra:safe',
        category: 'infra',
        label: 'SAFE',
        title: 'No obvious infrastructure drift found',
        summary: 'Docker, CI, and IaC scan found no high-signal drift',
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
