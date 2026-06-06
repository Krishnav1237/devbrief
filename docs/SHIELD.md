# DevBrief Vibe Shield

**Vibe Shield is an optional, advanced runtime sandbox designed to protect developers and AI-assisted workflows from execution risks.**

When running untrusted scripts, tests, or AI-generated code, Vibe Shield intercepts dangerous system operations at the runtime level before they reach the operating system.

---

## Usage

Run any command prefixed with the shield wrapper:

```bash
npx devbrief shield -- <command>
```

### Examples

Run a local Python script securely:
```bash
npx devbrief shield -- python script.py
```

Run package installation or npm scripts:
```bash
npx devbrief shield -- npm install
npx devbrief shield --path ../another-repo -- npm run build
```

### CLI Command Options

- `--path <path>` — Custom project path to confine execution to (defaults to current working directory).
- `--dry-run` — Audit-only mode. Logs warnings but does not block filesystem, network, or command calls.
- `--verbose` — Verbose logging. Prints a message for every intercepted and allowed call.

---

## Sandbox Safeguards

Vibe Shield applies runtime-level interception for **Node.js** and **Python** processes using environment-level preloading hooks.

```
                  ┌───────────────────────────────┐
                  │   npx devbrief shield -- cmd  │
                  └───────────────┬───────────────┘
                                  ▼
         ┌──────────────────────────────────────────────────┐
         │          Environment-Level Preloaders            │
         │   • NODE_OPTIONS: preload.cjs (--require/import) │
         │   • PYTHONPATH: sitecustomize.py                 │
         └────────────────────────┬─────────────────────────┘
                                  ▼
     ┌────────────────────────────┼────────────────────────────┐
     ▼                            ▼                            ▼
┌──────────────┐            ┌──────────────┐             ┌──────────────┐
│  Filesystem  │            │   Subprocess │             │   Outbound   │
│ Confinement  │            │  Spawn Block │             │ Network Leak │
└──────────────┘            └──────────────┘             └──────────────┘
```

### 1. Filesystem Confinement
*   **Write & Delete Restrictions:** Restricts all file writes and deletions (`fs` operations in Node, and audit events in Python) to the workspace root directory and system temporary directories (e.g. `/tmp` or `os.tmpdir()`).
*   **Sensitive Folder Protection:** Blocks read access to sensitive system and user directories (e.g. `~/.ssh`, `~/.aws`, `~/.kube`, `/etc/passwd`).

### 2. Command Injection Prevention
*   **API Interception:** Intercepts child process spawn operations (`child_process.spawn`, `exec`, `execSync`).
*   **Payload Analysis:** Evaluates command strings and arguments for shell injections, blocking suspicious chained commands, downloader tools, or reverse shells (e.g. `curl`, `wget`, `nc`, `/bin/sh`).

### 3. Outbound Secrets Leakage Prevention
*   **Secret Loading:** Automatically extracts active secrets from your `.env` file on startup.
*   **Network Auditing:** Hooks outbound HTTP/HTTPS connections and socket writes. 
*   **Exfiltration Block:** Scans payloads, headers, and query strings in real time. If a loaded secret is detected in a request to an untrusted domain (e.g. sending your `OPENAI_API_KEY` to `malicious-domain.com` instead of `api.openai.com`), the connection is terminated instantly.

---

## Runtime Integration Mechanics

Vibe Shield does not require root privileges or container runtimes (like Docker). Instead, it injects hooks during runtime initialization:

*   **Node.js preloader (`preload.cjs`):** Configured via the `NODE_OPTIONS` environment variable. For Node.js versions >= 20, it uses both `--require` and `--import` flag mappings to guarantee ESM and CommonJS load coverage. Single-load guard variables prevent duplicate evaluation.
*   **Python preloader (`sitecustomize.py`):** Configured by prepending the preloader directory to `PYTHONPATH`, causing Python to automatically load the shield hooks before running the user script.

---

## Environment Configuration

You can customize Vibe Shield behavior by exporting the following environment variables:

| Variable | Default | Description |
|---|---|---|
| `DEVBRIEF_SHIELD_WORKSPACE` | Current working directory | Absolute path to the allowed workspace for file operations. |
| `DEVBRIEF_SHIELD_DRY_RUN` | `false` | If set to `true`, logs warnings for blocked calls but does not intercept them. |
| `DEVBRIEF_SHIELD_VERBOSE` | `false` | If set to `true`, logs details of allowed operations. |
| `DEVBRIEF_SHIELD_SECRETS` | Extracted from `.env` | JSON string of active secrets monitored to prevent network leaks. |
