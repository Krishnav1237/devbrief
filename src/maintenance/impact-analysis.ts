import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext } from './types.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findPackageUsage(context: ProjectContext, packageName: string): string[] {
  const escaped = escapeRegex(packageName);
  const pythonName = escapeRegex(packageName.replace(/-/g, '_'));
  const importPattern = new RegExp(
    `(?:` +
      `from\\s+['"]${escaped}(?:/[^'"]*)?['"]|` +
      `import\\s*\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\)|` +
      `require\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\)|` +
      `['"]${escaped}(?:/[^'"]*)?['"]|` +
      `\\bimport\\s+${escaped}\\b|` +
      `\\bfrom\\s+${escaped}\\b|` +
      `\\bimport\\s+${pythonName}\\b|` +
      `\\bfrom\\s+${pythonName}\\b|` +
      `\\buse\\s+${escaped}\\b|` +
      `\\buse\\s+${pythonName}\\b` +
    `)`,
    'i'
  );
  const matches: string[] = [];

  for (const file of context.sourceFiles) {
    let content = '';
    try {
      content = readProjectFile(context, file);
    } catch {
      continue;
    }

    if (importPattern.test(content)) {
      matches.push(file);
    }
  }

  return matches;
}

export function createImpactFinding(
  context: ProjectContext,
  packageName: string,
  summary: string,
): MaintenanceFinding | undefined {
  const files = findPackageUsage(context, packageName);
  if (files.length === 0) return undefined;

  return {
    id: `impact:${packageName}`,
    category: 'impact',
    label: 'REVIEW',
    title: `${packageName} is used in source`,
    summary,
    evidence: `${files.length} call site${files.length === 1 ? '' : 's'} found`,
    recommendation: 'review',
    urgency: 4,
    impact: Math.min(10, files.length + 2),
    confidence: 8,
    effort: files.length <= 2 ? '20 min' : '1 hour+',
    packageName,
    files,
  };
}
