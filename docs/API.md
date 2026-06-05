# DevBrief API Reference

## Base URL

DevBrief API runs on **Tailscale** only, meaning all endpoints are only accessible within your Tailnet (private network). This provides a secure, private connection without exposing the API to the public internet.

### Authentication

All API endpoints require **Tailnet membership**. When accessing DevBrief:
- Your device must be connected to the Tailnet
- Your Tailnet identity is automatically verified by Tailscale
- No additional API keys are required for Tailnet-authenticated requests

**Optional X-API-Key Header:** For programmatic access or service-to-service communication, an X-API-Key header can be provided for additional verification (if implemented).

---

## Endpoints

### GET /dashboard

Returns the HTML dashboard page with a dark-themed UI displaying risk summaries.

**Response:**
- Status: `200 OK`
- Content-Type: `text/html`

**Description:**
Renders a responsive dark-themed dashboard interface showing:
- Risk summary overview (critical, breaking, minor counts)
- Library dependency stack
- Change history and recommendations
- Interactive library browsing and filtering

**Example:**
```html
<!-- Dark-themed HTML dashboard with embedded charts and tables -->
<!-- Shows real-time risk data and library information -->
```

---

### GET /api/dashboard/summary

Retrieves the complete risk breakdown and library stack.

**Response:**
- Status: `200 OK`
- Content-Type: `application/json`

**Description:**
Returns aggregated risk data including:
- Overall vulnerability counts by severity level
- Complete list of managed dependencies with current/latest versions
- Associated changes and risk information for each library
- Last analysis run timestamp

**Example Response:**
```json
{
  "summary": {
    "criticalCount": 3,
    "breakingCount": 0,
    "minorCount": 8,
    "lastRunAt": "2026-06-05T15:40:00Z"
  },
  "libraries": [
    {
      "name": "react",
      "currentVersion": "18.2.0",
      "latestVersion": "19.0.0",
      "type": "dependency",
      "highestRiskLevel": "CRITICAL"
    },
    {
      "name": "lodash",
      "currentVersion": "4.17.21",
      "latestVersion": "4.17.21",
      "type": "dependency",
      "highestRiskLevel": "MINOR"
    },
    {
      "name": "express",
      "currentVersion": "4.18.0",
      "latestVersion": "4.19.0",
      "type": "dependency",
      "highestRiskLevel": "BREAKING"
    }
  ],
  "changes": [
    {
      "library": "react",
      "version": "19.0.0",
      "riskLevel": "CRITICAL",
      "severityScore": 95,
      "summary": "Security fix for XSS vulnerability in JSX handling",
      "recommendation": "Update immediately to patch security vulnerability"
    },
    {
      "library": "react",
      "version": "19.0.0",
      "riskLevel": "BREAKING",
      "severityScore": 72,
      "summary": "Removed legacy createContext API",
      "recommendation": "Review application code and update context usage patterns"
    },
    {
      "library": "express",
      "version": "4.19.0",
      "riskLevel": "BREAKING",
      "severityScore": 65,
      "summary": "Changed default request timeout behavior",
      "recommendation": "Update middleware configuration if custom timeouts are needed"
    },
    {
      "library": "lodash",
      "version": "4.17.21",
      "riskLevel": "MINOR",
      "severityScore": 15,
      "summary": "Added new utility functions",
      "recommendation": "Optional update to leverage new utility methods"
    }
  ]
}
```

---

### GET /api/dashboard/changes/:library

Retrieves all tracked changes for a specific library.

**Parameters:**
- `library` (string, required) - Name of the library (e.g., "react", "lodash")

**Response:**
- Status: `200 OK`
- Content-Type: `application/json`

**Description:**
Returns a complete history of all tracked changes for the specified library, including:
- Version number
- Risk level classification
- Severity score
- Change summary
- Update recommendations

**Example Response:**
```json
{
  "library": "react",
  "changes": [
    {
      "version": "19.0.0",
      "riskLevel": "CRITICAL",
      "severityScore": 95,
      "summary": "Security fix for XSS vulnerability in JSX handling",
      "recommendation": "Update immediately to patch security vulnerability"
    },
    {
      "version": "19.0.0",
      "riskLevel": "BREAKING",
      "severityScore": 72,
      "summary": "Removed legacy createContext API",
      "recommendation": "Review application code and update context usage patterns"
    },
    {
      "version": "18.3.0",
      "riskLevel": "MINOR",
      "severityScore": 25,
      "summary": "Performance optimization for re-render detection",
      "recommendation": "Optional update for potential performance improvements"
    }
  ]
}
```

---

### POST /trigger

Initiates a new dependency analysis run.

**Request Body:**
```json
{
  "repositoryUrl": "https://github.com/example/repo"
}
```

**Response:**
- Status: `200 OK` or `409 Conflict`
- Content-Type: `application/json`

**Description:**
Triggers a new scan of project dependencies. Returns a run object containing:
- Run ID for tracking
- Risk summary of discovered issues
- Current status
- Timestamp

**Example Response (200 OK):**
```json
{
  "run_id": "run_abc123def456",
  "status": "in_progress",
  "createdAt": "2026-06-05T15:40:00Z",
  "riskSummary": {
    "criticalCount": 3,
    "breakingCount": 0,
    "minorCount": 8
  }
}
```

**Example Response (409 Conflict - Run Already In Progress):**
```json
{
  "error": "Run already in progress",
  "message": "A scan is currently running. Please wait for completion before starting a new one.",
  "currentRunId": "run_active789xyz"
}
```

---

### GET /digest/:run_id

Retrieves the results of a completed dependency analysis run.

**Parameters:**
- `run_id` (string, required) - ID of the analysis run

**Response:**
- Status: `200 OK` or `404 Not Found`
- Content-Type: `application/json`

**Description:**
Returns detailed analysis results for the specified run, including:
- Risk breakdown by severity level
- Identified libraries and their statuses
- Associated changes and recommendations
- Run metadata (timestamp, duration, status)

**Example Response:**
```json
{
  "run_id": "run_abc123def456",
  "status": "completed",
  "createdAt": "2026-06-05T15:40:00Z",
  "completedAt": "2026-06-05T15:42:30Z",
  "riskSummary": {
    "criticalCount": 3,
    "breakingCount": 0,
    "minorCount": 8
  },
  "libraries": [
    {
      "name": "react",
      "currentVersion": "18.2.0",
      "latestVersion": "19.0.0",
      "type": "dependency"
    }
  ],
  "changes": [
    {
      "library": "react",
      "version": "19.0.0",
      "riskLevel": "CRITICAL",
      "severityScore": 95,
      "summary": "Security fix for XSS vulnerability"
    }
  ]
}
```

---

## Risk Level Reference

Risk levels categorize the severity and impact of library changes. Use this reference to understand priorities and recommended actions.

| Risk Level | Severity Score | When to Use | Examples |
|------------|-----------------|-------------|----------|
| **CRITICAL** | 80-100 | Security vulnerabilities, CVEs, and issues that pose immediate risk to application security or stability | Security fixes for XSS/SQL injection vulnerabilities, CVE patches, zero-day exploits, critical data loss prevention fixes |
| **BREAKING** | 50-79 | Significant API changes, deprecated features being removed, or changes requiring code refactoring | Removed APIs or functions, changed function signatures, removed package exports, major behavior changes, dependency version constraints |
| **MINOR** | 0-49 | New features, enhancements, bug fixes, and backward-compatible improvements | New utility functions, performance optimizations, bug fixes, non-breaking API additions, documentation improvements |

**Priority Guidelines:**
1. **CRITICAL** - Address within 24-48 hours
2. **BREAKING** - Plan and execute within 1-2 weeks
3. **MINOR** - Include in normal development cycles

---

## Authentication

### Tailnet-Only Access

All DevBrief endpoints are protected by **Tailscale authentication**. This means:

- **Private Network:** API is only accessible from devices connected to your Tailnet
- **Zero Trust Security:** Identity is verified at the network level by Tailscale
- **No Public Exposure:** Endpoints are never exposed to the public internet
- **Automatic Authorization:** Tailnet membership automatically grants access

### Connecting to Tailnet

To access DevBrief:
1. Install Tailscale on your device: https://tailscale.com/download
2. Connect to your organization's Tailnet
3. Access DevBrief at the private Tailnet address provided by your administrator

### Optional: X-API-Key Header

For service-to-service communication or automated access, an X-API-Key header can be used for additional verification:

```bash
curl -H "X-API-Key: your-api-key" https://devbrief.tailnet/api/dashboard/summary
```

---

## Error Responses

All error responses follow a consistent format with appropriate HTTP status codes.

### 400 Bad Request

Invalid request parameters or malformed request body.

```json
{
  "error": "Bad Request",
  "message": "Missing required parameter: library"
}
```

### 404 Not Found

Requested resource does not exist.

**Example - Run Not Found:**
```json
{
  "error": "Not Found",
  "message": "Run with ID 'run_notfound' does not exist"
}
```

**Example - Library Not Found:**
```json
{
  "error": "Not Found",
  "message": "No changes found for library 'unknown-lib'"
}
```

### 409 Conflict

Request conflicts with current system state. Typically occurs when attempting to start a new run while one is already in progress.

```json
{
  "error": "Conflict",
  "message": "A scan is currently running. Please wait for completion before starting a new one.",
  "currentRunId": "run_active789xyz"
}
```

### 500 Internal Server Error

An unexpected error occurred on the server.

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred while processing your request. Please try again later."
}
```

---

## Examples

### Example 1: Check Dashboard Summary

```bash
curl -s https://devbrief.tailnet/api/dashboard/summary | jq '.'
```

### Example 2: Get Changes for Specific Library

```bash
curl -s https://devbrief.tailnet/api/dashboard/changes/react | jq '.changes'
```

### Example 3: Trigger New Analysis Run

```bash
curl -X POST https://devbrief.tailnet/trigger \
  -H "Content-Type: application/json" \
  -d '{"repositoryUrl": "https://github.com/example/repo"}'
```

### Example 4: Retrieve Run Results

```bash
curl -s https://devbrief.tailnet/digest/run_abc123def456 | jq '.riskSummary'
```

---

## Rate Limiting

Currently, no rate limiting is enforced. However, we recommend:
- Limit dashboard summary queries to once per minute
- Avoid triggering continuous analysis runs without delays
- Implement exponential backoff for retry logic

---

## Support

For API questions or issues:
- Check the DevBrief documentation
- Review your Tailnet configuration
- Contact your DevBrief administrator
