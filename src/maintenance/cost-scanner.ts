import { statSync } from 'fs';
import { join } from 'path';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

const LARGE_DEPENDENCIES = new Set([
  'aws-sdk',
  'firebase',
  'moment',
  'puppeteer',
  'playwright',
  'sharp',
]);

export const costScanner: Scanner = {
  name: 'cost',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];

    const largeDeps = context.dependencies.filter((dep) =>
      (!dep.ecosystem || dep.ecosystem === 'JavaScript/TypeScript') && LARGE_DEPENDENCIES.has(dep.name),
    );
    for (const dep of largeDeps) {
      findings.push({
        id: `cost:large-dependency:${dep.name}`,
        category: 'cost',
        label: dep.isDev ? 'SAFE' : 'REVIEW',
        title: `${dep.name} can add build or bundle weight`,
        summary: dep.isDev
          ? `${dep.name} is dev-only; no production cost signal`
          : `${dep.name} can increase install, image, or bundle size`,
        evidence: dep.isDev ? 'hidden because it is dev-only' : 'check if it ships to production paths',
        recommendation: dep.isDev ? 'ignore' : 'review',
        urgency: dep.isDev ? 0 : 3,
        impact: dep.isDev ? 0 : 4,
        confidence: 5,
        effort: '20 min',
        packageName: dep.name,
        files: ['package.json'],
        hiddenByDefault: true,
      });
    }

    for (const file of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
      if (!context.files.includes(file)) continue;
      try {
        const size = statSync(join(context.projectPath, file)).size;
        if (size > 1_500_000) {
          findings.push({
            id: `cost:large-lockfile:${file}`,
            category: 'cost',
            label: 'REVIEW',
            title: 'Large lockfile',
            summary: `${file} is larger than expected`,
            evidence: 'dependency tree may be heavier than necessary',
            recommendation: 'review',
            urgency: 2,
            impact: 3,
            confidence: 6,
            effort: '20 min',
            files: [file],
            hiddenByDefault: true,
          });
        }
      } catch {
        continue;
      }
    }

    if (findings.length === 0) {
      findings.push({
        id: 'cost:safe',
        category: 'cost',
        label: 'SAFE',
        title: 'No obvious local cost risk found',
        summary: 'no large dependency or artifact signal detected',
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
