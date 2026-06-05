import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

const KNOWN_SCAN_TARGETS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Dockerfile',
  'docker-compose.yml',
  '.github/workflows/*.yml',
  'Terraform, Kubernetes, and Helm files',
];

export const firstRunScanner: Scanner = {
  name: 'first-run',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    if (!context.profile.ecosystems.includes('Unknown')) return [];

    return [{
      id: 'first-run:no-project-detected',
      category: 'ops',
      label: 'REVIEW',
      title: 'No supported project manifest detected',
      summary: context.files.length === 0
        ? 'directory is empty or contains no readable project files'
        : 'no supported project manifest was detected',
      evidence: `DevBrief scanned ${context.files.length} file${context.files.length === 1 ? '' : 's'} and looks for ${KNOWN_SCAN_TARGETS.join(', ')}`,
      recommendation: 'ignore',
      urgency: 1,
      impact: 1,
      confidence: 9,
      effort: 'none',
      files: context.files.slice(0, 5),
    }];
  },
};
