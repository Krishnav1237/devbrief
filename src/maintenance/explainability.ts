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
    return 'Outdated dependencies fall behind on optimizations and make it harder to apply future security hotfixes.';
  }

  // Fallback default
  return 'Neglected maintenance debt compounds over time, making future upgrades risky and prone to compilation errors.';
}
