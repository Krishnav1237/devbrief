import { fetchWithRegistryClient, RegistryNotFoundError } from '../utils/registry-client.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

const POPULAR_PACKAGES = new Set([
  // JavaScript/TypeScript
  'express', 'lodash', 'axios', 'react', 'react-dom', 'vue', 'next', 'typescript', 'vite',
  'uuid', 'chalk', 'commander', 'dotenv', 'jest', 'vitest', 'tslib', 'webpack',
  // Python
  'requests', 'numpy', 'pandas', 'scipy', 'django', 'flask', 'fastapi', 'urllib3',
  'cryptography', 'jinja2', 'pytest', 'pip', 'boto3',
  // Rust
  'serde', 'tokio', 'syn', 'quote', 'rand', 'clap', 'regex', 'lazy_static',
  // Go
  'github.com/gin-gonic/gin', 'github.com/stretchr/testify', 'github.com/spf13/cobra',
]);

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // Deletion
          dp[i][j - 1] + 1,    // Insertion
          dp[i - 1][j - 1] + 1 // Substitution
        );
      }
    }
  }
  return dp[m][n];
}

function typosquatFinding(
  id: string,
  label: MaintenanceFinding['label'],
  summary: string,
  evidence: string,
  packageName: string,
): MaintenanceFinding {
  return {
    id,
    category: 'security',
    label,
    title: summary,
    summary,
    evidence,
    recommendation: label === 'ACTION REQUIRED' ? 'remediate' : 'review',
    urgency: label === 'ACTION REQUIRED' ? 10 : 8,
    impact: label === 'ACTION REQUIRED' ? 10 : 7,
    confidence: 9,
    effort: '20 min',
    packageName,
    files: ['package.json'],
  };
}

export const typosquattingScanner: Scanner = {
  name: 'typosquatting-detection',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];
    const manifestFiles = context.files.filter((f) =>
      ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod'].includes(f)
    );

    const checkPromises = context.dependencies.map(async (dep) => {
      const depName = dep.name.toLowerCase();

      // 1. Check for typosquatting (local Levenshtein check)
      if (!POPULAR_PACKAGES.has(depName)) {
        for (const popular of POPULAR_PACKAGES) {
          const dist = levenshteinDistance(depName, popular);
          if (dist === 1 || dist === 2) {
            findings.push(typosquatFinding(
              `security:typosquatting:${dep.name}`,
              'RISKY',
              `Potential typosquatting attempt: ${dep.name}`,
              `resembles popular package "${popular}" (Levenshtein distance: ${dist})`,
              dep.name,
            ));
            break;
          }
        }
      }

      // 2. Registry checks (hallucinated package & brand-new check)
      if (process.env.DEVBRIEF_OFFLINE === '1') {
        return;
      }

      try {
        let registryUrl = '';
        if (!dep.ecosystem || dep.ecosystem === 'JavaScript/TypeScript') {
          registryUrl = `https://registry.npmjs.org/${dep.name}`;
        } else if (dep.ecosystem === 'Python') {
          registryUrl = `https://pypi.org/pypi/${dep.name}/json`;
        } else if (dep.ecosystem === 'Rust') {
          registryUrl = `https://crates.io/api/v1/crates/${dep.name}`;
        }

        if (!registryUrl) return;

        const headers = dep.ecosystem === 'Rust'
          ? { 'User-Agent': 'DevBrief/1.0 (contact@devbrief.com)' }
          : undefined;

        const data = await fetchWithRegistryClient<any>(registryUrl, { headers, timeout: 5000, throwOn404: true });
        if (!data) return;

        // Extract creation date if present
        let createdDateStr = '';
        if (dep.ecosystem === 'Rust') {
          createdDateStr = data.crate?.created_at;
        } else if (dep.ecosystem === 'Python') {
          const version = data.info?.version;
          createdDateStr = data.releases?.[version]?.[0]?.upload_time;
        } else {
          createdDateStr = data.time?.created;
        }

        if (createdDateStr) {
          const createdTime = new Date(createdDateStr).getTime();
          if (!isNaN(createdTime)) {
            const ageMs = Date.now() - createdTime;
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
            if (ageMs > 0 && ageMs < thirtyDaysMs) {
              findings.push(typosquatFinding(
                `security:brand-new-package:${dep.name}`,
                'RISKY',
                `Recently published package: ${dep.name}`,
                `published within the last 30 days (${new Date(createdTime).toLocaleDateString()})`,
                dep.name,
              ));
            }
          }
        }
      } catch (err: any) {
        if (err && (err.name === 'RegistryNotFoundError' || err instanceof RegistryNotFoundError)) {
          findings.push(typosquatFinding(
            `security:hallucinated-package:${dep.name}`,
            'ACTION REQUIRED',
            `Hallucinated dependency detected: ${dep.name}`,
            `package not found in the public registry. LLM hallucination or invalid dependency confusion risk`,
            dep.name,
          ));
        }
      }
    });

    await Promise.all(checkPromises);

    return findings;
  },
};
