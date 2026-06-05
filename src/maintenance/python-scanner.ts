import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

export const pythonScanner: Scanner = {
  name: 'python',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    if (!context.profile.ecosystems.includes('Python')) return [];

    const findings: MaintenanceFinding[] = [];
    const hasDependencyFile = context.files.some((file) =>
      ['pyproject.toml', 'requirements.txt', 'Pipfile'].includes(file.split('/').pop() ?? file),
    );
    const hasLockfile = context.files.some((file) =>
      ['poetry.lock', 'Pipfile.lock', 'uv.lock'].includes(file.split('/').pop() ?? file),
    );

    if (hasDependencyFile && !hasLockfile && context.dependencies.some((dep) => dep.ecosystem === 'Python')) {
      findings.push({
        id: 'python:missing-lockfile',
        category: 'dependency',
        label: 'REVIEW',
        title: 'Python dependencies may not be locked',
        summary: 'Python dependency file found but no Poetry, Pipenv, or uv lockfile was found',
        evidence: 'ignore if this project intentionally uses only broad library constraints',
        recommendation: 'review',
        urgency: 3,
        impact: 4,
        confidence: 6,
        effort: '20 min',
        files: context.files.filter((file) => ['pyproject.toml', 'requirements.txt', 'Pipfile'].includes(file.split('/').pop() ?? file)),
        hiddenByDefault: true,
      });
    }

    if (!context.files.includes('.python-version') && context.profile.runtimeIndicators.every((file) => !file.includes('Dockerfile'))) {
      findings.push({
        id: 'python:no-runtime-pin',
        category: 'runtime',
        label: 'REVIEW',
        title: 'Python runtime is not pinned',
        summary: 'no .python-version or Docker Python runtime pin found',
        evidence: 'pin Python when production behavior depends on interpreter version',
        recommendation: 'monitor',
        urgency: 2,
        impact: 4,
        confidence: 6,
        effort: '5 min',
        files: context.files.filter((file) => ['pyproject.toml', 'requirements.txt', 'Pipfile'].includes(file.split('/').pop() ?? file)),
        hiddenByDefault: true,
      });
    }

    return findings;
  },
};
