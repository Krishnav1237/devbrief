import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';
import { findPackageUsage } from './impact-analysis.js';

const SERVICE_SDKS: Record<string, { service: string; note: string }> = {
  openai: { service: 'OpenAI', note: 'model names and API parameters can be retired independently of SDK updates' },
  '@anthropic-ai/sdk': { service: 'Anthropic', note: 'model IDs and Messages API behavior should be pinned intentionally' },
  stripe: { service: 'Stripe', note: 'API version drift can affect payments and webhooks' },
  '@clerk/nextjs': { service: 'Clerk', note: 'auth middleware changes can affect route protection' },
  '@supabase/supabase-js': { service: 'Supabase', note: 'client and auth behavior can change across majors' },
  resend: { service: 'Resend', note: 'email API changes can break transactional delivery' },
  twilio: { service: 'Twilio', note: 'messaging and webhook APIs should be version-aware' },
};

const RETIRED_MODEL_PATTERNS = [
  /gpt-4-0314/g,
  /gpt-4-0613/g,
  /gpt-3\.5-turbo-0301/g,
  /text-davinci-003/g,
  /claude-2(?:\.0|\.1)?/g,
];

export const serviceScanner: Scanner = {
  name: 'services',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];

    for (const dep of context.dependencies) {
      const service = SERVICE_SDKS[dep.name];
      if (!service) continue;

      const usage = findPackageUsage(context, dep.name);
      findings.push({
        id: `service:sdk:${dep.name}`,
        category: 'service',
        label: usage.length > 0 ? 'REVIEW' : 'SAFE',
        title: `${service.service} SDK detected`,
        summary: usage.length > 0
          ? `${service.service} SDK is used by this codebase`
          : `${service.service} SDK is installed but no direct source usage was found`,
        evidence: service.note,
        recommendation: usage.length > 0 ? 'monitor' : 'ignore',
        urgency: usage.length > 0 ? 4 : 1,
        impact: usage.length > 0 ? 6 : 1,
        confidence: usage.length > 0 ? 8 : 5,
        effort: '5 min',
        packageName: dep.name,
        files: usage.length > 0 ? usage : ['package.json'],
        hiddenByDefault: usage.length === 0,
      });
    }

    for (const file of context.sourceFiles) {
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
      if (file.includes('/fixtures/') || file.includes('/__fixtures__/')) continue;

      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      if (content.includes('RETIRED_MODEL_PATTERNS')) continue;

      for (const pattern of RETIRED_MODEL_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          findings.push({
            id: `service:model:${file}:${match[0]}`,
            category: 'service',
            label: 'ACTION REQUIRED',
            title: 'Retired or legacy AI model reference',
            summary: `${match[0]} appears in source`,
            evidence: 'move to a current model before provider retirement breaks calls',
            recommendation: 'migrate',
            urgency: 9,
            impact: 8,
            confidence: 8,
            effort: '20 min',
            files: [file],
          });
        }
      }
    }

    if (findings.length === 0) {
      findings.push({
        id: 'service:safe',
        category: 'service',
        label: 'SAFE',
        title: 'No high-signal service/API risk found',
        summary: 'no tracked third-party SDK or retired model reference detected',
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
