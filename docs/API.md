# DevBrief Local Server & Dashboard API

The optional local HTTP server serves the DevBrief Dashboard and exposes JSON telemetry. It operates entirely locally over your Tailscale interface or local loopback.

---

## Server Commands

```bash
# Starts the server in development mode
npm run dev

# Starts the server in production mode
npm start

# Runs the installed server directly
npx devbrief-server
```

---

## Dashboard Endpoint

### `GET /dashboard`

Returns the maintenance control panel as a standalone, zero-dependency HTML dashboard.

The dashboard displays:
- Overall project health score.
- Categorized findings list (e.g. Runtime Lifecycle, Dependency Risk, Infrastructure, Security & Services).
- Active filters and refresh triggers.
- Ignored/hidden findings statistics.

---

### `GET /api/dashboard/summary`

Performs a fresh `doctor` scan and returns the JSON payload powering the dashboard.

#### **Response `200 OK`**

```json
{
  "command": "doctor",
  "projectPath": "/path/to/project",
  "summary": "EOL: Node 20 is past EOL (2026-04-30)",
  "healthScore": 42,
  "healthBreakdown": {
    "runtime": 20,
    "dependencies": 22,
    "infrastructure": 18,
    "security": 24
  },
  "findings": [
    {
      "id": "runtime:node:package.json:20",
      "category": "runtime",
      "label": "EOL",
      "title": "Node.js runtime end-of-life",
      "summary": "Node 20 is past EOL (2026-04-30)",
      "evidence": "smallest safe path: Node 22 or 24 LTS",
      "recommendation": "upgrade",
      "urgency": 9,
      "impact": 9,
      "confidence": 9,
      "effort": "1 hour+",
      "whyItMatters": "Security fixes and performance improvements no longer ship after EOL.",
      "files": ["package.json"]
    }
  ],
  "ignored": [],
  "stats": {
    "dependencies": 118,
    "files": 74,
    "packageManagers": ["pnpm"],
    "ecosystems": ["JavaScript/TypeScript"],
    "projectKinds": ["Next.js", "React"],
    "runtimeIndicators": 2,
    "infraSignals": 4,
    "securitySignals": 3,
    "serviceSignals": 1,
    "scannedAt": "2026-06-05T10:10:00.000Z"
  }
}
```

#### **Response `500 Internal Server Error`**

```json
{
  "error": "Failed to load dashboard data",
  "details": "Nested scanner exception text..."
}
```
