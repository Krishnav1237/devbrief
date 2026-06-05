# DevBrief Risk Guide

DevBrief maps automated scan findings to human-centric risk labels and maintenance decisions.

---

## Risk Labels

| Label | Meaning | Recommended Action |
|---|---|---|
| `SAFE` | No current action needed | Ignore |
| `REVIEW` | Check context before changing code | Review or monitor |
| `UPGRADE SOON` | Plan a low/medium urgency update | Upgrade during standard cycles |
| `RISKY` | Real breakage or production bugs are plausible | Review before code changes |
| `EOL` | Runtime support has ended; security alerts are dead | Upgrade or migrate |
| `ACTION REQUIRED` | Direct security vulnerability or production failure | Remediate immediately |

---

## Recommendation Actions

Every finding returns a clear `recommendation`:

- `ignore` — Informational only. No action needed.
- `monitor` — Watch for deprecation dates or drift without acting today.
- `review` — Code inspection is needed to evaluate impact.
- `upgrade` — Apply a package or runtime version bump.
- `migrate` — Involves major version adaptations or API changes.
- `remediate` — Simple file fixes (e.g. remove committed `.env` files).

---

## Qualitative Confidence Mappings

To avoid arbitrary numbering that developers cannot verify, DevBrief formats confidence levels as qualitative groupings:

- **High**: The engine has direct, definitive proof of the risk (e.g., matching a locked package name to an active CVE identifier, or parsing an expired official EOL date).
- **Medium**: Strong heuristic signals are present, but local project configuration or source code context should be reviewed to confirm actionability.
- **Low**: Speculative findings (e.g. general code weights, missing local testing scripts). These are marked `hiddenByDefault: true` and never surfaced in standard outputs.

---

## Health Score & Categories

Health scores (0–100) are compiled by deducting weighted penalties from a perfect 100 base score. This score is split into four user-centric categories:

### 1. Runtime Lifecycle (Max 25 pts)
Scans Node.js, Python, and Docker runtimes for active lifecycle state and EOL deadlines.

### 2. Dependency Risk (Max 25 pts)
Scans package locks and manifests for vulnerabilities, outdated majors, and deprecated libraries.

### 3. Infrastructure (Max 25 pts)
Checks Docker files, compose setups, and GitHub Action runners for tag drift or outdated base specs.

### 4. Security & Services (Max 25 pts)
Scans for exposed secrets, wildcard CORS parameters, and deprecated API SDK integrations (e.g., Stripe, OpenAI).
