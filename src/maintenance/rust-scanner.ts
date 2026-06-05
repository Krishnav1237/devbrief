import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

export const rustScanner: Scanner = {
  name: 'rust',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    if (!context.profile.ecosystems.includes('Rust')) return [];

    if (context.files.includes('Cargo.toml') && !context.files.includes('Cargo.lock')) {
      return [{
        id: 'rust:missing-lockfile',
        category: 'dependency',
        label: 'REVIEW',
        title: 'Rust lockfile is missing',
        summary: 'Cargo.toml found but Cargo.lock was not found',
        evidence: 'applications should usually commit Cargo.lock; libraries may intentionally omit it',
        recommendation: 'review',
        urgency: 3,
        impact: 4,
        confidence: 7,
        effort: '5 min',
        files: ['Cargo.toml'],
        hiddenByDefault: true,
      }];
    }

    return [];
  },
};
