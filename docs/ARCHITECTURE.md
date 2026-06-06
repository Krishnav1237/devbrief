# DevBrief Architecture

DevBrief is built around a single core tenet: **calm, evidence-backed project maintenance intelligence**. 

Instead of alerting you about everything that is old, DevBrief acts as a filter to tell you what actually needs your attention today, what can wait, and what you can safely ignore.

---

## Technical Architecture

The codebase is split into three layers:

```
┌───────────────────────────────────────────────┐
│                   CLI / API                   │
└───────────────────────┬───────────────────────┘
                        ▼
┌───────────────────────────────────────────────┐
│              Maintenance Engine               │
└───────────────────────┬───────────────────────┘
                        ▼
┌───────────────────────────────────────────────┐
│        Local Project Context & Files          │
└───────────────────────────────────────────────┘
```

### 1. Local Project Context (`src/maintenance/project-context.ts`)
DevBrief parses local files in a project directory. It builds a `ProjectContext` mapping:
- Auto-detected programming languages and frameworks (Ecosystems)
- Package manifests (e.g. `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`)
- Configuration files, Dockerfiles, and CI workflows
- Project dependencies and exact locked versions

### 2. Maintenance Engine (`src/maintenance/engine.ts`)
The engine runs registered scanners concurrently against the `ProjectContext`. It handles scanner failures gracefully, reducing finding confidence rather than aborting the entire process.

### 3. Recommendation Engine (`src/maintenance/recommendation-engine.ts`)
Determines the health score and ranks findings based on their severity, urgency, and confidence.

---

## Scanner Maturity Levels

DevBrief maintains a clear separation of concern and flags scanners based on their maturity. This ensures trust is maintained and speculative findings are never surfaced prominently.

### Stable
- **Runtime Lifecycle** (`runtime-scanner.ts`): Inspects Node.js, Python, and base Docker runtimes. Lifecycle timelines are fetched dynamically from [endoflife.date](https://endoflife.date) with local cache files stored in `~/.devbrief/` for offline-first support.
- **Dependency Risk** (`dependency-scanner.ts`): Scrapes local manifests to identify major version gaps, native module risk, and deprecated packages.
- **Vibe Coding Safety Engine** (`vibe-scanner.ts`): Scans accessed environment variables across JS, Python, Go, and Rust codebases to flag undocumented env keys (`.env.example` drift) or missing local configurations (`.env`). Performs static import analysis to detect phantom dependencies (used in code but unlisted in manifests) or bloated dependencies (listed but never imported).
- **Security Posture & AI Placeholders** (`security-scanner.ts`): Checks for exposed secrets (AWS, OpenAI, GitHub, Slack, Private Keys), weak JWT secrets, wildcard CORS configurations, and unignored `.env` local file leak risks using native `git check-ignore` command executions. Also scans for copy-pasted AI-generated placeholder credentials (e.g. `YOUR_API_KEY_HERE`, `sk_test_placeholder`).
- **Vulnerability Auditing** (`vulnerability-detector.ts`): Audits packages dynamically by auto-detecting lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`) and running the native package manager command, parsing various formats natively.
- **Upgrade Confidence** (`upgrade-advisor.ts`): Evaluates target package versions against your repository imports to verify if you actively use affected entry points. Supports **npm**, **PyPI**, **Crates.io** (with proper User-Agent headers), and **Go Proxy** (with capital module path escaping) registries via high-performance direct HTTP requests routed through a **Resilient Registry Client** (`registry-client.ts`) featuring outbound throttling (limit: 5), exponential retry with jitter, 12h local file cache, and clean offline-first degradation (`DEVBRIEF_OFFLINE=1`).
- **Safe Remediation & Git Hook Automation** (`cli/index.ts`): 
  - Applies automatic minor/patch upgrades via `fix --safe-only` in a workspace-aware manner, verified by `git status --porcelain`.
  - Installs/updates pre-commit git hooks via `init-hook` to run scans automatically on commit (`devbrief doctor --exit-code --quiet`), supporting automatic backups of pre-existing hooks.

### Beta
- **Infrastructure Drift** (`infra-scanner.ts`): Analyzes Docker base images, Compose files, and GitHub Actions setups for outdated instructions or runner drift.
- **Services Deprecation** (`service-scanner.ts`): Identifies old vendor SDKs or API integrations (e.g. Stripe, OpenAI, Twilio) that are nearing deprecation.

### Experimental
- **Operational Signals** (`ops-scanner.ts`): Scans for missing local smoke tests, unscheduled cron timeouts, and backup routines. Cost and operational findings are marked `hiddenByDefault: true` and are only shown when explicitly requested or expanded.

---

## Monorepo Workspaces Support

DevBrief treats monorepos as first-class citizens. 

When a scan is run in a monorepo workspace (e.g. containing Turborepo, pnpm workspaces, Nx, or nested packages), the project context loader:
1. Detects nested manifest files (e.g., `apps/web/package.json`, `apps/api/package.json`).
2. Registers them as distinct `projectRoots`.
3. Reports files relative to the workspace root, mapping findings to specific directories (e.g., `apps/web` or `packages/shared`).

Sub-project health breakdown is printed automatically when multiple project roots are detected.
