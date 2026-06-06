# Contributing to DevBrief

DevBrief is a local-first project maintenance intelligence tool. Good contributions make it calmer, more accurate, and easier to trust.

---

## Local Setup

Make sure you have Node.js (>= 18) installed.

```bash
# Clone the repository and install dependencies
git clone https://github.com/Krishnav1237/devbrief.git
cd devbrief
npm install

# Build the TypeScript compiler
npm run build

# Run unit and integration tests
npm test
```

### Run CLI Locally

You can execute the TypeScript entry point directly using `tsx`:

```bash
npm run cli -- doctor
npm run cli -- risk
npm run cli -- upgrade express --target 5.0.0
```

To run against a fixture project:

```bash
npm run cli -- doctor --path examples/fixtures/npm-app
```

---

## Codebase Map

- [src/cli/](file:///Users/HP/devbrief/src/cli/) — CLI parser and terminal command outputs.
- [src/maintenance/](file:///Users/HP/devbrief/src/maintenance/) — All core scanning intelligence.
  - [engine.ts](file:///Users/HP/devbrief/src/maintenance/engine.ts) — Orchestrator compiling scanner outputs.
  - [project-context.ts](file:///Users/HP/devbrief/src/maintenance/project-context.ts) — File walks and manifest parsing.
  - [explainability.ts](file:///Users/HP/devbrief/src/maintenance/explainability.ts) — Explainability layer ("Why this matters").
  - [types.ts](file:///Users/HP/devbrief/src/maintenance/types.ts) — Scanner and finding interfaces.
- [docs/](file:///Users/HP/devbrief/docs/) — Documentation.

---

## Adding a Scanner

Scanners are registered in `src/maintenance/engine.ts`. They implement the `Scanner` interface from `types.ts`:

```ts
export interface Scanner {
  name: string;
  scan(context: ProjectContext): Promise<MaintenanceFinding[]>;
}
```

Every scanner finding must return:
- `id` — Unique identifier (e.g. `security:wildcard-cors`).
- `category` — Finding category (e.g. `runtime`, `dependency`, `security`).
- `label` — Urgency label (`SAFE`, `REVIEW`, `UPGRADE SOON`, `RISKY`, `EOL`, `ACTION REQUIRED`).
- `recommendation` — Concrete action (`ignore`, `monitor`, `review`, `upgrade`, `remediate`).
- `confidence` — Heuristic confidence (numeric, mapped to High/Medium/Low during output).
- `effort` — Effort estimate (`none`, `5 min`, `20 min`, `1 hour+`, `migration likely`).
- `files` — Array of file paths acting as evidence.

Speculative or low-confidence findings must be set to `hiddenByDefault: true` so they do not clutter standard reports or lower the health score unnecessarily.

### Resilient Network Requests
If your scanner needs to fetch remote resources (e.g. library registry metrics or deprecation API timelines), **do not use `axios` directly**. Instead, import and use the throttled, cached registry client helper:

```ts
import { fetchWithRegistryClient } from '../utils/registry-client.js';

const data = await fetchWithRegistryClient<MyResponseSchema>(url, { timeout: 5000 });
```

This guarantees your scanner respects the offline flag (`DEVBRIEF_OFFLINE=1`), concurrency throttling, local file caching, and retry logic.

---

## Submitting Pull Requests

1. Write a focused scanner or logic fix in `src/maintenance/`.
2. Add a tiny fixture project under `examples/fixtures/` if testing a new framework manifest.
3. Write deterministic tests in `src/maintenance/maintenance-engine.test.ts`.
4. Ensure all tests pass with `npm test`.
