/**
 * d365.js
 * ───────
 * D365 Finance & Operations — page-specific helpers built on top of core.js.
 *
 * Covers:
 *   • Page readiness detection
 *   • Grid navigation (virtualized grids)
 *   • Toolbar button finding
 *   • Company / entity switching via the top-bar picker
 *   • Excel export + blob URL interception
 *   • XLSX parsing in-browser (via SheetJS loaded on demand)
 */

import {
  _log, sleep, waitFor, waitForGone,
  isVisible, query, findByText, findByLabel,
  simulateClick, click, fill, press, scrollGrid,
} from './core.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG  (callers can override via D365Toolkit.d365Config)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  stepDelayMs:          400,
  navigationTimeoutMs:  25_000,
  historyRowTimeoutMs:  6_000,
  goToRowMaxAttempts:   80,
};

export let d365Config = { ...DEFAULT_CONFIG };

// ─────────────────────────────────────────────────────────────────────────────
// Loading indicators / page readiness
// ─────────────────────────────────────────────────────────────────────────────

const LOADING_SELECTORS = [
  '.waitPanel',
  '.dyn-loadingIndicator',
  "[id*='loadingIndicator']",
  '.loading-blocker',
];

/**
 * Wait until all D365 loading spinners have disappeared and the DOM is stable.
 * @param {string} [extraSelector]  optionally wait for this to become visible too
 */
async function waitReady(extraSelector = null) {
  // Wait for all known spinners to vanish
  for (const sel of LOADING_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) {
      await waitFor(() => {
        const e = document.querySelector(sel);
        return !e || !isVisible(e);
      }, { timeout: d365Config.navigationTimeoutMs, label: `loading indicator "${sel}" to hide` });
    }
  }
  if (extraSelector) {
    await waitFor(
      () => query(extraSelector, { visibleOnly: true }),
      { timeout: d365Config.navigationTimeoutMs, label: `"${extraSelector}" to appear` }
    );
  }
  await sleep(d365Config.stepDelayMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a D365 grid element by its aria-label.
 * @param {string} label  e.g. "Batch job" or "Batch jobs history"
 */
function getGrid(label) {
  return document.querySelector(`[role="grid"][aria-label="${label}"]`);
}

/** Total data-row count from the grid's aria-rowcount attribute. */
function getRowCount(grid) {
  return Math.max(0, (parseInt(grid.getAttribute('aria-rowcount'), 10) || 1) - 1);
}

/** Get a row element by its aria-rowindex (1 = header, 2 = first data row). */
function getRowByIndex(grid, idx) {
  return grid.querySelector(`[role="row"][aria-rowindex="${idx}"]`);
}

/** Get the currently active (selected) row. */
function getActiveRow(grid) {
  return grid.querySelector('[role="row"][data-dyn-row-active="true"]');
}

function getActiveRowIndex(grid) {
  const row = getActiveRow(grid);
  return row ? parseInt(row.getAttribute('aria-rowindex'), 10) : null;
}

/**
 * Read the value of a cell in a grid row by its column aria-label.
 * D365 renders cell values as `<input aria-label="Column Name" value="..." />`.
 */
function readCell(rowEl, columnLabel) {
  const input = rowEl.querySelector(`input[aria-label="${columnLabel}"]`);
  return input ? input.value.trim() : '';
}

/**
 * Activate (select) a row by clicking its first meaningful cell.
 * Retries with a direct row click if the status cell click didn't work.
 */
async function selectRow(grid, rowEl, expectedIdx) {
  // Prefer clicking a grid cell rather than the row itself
  const cell = rowEl.querySelector('[role="gridcell"]') || rowEl;
  simulateClick(cell);
  await sleep(120);
  if (getActiveRowIndex(grid) !== expectedIdx) {
    simulateClick(rowEl);
    await sleep(120);
  }
}

/**
 * Scroll the virtualised grid until row `idx` is rendered, then select it.
 * Works regardless of current scroll position.
 */
async function goToRow(gridOrLabel, idx) {
  const getG = () =>
    typeof gridOrLabel === 'string' ? getGrid(gridOrLabel) : (document.contains(gridOrLabel) ? gridOrLabel : null);

  for (let attempt = 0; attempt < d365Config.goToRowMaxAttempts; attempt++) {
    const grid  = getG();
    if (!grid) throw new Error('goToRow: grid is no longer in the DOM');

    const rowEl = getRowByIndex(grid, idx);
    if (rowEl) {
      await selectRow(grid, rowEl, idx);
      if (getActiveRowIndex(grid) === idx) return rowEl;
      await sleep(100);
      continue;
    }

    // Row not rendered yet — scroll toward it
    const rendered = Array.from(grid.querySelectorAll('[role="row"][aria-rowindex]'))
      .map(r => parseInt(r.getAttribute('aria-rowindex'), 10))
      .filter(n => !isNaN(n));

    if (rendered.length) {
      const minRendered = Math.min(...rendered);
      scrollGrid(grid, idx < minRendered ? -150 : 150);
    } else {
      scrollGrid(grid, 150);
    }
    await sleep(220);
  }
  throw new Error(`goToRow: could not reach row index ${idx} after ${d365Config.goToRowMaxAttempts} attempts`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar buttons
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find a toolbar/action-pane button by:
 *   1. id ending in `_${idSuffix}`
 *   2. aria-label containing `label` (case-insensitive)
 *   3. visible text match
 *
 * @param {string} label      Button label text (also used for text fallback)
 * @param {string} [idSuffix] Optional id suffix (e.g. "_BatchJobHistory")
 */
function findButton(label, idSuffix = null) {
  if (idSuffix) {
    const byId = document.querySelector(`[id$="${idSuffix}"]`);
    if (byId) {
      const clickable = byId.closest('button,[role="button"],a')
        || byId.querySelector('button,[role="button"],a')
        || byId;
      if (isVisible(clickable)) return clickable;
    }
  }
  return findByLabel(label) || findByText(label);
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Events
// ─────────────────────────────────────────────────────────────────────────────

function pressKey(el, key, code = key) {
  el.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
    })
  );

  el.dispatchEvent(
    new KeyboardEvent('keyup', {
      key,
      code,
      bubbles: true,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity / company switching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Switch the active legal entity using the top-bar company picker.
 * Does NOT cause a full page reload — D365 updates the current page in-place.
 *
 * @param {string} entityCode  e.g. "4111" or "0051"
 */
async function switchEntity(entityCode) {
  const currentBtn = document.querySelector('#CompanyButton_button');
  if (!currentBtn) throw new Error('switchEntity: company button not found');

  const currentCode = currentBtn.textContent.trim();
  if (currentCode === entityCode) {
    _log.info(`Already on entity ${entityCode} — skipping switch`);
    return;
  }

  _log.info(`Switching entity: ${currentCode} → ${entityCode}`);

  // 1. Open the picker
  simulateClick(currentBtn);

  // 2. Wait for the search input to appear
  const searchInput = await waitFor(
    () => {
      // D365 shows a dialog/panel with a search box — try common selectors
      return (
        query('input[aria-label*="company" i]',   { visibleOnly: true }) ||
        query('input[aria-label*="entity" i]',     { visibleOnly: true }) ||
        query('input[placeholder*="Search" i]',    { visibleOnly: true }) ||
        query('.navigationBar-searchInput input',  { visibleOnly: true }) ||
        query('[data-dyn-controlname*="Company"] input', { visibleOnly: true })
      );
    },
    { timeout: 10_000, label: 'company picker search input' }
  );

  // 3. Type the entity code
  await fill(searchInput, entityCode);
  await sleep(600); // let the list filter

  // 4. Click the matching list item
  const listItem = await waitFor(
    () => {
      // Look for an option/row whose text exactly matches the entity code
      const items = document.querySelectorAll(
        '[role="option"], [role="listitem"], [role="row"], .navigationBar-companyListItem'
      );
      for (const item of items) {
        if (isVisible(item) && item.textContent.trim().startsWith(entityCode)) {
          return item;
        }
      }
      return null;
    },
    { timeout: 8_000, label: `company list item for "${entityCode}"` }
  );

  simulateClick(listItem);

  // 5. Wait for D365 to finish refreshing the page data
  await waitReady();

  // Confirm the switch
  const newCode = document.querySelector('#CompanyButton_button')?.textContent.trim();
  if (newCode !== entityCode) {
    _log.warn(`switchEntity: button shows "${newCode}" instead of "${entityCode}" — continuing anyway`);
  } else {
    _log.ok(`Switched to entity ${entityCode}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigate to a D365 module (menu item)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navigate to a D365 module by appending `?mi=<module>` to the base URL.
 * Uses the current page's origin so it works for any D365 environment.
 *
 * @param {string} module   e.g. "CustInvoiceJournal", "BatchJob"
 * @param {string} [entity] optionally switch entity first
 */
async function navigate(module, entity = null) {
  if (entity) await switchEntity(entity);
  const base = `${location.origin}/`;
  const cmp  = document.querySelector('#CompanyButton_button')?.textContent.trim() || '';
  location.href = `${base}?cmp=${cmp}&mi=${module}`;
  // After navigation the page fully reloads — caller must waitReady()
}

// ─────────────────────────────────────────────────────────────────────────────
// Excel export + blob URL interception
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set up an XHR/fetch interceptor that listens for the D365
 * ReliableCommunicationManager response which carries the blob URL.
 *
 * Returns { stop, promise }:
 *   - promise  resolves with the captured blob URL string
 *   - stop()   removes the interceptor (call in finally)
 *
 * The interceptor patches XMLHttpRequest.prototype.open so it survives
 * D365's own XHR activity without any global side-effects beyond the patch.
 */
function createBlobInterceptor() {
  const captured = [];

  // Patch XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this._d365url = args[1] || '';
    return origOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._d365url && this._d365url.includes('ReliableCommunicationManager')) {
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText);
          for (const msg of (data.Messages || [])) {
            for (const interaction of (msg.Interactions || [])) {
              if (interaction.$type === 'NavigationInteraction') {
                const url = interaction.NamedParameters?.url || '';
                if (url.includes('blob.core.windows.net') && url.includes('.xlsx')) {
                  captured.push(url);
                }
              }
            }
          }
        } catch (_) { /* not a JSON blob response */ }
      });
    }
    return origSend.apply(this, args);
  };

  const promise = new Promise((resolve, reject) => {
    const check  = setInterval(() => { if (captured.length) { clearInterval(check); resolve(captured[captured.length - 1]); } }, 300);
    setTimeout(() => { clearInterval(check); reject(new Error('Blob URL not captured within timeout')); }, 10 * 60 * 1000);
  });

  function stop() {
    XMLHttpRequest.prototype.open = origOpen;
    XMLHttpRequest.prototype.send = origSend;
  }

  return { promise, stop };
}

/**
 * Download an Azure blob URL and return its contents as an ArrayBuffer.
 * Uses window.gmXmlHttpRequest (bridged from TamperMonkey) so the
 * browser's same-origin policy doesn't block the cross-origin blob URL.
 *
 * Falls back to window.fetch only if the bridge is absent.
 */
function downloadBlob(url) {
  const bridge = window.gmXmlHttpRequest;

  if (typeof bridge === 'function') {
    return new Promise((resolve, reject) => {
      bridge({
        method:       'GET',
        url,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
        },
        timeout:   120_000,
        onload:    r  => resolve(r.response),
        onerror:   e  => reject(new Error(`downloadBlob failed: ${JSON.stringify(e)}`)),
        ontimeout: () => reject(new Error('downloadBlob timed out')),
      });
    });
  }

  _log.warn('downloadBlob: window.gmXmlHttpRequest not found — falling back to window.fetch (may fail on CORS)');
  return fetch(url).then(r => r.arrayBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// SheetJS loader (loaded once on demand from CDN)
// ─────────────────────────────────────────────────────────────────────────────

let _xlsxReady = null;

async function loadSheetJS() {
  if (typeof XLSX !== 'undefined') return;
  if (_xlsxReady) return _xlsxReady;

  _xlsxReady = new Promise((resolve, reject) => {
    const s   = document.createElement('script');
    s.src     = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Failed to load SheetJS from CDN'));
    document.head.appendChild(s);
  });
  await _xlsxReady;
  _log.ok('SheetJS loaded');
}

/**
 * Parse an XLSX ArrayBuffer and return an array of row objects
 * (first row is treated as the header).
 *
 * @param {ArrayBuffer} buffer
 * @param {string}      [sheetName]  defaults to the first sheet
 * @returns {object[]}
 */
async function parseXlsx(buffer, sheetName = null) {
  await loadSheetJS();
  const workbook  = XLSX.read(buffer, { type: 'array' });
  const sheet     = workbook.Sheets[sheetName || workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  waitReady,
  getGrid,
  getRowCount,
  getRowByIndex,
  getActiveRow,
  getActiveRowIndex,
  readCell,
  selectRow,
  goToRow,
  findButton,
  switchEntity,
  navigate,
  createBlobInterceptor,
  downloadBlob,
  loadSheetJS,
  parseXlsx,
};
