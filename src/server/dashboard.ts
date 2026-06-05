/**
 * DevBrief Dashboard routes.
 *
 * Provides HTML dashboard UI and JSON API for viewing risk reports,
 * library updates, and change summaries.
 */

import { Hono } from 'hono';
import { getStore } from '../utils/store.js';
import type { ChangeEntry } from '../models/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardSummary {
  criticalCount: number;
  breakingCount: number;
  minorCount: number;
  totalCount: number;
  summary: string;
}

interface DashboardLibrary {
  name: string;
  version: string;
  riskLevel: 'CRITICAL' | 'BREAKING' | 'MINOR' | 'NONE';
  changeCount: number;
}

interface DashboardChange {
  libraryName: string;
  version: string;
  classification: string | null;
  summary: string | null;
  sourceUrl: string;
  scrapedAt: string;
}

interface DashboardResponse {
  summary: DashboardSummary;
  libraries: DashboardLibrary[];
  changes: DashboardChange[];
  lastRun: string | null;
}

// ---------------------------------------------------------------------------
// Risk classification helpers
// ---------------------------------------------------------------------------

function classifyRiskLevel(
  classification: string | null,
): 'CRITICAL' | 'BREAKING' | 'MINOR' {
  if (!classification) return 'MINOR';

  const normalized = (classification || '').toLowerCase();
  if (normalized === 'breaking') return 'BREAKING';
  if (normalized === 'deprecation') return 'BREAKING';
  return 'MINOR';
}

// ---------------------------------------------------------------------------
// Dashboard data retrieval
// ---------------------------------------------------------------------------

function getDashboardData(): DashboardResponse {
  const store = getStore();

  // Get latest run
  const latestRun = store
    .prepare(
      'SELECT * FROM run_records ORDER BY triggered_at DESC LIMIT 1',
    )
    .get() as Record<string, unknown> | undefined;

  const lastRunTimestamp = latestRun ? (latestRun.completed_at as string) : null;

  // Get all recent change entries (last 50)
  const changes = store
    .prepare(
      `SELECT * FROM change_entries 
       ORDER BY scraped_at DESC 
       LIMIT 50`,
    )
    .all() as Array<Record<string, unknown>>;

  const changesList: DashboardChange[] = changes.map((row) => ({
    libraryName: row.library_name as string,
    version: row.version as string,
    classification: (row.classification as string) || null,
    summary: (row.summary as string) || null,
    sourceUrl: row.source_url as string,
    scrapedAt: row.scraped_at as string,
  }));

  // Group by library and count by risk level
  const libraryMap = new Map<string, { entries: DashboardChange[]; versions: Set<string> }>();

  for (const change of changesList) {
    if (!libraryMap.has(change.libraryName)) {
      libraryMap.set(change.libraryName, {
        entries: [],
        versions: new Set(),
      });
    }
    const lib = libraryMap.get(change.libraryName)!;
    lib.entries.push(change);
    lib.versions.add(change.version);
  }

  // Count risk levels across all changes
  let criticalCount = 0;
  let breakingCount = 0;
  let minorCount = 0;

  for (const change of changesList) {
    const risk = classifyRiskLevel(change.classification);
    if (risk === 'BREAKING') {
      breakingCount++;
    } else if (risk === 'MINOR') {
      minorCount++;
    }
  }

  // Build library list
  const libraries: DashboardLibrary[] = Array.from(libraryMap.entries()).map(
    ([name, data]) => {
      let maxRisk: 'CRITICAL' | 'BREAKING' | 'MINOR' | 'NONE' = 'NONE';

      for (const entry of data.entries) {
        const risk = classifyRiskLevel(entry.classification);
        if (risk === 'BREAKING') maxRisk = 'BREAKING';
        if (maxRisk !== 'BREAKING' && risk === 'MINOR') {
          maxRisk = 'MINOR';
        }
      }

      const latestVersion = Array.from(data.versions).sort().reverse()[0];

      return {
        name,
        version: latestVersion,
        riskLevel: maxRisk,
        changeCount: data.entries.length,
      };
    },
  );

  libraries.sort((a, b) => {
    const riskOrder: Record<string, number> = {
      BREAKING: 0,
      CRITICAL: 1,
      MINOR: 2,
      NONE: 3,
    };
    return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
  });

  const totalCount = changesList.length;
  const summary =
    totalCount === 0
      ? 'All systems up to date'
      : `${breakingCount} BREAKING, ${minorCount} MINOR updates available`;

  return {
    summary: {
      criticalCount,
      breakingCount,
      minorCount,
      totalCount,
      summary,
    },
    libraries: libraries.slice(0, 20),
    changes: changesList,
    lastRun: lastRunTimestamp,
  };
}

function getDashboardDataForLibrary(libraryName: string): DashboardChange[] {
  const store = getStore();

  const rows = store
    .prepare(
      `SELECT * FROM change_entries 
       WHERE library_name = ? 
       ORDER BY scraped_at DESC`,
    )
    .all(libraryName) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    libraryName: row.library_name as string,
    version: row.version as string,
    classification: (row.classification as string) || null,
    summary: (row.summary as string) || null,
    sourceUrl: row.source_url as string,
    scrapedAt: row.scraped_at as string,
  }));
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function generateDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevBrief Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <style>
    :root {
      --color-critical: #ef4444;
      --color-breaking: #f97316;
      --color-minor: #3b82f6;
      --color-dark: #1f2937;
      --color-darker: #111827;
    }

    body {
      background-color: var(--color-darker);
      color: #e5e7eb;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    }

    .badge-critical {
      background-color: var(--color-critical);
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .badge-breaking {
      background-color: var(--color-breaking);
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .badge-minor {
      background-color: var(--color-minor);
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .badge-none {
      background-color: #6b7280;
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .card {
      background-color: var(--color-dark);
      border: 1px solid #374151;
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #374151;
      padding-bottom: 1rem;
      margin-bottom: 1rem;
    }

    .library-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      border-bottom: 1px solid #374151;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .library-row:hover {
      background-color: #1f2937;
    }

    .library-row:last-child {
      border-bottom: none;
    }

    .library-info {
      flex: 1;
    }

    .library-name {
      font-weight: 500;
      font-size: 1rem;
      margin-bottom: 0.25rem;
    }

    .library-version {
      color: #9ca3af;
      font-size: 0.875rem;
    }

    .library-actions {
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    .stat-group {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .stat-box {
      background-color: #111827;
      border: 1px solid #374151;
      border-radius: 0.5rem;
      padding: 1rem;
      text-align: center;
    }

    .stat-number {
      font-size: 1.875rem;
      font-weight: bold;
      margin-bottom: 0.5rem;
    }

    .stat-label {
      color: #9ca3af;
      font-size: 0.875rem;
    }

    .changes-list {
      max-height: 400px;
      overflow-y: auto;
    }

    .change-item {
      padding: 1rem;
      border-bottom: 1px solid #374151;
      font-size: 0.875rem;
    }

    .change-item:last-child {
      border-bottom: none;
    }

    .change-library {
      font-weight: 500;
      margin-bottom: 0.25rem;
    }

    .change-summary {
      color: #9ca3af;
      margin-bottom: 0.5rem;
    }

    .change-time {
      color: #6b7280;
      font-size: 0.75rem;
    }

    .loading {
      text-align: center;
      padding: 2rem;
      color: #9ca3af;
    }

    .error {
      background-color: var(--color-critical);
      padding: 1rem;
      border-radius: 0.5rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="min-h-screen bg-gray-900">
    <!-- Header -->
    <div class="bg-gray-800 border-b border-gray-700 py-6 px-4 md:px-8">
      <div class="max-w-6xl mx-auto">
        <h1 class="text-3xl font-bold mb-2">DevBrief Dashboard</h1>
        <p class="text-gray-400">Library updates and risk monitoring</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="max-w-6xl mx-auto py-8 px-4 md:px-8">
      <div id="error-container"></div>
      <div id="loading" class="loading">Loading dashboard...</div>

      <div id="content" style="display: none;">
        <!-- Summary Stats -->
        <div class="stat-group" id="stats-container"></div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <!-- Libraries -->
          <div class="card">
            <div class="card-header">
              <h2 class="text-xl font-bold">Libraries</h2>
              <span id="library-count" class="text-gray-400"></span>
            </div>
            <div id="libraries-container"></div>
          </div>

          <!-- Recent Changes -->
          <div class="card">
            <div class="card-header">
              <h2 class="text-xl font-bold">Recent Changes</h2>
              <span id="last-run" class="text-gray-400 text-sm"></span>
            </div>
            <div class="changes-list" id="changes-container"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    async function loadDashboard() {
      try {
        const response = await fetch('/api/dashboard/summary');
        if (!response.ok) {
          throw new Error(\`HTTP \${response.status}\`);
        }
        const data = await response.json();
        renderDashboard(data);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        document.getElementById('error-container').innerHTML = 
          \`<div class="error">Failed to load dashboard: \${errorMsg}</div>\`;
        document.getElementById('loading').style.display = 'none';
      }
    }

    function renderDashboard(data) {
      // Render stats
      const statsContainer = document.getElementById('stats-container');
      statsContainer.innerHTML = \`
        <div class="stat-box">
          <div class="stat-number" style="color: var(--color-breaking);">\${data.summary.breakingCount}</div>
          <div class="stat-label">BREAKING Changes</div>
        </div>
        <div class="stat-box">
          <div class="stat-number" style="color: var(--color-minor);">\${data.summary.minorCount}</div>
          <div class="stat-label">MINOR Changes</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">\${data.summary.totalCount}</div>
          <div class="stat-label">Total Updates</div>
        </div>
      \`;

      // Render libraries
      const librariesContainer = document.getElementById('libraries-container');
      if (data.libraries.length === 0) {
        librariesContainer.innerHTML = '<div class="text-gray-400 text-center py-4">No libraries found</div>';
      } else {
        librariesContainer.innerHTML = data.libraries.map(lib => {
          const badgeClass = \`badge-\${lib.riskLevel.toLowerCase()}\`;
          return \`
            <div class="library-row" onclick="viewLibraryDetails('\${lib.name}')">
              <div class="library-info">
                <div class="library-name">\${escapeHtml(lib.name)}</div>
                <div class="library-version">v\${escapeHtml(lib.version)} · \${lib.changeCount} change\${lib.changeCount !== 1 ? 's' : ''}</div>
              </div>
              <div class="library-actions">
                <span class="\${badgeClass}">\${lib.riskLevel}</span>
              </div>
            </div>
          \`;
        }).join('');
      }
      document.getElementById('library-count').textContent = \`\${data.libraries.length} libraries\`;

      // Render recent changes
      const changesContainer = document.getElementById('changes-container');
      if (data.changes.length === 0) {
        changesContainer.innerHTML = '<div class="text-gray-400 text-center py-4">No recent changes</div>';
      } else {
        changesContainer.innerHTML = data.changes.slice(0, 10).map(change => {
          const riskLevel = change.classification ? (change.classification === 'breaking' || change.classification === 'deprecation' ? 'breaking' : 'minor') : 'minor';
          const badgeClass = \`badge-\${riskLevel}\`;
          return \`
            <div class="change-item">
              <div class="change-library">\${escapeHtml(change.libraryName)} v\${escapeHtml(change.version)}</div>
              \${change.summary ? \`<div class="change-summary">\${escapeHtml(change.summary)}</div>\` : ''}
              <div class="flex justify-between items-center">
                <span class="\${badgeClass}">\${riskLevel.toUpperCase()}</span>
                <span class="change-time">\${formatDate(change.scrapedAt)}</span>
              </div>
            </div>
          \`;
        }).join('');
      }

      // Format last run
      if (data.lastRun) {
        document.getElementById('last-run').textContent = 'Updated: ' + formatDate(data.lastRun);
      }

      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';
    }

    function viewLibraryDetails(libraryName) {
      alert('Library details for ' + libraryName + ' would open in a modal or new page.');
    }

    function escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, m => map[m]);
    }

    function formatDate(isoString) {
      const date = new Date(isoString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // Load dashboard on page load
    loadDashboard();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Hono routes
// ---------------------------------------------------------------------------

export function registerDashboardRoutes(app: Hono): void {
  // GET /dashboard — serve HTML page
  app.get('/dashboard', (c) => {
    const html = generateDashboardHTML();
    return c.html(html);
  });

  // GET /api/dashboard/summary — JSON endpoint
  app.get('/api/dashboard/summary', (c) => {
    try {
      const data = getDashboardData();
      return c.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json(
        { error: 'Failed to load dashboard data', details: message },
        500,
      );
    }
  });

  // GET /api/dashboard/changes/:library — changes for specific library
  app.get('/api/dashboard/changes/:library', (c) => {
    try {
      const library = c.req.param('library');
      const changes = getDashboardDataForLibrary(library);
      return c.json({ library, changes });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json(
        { error: 'Failed to load changes', details: message },
        500,
      );
    }
  });
}
