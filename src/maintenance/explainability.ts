import type { MaintenanceFinding } from './types.js';

/**
 * Returns a human-readable explanation of why a given finding matters.
 * Tailored to juniors, indie hackers, and AI-assisted coders who may not be
 * familiar with project maintenance concepts.
 *
 * Uses the category, title, evidence, and recommendation properties for future-proof matching.
 */
export function getWhyItMatters(finding: Omit<MaintenanceFinding, 'whyItMatters'>): string {
  const category = finding.category;
  const title = finding.title.toLowerCase();
  const summary = finding.summary.toLowerCase();
  const evidence = (finding.evidence ?? '').toLowerCase();

  // 1. Runtime Lifecycle
  if (category === 'runtime') {
    if (summary.includes('eol') || title.includes('eol') || summary.includes('end-of-life')) {
      return 'Security fixes and critical patches no longer ship after a runtime reaches End-of-Life (EOL).';
    }
    return 'Drift in runtime versions between development and production can cause silent runtime crashes.';
  }

  // 2. Vulnerabilities
  if (category === 'vulnerability') {
    return 'Known vulnerabilities in dependencies can be exploited to bypass authentication, steal data, or crash your service.';
  }

  // 3. Infrastructure Drift
  if (category === 'infra') {
    if (summary.includes('floating') || summary.includes('latest') || evidence.includes('latest')) {
      return 'Floating tags (like "latest") pull different container versions unpredictably, leading to broken builds in production.';
    }
    if (summary.includes('go.sum') || evidence.includes('checksum')) {
      return 'Repeatable builds require lock/checksum files to guarantee the code you compile hasn\'t been modified.';
    }
    return 'Drift in runner configurations or container engines leads to "works on my machine" deployment bugs.';
  }

  // 4. Security & Posture
  if (category === 'security') {
    if (summary.includes('cors') || title.includes('cors') || evidence.includes('*')) {
      return 'Permissive wildcard CORS headers allow arbitrary third-party websites to read private API responses in the user\'s browser.';
    }
    if (summary.includes('.env') || title.includes('secret') || title.includes('env file')) {
      return 'Committed environment files leak API keys, database credentials, and session secrets to anyone with repository access.';
    }
    if (summary.includes('undocumented') || title.includes('undocumented')) {
      return 'Referencing environment variables in code without declaring them in .env.example prevents other developers or CI/CD servers from configuring the application correctly.';
    }
    if (summary.includes('missing local') || title.includes('missing local') || title.includes('missing from your local')) {
      return 'Missing local env values cause runtime reference errors and crash application processes on startup.';
    }
    if (summary.includes('typosquatting') || title.includes('typosquatting')) {
      return 'Typosquatted packages mimic popular libraries with slight name changes to trick developers into installing them, enabling execution of malicious code.';
    }
    if (summary.includes('hallucinated') || title.includes('hallucinated')) {
      return 'Hallucinated dependencies do not exist on public registries. Attackers register these hallucinated names to run dependency confusion attacks and compromise codebases.';
    }
    if (summary.includes('recently published') || title.includes('recently published') || title.includes('brand-new')) {
      return 'Recently published packages have higher security risk as they have not been vetted by the community and are common targets for malware distribution.';
    }
    return 'Weak security postures leave your endpoints vulnerable to scanning bots and automated attacks.';
  }

  // 5. Service Drift
  if (category === 'service') {
    return 'Outdated third-party API SDKs are deprecated by service providers and will eventually fail to connect.';
  }

  // 6. Operational Signals
  if (category === 'ops') {
    if (summary.includes('timeout') || title.includes('timeout') || summary.includes('stuck')) {
      return 'Un-timed background cron jobs or CI workflows can hang indefinitely, blocking deployments and run up server bills.';
    }
    if (title.includes('health') || summary.includes('probe')) {
      return 'Without smoke tests or health checks, container orchestrators can\'t detect and restart dead applications.';
    }
    return 'Lack of operational backups or checkups risks silent data loss and unmonitored server failures.';
  }

  // 7. Dependencies (Version gaps, etc.)
  if (category === 'dependency') {
    if (summary.includes('major') || title.includes('major') || summary.includes('crosses')) {
      return 'Major version updates cross breaking-change boundaries, meaning they change APIs and require code updates.';
    }
    if (summary.includes('phantom') || title.includes('phantom')) {
      return 'Phantom dependencies are imported in code but not declared in manifests. They work locally by accident but will fail during clean builds, deployment, or CI.';
    }
    if (summary.includes('unused') || title.includes('unused')) {
      return 'Unused dependencies bloat the container image size, slow down npm install times, and increase the security attack surface.';
    }
    return 'Outdated dependencies fall behind on optimizations and make it harder to apply future security hotfixes.';
  }

  // Fallback default
  return 'Neglected maintenance debt compounds over time, making future upgrades risky and prone to compilation errors.';
}
