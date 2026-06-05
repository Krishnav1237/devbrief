import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9_]{30,}/ },
  { name: 'OpenAI API key', regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'Private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Slack token', regex: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
];

function securityFinding(
  id: string,
  label: MaintenanceFinding['label'],
  summary: string,
  evidence: string,
  files: string[],
  confidence = 8,
): MaintenanceFinding {
  return {
    id,
    category: 'security',
    label,
    title: summary,
    summary,
    evidence,
    recommendation: label === 'ACTION REQUIRED' ? 'remediate' : 'review',
    urgency: label === 'ACTION REQUIRED' ? 10 : label === 'RISKY' ? 8 : 5,
    impact: label === 'ACTION REQUIRED' ? 10 : 7,
    confidence,
    effort: label === 'ACTION REQUIRED' ? '20 min' : '5 min',
    files,
  };
}

function shouldScanFile(file: string): boolean {
  if (file === 'package-lock.json' || file.endsWith('.lock')) return false;
  if (file.endsWith('.md')) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  if (file.includes('/fixtures/') || file.includes('/__fixtures__/')) return false;
  return true;
}

export const securityScanner: Scanner = {
  name: 'security',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];
    const scanFiles = [...new Set([...context.sourceFiles, ...context.configFiles, ...context.envFiles])]
      .filter(shouldScanFile);

    for (const file of scanFiles) {
      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(content)) {
          findings.push(securityFinding(
            `security:secret:${pattern.name}:${file}`,
            'ACTION REQUIRED',
            `${pattern.name} appears in repository files`,
            'rotate the secret and move it to local environment storage',
            [file],
            9,
          ));
        }
      }

      if (/cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]/s.test(content) || /Access-Control-Allow-Origin['"]?\s*[:,\s]\s*['"]?\*/.test(content)) {
        findings.push(securityFinding(
          `security:cors:${file}`,
          'RISKY',
          'CORS allows any origin',
          'restrict production origins before exposing auth or credentials',
          [file],
        ));
      }

      if (/debug\s*:\s*true/.test(content) || /NODE_ENV\s*=\s*development/.test(content)) {
        findings.push(securityFinding(
          `security:debug:${file}`,
          'REVIEW',
          'debug or development mode is configured',
          'confirm this cannot be used in production',
          [file],
          7,
        ));
      }

      if (/jwt\.sign\([^)]*['"](secret|changeme|password|test)['"]/i.test(content)) {
        findings.push(securityFinding(
          `security:jwt-secret:${file}`,
          'RISKY',
          'JWT signing uses a weak hard-coded secret',
          'read the signing secret from a private environment variable',
          [file],
          8,
        ));
      }
    }

    for (const file of context.envFiles) {
      if (!file.includes('example') && !file.includes('sample')) {
        findings.push(securityFinding(
          `security:env-file:${file}`,
          'REVIEW',
          `${file} is present in the project tree`,
          'confirm it is ignored and never committed with real values',
          [file],
          7,
        ));
      }
    }

    const usesExpress = context.dependencies.some((dep) => dep.name === 'express');
    const usesHelmet = context.dependencies.some((dep) => dep.name === 'helmet');
    if (usesExpress && !usesHelmet) {
      findings.push(securityFinding(
        'security:express-no-helmet',
        'REVIEW',
        'Express app has no helmet dependency',
        'add security headers if this serves public HTTP traffic',
        ['package.json'],
        6,
      ));
    }

    if (findings.length === 0) {
      findings.push({
        id: 'security:safe',
        category: 'security',
        label: 'SAFE',
        title: 'No high-confidence security posture issue found',
        summary: 'no exposed secrets or obvious unsafe production defaults detected',
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
