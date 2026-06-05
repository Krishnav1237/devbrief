# Contributing to DevBrief

DevBrief is a local-first maintenance intelligence tool. Good contributions make it calmer, more accurate, easier to run, and easier to trust.

## Local Setup

```bash
npm install
npm run build
npm test
```

Run the CLI locally:

```bash
npm run cli -- doctor
npm run cli -- risk
npm run cli -- runtime
npm run cli -- infra
npm run cli -- security
npm run cli -- services
npm run cli -- ops
npm run cli -- cost
npm run cli -- inbox
npm run cli -- weekly
npm run cli -- fix --safe-only
npm run cli -- upgrade express --target 5.0.0
```

Scan a fixture project:

```bash
npm run cli -- doctor --path examples/fixtures/npm-app
npm run cli -- doctor --path examples/fixtures/python-app
npm run cli -- doctor --path examples/fixtures/go-module
```

## Project Structure

```
src/
  cli/            CLI entry point and command definitions
  maintenance/    All scanners and the maintenance engine
    engine.ts     Orchestrates scanners and produces ScanResult
    types.ts      Shared type definitions (MaintenanceFinding, ScanResult, etc.)
    output.ts     Formats results for CLI output
    project-context.ts  Builds ProjectContext from the filesystem
    *-scanner.ts  Individual scanners (dependency, runtime, infra, security, ...)
    upgrade-advisor.ts  Upgrade safety assessment
  server/         Optional HTTP server (Hono) and dashboard
  scheduler/      Cron scheduler for automated pipeline runs
  utils/          Shared utilities (store, purge, config I/O, risk classifier, ...)
  mastra/         Mastra workflow registration (legacy pipeline)
  steps/          Legacy pipeline steps (scrape, summarize, publish, ...)
  models/         Shared type definitions for the legacy pipeline
examples/
  fixtures/       Small copyable project fixtures for testing
docs/
  API.md          HTTP server routes and configuration
  EXAMPLES.md     Sample CLI output for all commands
  RISK_GUIDE.md   Risk labels, recommendation actions, confidence, and categories
```

## Scanner Contributions

Prefer small scanner changes:

- one ecosystem
- one risk category
- one clear evidence source
- one fixture-style test
- one output example if behavior changes

Every scanner finding should include:

- a clear `label` (one of `SAFE`, `REVIEW`, `UPGRADE SOON`, `RISKY`, `EOL`, `ACTION REQUIRED`)
- a short `summary`
- concrete `evidence`
- one `recommendation` action (see `docs/RISK_GUIDE.md` for the full list)
- `confidence` from 0 to 10
- `effort` estimate (`none`, `5 min`, `20 min`, `1 hour+`, `migration likely`)
- `hiddenByDefault: true` for low-signal or advisory findings

Do not report a finding just because something is old. Report it when it changes a developer decision.

Recommended pull request shape:

1. Add or update one scanner in `src/maintenance/`.
2. Add one tiny fixture under `examples/fixtures/` if a new project shape is needed.
3. Add one deterministic test in `src/maintenance/maintenance-engine.test.ts`.
4. Update `docs/EXAMPLES.md` only if visible output changes.

## Adding a New Scanner

1. Create `src/maintenance/my-scanner.ts` implementing the `Scanner` interface:

   ```ts
   import type { Scanner, ProjectContext, MaintenanceFinding } from './types.js';

   export const myScanner: Scanner = {
     name: 'my-scanner',
     async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
       const findings: MaintenanceFinding[] = [];
       // ... your logic
       return findings;
     },
   };
   ```

2. Register the scanner in `src/maintenance/engine.ts` by importing it and adding it to the scanner list.

3. Add a test in `src/maintenance/maintenance-engine.test.ts` using a temporary fixture directory.

## Noise Rules

DevBrief should be useful when the answer is "do nothing."

Use `SAFE` and hidden findings for low-risk signals. Use `REVIEW` when a human should verify context. Reserve `RISKY`, `EOL`, and `ACTION REQUIRED` for evidence-backed issues with real maintenance impact.

## Fixtures and Tests

Tests should use small temporary project fixtures. Cover:

- auto-detection
- scanner correctness
- no-risk output
- hidden-by-default behavior
- missing data fallback
- effort and confidence scoring
- project-specific file evidence

Keep tests deterministic. Avoid relying on live network calls unless the test explicitly mocks or disables them.

The test runner is Vitest. Run all tests:

```bash
npm test
```

Run a single test file:

```bash
npm test -- src/maintenance/maintenance-engine.test.ts
```

Watch mode:

```bash
npm run test:watch
```

## Compatibility

Legacy changelog briefing commands still exist for compatibility. New public-facing work should lead with maintenance intelligence and `devbrief doctor`.

## Good First Issues

Good first contributions include:

- add an ecosystem fixture
- improve a scanner's evidence text
- add a conservative detection rule
- reduce a noisy finding
- improve README examples
- add tests for an unsupported or empty repo
- document a new scanner's output in `docs/EXAMPLES.md`

Use the issue templates for bugs, noisy findings, and scanner requests. A good scanner request names the local evidence file and shows the output DevBrief should print.
