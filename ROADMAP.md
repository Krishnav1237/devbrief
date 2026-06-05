# DevBrief Roadmap

This document outlines the planned future features and directions for the DevBrief Project Maintenance Intelligence engine.

---

## Phase 2: Retention & Historical Analysis

To encourage long-term adoption and integrate DevBrief into continuous inspection workflows, we plan to implement the following features:

### 1. Health History Tracking (`devbrief trend`)
- Query local SQLite run history to graph and display project health changes over time.
- Command layout:
  ```bash
  npx devbrief trend
  ```
- Compare finding states between the current execution and the last run, or runs from 7/30 days ago:
  ```text
  Health Trend:
    30 days ago: 64
    Today: 84 (Improved!)

  Improved:
    ✓ Runtime upgraded to Node 22
    ✓ 2 dependencies vulnerabilities fixed

  New:
    ⚠ Docker image tag drift detected
  ```

---

## Phase 3: Advanced Integrations

- **GitHub Action App**: Provide a native GitHub Action wrapper that posts the DevBrief markdown report as a PR comment or workflow summary.
- **IDE Extensions**: Lightweight VS Code and JetBrains extension that highlights EOL or risky dependencies directly in `package.json` and manifests.
- **Visual Desktop Companion**: A local tray utility that scans your development directory and pops a clean tray menu showing a local health radar.
