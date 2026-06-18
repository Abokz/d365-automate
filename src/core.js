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

console.log('TOOLKIT BUILD 2026-06-18-1');

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

function isProcessing() {
    const el = document.getElementById('ShellProcessingDiv');

    if (!el) return false;

    return (
        el.offsetParent !== null &&
        el.textContent?.includes('Please wait')
    );
}

async function waitForD365Idle({
    timeout = 30000,
    poll = 100
} = {}) {
    const start = Date.now();

    // Give the overlay a chance to appear.
    while (Date.now() - start < 1000) {
        if (isProcessing()) break;
        await sleep(poll);
    }

    // Wait until it's gone.
    await waitFor(
        () => !isProcessing(),
        {
            timeout,
            interval: poll,
            label: 'D365 processing overlay to disappear'
        }
    );
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

/**
 * Find clickable element in an element.
 */
function findClickable(el) {
    if (!el) return null;

    const selectors = [
        '.dyn-headerCell',
        '[data-dyn-columnname]',
        '[role="button"]',
        'button',
        'a[href]',
        '[onclick]',
        '[tabindex]'
    ];

    // If the element itself matches
    for (const selector of selectors) {
        if (el.matches?.(selector)) {
            return el;
        }
    }

    // Search descendants
    for (const selector of selectors) {
        const found = el.querySelector(selector);
        if (found) {
            return found;
        }
    }

    return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// Click / fill — Playwright-style
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a realistic mouse-event sequence on an element.
 */

function simulateClick(el) {
    if (!el) {
        throw new Error('simulateClick: element is null');
    }

    el = findClickable(el);

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const downOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons: 1
    };

    const upOpts = {
        ...downOpts,
        buttons: 0
    };

    el.dispatchEvent(new MouseEvent('mousedown', downOpts));

    if (typeof el.focus === 'function') {
        el.focus();
    }

    el.dispatchEvent(new MouseEvent('mouseup', upOpts));
    el.dispatchEvent(new MouseEvent('click', upOpts));
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
 * Default browser-realistic headers sent with every gmFetch request.
 * Mimics a real Edge 125 / Windows 11 request so intranet servers
 * (like IXOS) don't reject the call as a bot.
 *
 * The TamperMonkey loader exposes GM_xmlhttpRequest onto window as
 * window.gmXmlHttpRequest so the bundled script (which runs in the page
 * context, not the TamperMonkey sandbox) can reach it.
 */
const GM_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,' +
    'image/avif,image/webp,image/apng,*/*;q=0.8,' +
    'application/signed-exchange;v=b3;q=0.7',
  'Accept-Language':           'en-US,en;q=0.9',
  'Accept-Encoding':           'gzip, deflate, br',
  'Connection':                'keep-alive',
  'Cache-Control':             'max-age=0',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest':            'document',
  'Sec-Fetch-Mode':            'navigate',
  'Sec-Fetch-Site':            'none',
  'Sec-Fetch-User':            '?1',
};

/**
 * Fetch a URL via TamperMonkey's GM_xmlhttpRequest (bypasses CORS /
 * intranet restrictions).
 *
 * HOW THE BRIDGE WORKS
 * ────────────────────
 * GM_xmlhttpRequest lives in the TamperMonkey sandbox, not in the page's
 * JS context. The bundled toolkit runs in the page context, so it cannot
 * access GM_xmlhttpRequest directly. The TamperMonkey loader script solves
 * this by wrapping the function and attaching it to window:
 *
 *   window.gmXmlHttpRequest = (opts) => GM_xmlhttpRequest(opts);
 *
 * This function then calls window.gmXmlHttpRequest, which crosses the
 * sandbox boundary back into TamperMonkey.
 *
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.method        default 'GET'
 * @param {object} opts.extraHeaders  merged on top of GM_BROWSER_HEADERS
 * @param {string} opts.body          request body for POST
 * @param {string} opts.referer       Referer header (defaults to target origin)
 * @param {number} opts.timeout       ms (default 180 000)
 * @returns {Promise<{status:number, text:string, headers:string}>}
 */
function gmFetch(url, {
  method       = 'GET',
  extraHeaders = {},
  body         = null,
  referer      = null,
  timeout      = 180_000,
} = {}) {

  // Resolve the bridge function placed on window by the TamperMonkey loader
  const bridge = window.gmXmlHttpRequest;

  if (typeof bridge !== 'function') {
    _log.warn(
      'window.gmXmlHttpRequest not found — ' +
      'make sure the TamperMonkey loader exposes it (see README). ' +
      'Falling back to window.fetch (CORS will likely block intranet URLs).'
    );
    return window.fetch(url, { method, body })
      .then(async r => ({ status: r.status, text: await r.text(), headers: '' }));
  }

  // Build the final headers: defaults → caller overrides → Referer
  const headers = {
    ...GM_BROWSER_HEADERS,
    ...extraHeaders,
    // Derive Referer from the target URL's origin if not supplied
    Referer: referer || (() => {
      try { return new URL(url).origin + '/'; } catch { return url; }
    })(),
  };

  return new Promise((resolve, reject) => {
    bridge({
      method,
      url,
      headers,
      data:      body,
      timeout,
      onload:    r  => resolve({ status: r.status, text: r.responseText, headers: r.responseHeaders }),
      onerror:   e  => reject(new Error(`gmFetch network error for ${url}: ${JSON.stringify(e)}`)),
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
  isProcessing,
  waitForD365Idle,
  isVisible,
  query,
  findByText,
  findByLabel,
  findClickable,
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
