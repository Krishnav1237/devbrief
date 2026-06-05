import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

export const goScanner: Scanner = {
  name: 'go',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    if (!context.profile.ecosystems.includes('Go')) return [];

    const findings: MaintenanceFinding[] = [];
    if (context.files.includes('go.mod') && !context.files.includes('go.sum')) {
      findings.push({
        id: 'go:missing-sum',
        category: 'dependency',
        label: 'REVIEW',
        title: 'Go checksum file is missing',
        summary: 'go.mod found but go.sum was not found',
        evidence: 'go.sum records module checksums for repeatable dependency verification',
        recommendation: 'review',
        urgency: 3,
        impact: 4,
        confidence: 8,
        effort: '5 min',
        files: ['go.mod'],
      });
    }

    return findings;
  },
};
