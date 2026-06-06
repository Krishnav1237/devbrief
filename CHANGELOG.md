# Changelog

All notable changes to DevBrief are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
DevBrief uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- `shield -- <cmd>` command: runtime execution sandbox wrapper to block filesystem writes/deletions outside workspace, restrict reading sensitive folders (`~/.ssh`, `~/.aws`, `~/.kube`, `/etc/passwd`), prevent command injections, and block HTTP exfiltration of secrets to untrusted domains. Supports Node.js (both CommonJS and ESM preloading hooks using `--require` and `--import`) and Python runtimes natively with single-load safety guards.
- `clean-secrets` command: scans codebase for hardcoded secrets and placeholders using a token-level state machine parser (`extractStringLiterals`), extracts them into `.env`, and updates file references to load them from environment, preventing comments alteration.
- Interactive upgrades & fixes prompt: `devbrief fix` launches a zero-dependency ANSI-based console select menu in interactive TTY environments to review and toggle upgrades.
- Dynamic Scanner plugin loader: loader utility that automatically scans `.devbrief/plugins` and registers custom scans at runtime.
- `risk` command: dedicated dependency and vulnerability risk scan
- `ops` command: operational health signals (health checks, scheduled workflow timeouts, backup hints)
- `cost` command: local build and dependency weight signals
- `inbox` command: urgent items and safe wins in a compact format
- `weekly` command: compact weekly maintenance plan
- `fix --safe-only` command: conservative remediation path (identifies but does not yet auto-apply)
- `node-upgrade` alias for `runtime` command
- `--exit-code` flag on all scan commands: `0` safe, `1` review, `2` risky/EOL/action required
- `--quiet` flag: print only summary, health score, and next action
- `--json` flag: machine-readable JSON output on all scan commands
- `--expanded` flag: show hidden low-signal findings
- `--path <dir>` flag: scan a different directory without changing the working directory
- HTTP dashboard at `GET /dashboard` with category filter, health score, and live refresh
- `GET /api/dashboard/summary` JSON endpoint for the maintenance radar
- `GROQ_MODEL` environment variable to override the LLM model name
- Shared `src/utils/network.ts` utility for Tailscale IP detection (removes circular dependency)
- SQLite `busy_timeout: 5000` to prevent lock errors under concurrent access
- Atomic transaction wrapping in `src/utils/purge.ts`
- UUID validation on `GET /audio/:run_id` to block path traversal
- Package name regex validation in `upgrade-advisor.ts` subprocess calls
- Dependency vulnerability scan integration in `risk-classifier.ts`
- `runAction` error-handling wrapper in CLI to prevent unhandled promise rejections
- Comprehensive audit fix test suite in `tests/properties/audit-fixes.test.ts`
- Python/Rust/Go import detection in `impact-analysis.ts`
- Go, Python, and Cargo dependency parsing in `project-context.ts`
- Case-insensitive Docker instruction parsing in `infra-scanner.ts`
- Improved version regex and legacy EOL detection in `runtime-scanner.ts`
- Fixed CORS wildcard regex in `security-scanner.ts`
- HydraDB cloud-level deduplication in the pipeline workflow
- Run ID propagation fix connecting `POST /trigger` to the pipeline

### Changed

- `detectTailscaleIP` moved from `src/server/index.ts` to `src/utils/network.ts` to resolve circular dependency
- `src/index.ts`: SQLite store is now closed gracefully on `SIGINT`/`SIGTERM`

---

## [0.1.0] — Initial Release

### Added

- `doctor` command: full maintenance radar across all scanner categories
- `upgrade <package>` command: safe upgrade assessment for a named dependency
- `runtime` command: Node.js and Python EOL guidance
- `infra` command: Docker, Compose, GitHub Actions, Terraform/Kubernetes/Helm drift
- `security` command: conservative local security posture checks
- `services` command: SDK and third-party API risk signals
- `stack` subcommands: `add`, `remove`, `list` for legacy changelog pipeline configuration
- `run` command: manual trigger for the legacy briefing pipeline
- HTTP server with `POST /trigger`, `GET /runs`, `GET /runs/:run_id`, `GET /digest/:run_id`, `GET /audio/:run_id`
- Cron scheduler for automatic daily pipeline runs
- SQLite storage for run history and change entries
- HydraDB optional cloud storage integration
- Mastra workflow registration for the legacy briefing pipeline
- Support for JavaScript/TypeScript, Python, Rust, Go, Java/JVM, and infra-only project scanning
- Ecosystem fixtures in `examples/fixtures/`
- Issue templates: bug report and scanner request
