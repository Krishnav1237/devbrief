import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

export const javascriptScanner: Scanner = {
  name: 'javascript',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    if (!context.profile.ecosystems.includes('JavaScript/TypeScript')) return [];

    const findings: MaintenanceFinding[] = [];
    const hasLockfile = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].some((file) => context.files.includes(file));

    const dependencyCount = Object.keys(context.packageJson?.dependencies ?? {}).length
      + Object.keys(context.packageJson?.devDependencies ?? {}).length;

    if (!hasLockfile && dependencyCount > 0) {
      findings.push({
        id: 'javascript:missing-lockfile',
        category: 'dependency',
        label: 'REVIEW',
        title: 'JavaScript dependencies are not locked',
        summary: 'package.json has dependencies but no npm, pnpm, or yarn lockfile was found',
        evidence: 'lockfiles make installs repeatable across machines and CI',
        recommendation: 'review',
        urgency: 4,
        impact: 5,
        confidence: 9,
        effort: '5 min',
        files: ['package.json'],
      });
    }

    if (context.packageJson && !context.packageJson.engines?.node && !context.files.includes('.nvmrc') && !context.files.includes('.node-version')) {
      findings.push({
        id: 'javascript:no-node-pin',
        category: 'runtime',
        label: 'REVIEW',
        title: 'Node runtime is not pinned',
        summary: 'no Node version pin found',
        evidence: 'add engines.node, .nvmrc, or a CI/Docker runtime pin if builds depend on Node behavior',
        recommendation: 'monitor',
        urgency: 2,
        impact: 4,
        confidence: 7,
        effort: '5 min',
        files: ['package.json'],
        hiddenByDefault: true,
      });
    }

    return findings;
  },
};
