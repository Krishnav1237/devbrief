# DevBrief Risk & Maturity Guide

DevBrief maps automated scan findings to human-centric risk labels, recommendation actions, and project health scores.

---

## Risk Labels

| Label | Meaning | Recommended Action |
|---|---|---|
| `SAFE` | No current action needed | Ignore or monitor |
| `REVIEW` | Check code/configuration context before changing code | Review manually |
| `UPGRADE SOON` | Plan a low/medium urgency version update | Upgrade during regular maintenance |
| `RISKY` | Plausible production bugs, regressions, or vulnerability exposures | Review and plan mitigation |
| `EOL` | Runtime or version support has ended; security updates are no longer shipped | Upgrade immediately |
| `ACTION REQUIRED` | Direct security vulnerability or severe configuration error | Remediate immediately |

---

## Recommendation Actions

Every finding returns a clear `recommendation`:

*   `ignore` — Informational only. No action is required.
*   `monitor` — Watch for upcoming deprecation dates or drift without taking action today.
*   `review` — Static code inspection or manual verification is required.
*   `upgrade` — Apply a package or runtime version bump.
*   `migrate` — Requires structural adaptations, import changes, or API updates.
*   `remediate` — Simple file fixes (e.g. removing unignored `.env` files or extracting hardcoded credentials).

---

## Qualitative Confidence Mappings

To avoid arbitrary numbering that developers cannot verify, DevBrief categories confidence levels qualitatively:

*   **High:** The engine has direct, definitive proof of the risk (e.g., matching a locked package name to an active CVE identifier, or parsing an expired runtime EOL date).
*   **Medium:** Strong heuristic signals are present, but local project configuration or source code context should be reviewed to confirm actionability.
*   **Low:** Speculative findings. These are marked `hiddenByDefault: true` and are never surfaced in standard outputs to avoid alert fatigue.

---

## Scanner Maturity Levels

DevBrief is transparent about what it can prove. We categorize our scans by maturity:

### 🟢 Stable
Scanners that operate with minimal false positives and provide deterministic actionability:
*   **Runtime Lifecycle:** Checks Node.js and Python runtimes against official EOL timelines.
*   **Dependency Risk:** Audits package manifests for major version gaps and deprecated dependencies.
*   **Vulnerability Detection:** Integrates with local lockfile auditing tools to resolve active CVEs.
*   **Upgrade Confidence:** Evaluates target package version changes against your repository imports to check for affected entry points.
*   **Security Posture:** Checks for unignored `.env` files, weak JWT tokens, and exposed credentials.

### 🟡 Beta
Scanners that are highly useful but may require context checks:
*   **Infrastructure Drift:** Detects outdated Docker base images, Docker Compose versions, and GitHub Actions runner configurations.
*   **Service Deprecation:** Identifies old vendor SDK integrations (e.g., Stripe, OpenAI) that are nearing API deprecation.
*   **Vibe Coding Safety:** Analyzes undocumented environment variables (drift between `.env` and `.env.example`), phantom dependencies (imported but not declared), and unused dependencies.

### 🔴 Experimental
Scanners targeting edge-case operational issues:
*   **Operational Signals:** Checks for missing local smoke tests, untimed CI crons, and backup schedules. (Operational findings are hidden by default).

---

## Trust Model

*   **Local First:** All scans, parser operations, and dependency reviews run entirely on your local machine. No code is transmitted to external servers.
*   **Calm & Conservative:** Speculative or low-signal alerts are filtered out by default to preserve developer focus.
*   **Zero Configuration:** Designed to work out of the box without requiring API keys, SaaS accounts, or config files.
*   **Resilient:** Degrades gracefully when network registries (e.g. npm or endoflife.date) are offline, falling back to local database caches.

---

## ⚠️ Security of Plugins

> [!WARNING]
> Custom scanner plugins execute local code inside the DevBrief engine process.
> *   Only load custom scanner plugins from trusted sources.
> *   Do not download or run unverified plugins.
> *   Place project-specific plugins in the local `.devbrief/plugins/` folder only after conducting a code review.
