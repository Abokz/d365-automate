/**
 * core.js
 * ───────
 * Low-level primitives that mirror the Playwright API surface but run
 * directly in the browser page context.
 *
 * Exported onto window.D365Toolkit by index.js.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal logger  (all toolkit output is prefixed so it's easy to filter)
// ─────────────────────────────────────────────────────────────────────────────

const _log = {
  info:  (...a) => console.log( '%c[D365]', 'color:#4fc3f7;font-weight:bold', ...a),
  warn:  (...a) => console.warn('%c[D365]', 'color:#ffb74d;font-weight:bold', ...a),
  error: (...a) => console.error('%c[D365]', 'color:#ef5350;font-weight:bold', ...a),
  ok:    (...a) => console.log( '%c[D365]', 'color:#81c784;font-weight:bold', ...a),
};

// ─────────────────────────────────────────────────────────────────────────────
// sleep / waitFor
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Poll until checkFn() returns a truthy value.
 * @param {Function} checkFn
 * @param {object}   opts
 * @param {number}   opts.timeout   ms before rejection (default 15 000)
 * @param {number}   opts.interval  polling interval in ms (default 200)
 * @param {string}   opts.label     description shown in the timeout error
 * @returns {Promise<*>} the first truthy value returned by checkFn
 */
async function waitFor(checkFn, { timeout = 15_000, interval = 200, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = checkFn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`Timed out after ${timeout}ms waiting for: ${label}`);
}

/**
 * Wait until checkFn() returns falsy (element gone / hidden).
 */
async function waitForGone(checkFn, { timeout = 15_000, interval = 200, label = 'element to disappear' } = {}) {
  return waitFor(() => !checkFn(), { timeout, interval, label });
}

// ─────────────────────────────────────────────────────────────────────────────
// Visibility
// ─────────────────────────────────────────────────────────────────────────────

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const s = window.getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * querySelector with an optional visible-only filter.
 */
function query(selector, { visibleOnly = false, root = document } = {}) {
  if (!visibleOnly) return root.querySelector(selector);
  for (const el of root.querySelectorAll(selector)) {
    if (isVisible(el)) return el;
  }
  return null;
}

/**
 * Find any clickable element whose visible text exactly matches `text`
 * (case-insensitive, whitespace-normalised).
 */
function findByText(text, { root = document, visibleOnly = true } = {}) {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(text);
  const tags = 'button,[role="button"],a,[role="menuitem"],[role="option"],span,div,li';
  for (const el of root.querySelectorAll(tags)) {
    if (norm(el.textContent) === target) {
      if (!visibleOnly || isVisible(el)) {
        return el.closest('button,[role="button"],a,[role="menuitem"],[role="option"]') || el;
      }
    }
  }
  return null;
}

/**
 * Find element by aria-label (case-insensitive, substring match).
 */
function findByLabel(label, { root = document, visibleOnly = true } = {}) {
  const norm = s => (s || '').toLowerCase().trim();
  const target = norm(label);
  for (const el of root.querySelectorAll('[aria-label]')) {
    if (norm(el.getAttribute('aria-label')).includes(target)) {
      if (!visibleOnly || isVisible(el)) return el;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Click / fill — Playwright-style
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a realistic mouse-event sequence on an element.
 */
function simulateClick(el) {
  if (!el) throw new Error('simulateClick: element is null');
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup',   opts));
  el.dispatchEvent(new MouseEvent('click',     opts));
}

/**
 * Click the first visible element matching `selector`.
 * @param {string|Element} target  CSS selector or element reference
 * @param {object}         opts
 * @param {number}         opts.timeout   waitFor timeout in ms
 * @param {Element}        opts.root      search root
 */
async function click(target, { timeout = 15_000, root = document } = {}) {
  let el;
  if (typeof target === 'string') {
    el = await waitFor(
      () => query(target, { visibleOnly: true, root }),
      { timeout, label: `clickable element "${target}"` }
    );
  } else {
    el = target;
  }
  simulateClick(el);
  await sleep(80); // let D365 process the event
}

/**
 * Clear an input and type a new value, dispatching the events D365 listens to.
 * @param {string|Element} target  CSS selector or element reference
 * @param {string}         value
 */
async function fill(target, value, { timeout = 15_000, root = document } = {}) {
  let el;
  if (typeof target === 'string') {
    el = await waitFor(
      () => query(target, { root }),
      { timeout, label: `input "${target}"` }
    );
  } else {
    el = target;
  }

  el.focus();
  // React / D365 uses synthetic events — we need to set the value via the
  // native input value descriptor and then fire 'input' + 'change'.
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(80);
}

/**
 * Press a keyboard key on an element (e.g. 'Enter', 'Escape', 'Tab').
 */
async function press(target, key, { timeout = 15_000, root = document } = {}) {
  let el;
  if (typeof target === 'string') {
    el = await waitFor(() => query(target, { root }), { timeout, label: `element for keypress "${target}"` });
  } else {
    el = target;
  }
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  el.dispatchEvent(new KeyboardEvent('keyup',   { key, bubbles: true, cancelable: true }));
  await sleep(80);
}

/**
 * Scroll a grid element up or down by `amount` pixels via a WheelEvent.
 */
function scrollGrid(gridEl, amount = 150) {
  const rect = gridEl.getBoundingClientRect();
  gridEl.dispatchEvent(new WheelEvent('wheel', {
    deltaY:    amount,
    deltaMode: 0,
    bubbles:   true,
    cancelable: true,
    clientX:   rect.left + rect.width  / 2,
    clientY:   rect.top  + rect.height / 2,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GM_xmlhttpRequest wrapper  (IXOS / cross-origin intranet requests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a URL via TamperMonkey's GM_xmlhttpRequest (bypasses CORS).
 * Falls back to window.fetch if GM_xmlhttpRequest is not available
 * (e.g. during local dev / unit tests).
 *
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.method       default 'GET'
 * @param {object} opts.headers      request headers
 * @param {string} opts.body         request body (for POST)
 * @param {number} opts.timeout      ms (default 180 000)
 * @returns {Promise<{status:number, text:string, headers:object}>}
 */
function gmFetch(url, { method = 'GET', headers = {}, body = null, timeout = 180_000 } = {}) {
  if (typeof GM_xmlhttpRequest === 'undefined' && typeof GM === 'undefined') {
    _log.warn('GM_xmlhttpRequest not available — falling back to window.fetch (CORS may block)');
    return window.fetch(url, { method, headers, body })
      .then(async r => ({ status: r.status, text: await r.text(), headers: {} }));
  }

  const gmXhr = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest.bind(GM) : GM_xmlhttpRequest;

  return new Promise((resolve, reject) => {
    gmXhr({
      method,
      url,
      headers,
      data: body,
      timeout,
      onload:   r  => resolve({ status: r.status, text: r.responseText, headers: r.responseHeaders }),
      onerror:  e  => reject(new Error(`gmFetch network error: ${JSON.stringify(e)}`)),
      ontimeout: () => reject(new Error(`gmFetch timed out after ${timeout}ms: ${url}`)),
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export  (no external dependencies)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of `rows` (array of objects) as a CSV file.
 * @param {object[]} rows
 * @param {string}   filename
 */
function exportCsv(rows, filename = 'export.csv') {
  if (!rows.length) { _log.warn('exportCsv: no data to export'); return; }
  const headers = Object.keys(rows[0]);
  const escape  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines   = [headers.map(escape).join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))];
  const blob    = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url     = URL.createObjectURL(blob);
  const a       = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  _log.ok(`CSV downloaded: ${filename} (${rows.length} rows)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a date string, including the M/D/YYYY h:mm:ss AM/PM format D365 uses.
 */
function parseDate(str) {
  if (!str) return null;
  let d = new Date(str);
  if (!isNaN(d.getTime())) return d;
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

/** Format a Date as "M/D/YYYY h:mm:ss AM/PM" (D365 filter format). */
function fmtD365(dt) {
  const pad = n => String(n).padStart(2, '0');
  const h   = dt.getHours();
  const ap  = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()} ` +
         `${h12}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())} ${ap}`;
}

/** Format a Date as "YYYYMMDD" (IXOS URL format). */
function fmtIxos(dt) {
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}

/**
 * Split [fromDt, toDt] into `batchHours`-hour windows.
 * @returns {Array<[Date, Date]>}
 */
function generateBatches(fromDt, toDt, batchHours = 12) {
  const batches = [];
  const delta   = batchHours * 60 * 60 * 1000;
  let   cursor  = new Date(fromDt);
  while (cursor <= toDt) {
    const end = new Date(Math.min(cursor.getTime() + delta - 1000, toDt.getTime()));
    batches.push([new Date(cursor), end]);
    if (end >= toDt) break;
    cursor = new Date(cursor.getTime() + delta);
  }
  return batches;
}

/** Normalise an invoice ID: strip leading apostrophe, trim, uppercase. */
function normalizeId(val) {
  return String(val).trim().replace(/^'/, '').trim().toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  _log,
  sleep,
  waitFor,
  waitForGone,
  isVisible,
  query,
  findByText,
  findByLabel,
  simulateClick,
  click,
  fill,
  press,
  scrollGrid,
  gmFetch,
  exportCsv,
  parseDate,
  durationSeconds,
  fmtD365,
  fmtIxos,
  generateBatches,
  normalizeId,
};
