# DevBrief

**Project Maintenance Intelligence for developers.**

DevBrief is a local-first, zero-setup CLI that tells you what actually needs your attention in a project, what will break, and what you can safely ignore.

```bash
npx devbrief doctor
```

No configuration. No API keys. No SaaS account. Run it in any repository and get a calm maintenance report in seconds.

---

## What is DevBrief?

**DevBrief sits between:**

- **Dependabot / Renovate** (which generate automated noise and PR spams)
- **Snyk / Trivy** (which dump massive vulnerability reports)
- **endoflife.date** (which lists raw lifecycle timelines)

Instead of generating more alerts, DevBrief answers:

- **What matters?** (Which dependencies are actively used in code)
- **What can wait?** (What risks are isolated or hidden behind dev dependencies)
- **What will break?** (What upgrades cross major boundaries or affect import paths)
- **What should I do next?** (The smallest, high-confidence maintenance step)

---

## Running Your First Scan

Run without installing:

```bash
npx devbrief doctor
```

### Example Report:

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

## ⚡ The Killer Feature: Multi-Ecosystem Upgrade Confidence

DevBrief parses your project imports to check if upgrading a package will break your code. It supports JavaScript/TypeScript, Python (PyPI), Rust (Crates.io), and Go (Go Proxy) ecosystems natively:

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

## Scanner Maturity Levels

DevBrief is transparent about what it can prove. We categorize our scans by maturity:

### Stable
- **Runtime Lifecycle**: Node.js and Python EOL checks (fetching dynamic timelines from [endoflife.date](https://endoflife.date) with local caching).
- **Dependency Risk**: Dynamic auditing across npm, pnpm, yarn, and bun depending on lockfiles; major version gaps; native module rebuild risks.
- **Upgrade Confidence**: Repository import cross-referencing and target version checks across **npm**, **PyPI**, **Crates.io**, and **Go Proxy** registries.
- **Safe Remediation**: Automates low-risk package upgrades with a safeguard checking `git status --porcelain` before making local changes.

### Beta
- **Infrastructure Drift**: Floating image tags, old runners, and Compose configuration mismatches.
- **Services Deprecation**: Deprecating vendor SDK versions (e.g. Stripe, OpenAI, Clerk, Twilio).

### Experimental
- **Operational Signals**: Missing local smoke checks, un-timed CI cron definitions, and backup schedules. (Cost and ops checks are hidden by default to preserve developer trust).

---

## Who It Is For

- **Solo Developers & Indie Hackers** who don't have time to sort through 40 warning emails.
- **Startup Engineers** looking for a zero-setup view of codebase tech debt.
- **Open Source Maintainers** wanting to keep actions and base configurations clean.
- **Small Teams** who want high-signal, actionable maintenance recommendations.

---

## CLI Commands

All primary and secondary commands support formatting options (e.g. for CI/CD integrations) via the `--format` flag:
*   `--format text` (Default CLI output)
*   `--format markdown` (Collapsible GitHub Summary markdown format)
*   `--format json` (Raw JSON payload)
*   `--format quiet` (No console output, sets correct exit codes)

### Primary Commands
- `npx devbrief doctor` — Full maintenance radar (scans all categories).
- `npx devbrief upgrade <package>` — Evaluates if a dependency upgrade is safe for this project (supporting npm, PyPI, Crates.io, and Go Proxy).
- `npx devbrief runtime` — Checks runtime EOL state (alias: `node-upgrade`).
- `npx devbrief inbox` — Lists only urgent items and quick safe wins.

### Secondary Commands
- `npx devbrief risk` — Scan dependency vulnerabilities and lifecycle risks.
- `npx devbrief infra` — Check Docker, Compose, and CI runner configurations.
- `npx devbrief security` — Check security posture (committed `.env`, wildcard CORS, debug flags).
- `npx devbrief services` — Detect drift in third-party API SDKs.
- `npx devbrief weekly` — Builds a compact weekly plan.
- `npx devbrief fix --safe-only` — Automatically applies low-risk, high-confidence minor and patch dependency updates (requires a clean git working directory, checked via `git status --porcelain`).

---

## Trust Model

- **Local First**: Scans and evaluates entirely on your machine.
- **Calm & Conservative**: Low-signal or speculative alerts are hidden by default.
- **Zero Configuration**: Works without API keys, environment files, or dashboards.
- **Resilient**: Degrades gracefully when network services (e.g. `npm audit`) are offline.

---

## Documentation Links

- [docs/RISK_GUIDE.md](docs/RISK_GUIDE.md) — Scoring, confidence levels, and risk definitions.
- [docs/EXAMPLES.md](docs/EXAMPLES.md) — Raw CLI outputs for all commands.
- [docs/CONFIG.md](docs/CONFIG.md) — Local port and database locations.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — How the engine parses files and handles monorepos.
- [docs/LEGACY.md](docs/LEGACY.md) — Legacy release briefing and TTS documentation.

---

## Contributing

We welcome small, evidence-backed improvements. Please read [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

## Legacy Compatibility

For backwards compatibility, the legacy release briefing pipeline remains available. Commands (`devbrief run` and `devbrief stack`) and API integrations are fully isolated. See [docs/LEGACY.md](docs/LEGACY.md) for details.
