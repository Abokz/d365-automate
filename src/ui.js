/**
 * ui.js
 * ─────
 * Floating side-panel injected into D365.
 * Provides buttons to launch workflows, shows live progress,
 * and renders result tables inline.
 */

import { _log, exportCsv } from './core.js';
import { BatchJobMonitor, InvoiceCrossCheck } from './workflows.js';

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
#d365tk-panel {
  position: fixed;
  top: 60px;
  right: 0;
  width: 340px;
  max-height: calc(100vh - 70px);
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  border-radius: 10px 0 0 10px;
  box-shadow: -4px 0 24px rgba(0,0,0,.45);
  display: flex;
  flex-direction: column;
  z-index: 999999;
  transition: transform .25s ease;
}
#d365tk-panel.collapsed { transform: translateX(305px); }

#d365tk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #313244;
  border-radius: 10px 0 0 0;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
#d365tk-header span { font-weight: 700; font-size: 14px; letter-spacing: .5px; color: #89b4fa; }
#d365tk-toggle { font-size: 18px; color: #a6adc8; line-height:1; }

#d365tk-body {
  overflow-y: auto;
  flex: 1;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tk-section {
  background: #313244;
  border-radius: 8px;
  padding: 10px;
}
.tk-section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: #89b4fa;
  margin-bottom: 8px;
}

.tk-btn {
  display: block;
  width: 100%;
  padding: 7px 10px;
  margin-bottom: 5px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  transition: opacity .15s, filter .15s;
}
.tk-btn:last-child { margin-bottom: 0; }
.tk-btn:hover { filter: brightness(1.15); }
.tk-btn:disabled { opacity: .45; cursor: not-allowed; filter: none; }

.tk-btn-primary  { background: #89b4fa; color: #1e1e2e; }
.tk-btn-success  { background: #a6e3a1; color: #1e1e2e; }
.tk-btn-warning  { background: #f9e2af; color: #1e1e2e; }
.tk-btn-danger   { background: #f38ba8; color: #1e1e2e; }
.tk-btn-neutral  { background: #45475a; color: #cdd6f4; }
.tk-btn-ghost    { background: transparent; color: #89b4fa; border: 1px solid #89b4fa; }

.tk-label {
  display: block;
  font-size: 11px;
  color: #a6adc8;
  margin-bottom: 3px;
}
.tk-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  background: #1e1e2e;
  border: 1px solid #45475a;
  border-radius: 5px;
  color: #ffffff;
  font-size: 12px;
  margin-bottom: 6px;
}
.tk-input:focus { outline: none; border-color: #89b4fa; }

/* Progress / log */
#d365tk-log {
  background: #11111b;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Consolas', monospace;
  max-height: 160px;
  overflow-y: auto;
  line-height: 1.5;
}
.tk-log-info  { color: #89b4fa; }
.tk-log-ok    { color: #a6e3a1; }
.tk-log-warn  { color: #f9e2af; }
.tk-log-error { color: #f38ba8; }

/* Status badge */
.tk-status {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .5px;
}
.tk-status-idle    { background:#45475a; color:#cdd6f4; }
.tk-status-running { background:#f9e2af; color:#1e1e2e; }
.tk-status-done    { background:#a6e3a1; color:#1e1e2e; }
.tk-status-error   { background:#f38ba8; color:#1e1e2e; }

/* Result table */
.tk-table-wrap { overflow-x: auto; margin-top: 6px; }
.tk-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.tk-table th {
  background: #45475a;
  color: #89b4fa;
  padding: 4px 6px;
  text-align: left;
  font-weight: 700;
  white-space: nowrap;
}
.tk-table td {
  padding: 3px 6px;
  border-bottom: 1px solid #313244;
  white-space: nowrap;
}
.tk-table tr:hover td { background: #313244; }
.tk-flag-ok       { color: #a6e3a1; font-weight: 700; }
.tk-flag-attention { color: #f38ba8; font-weight: 700; }
.tk-flag-error    { color: #f9e2af; font-weight: 700; }

/* Progress bar */
.tk-progress-wrap {
  background: #11111b;
  border-radius: 99px;
  height: 6px;
  overflow: hidden;
  margin: 4px 0;
}
.tk-progress-bar {
  height: 100%;
  background: #89b4fa;
  border-radius: 99px;
  transition: width .3s ease;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Singleton panel state
// ─────────────────────────────────────────────────────────────────────────────

let _panel     = null;
let _logEl     = null;
let _statusEl  = null;
let _progressEl = null;
let _resultsEl = null;
let _running   = false;

// ─────────────────────────────────────────────────────────────────────────────
// Log helpers (writes to both browser console AND the panel log)
// ─────────────────────────────────────────────────────────────────────────────

function panelLog(msg, level = 'info') {
  if (!_logEl) return;
  const line = document.createElement('div');
  line.className = `tk-log-${level}`;
  line.textContent = `› ${msg}`;
  _logEl.appendChild(line);
  _logEl.scrollTop = _logEl.scrollHeight;
}

function clearLog() {
  if (_logEl) _logEl.innerHTML = '';
}

// Monkey-patch _log so workflow messages also appear in the panel
function _patchLogger() {
  const orig = { ..._log };
  _log.info  = (...a) => { orig.info(...a);  panelLog(a.join(' '), 'info');  };
  _log.ok    = (...a) => { orig.ok(...a);    panelLog(a.join(' '), 'ok');    };
  _log.warn  = (...a) => { orig.warn(...a);  panelLog(a.join(' '), 'warn');  };
  _log.error = (...a) => { orig.error(...a); panelLog(a.join(' '), 'error'); };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status + progress helpers
// ─────────────────────────────────────────────────────────────────────────────

function setStatus(label, cls = 'idle') {
  if (!_statusEl) return;
  _statusEl.textContent  = label;
  _statusEl.className    = `tk-status tk-status-${cls}`;
}

function setProgress(pct) {
  if (!_progressEl) return;
  _progressEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result renderers
// ─────────────────────────────────────────────────────────────────────────────

function renderBatchJobReport(report) {
  if (!_resultsEl) return;
  const attention = report.filter(r => r.flag !== 'OK');
  const summary   = `${report.length} jobs · ${attention.length} need attention`;

  const cols = ['Job ID', 'Description', 'Last Status', 'Duration (s)', 'Flag', 'Note'];
  const rows = report.map(r => [
    r.jobId,
    r.description.length > 22 ? r.description.slice(0, 22) + '…' : r.description,
    r.historyStatus,
    r.durationSec ?? '—',
    r.flag,
    r.note.length > 30 ? r.note.slice(0, 30) + '…' : r.note,
  ]);

  _resultsEl.innerHTML = _buildTable(cols, rows, r => r[4] === 'OK' ? '' : 'tk-flag-attention', 4);
  _resultsEl.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:6px;color:#a6adc8;font-size:11px;">${summary}</div>`);
}

function renderCrossCheckResults(results) {
  if (!_resultsEl) return;
  const totalMissing = results.reduce((s, r) => s + r.missingCount, 0);
  const summary      = `${results.length} entities · ${totalMissing} missing invoice(s)`;

  const cols = ['Entity', 'D365', 'IXOS', 'Missing'];
  const rows = results.map(r => [r.entity, r.d365Count, r.ixosCount, r.missingCount]);

  _resultsEl.innerHTML = _buildTable(cols, rows, r => r[3] > 0 ? 'tk-flag-attention' : 'tk-flag-ok', 3);
  _resultsEl.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:6px;color:#a6adc8;font-size:11px;">${summary}</div>`);
}

function _buildTable(cols, rows, classForRow = () => '', flagColIdx = -1) {
  const ths  = cols.map(c => `<th>${c}</th>`).join('');
  const tbrs = rows.map(r => {
    const tds = r.map((cell, i) => {
      let cls = '';
      if (i === flagColIdx) {
        cls = cell === 'OK' ? 'tk-flag-ok' : cell === 'ATTENTION' ? 'tk-flag-attention' : 'tk-flag-error';
      }
      return `<td class="${cls}">${cell}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  return `<div class="tk-table-wrap"><table class="tk-table"><thead><tr>${ths}</tr></thead><tbody>${tbrs}</tbody></table></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow runners (wrappers that update UI state)
// ─────────────────────────────────────────────────────────────────────────────

async function _runBatchJobMonitor() {
  if (_running) return;
  _running = true;
  clearLog();
  setStatus('Running…', 'running');
  setProgress(0);
  if (_resultsEl) _resultsEl.innerHTML = '';

  try {
    const report = await BatchJobMonitor.run();
    setStatus('Done', 'done');
    setProgress(100);
    renderBatchJobReport(report);
  } catch (err) {
    _log.error(err.message);
    setStatus('Error', 'error');
  } finally {
    _running = false;
    _refreshButtons();
  }
}

async function _runInvoiceCrossCheck(fromDt, toDt, entities) {
  if (_running) return;
  _running = true;
  clearLog();
  setStatus('Running…', 'running');
  setProgress(0);
  if (_resultsEl) _resultsEl.innerHTML = '';

  try {
    const results = await InvoiceCrossCheck.run({ fromDt, toDt, entities });
    setStatus('Done', 'done');
    setProgress(100);
    renderCrossCheckResults(results);
  } catch (err) {
    _log.error(err.message);
    setStatus('Error', 'error');
  } finally {
    _running = false;
    _refreshButtons();
  }
}

function _refreshButtons() {
  if (!_panel) return;
  _panel.querySelectorAll('.tk-run-btn').forEach(btn => {
    btn.disabled = _running;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel builder
// ─────────────────────────────────────────────────────────────────────────────

function _buildPanel() {
  // Inject stylesheet
  if (!document.querySelector('#d365tk-style')) {
    const style = document.createElement('style');
    style.id    = 'd365tk-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const panel = document.createElement('div');
  panel.id    = 'd365tk-panel';
  panel.innerHTML = `
    <div id="d365tk-header">
      <span>⚙ D365 Toolkit</span>
      <span id="d365tk-toggle">◀</span>
    </div>

    <div id="d365tk-body">

      <!-- Status row -->
      <div class="tk-section" style="display:flex;align-items:center;gap:8px;padding:7px 10px;">
        <span id="d365tk-status" class="tk-status tk-status-idle">Idle</span>
        <div class="tk-progress-wrap" style="flex:1">
          <div id="d365tk-progress" class="tk-progress-bar" style="width:0%"></div>
        </div>
      </div>

      <!-- ── Batch Job Monitor ── -->
      <div class="tk-section">
        <div class="tk-section-title">📋 Batch Job Monitor</div>

        <button class="tk-btn tk-btn-neutral" id="bjm-selftest">Run self-test</button>
        <button class="tk-btn tk-btn-warning tk-run-btn" id="bjm-testone">Test current row</button>
        <button class="tk-btn tk-btn-primary tk-run-btn" id="bjm-run">▶ Run all jobs</button>
        <button class="tk-btn tk-btn-success" id="bjm-export" style="margin-top:4px;">⬇ Export CSV</button>

        <div style="margin-top:6px;">
          <label class="tk-label">Short-run threshold (seconds)</label>
          <input class="tk-input" id="bjm-threshold" type="number" value="${BatchJobMonitor.CONFIG.shortDurationThresholdSec}" min="1" />
        </div>
        <div>
          <label class="tk-label">Max jobs (blank = all)</label>
          <input class="tk-input" id="bjm-maxjobs" type="number" placeholder="all" />
        </div>
      </div>

      <!-- ── Invoice Cross-Check ── -->
      <div class="tk-section">
        <div class="tk-section-title">🧾 Invoice Cross-Check</div>

        <label class="tk-label">From date (MM/DD/YYYY)</label>
        <input class="tk-input" id="icc-from" type="text" placeholder="01/01/2024" />

        <label class="tk-label">To date (MM/DD/YYYY)</label>
        <input class="tk-input" id="icc-to" type="text" placeholder="01/31/2024" />

        <label class="tk-label">Entities (space or comma separated)</label>
        <input class="tk-input" id="icc-entities" type="text" placeholder="4111 0051" />

        <label class="tk-label">Batch window (hours)</label>
        <input class="tk-input" id="icc-batchhours" type="number" value="${InvoiceCrossCheck.CONFIG.batchHours}" min="1" max="24" />

        <button class="tk-btn tk-btn-primary tk-run-btn" id="icc-run" style="margin-top:4px;">▶ Run cross-check</button>
        <button class="tk-btn tk-btn-success" id="icc-export">⬇ Export missing CSV</button>
        <button class="tk-btn tk-btn-ghost"   id="icc-export-summary">⬇ Export summary CSV</button>
      </div>

      <!-- ── Live log ── -->
      <div class="tk-section">
        <div class="tk-section-title" style="display:flex;justify-content:space-between;">
          <span>📟 Log</span>
          <span id="d365tk-clearlog" style="cursor:pointer;color:#a6adc8;font-size:10px;font-weight:400;">clear</span>
        </div>
        <div id="d365tk-log"></div>
      </div>

      <!-- ── Results ── -->
      <div class="tk-section" id="d365tk-results-section">
        <div class="tk-section-title">📊 Results</div>
        <div id="d365tk-results"></div>
      </div>

    </div><!-- /body -->
  `;

  document.body.appendChild(panel);
  return panel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire up events
// ─────────────────────────────────────────────────────────────────────────────

function _wireEvents(panel) {
  // Collapse / expand
  const header   = panel.querySelector('#d365tk-header');
  const toggleEl = panel.querySelector('#d365tk-toggle');
  header.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    toggleEl.textContent = collapsed ? '▶' : '◀';
  });

  // Log clear
  panel.querySelector('#d365tk-clearlog').addEventListener('click', clearLog);

  // ── Batch Job Monitor buttons ──────────────────────────────────────────────

  panel.querySelector('#bjm-selftest').addEventListener('click', () => {
    BatchJobMonitor.selfTest();
  });

  panel.querySelector('#bjm-testone').addEventListener('click', async () => {
    if (_running) return;
    _running = true;
    _refreshButtons();
    clearLog();
    setStatus('Running…', 'running');
    try {
      await BatchJobMonitor.testOne();
      setStatus('Done', 'done');
    } catch (err) {
      _log.error(err.message);
      setStatus('Error', 'error');
    } finally {
      _running = false;
      _refreshButtons();
    }
  });

  panel.querySelector('#bjm-run').addEventListener('click', () => {
    // Apply config from inputs
    const threshold = parseInt(panel.querySelector('#bjm-threshold').value, 10);
    const maxJobs   = parseInt(panel.querySelector('#bjm-maxjobs').value,   10);
    if (!isNaN(threshold)) BatchJobMonitor.CONFIG.shortDurationThresholdSec = threshold;
    BatchJobMonitor.CONFIG.maxJobs = isNaN(maxJobs) ? null : maxJobs;
    _runBatchJobMonitor();
  });

  panel.querySelector('#bjm-export').addEventListener('click', () => {
    BatchJobMonitor.exportCsv();
  });

  // ── Invoice Cross-Check buttons ────────────────────────────────────────────

  panel.querySelector('#icc-run').addEventListener('click', () => {
    const fromStr  = panel.querySelector('#icc-from').value.trim();
    const toStr    = panel.querySelector('#icc-to').value.trim();
    const entStr   = panel.querySelector('#icc-entities').value.trim();
    const batchHrs = parseInt(panel.querySelector('#icc-batchhours').value, 10);

    if (!fromStr || !toStr || !entStr) {
      panelLog('Please fill in From date, To date, and Entities.', 'warn');
      return;
    }

    const fromDt = new Date(fromStr);
    let   toDt   = new Date(toStr);
    toDt.setHours(23, 59, 59, 0);

    if (isNaN(fromDt) || isNaN(toDt)) {
      panelLog('Invalid date — use MM/DD/YYYY format.', 'error');
      return;
    }

    const entities = entStr.replace(/,/g, ' ').split(/\s+/).filter(Boolean);

    if (!isNaN(batchHrs) && batchHrs > 0) {
      InvoiceCrossCheck.CONFIG.batchHours = batchHrs;
    }

    _runInvoiceCrossCheck(fromDt, toDt, entities);
  });

  panel.querySelector('#icc-export').addEventListener('click', () => {
    InvoiceCrossCheck.exportCsv();
  });

  panel.querySelector('#icc-export-summary').addEventListener('click', () => {
    InvoiceCrossCheck.exportSummaryCsv();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public init
// ─────────────────────────────────────────────────────────────────────────────

function initUI() {
  if (_panel) {
    _log.warn('UI already initialised — remove the existing panel first if you want to re-init.');
    return;
  }

  _panel      = _buildPanel();
  _logEl      = _panel.querySelector('#d365tk-log');
  _statusEl   = _panel.querySelector('#d365tk-status');
  _progressEl = _panel.querySelector('#d365tk-progress');
  _resultsEl  = _panel.querySelector('#d365tk-results');

  _wireEvents(_panel);
  _patchLogger();

  _log.ok('D365 Toolkit UI ready');
}

function destroyUI() {
  if (_panel) {
    _panel.remove();
    _panel = _logEl = _statusEl = _progressEl = _resultsEl = null;
  }
  const style = document.querySelector('#d365tk-style');
  if (style) style.remove();
}

export { initUI, destroyUI, panelLog, setStatus, setProgress };
