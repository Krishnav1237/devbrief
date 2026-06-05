import { Hono } from 'hono';
import { runMaintenanceScan } from '../maintenance/engine.js';

function generateDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevBrief Maintenance Radar</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8f5;
      --panel: #ffffff;
      --ink: #19201d;
      --muted: #66736c;
      --line: #dce2dd;
      --accent: #0f766e;
      --risk: #b42318;
      --warn: #a15c07;
      --safe: #137333;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 56px;
    }

    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: end;
      padding: 20px 0 26px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1.05;
      font-weight: 760;
    }

    p { margin: 0; }

    .muted { color: var(--muted); }

    .shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 28px;
      margin-top: 28px;
    }

    .score {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-variant-numeric: tabular-nums;
    }

    .score strong {
      font-size: 48px;
      line-height: 1;
    }

    .summary {
      margin-top: 18px;
      padding: 18px 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      font-size: 18px;
      font-weight: 650;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 24px 0 16px;
    }

    button {
      border: 1px solid var(--line);
      background: transparent;
      color: var(--ink);
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      cursor: pointer;
    }

    button.active {
      border-color: var(--accent);
      color: var(--accent);
      background: #e6f3f1;
    }

    .list {
      border-top: 1px solid var(--line);
    }

    .finding {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr) 120px;
      gap: 16px;
      padding: 16px 0;
      border-bottom: 1px solid var(--line);
      transition: background-color 120ms ease;
    }

    .finding:hover {
      background: rgba(15, 118, 110, 0.05);
    }

    .label {
      width: fit-content;
      border-radius: 6px;
      padding: 4px 7px;
      font-size: 12px;
      font-weight: 750;
      line-height: 1.2;
      border: 1px solid currentColor;
    }

    .SAFE { color: var(--safe); }
    .REVIEW, .UPGRADE { color: var(--warn); }
    .RISKY, .EOL, .ACTION { color: var(--risk); }

    .finding h2 {
      margin: 0 0 5px;
      font-size: 16px;
      line-height: 1.25;
    }

    .evidence {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    aside {
      border-left: 1px solid var(--line);
      padding-left: 24px;
    }

    .aside-section {
      padding: 18px 0;
      border-bottom: 1px solid var(--line);
    }

    .aside-section:first-child { padding-top: 0; }

    .aside-title {
      margin: 0 0 10px;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      font-weight: 760;
    }

    .action {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      font-size: 14px;
      border-top: 1px solid #edf0ed;
    }

    .empty {
      padding: 28px 0;
      color: var(--muted);
    }

    @media (max-width: 820px) {
      header, .shell, .finding {
        grid-template-columns: 1fr;
      }

      aside {
        border-left: 0;
        padding-left: 0;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>DevBrief</h1>
        <p class="muted">Project maintenance radar for the current codebase.</p>
      </div>
      <button id="refresh" type="button">Refresh</button>
    </header>

    <div id="loading" class="empty">Scanning project maintenance risk...</div>
    <section id="content" class="shell" hidden>
      <div>
        <div class="score"><strong id="score">--</strong><span class="muted">/100 health</span></div>
        <div id="summary" class="summary"></div>
        <div id="filters" class="toolbar"></div>
        <div id="findings" class="list"></div>
      </div>
      <aside>
        <div class="aside-section">
          <p class="aside-title">Latest Scan</p>
          <p id="scannedAt" class="muted"></p>
        </div>
        <div class="aside-section">
          <p class="aside-title">Recommended Actions</p>
          <div id="actions"></div>
        </div>
        <div class="aside-section">
          <p class="aside-title">Ignored By Default</p>
          <p id="ignored" class="muted"></p>
        </div>
      </aside>
    </section>
  </main>

  <script>
    let state = null;
    let activeCategory = 'all';

    const labelClass = (label) => label.replace(/ .*/, '');

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[char]);
    }

    function renderFilters() {
      const categories = ['all', ...new Set(state.findings.map((finding) => finding.category))];
      document.getElementById('filters').innerHTML = categories.map((category) =>
        '<button class="' + (category === activeCategory ? 'active' : '') + '" data-category="' + category + '">' +
          escapeHtml(category) +
        '</button>'
      ).join('');

      document.querySelectorAll('[data-category]').forEach((button) => {
        button.addEventListener('click', () => {
          activeCategory = button.dataset.category;
          render();
        });
      });
    }

    function renderFindings() {
      const findings = activeCategory === 'all'
        ? state.findings
        : state.findings.filter((finding) => finding.category === activeCategory);

      document.getElementById('findings').innerHTML = findings.length === 0
        ? '<div class="empty">No visible findings in this category.</div>'
        : findings.map((finding) =>
          '<article class="finding">' +
            '<div><span class="label ' + labelClass(finding.label) + '">' + escapeHtml(finding.label) + '</span></div>' +
            '<div>' +
              '<h2>' + escapeHtml(finding.summary) + '</h2>' +
              '<p class="muted">' + escapeHtml(finding.title) + '</p>' +
              (finding.evidence ? '<p class="evidence">' + escapeHtml(finding.evidence) + '</p>' : '') +
            '</div>' +
            '<div class="muted">' + escapeHtml(finding.effort) + '</div>' +
          '</article>'
        ).join('');
    }

    function renderActions() {
      const actions = state.findings.slice(0, 5);
      document.getElementById('actions').innerHTML = actions.length === 0
        ? '<p class="muted">No action needed.</p>'
        : actions.map((finding) =>
          '<div class="action"><span>' + escapeHtml(finding.recommendation) + '</span><span>' + escapeHtml(finding.category) + '</span></div>'
        ).join('');
    }

    function render() {
      document.getElementById('score').textContent = state.healthScore;
      document.getElementById('summary').textContent = state.summary;
      document.getElementById('scannedAt').textContent = new Date(state.stats.scannedAt).toLocaleString();
      document.getElementById('ignored').textContent = state.ignored.length + ' low-signal item' + (state.ignored.length === 1 ? '' : 's') + ' hidden';
      renderFilters();
      renderFindings();
      renderActions();
    }

    async function loadDashboard() {
      document.getElementById('loading').hidden = false;
      document.getElementById('content').hidden = true;
      const response = await fetch('/api/dashboard/summary');
      state = await response.json();
      render();
      document.getElementById('loading').hidden = true;
      document.getElementById('content').hidden = false;
    }

    document.getElementById('refresh').addEventListener('click', loadDashboard);
    loadDashboard().catch((error) => {
      document.getElementById('loading').textContent = 'Dashboard scan failed: ' + error.message;
    });
  </script>
</body>
</html>`;
}

export function registerDashboardRoutes(app: Hono): void {
  app.get('/dashboard', (c) => {
    return c.html(generateDashboardHTML());
  });

  app.get('/api/dashboard/summary', async (c) => {
    try {
      const data = await runMaintenanceScan('doctor', process.cwd());
      return c.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: 'Failed to load dashboard data', details: message }, 500);
    }
  });
}
