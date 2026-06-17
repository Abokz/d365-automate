/**
 * Batch Job Monitor — Dynamics 365 Finance & Operations
 * ------------------------------------------------------
 * Walks every row in the "Batch job" list grid, opens "Batch job history"
 * for each one, reads the most recent run (first row of the history grid —
 * that grid is sorted by End date/time descending), and flags jobs that:
 *   - did NOT end with status "Ended", or
 *   - ended but ran for less than CONFIG.shortDurationThresholdSec seconds
 *     (a likely sign the job failed almost immediately).
 *
 * HOW TO USE
 * 1. Open the batch job list page (your "Daily jobs to Monitor" view) so the
 *    grid is visible, with the first row loaded.
 * 2. Open the browser console (F12) and paste this entire script, then press
 *    Enter. This only defines window.BatchJobMonitor — nothing runs yet.
 * 3. Run:           BatchJobMonitor.selfTest()
 *    This checks whether the script can find the grid, the "Batch job
 *    history" button, and the "Back" button. Fix anything it flags before
 *    continuing (see note below).
 * 4. Optionally run: await BatchJobMonitor.testOne()
 *    This processes just the currently-active row end-to-end, so you can
 *    confirm the whole click -> read history -> navigate back cycle works
 *    before committing to the full list.
 * 5. Run the full thing:
 *      await BatchJobMonitor.run()
 *    (If your console doesn't support top-level await, use
 *      BatchJobMonitor.run().then(r => console.log('done', r));)
 * 6. A report table prints automatically when it finishes. You can also run
 *      BatchJobMonitor.exportCsv()
 *    afterwards to download the results as a CSV file.
 *
 * IF SELFTEST FLAGS A MISSING BUTTON
 * The grid/column lookups come straight from your page's markup and should
 * be stable. The "Batch job history" and "Back" buttons weren't in what you
 * shared, so I guessed reasonable selectors with text-based fallbacks. If
 * selfTest() reports either as "NOT FOUND", right-click that button in your
 * browser -> Inspect, note its id/aria-label, and update
 * findBatchJobHistoryButton() / findBackButton() below.
 */
(function () {
  'use strict';

  const CONFIG = {
    shortDurationThresholdSec: 30, // flag runs that ended in under this many seconds
    stepDelayMs: 400,              // small pause after each click/navigation
    navigationTimeoutMs: 20000,    // how long to wait for a page transition
    historyRowTimeoutMs: 6000,     // how long to wait for the first history row before assuming "no history"
    goToRowMaxAttempts: 80,        // how many scroll/select cycles before giving up on reaching a row
    retriesPerJob: 1,              // extra attempts if reading a job's history fails
    maxJobs: null,                 // set a number to limit a test run, or null for all
  };

  let lastReport = [];

  // ---------- generic helpers ----------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(checkFn, { timeout = 15000, interval = 200, label = 'condition' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = checkFn();
      if (result) return result;
      await sleep(interval);
    }
    throw new Error(`Timed out after ${timeout}ms waiting for: ${label}`);
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function simulateClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function scrollGridDown(grid, amount = 150) {
    const rect = grid.getBoundingClientRect();
    grid.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: amount,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );
  }

  function findClickableByExactText(text) {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(text);
    const candidates = document.querySelectorAll('button, [role="button"], a, span, div');
    for (const el of candidates) {
      if (norm(el.textContent) === target && isVisible(el)) {
        return el.closest('button, [role="button"], a') || el;
      }
    }
    return null;
  }

  // ---------- grid lookups (based on your actual markup) ----------

  function getMainGrid() {
    return document.querySelector('[role="grid"][aria-label="Batch job"]');
  }

  function getHistoryGrid() {
    return document.querySelector('[role="grid"][aria-label="Batch jobs history"]');
  }

  function getRowByAriaIndex(grid, idx) {
    return grid.querySelector(`[role="row"][aria-rowindex="${idx}"]`);
  }

  function getActiveRow(grid) {
    return grid.querySelector('[role="row"][data-dyn-row-active="true"]');
  }

  function getActiveRowAriaIndex(grid) {
    const row = getActiveRow(grid);
    return row ? parseInt(row.getAttribute('aria-rowindex'), 10) : null;
  }

  function readCell(rowEl, label) {
    const input = rowEl.querySelector(`input[aria-label="${label}"]`);
    return input ? input.value.trim() : '';
  }

  function readMainRow(rowEl) {
    return {
      jobId: readCell(rowEl, 'Job ID'),
      status: readCell(rowEl, 'Status'),
      description: readCell(rowEl, 'Job description'),
    };
  }

  function readHistoryRow(rowEl) {
    return {
      status: readCell(rowEl, 'Status'),
      start: readCell(rowEl, 'Actual start date/time'),
      end: readCell(rowEl, 'End date/time'),
    };
  }

  // ---------- toolbar buttons (best-guess selectors — verify with selfTest) ----------

  function findBatchJobHistoryButton() {
    const byId = document.querySelector('[id$="_BatchJobHistory"]');
    if (byId) {
      const clickable =
        byId.closest('button, [role="button"], a') ||
        byId.querySelector('button, [role="button"], a') ||
        byId;
      if (isVisible(clickable)) return clickable;
    }
    return findClickableByExactText('Batch job history');
  }

  function findBackButton() {
    return (
      document.querySelector('button[aria-label="Back" i], [role="button"][aria-label="Back" i]') ||
      document.querySelector('button[aria-label="Close" i], [role="button"][aria-label="Close" i]')
    );
  }

  // ---------- row selection / navigation through the virtualized grid ----------

  function getStatusCell(rowEl) {
    const input = rowEl.querySelector('input[aria-label="Status"]');
    if (!input) return rowEl;
    return input.closest('[role="gridcell"]') || input.parentElement;
  }

  async function selectRow(grid, rowEl, expectedIdx) {
    simulateClick(getStatusCell(rowEl));
    await sleep(150);
    if (getActiveRowAriaIndex(grid) !== expectedIdx) {
      simulateClick(rowEl);
      await sleep(150);
    }
  }

  // Brings row `idx` into view and selects it, regardless of where the
  // grid is currently scrolled to. Doesn't assume the previously-active
  // row is still rendered (it may not be, e.g. after returning from the
  // history page), so it scrolls up or down as needed based on what's
  // actually rendered right now.
  async function goToRow(grid, idx) {
    for (let attempt = 0; attempt < CONFIG.goToRowMaxAttempts; attempt++) {
      grid = getMainGrid() || grid;
      const rowEl = getRowByAriaIndex(grid, idx);
      if (rowEl) {
        await selectRow(grid, rowEl, idx);
        if (getActiveRowAriaIndex(grid) === idx) return rowEl;
        await sleep(150);
        continue;
      }
      const rendered = Array.from(grid.querySelectorAll('[role="row"][aria-rowindex]'))
        .map((r) => parseInt(r.getAttribute('aria-rowindex'), 10))
        .filter((n) => !isNaN(n));
      if (rendered.length) {
        const minIdx = Math.min(...rendered);
        scrollGridDown(grid, idx < minIdx ? -150 : 150);
      } else {
        scrollGridDown(grid, 150);
      }
      await sleep(250);
    }
    throw new Error(`could not bring row index ${idx} into view after ${CONFIG.goToRowMaxAttempts} attempts`);
  }

  // ---------- date math ----------

  function parseDate(str) {
    if (!str) return null;
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    // Fallback for "M/D/YYYY h:mm:ss AM/PM" in case native parsing fails for your locale
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      let [, mo, da, yr, hr, mi, se, ap] = m;
      hr = parseInt(hr, 10);
      if (/pm/i.test(ap) && hr < 12) hr += 12;
      if (/am/i.test(ap) && hr === 12) hr = 0;
      return new Date(+yr, +mo - 1, +da, hr, +mi, +se);
    }
    return null;
  }

  function durationSeconds(startStr, endStr) {
    const s = parseDate(startStr);
    const e = parseDate(endStr);
    if (!s || !e) return null;
    return Math.round((e - s) / 1000);
  }

  // ---------- per-job work ----------

  // Reads the first row of the history grid. Never returns a stale/null
  // grid reference to querySelector — every check re-fetches the grid
  // fresh, and "no row yet" is retried (rather than assumed to be an error)
  // for up to historyRowTimeoutMs before being treated as "no history".
  async function openHistoryAndReadFirstRow() {
    const btn = findBatchJobHistoryButton();
    if (!btn) throw new Error('Could not find the "Batch job history" button');
    simulateClick(btn);

    let data = { status: 'NO_HISTORY', start: '', end: '' };
    let readError = null;

    try {
      await waitFor(() => getHistoryGrid() !== null, {
        timeout: CONFIG.navigationTimeoutMs,
        label: 'history grid to appear',
      });

      let firstRow = null;
      try {
        firstRow = await waitFor(
          () => {
            const g = getHistoryGrid();
            return g ? getRowByAriaIndex(g, 2) : null;
          },
          { timeout: CONFIG.historyRowTimeoutMs, interval: 200, label: 'history first row' }
        );
      } catch (e) {
        firstRow = null; // genuinely no history yet — not a script error
      }

      if (firstRow) data = readHistoryRow(firstRow);
    } catch (err) {
      readError = err;
    } finally {
      // No matter what happened above, always try to get back to the main
      // grid — otherwise every job after this one fails too.
      const backBtn = findBackButton();
      if (backBtn) {
        simulateClick(backBtn);
      } else {
        history.back();
      }
      try {
        await waitFor(() => getMainGrid() !== null, {
          timeout: CONFIG.navigationTimeoutMs,
          label: 'main grid to reappear',
        });
        await sleep(CONFIG.stepDelayMs);
      } catch (backErr) {
        throw new Error(
          `Could not return to the main grid${readError ? ' (after: ' + readError.message + ')' : ''}: ${backErr.message}`
        );
      }
    }

    if (readError) throw readError;
    return data;
  }

  async function openHistoryAndReadFirstRowWithRetry(retries) {
    try {
      return await openHistoryAndReadFirstRow();
    } catch (err) {
      if (retries > 0) {
        console.warn(`  retrying after error: ${err.message}`);
        await sleep(800);
        return openHistoryAndReadFirstRowWithRetry(retries - 1);
      }
      throw err;
    }
  }

  function evaluateJob(hist) {
    if (hist.status === 'NO_HISTORY') {
      return { flag: 'ATTENTION', note: 'No execution history found for this job', durationSec: null };
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

  // ---------- public API ----------

  function selfTest() {
    const mainGrid = getMainGrid();
    const historyBtn = findBatchJobHistoryButton();
    const backBtn = findBackButton();
    console.log('Main grid found:', !!mainGrid);
    console.log('Active row found:', !!(mainGrid && getActiveRow(mainGrid)));
    console.log('"Batch job history" button found:', !!historyBtn, historyBtn);
    console.log('"Back" button found:', !!backBtn, backBtn);
    if (!mainGrid) console.warn('Make sure you are on the batch job list page.');
    if (!historyBtn) console.warn('Update findBatchJobHistoryButton() with the real selector.');
    if (!backBtn) console.warn('Update findBackButton() with the real selector (falls back to history.back() otherwise).');
  }

  async function testOne() {
    const mainGrid = getMainGrid();
    if (!mainGrid) throw new Error('Main grid not found — are you on the batch job list page?');
    const active = getActiveRow(mainGrid);
    if (!active) throw new Error('No active row selected in the grid');
    const job = readMainRow(active);
    console.log('Testing job:', job);
    const hist = await openHistoryAndReadFirstRow();
    console.log('History first row:', hist);
    console.log('Evaluation:', evaluateJob(hist));
  }

  async function run() {
    let grid = getMainGrid();
    if (!grid) throw new Error('Main grid not found — are you on the batch job list page?');

    const totalRows = (parseInt(grid.getAttribute('aria-rowcount'), 10) || 1) - 1;
    const limit = CONFIG.maxJobs ? Math.min(CONFIG.maxJobs, totalRows) : totalRows;
    console.log(`Found ${totalRows} job(s) in the grid. Processing ${limit}.`);

    const report = [];
    let idx = 2; // aria-rowindex of the first data row (1 is the header)

    for (let i = 0; i < limit; i++) {
      grid = getMainGrid();
      if (!grid) {
        console.error(`Stopped at job ${i + 1}: main grid is no longer on screen.`);
        break;
      }

      let rowEl;
      try {
        rowEl = await goToRow(grid, idx);
      } catch (err) {
        console.error(`Stopped at job ${i + 1}: ${err.message}`);
        break;
      }

      const job = readMainRow(rowEl);
      console.log(`[${i + 1}/${limit}] ${job.jobId} — ${job.description}`);

      let entry = { ...job, historyStatus: '', start: '', end: '', durationSec: null, flag: 'ERROR', note: '' };
      try {
        const hist = await openHistoryAndReadFirstRowWithRetry(CONFIG.retriesPerJob);
        const evalResult = evaluateJob(hist);
        entry.historyStatus = hist.status;
        entry.start = hist.start;
        entry.end = hist.end;
        entry.durationSec = evalResult.durationSec;
        entry.flag = evalResult.flag;
        entry.note = evalResult.note;
      } catch (err) {
        entry.note = `Failed to read history: ${err.message}`;
        console.error(`  ${job.jobId}: ${entry.note}`);
      }
      report.push(entry);

      idx++;
      await sleep(CONFIG.stepDelayMs);
    }

    lastReport = report;
    printReport(report);
    return report;
  }

  function printReport(report) {
    console.log('\n========== BATCH JOB MONITOR REPORT ==========');
    console.table(
      report.map((r) => ({
        'Job ID': r.jobId,
        Description: r.description,
        'Last status': r.historyStatus,
        Start: r.start,
        End: r.end,
        'Duration (s)': r.durationSec,
        Flag: r.flag,
        Note: r.note,
      }))
    );
    const attention = report.filter((r) => r.flag !== 'OK');
    if (attention.length) {
      console.warn(`${attention.length} of ${report.length} job(s) need attention:`);
      attention.forEach((r) => console.warn(`  • ${r.jobId} (${r.description}): ${r.note}`));
    } else {
      console.log(`All ${report.length} job(s) look healthy.`);
    }
  }

  function exportCsv(filename = 'batch-job-report.csv') {
    if (!lastReport.length) {
      console.warn('No report yet — run BatchJobMonitor.run() first.');
      return;
    }
    const headers = ['Job ID', 'Description', 'Last status', 'Start', 'End', 'Duration (s)', 'Flag', 'Note'];
    const rows = lastReport.map((r) => [
      r.jobId, r.description, r.historyStatus, r.start, r.end, r.durationSec, r.flag, r.note,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.BatchJobMonitor = { CONFIG, selfTest, testOne, run, exportCsv, getReport: () => lastReport };
  console.log('BatchJobMonitor loaded. Try BatchJobMonitor.selfTest() first.');
})();
