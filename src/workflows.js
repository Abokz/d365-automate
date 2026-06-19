/**
 * workflows.js
 * ────────────
 * Two complete automation workflows built on core.js + d365.js:
 *
 *   D365Toolkit.workflows.BatchJobMonitor   — walks batch job list, reads
 *     history, flags jobs that didn't end cleanly or ran suspiciously fast.
 *
 *   D365Toolkit.workflows.InvoiceCrossCheck — for each entity, downloads
 *     D365 invoice IDs in 12-hr batches, fetches IXOS invoice IDs via
 *     GM_xmlhttpRequest, diffs the two sets, and reports what's missing.
 */

import {
  _log, sleep, waitFor,
  exportCsv, gmFetch,
  fmtD365, fmtIxos,
  generateBatches, normalizeId,
  durationSeconds,
  waitForD365Idle,
  waitForElement,
  findByText,
  simulateClick,
  getByRole,
} from './core.js';

import {
  d365Config,
  waitReady,
  getGrid, getRowCount, getRowByIndex, getActiveRow, getActiveRowIndex,
  readCell, goToRow, findButton,
  switchEntity,
  createBlobInterceptor, downloadBlob, parseXlsx,
  selectRow,
} from './d365.js';

// ─────────────────────────────────────────────────────────────────────────────
// ██████  ██████  ████████  ██████ ██   ██      ██  ██████  ██████
// ██   ██ ██   ██    ██    ██      ██   ██      ██ ██    ██ ██   ██
// ██████  ██████     ██    ██      ███████      ██ ██    ██ ██████
// ██   ██ ██   ██    ██    ██      ██   ██ ██   ██ ██    ██ ██   ██
// ██████  ██   ██    ██     ██████ ██   ██  █████   ██████  ██████
//
// BATCH JOB MONITOR
// ─────────────────────────────────────────────────────────────────────────────

const BatchJobMonitor = (() => {

  const CONFIG = {
    shortDurationThresholdSec: 10,   // flag jobs that ran < this many seconds
    retriesPerJob: 1,
    maxJobs: null,                   // null = all; set a number to limit test runs
  };

  let _lastReport = [];

  // ── grid read helpers ──────────────────────────────────────────────────────

  function readMainRow(rowEl) {
    return {
      jobId:       readCell(rowEl, 'Job ID'),
      status:      readCell(rowEl, 'Status'),
      description: readCell(rowEl, 'Job description'),
    };
  }

  function readHistoryRow(rowEl) {
    return {
      status: readCell(rowEl, 'Status'),
      start:  readCell(rowEl, 'Actual start date/time'),
      end:    readCell(rowEl, 'End date/time'),
    };
  }

  // ── per-job: open history, read first row, come back ──────────────────────

  async function openHistoryAndReadFirstRow() {
    const btn = findButton('Batch job history', '_BatchJobHistory');
    if (!btn) throw new Error('Could not find the "Batch job history" button');

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    let data     = { status: 'NO_HISTORY', start: '', end: '' };
    let readError = null;

    try {
      // Wait for history grid to appear
      await waitFor(
        () => getGrid('Batch jobs history'),
        { timeout: d365Config.navigationTimeoutMs, label: 'history grid' }
      );

      // Wait for first data row (aria-rowindex 2)
      let firstRow = null;
      try {
        firstRow = await waitFor(
          () => {
            const g = getGrid('Batch jobs history');
            return g ? getRowByIndex(g, 2) : null;
          },
          { timeout: d365Config.historyRowTimeoutMs, label: 'first history row' }
        );
      } catch (_) {
        // Genuinely no history yet — not an error
        firstRow = null;
      }

      if (firstRow) data = readHistoryRow(firstRow);

    } catch (err) {
      readError = err;
    } finally {
      // Always navigate back, even if reading failed
      const backBtn =
        document.querySelector('button[aria-label="Back" i],[role="button"][aria-label="Back" i]') ||
        document.querySelector('button[aria-label="Close" i],[role="button"][aria-label="Close" i]');

      if (backBtn) {
        backBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } else {
        history.back();
      }
      await waitForD365Idle();
      try {
        await waitFor(
          () => getGrid('Batch job'),
          { timeout: d365Config.navigationTimeoutMs, label: 'main grid to reappear' }
        );
        await sleep(d365Config.stepDelayMs);
      } catch (backErr) {
        throw new Error(
          `Could not return to main grid${readError ? ' (after: ' + readError.message + ')' : ''}: ${backErr.message}`
        );
      }
    }

    if (readError) throw readError;
    return data;
  }

  async function openHistoryWithRetry(retries) {
    try {
      return await openHistoryAndReadFirstRow();
    } catch (err) {
      if (retries > 0) {
        _log.warn(`Retrying after error: ${err.message}`);
        await sleep(800);
        return openHistoryWithRetry(retries - 1);
      }
      throw err;
    }
  }

  // ── evaluation ─────────────────────────────────────────────────────────────

  function evaluateJob(hist) {
    if (hist.status === 'NO_HISTORY') {
      return { flag: 'ATTENTION', note: 'No execution history found', durationSec: null };
    }
    if (hist.status !== 'Ended') {
      return { flag: 'ATTENTION', note: `Last run status is "${hist.status}", not Ended`, durationSec: null };
    }
    const dur = durationSeconds(hist.start, hist.end);
    if (dur === null) {
      return { flag: 'ATTENTION', note: 'Could not parse start/end time', durationSec: null };
    }
    if (dur < CONFIG.shortDurationThresholdSec) {
      return { flag: 'ATTENTION', note: `Ended after only ${dur}s — possible failure`, durationSec: dur };
    }
    return { flag: 'OK', note: `Ran for ${dur}s`, durationSec: dur };
  }

  // ── public API ─────────────────────────────────────────────────────────────

  function selfTest() {
    const grid    = getGrid('Batch job');
    const histBtn = findButton('Batch job history', '_BatchJobHistory');
    const backBtn = document.querySelector('button[aria-label="Back" i]');
    _log.info('Self-test results:');
    _log.info('  Main grid found:',          !!grid);
    _log.info('  Active row found:',         !!(grid && getActiveRow(grid)));
    _log.info('  "Batch job history" btn:',  !!histBtn, histBtn);
    _log.info('  "Back" button found:',      !!backBtn, backBtn);
    if (!grid)    _log.warn('  → Navigate to the Batch Job list page first.');
    if (!histBtn) _log.warn('  → Update findButton() for "Batch job history".');
    if (!backBtn) _log.warn('  → Back button not found — will fall back to history.back().');
  }

  async function testOne() {
    const grid = getGrid('Batch job');
    if (!grid) throw new Error('Main grid not found');
    const active = getActiveRow(grid);
    if (!active)  throw new Error('No active row');
    const job  = readMainRow(active);
    _log.info('Testing job:', job);
    const hist = await openHistoryAndReadFirstRow();
    _log.info('History first row:', hist);
    _log.info('Evaluation:', evaluateJob(hist));
  }

  async function run() {
    let grid = getGrid('Batch job');
    if (!grid) throw new Error('Main grid not found — navigate to the Batch Job list page first.');

    const total = getRowCount(grid);
    const limit = CONFIG.maxJobs ? Math.min(CONFIG.maxJobs, total) : total;
    _log.info(`Found ${total} job(s). Processing ${limit}.`);

    const report = [];
    let idx = 2; // aria-rowindex 1 is the header

    for (let i = 0; i < limit; i++) {
      grid = getGrid('Batch job');
      if (!grid) { _log.error(`Stopped at job ${i + 1}: grid gone.`); break; }

      let rowEl;
      try {
        rowEl = await goToRow(grid, idx);
      } catch (err) {
        _log.error(`Stopped at job ${i + 1}: ${err.message}`);
        break;
      }

      const job   = readMainRow(rowEl);
      const label = `[${i + 1}/${limit}] ${job.jobId} — ${job.description}`;
      _log.info(label);

      const entry = { ...job, historyStatus: '', start: '', end: '', durationSec: null, flag: 'ERROR', note: '' };

      try {
        const hist       = await openHistoryWithRetry(CONFIG.retriesPerJob);
        const evalResult = evaluateJob(hist);
        Object.assign(entry, {
          historyStatus: hist.status,
          start:         hist.start,
          end:           hist.end,
          durationSec:   evalResult.durationSec,
          flag:          evalResult.flag,
          note:          evalResult.note,
        });
      } catch (err) {
        entry.note = `Failed to read history: ${err.message}`;
        _log.error(`  ${job.jobId}: ${entry.note}`);
      }

      report.push(entry);
      await goToRow(grid, idx); // Select again to deselect
      idx++;
      await sleep(d365Config.stepDelayMs);
    }

    _lastReport = report;
    _printReport(report);
    return report;
  }

  function _printReport(report) {
    _log.info('\n========== BATCH JOB MONITOR REPORT ==========');
    console.table(report.map(r => ({
      'Job ID':       r.jobId,
      'Description':  r.description,
      'Last Status':  r.historyStatus,
      'Start':        r.start,
      'End':          r.end,
      'Duration (s)': r.durationSec,
      'Flag':         r.flag,
      'Note':         r.note,
    })));
    const attention = report.filter(r => r.flag !== 'OK');
    if (attention.length) {
      _log.warn(`${attention.length} of ${report.length} job(s) need attention:`);
      attention.forEach(r => _log.warn(`  • ${r.jobId} (${r.description}): ${r.note}`));
    } else {
      _log.ok(`All ${report.length} job(s) look healthy.`);
    }
  }

  function doExportCsv(filename = 'batch-job-report.csv') {
    if (!_lastReport.length) { _log.warn('No report yet — run BatchJobMonitor.run() first.'); return; }
    exportCsv(_lastReport.map(r => ({
      'Job ID':       r.jobId,
      'Description':  r.description,
      'Last Status':  r.historyStatus,
      'Start':        r.start,
      'End':          r.end,
      'Duration (s)': String(r.durationSec ?? ''),
      'Flag':         r.flag,
      'Note':         r.note,
    })), filename);
  }

  return {
    CONFIG,
    selfTest,
    testOne,
    run,
    exportCsv: doExportCsv,
    getReport: () => _lastReport,
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// ██ ███    ██ ██    ██  ██████  ██  ██████  ███████
// ██ ████   ██ ██    ██ ██    ██ ██ ██      ██
// ██ ██ ██  ██ ██    ██ ██    ██ ██ ██      █████
// ██ ██  ██ ██  ██  ██  ██    ██ ██ ██      ██
// ██ ██   ████   ████    ██████  ██  ██████ ███████
//
// INVOICE CROSS-CHECK
// ─────────────────────────────────────────────────────────────────────────────

const InvoiceCrossCheck = (() => {

  // ── config ─────────────────────────────────────────────────────────────────

  const CONFIG = {
    ixosBase:     'http://pstam-web.akzonobel.intra/GATS/ArchivedInvoices/',
    ixosMaxRows:  30_000,
    batchHours:   12,
    // Invoice types to query in IXOS
    ixosTypes: [
      { desc: 'sales+invoice',     label: 'SI'  },
      { desc: 'free+text+invoice', label: 'FTI' },
    ],
  };

  // ── runtime state ──────────────────────────────────────────────────────────

  let _ixosIds   = new Set();   // populated once, reused for all entities
  let _results   = [];          // { entity, d365Count, ixosCount, missingCount, missing[] }
  let _legalEntityCount = {};

  // ── IXOS HTML parser ───────────────────────────────────────────────────────
  // Mirrors the Python IXOSTableParser — extracts (invoiceId, legalEntity)
  // pairs from IXOS's HTML table response.

  function parseIxosHtml(html) {
    const parser   = new DOMParser();
    const doc      = parser.parseFromString(html, 'text/html');
    const rows     = doc.querySelectorAll('table tr');
    const invoices = [];
    let   headerDone = false;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));

      if (!headerDone) {
        if (cells.some(c => c.tagName === 'TH')) { headerDone = true; }
        continue;
      }

      if (cells.length >= 7) {
        const invId    = cells[1]?.textContent.trim().replace(/^'/, '') || '';
        const legalEnt = cells[2]?.textContent.trim() || '';
        if (invId && legalEnt) {
          _legalEntityCount[legalEnt] ??= 0;
          _legalEntityCount[legalEnt]++;
          invoices.push({ invId, legalEnt });
        }
      }
    }
    _log.info(
      "Legal Entities count per IXOS:",
      JSON.stringify(_legalEntityCount, null, 2)
    );
    return invoices;
  }

  function buildIxosUrl(desc, fromDt, toDt) {
    return CONFIG.ixosBase
      + `?axObjectID=&axObjectID_case_insensitive=true`
      + `&Description=${desc}&Description_case_insensitive=true`
      + `&DocumentDate_from=${fmtIxos(fromDt)}`
      + `&DocumentDate_until=${fmtIxos(toDt)}`
      + `&LinkDate_from=&LinkDate_until=`
      + `&axDestination=*ALL*&axObjectType=*ALL*&axObjectType2=*NONE*`
      + `&ixArchiveID=*ALL*&Sort=axObjectID`
      + `&MaxRows=${CONFIG.ixosMaxRows}&invoiceForm=Submit`;
  }

  // ── IXOS fetch (via GM_xmlhttpRequest) ─────────────────────────────────────

  async function fetchIxosInvoices(fromDt, toDt) {
    const allIds = new Set();

    for (const { desc, label } of CONFIG.ixosTypes) {
      _log.info(`[IXOS/${label}] Querying...`);
      try {
        const url  = buildIxosUrl(desc, fromDt, toDt);
        const resp = await gmFetch(url, { timeout: 180_000 });

        if (resp.status !== 200) {
          _log.warn(`[IXOS/${label}] HTTP ${resp.status} — skipping`);
          continue;
        }

        const rows = parseIxosHtml(resp.text);
        rows.forEach(r => allIds.add(normalizeId(r.invId)));
        _log.ok(`[IXOS/${label}] ${rows.length} invoices`);

      } catch (err) {
        _log.warn(`[IXOS/${label}] Error: ${err.message}`);
      }
    }

    _log.ok(`[IXOS] Total (SI+FTI): ${allIds.size}`);
    return allIds;
  }

  // ── D365 invoice download (one batch) ──────────────────────────────────────

  /**
   * Apply a date filter on the CustInvoiceJournal grid, select all rows,
   * export to Excel, intercept the blob URL, download the XLSX, and
   * return the set of invoice IDs found.
   *
   * The caller is responsible for being on the correct entity BEFORE calling
   * this — use switchEntity() first.
   */
  async function downloadBatch(fromDt, toDt, batchLabel) {
    _log.info(`  Batch ${batchLabel}: ${fmtD365(fromDt)} → ${fmtD365(toDt)}`);

    // Set up blob interceptor BEFORE triggering the export
    const interceptor = createBlobInterceptor();

    try {
      // ① Wait for the journal grid to be ready
      await waitReady('[role="grid"]');

      // ② Open the date filter
      //    D365 date range filters typically live in the filter row or
      //    in the "Filter" panel.  We click the column header to open inline
      //    filter, or use the Advanced filter button.
      const grid = document.querySelector('[role="grid"]');
      if (!grid) throw new Error('Invoice journal grid not found');

      // Click the "Created date and time" column filter header
      const dateHeader = findByText('Created date and time');
      if (dateHeader) {
        simulateClick(dateHeader);
        await sleep(400);
      }
      await waitForD365Idle();

      // Fill the from/to date inputs
      // D365 date range inputs typically have name patterns ending in _Input_0 / _Input_1
      const fromInput = await waitForElement(
        'input[name$="_createdDateTime_Input_0"]'
      );

      const toInput = await waitForElement(
        'input[name$="_createdDateTime_Input_1"]'
      );
      await sleep(d365Config.stepDelayMs);

      const { fill } = await import('./core.js');
      if (fromInput) await fill(fromInput, fmtD365(fromDt));
      if (toInput)   await fill(toInput,   fmtD365(toDt));

      // Apply
      const applyBtn = findButton('Apply');
      if (applyBtn) {
        simulateClick(applyBtn);
        await waitReady('[role="grid"]');
      }
      await waitForD365Idle();
      await sleep(d365Config.stepDelayMs);

      // ③ Select all rows
      const checkbox = await getByRole("checkbox", "Select or unselect all rows");
      const checked = checkbox.getAttribute('aria-checked');     

      if (checked !== true) {
        simulateClick(checkbox);
        await waitForD365Idle();
        await sleep(d365Config.stepDelayMs);
      }

      // ④ Open in Microsoft Office → Export to Excel
      const officeBtn = findButton('Open in Microsoft Office');
      if (!officeBtn) throw new Error('"Open in Microsoft Office" button not found');
      simulateClick(officeBtn);
      await waitForD365Idle();

      const exportItem = findButton('Export to Excel Customer') ||
        Array.from(document.querySelectorAll('[role="menuitem"]'))
          .find(el => el.textContent.includes('Export to Excel'));

      if (!exportItem) throw new Error('"Export to Excel" menu item not found');
      simulateClick(exportItem);
      await waitForD365Idle();

      const downloadBtn = findButton('Download') ||
        Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.trim() === 'Download');
      if (!downloadBtn) throw new Error('"Download" button not found');
      simulateClick(downloadBtn);
      await waitForD365Idle();

      // ⑤ Wait for blob URL (up to 10 minutes)
      _log.info('  ⏳ Waiting for D365 to generate XLSX...');
      const blobUrl = await interceptor.promise;
      _log.ok(`  Blob URL captured`);

      // ⑥ Download the XLSX via GM_xmlhttpRequest
      const buffer = await downloadBlob(blobUrl);
      const rows   = await parseXlsx(buffer);

      if (!rows.length || !('Invoice' in rows[0])) {
        _log.warn(`  "Invoice" column not found. Available: ${Object.keys(rows[0] || {}).join(', ')}`);
        return new Set();
      }

      const ids = new Set(
        rows.map(r => r['Invoice']).filter(v => v && String(v).trim() !== '').map(normalizeId)
      );
      _log.ok(`  ${ids.size} invoice IDs in this batch`);
      return ids;

    } finally {
      interceptor.stop();
    }
  }

  // ── D365 fetch (all batches for one entity) ─────────────────────────────────

  async function fetchD365Invoices(entity, fromDt, toDt) {
    const batches = generateBatches(fromDt, toDt, CONFIG.batchHours);
    _log.info(`[${entity}] ${batches.length} batch(es) to process`);

    const allIds = new Set();

    for (let i = 0; i < batches.length; i++) {
      const [bFrom, bTo] = batches[i];
      const label = `${i + 1}/${batches.length}`;
      try {
        const ids = await downloadBatch(bFrom, bTo, label);
        ids.forEach(id => allIds.add(id));
      } catch (err) {
        _log.warn(`[${entity}] Batch ${label} failed: ${err.message}`);
      }
      await waitForD365Idle();
    }

    _log.ok(`[${entity}] ${allIds.size} unique invoice IDs after all batches`);
    return allIds;
  }

  // ── main run ───────────────────────────────────────────────────────────────

  /**
   * @param {object}   params
   * @param {Date}     params.fromDt
   * @param {Date}     params.toDt
   * @param {string[]} params.entities   e.g. ['4111', '0051']
   */
  async function run({ fromDt, toDt, entities }) {
    if (!fromDt || !toDt || !entities?.length) {
      throw new Error('run() requires { fromDt, toDt, entities }');
    }

    _results = [];

    _log.info('═'.repeat(50));
    _log.info('  D365 ↔ IXOS Invoice Cross-Check');
    _log.info('═'.repeat(50));
    _log.info(`Date range : ${fmtD365(fromDt)} → ${fmtD365(toDt)}`);
    _log.info(`Entities   : ${entities.join(', ')}`);

    // 1. Fetch IXOS once for all entities
    _log.info('\n── IXOS ─────────────────────────────────────────────────');
    _ixosIds = await fetchIxosInvoices(fromDt, toDt);

    // 2. Process each entity
    for (const entity of entities) {
      _log.info(`\n── Entity: ${entity} ─────────────────────────────────────`);

      // Switch entity (no page reload)
      await switchEntity(entity);
      await waitReady();

      const d365Ids = await fetchD365Invoices(entity, fromDt, toDt);

      if (!d365Ids.size) {
        _log.warn(`[${entity}] No D365 invoices found — skipping.`);
        _results.push({ entity, d365Count: 0, ixosCount: _legalEntityCount[entity], missingCount: 0, missing: [] });
        continue;
      }

      const missing = [...d365Ids].filter(id => !_ixosIds.has(id));
      _log.info(`[${entity}] D365=${d365Ids.size} | IXOS=${_legalEntityCount[entity]} | Missing=${missing.length}`);

      _results.push({
        entity,
        d365Count:    d365Ids.size,
        ixosCount:    _legalEntityCount[entity],
        missingCount: missing.length,
        missing,
      });

      if (missing.length) {
        _log.warn(`[${entity}] ❌ ${missing.length} invoice(s) missing from IXOS`);
      } else {
        _log.ok(`[${entity}] ✅ All D365 invoices present in IXOS`);
      }
    }

    _printSummary();
    return _results;
  }

  function _printSummary() {
    _log.info('\n========== INVOICE CROSS-CHECK SUMMARY ==========');
    console.table(_results.map(r => ({
      Entity:   r.entity,
      D365:     r.d365Count,
      IXOS:     r.ixosCount,
      Missing:  r.missingCount,
    })));
  }

  /** Export a flat CSV of all missing invoices across all entities. */
  function doExportCsv(filename = 'invoice-missing.csv') {
    const rows = _results.flatMap(r =>
      r.missing.map(id => ({ Entity: r.entity, 'Invoice ID': id }))
    );
    if (!rows.length) { _log.warn('No missing invoices to export.'); return; }
    exportCsv(rows, filename);
  }

  /** Export a per-entity summary CSV. */
  function doExportSummaryCsv(filename = 'invoice-summary.csv') {
    if (!_results.length) { _log.warn('No results yet.'); return; }
    exportCsv(_results.map(r => ({
      Entity:        r.entity,
      'D365 count':  String(r.d365Count),
      'IXOS count':  String(r.ixosCount),
      'Missing':     String(r.missingCount),
    })), filename);
  }

  return {
    CONFIG,
    run,
    exportCsv:        doExportCsv,
    exportSummaryCsv: doExportSummaryCsv,
    getResults:       () => _results,
    getIxosIds:       () => _ixosIds,
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

const workflows = { BatchJobMonitor, InvoiceCrossCheck };
export { workflows, BatchJobMonitor, InvoiceCrossCheck };
