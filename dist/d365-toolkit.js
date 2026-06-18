(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/core.js
  var core_exports = {};
  __export(core_exports, {
    _log: () => _log,
    click: () => click,
    durationSeconds: () => durationSeconds,
    exportCsv: () => exportCsv,
    fill: () => fill,
    findByLabel: () => findByLabel,
    findByText: () => findByText,
    fmtD365: () => fmtD365,
    fmtIxos: () => fmtIxos,
    generateBatches: () => generateBatches,
    gmFetch: () => gmFetch,
    isVisible: () => isVisible,
    normalizeId: () => normalizeId,
    parseDate: () => parseDate,
    press: () => press,
    query: () => query,
    scrollGrid: () => scrollGrid,
    simulateClick: () => simulateClick,
    sleep: () => sleep,
    waitFor: () => waitFor,
    waitForGone: () => waitForGone
  });
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function waitFor(checkFn, { timeout = 15e3, interval = 200, label = "condition" } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = checkFn();
      if (result) return result;
      await sleep(interval);
    }
    throw new Error(`Timed out after ${timeout}ms waiting for: ${label}`);
  }
  async function waitForGone(checkFn, { timeout = 15e3, interval = 200, label = "element to disappear" } = {}) {
    return waitFor(() => !checkFn(), { timeout, interval, label });
  }
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }
  function query(selector, { visibleOnly = false, root = document } = {}) {
    if (!visibleOnly) return root.querySelector(selector);
    for (const el of root.querySelectorAll(selector)) {
      if (isVisible(el)) return el;
    }
    return null;
  }
  function findByText(text, { root = document, visibleOnly = true } = {}) {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
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
  function findByLabel(label, { root = document, visibleOnly = true } = {}) {
    const norm = (s) => (s || "").toLowerCase().trim();
    const target = norm(label);
    for (const el of root.querySelectorAll("[aria-label]")) {
      if (norm(el.getAttribute("aria-label")).includes(target)) {
        if (!visibleOnly || isVisible(el)) return el;
      }
    }
    return null;
  }
  function simulateClick(el) {
    if (!el) throw new Error("simulateClick: element is null");
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }
  async function click(target, { timeout = 15e3, root = document } = {}) {
    let el;
    if (typeof target === "string") {
      el = await waitFor(
        () => query(target, { visibleOnly: true, root }),
        { timeout, label: `clickable element "${target}"` }
      );
    } else {
      el = target;
    }
    simulateClick(el);
    await sleep(80);
  }
  async function fill(target, value, { timeout = 15e3, root = document } = {}) {
    let el;
    if (typeof target === "string") {
      el = await waitFor(
        () => query(target, { root }),
        { timeout, label: `input "${target}"` }
      );
    } else {
      el = target;
    }
    el.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(80);
  }
  async function press(target, key, { timeout = 15e3, root = document } = {}) {
    let el;
    if (typeof target === "string") {
      el = await waitFor(() => query(target, { root }), { timeout, label: `element for keypress "${target}"` });
    } else {
      el = target;
    }
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    await sleep(80);
  }
  function scrollGrid(gridEl, amount = 150) {
    const rect = gridEl.getBoundingClientRect();
    gridEl.dispatchEvent(new WheelEvent("wheel", {
      deltaY: amount,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }));
  }
  function gmFetch(url, {
    method = "GET",
    extraHeaders = {},
    body = null,
    referer = null,
    timeout = 18e4
  } = {}) {
    const bridge = window.gmXmlHttpRequest;
    if (typeof bridge !== "function") {
      _log.warn(
        "window.gmXmlHttpRequest not found \u2014 make sure the TamperMonkey loader exposes it (see README). Falling back to window.fetch (CORS will likely block intranet URLs)."
      );
      return window.fetch(url, { method, body }).then(async (r) => ({ status: r.status, text: await r.text(), headers: "" }));
    }
    const headers = {
      ...GM_BROWSER_HEADERS,
      ...extraHeaders,
      // Derive Referer from the target URL's origin if not supplied
      Referer: referer || (() => {
        try {
          return new URL(url).origin + "/";
        } catch {
          return url;
        }
      })()
    };
    return new Promise((resolve, reject) => {
      bridge({
        method,
        url,
        headers,
        data: body,
        timeout,
        onload: (r) => resolve({ status: r.status, text: r.responseText, headers: r.responseHeaders }),
        onerror: (e) => reject(new Error(`gmFetch network error for ${url}: ${JSON.stringify(e)}`)),
        ontimeout: () => reject(new Error(`gmFetch timed out after ${timeout}ms: ${url}`))
      });
    });
  }
  function exportCsv(rows, filename = "export.csv") {
    if (!rows.length) {
      _log.warn("exportCsv: no data to export");
      return;
    }
    const headers = Object.keys(rows[0]);
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _log.ok(`CSV downloaded: ${filename} (${rows.length} rows)`);
  }
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
    return Math.round((e - s) / 1e3);
  }
  function fmtD365(dt) {
    const pad = (n) => String(n).padStart(2, "0");
    const h = dt.getHours();
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()} ${h12}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())} ${ap}`;
  }
  function fmtIxos(dt) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
  }
  function generateBatches(fromDt, toDt, batchHours = 12) {
    const batches = [];
    const delta = batchHours * 60 * 60 * 1e3;
    let cursor = new Date(fromDt);
    while (cursor <= toDt) {
      const end = new Date(Math.min(cursor.getTime() + delta - 1e3, toDt.getTime()));
      batches.push([new Date(cursor), end]);
      if (end >= toDt) break;
      cursor = new Date(cursor.getTime() + delta);
    }
    return batches;
  }
  function normalizeId(val) {
    return String(val).trim().replace(/^'/, "").trim().toUpperCase();
  }
  var _log, GM_BROWSER_HEADERS;
  var init_core = __esm({
    "src/core.js"() {
      _log = {
        info: (...a) => console.log("%c[D365]", "color:#4fc3f7;font-weight:bold", ...a),
        warn: (...a) => console.warn("%c[D365]", "color:#ffb74d;font-weight:bold", ...a),
        error: (...a) => console.error("%c[D365]", "color:#ef5350;font-weight:bold", ...a),
        ok: (...a) => console.log("%c[D365]", "color:#81c784;font-weight:bold", ...a)
      };
      GM_BROWSER_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1"
      };
    }
  });

  // src/index.js
  init_core();

  // src/d365.js
  init_core();
  var DEFAULT_CONFIG = {
    stepDelayMs: 400,
    navigationTimeoutMs: 25e3,
    historyRowTimeoutMs: 6e3,
    goToRowMaxAttempts: 80
  };
  var d365Config = { ...DEFAULT_CONFIG };
  var LOADING_SELECTORS = [
    ".waitPanel",
    ".dyn-loadingIndicator",
    "[id*='loadingIndicator']",
    ".loading-blocker"
  ];
  async function waitReady(extraSelector = null) {
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
  function getGrid(label) {
    return document.querySelector(`[role="grid"][aria-label="${label}"]`);
  }
  function getRowCount(grid) {
    return Math.max(0, (parseInt(grid.getAttribute("aria-rowcount"), 10) || 1) - 1);
  }
  function getRowByIndex(grid, idx) {
    return grid.querySelector(`[role="row"][aria-rowindex="${idx}"]`);
  }
  function getActiveRow(grid) {
    return grid.querySelector('[role="row"][data-dyn-row-active="true"]');
  }
  function getActiveRowIndex(grid) {
    const row = getActiveRow(grid);
    return row ? parseInt(row.getAttribute("aria-rowindex"), 10) : null;
  }
  function readCell(rowEl, columnLabel) {
    const input = rowEl.querySelector(`input[aria-label="${columnLabel}"]`);
    return input ? input.value.trim() : "";
  }
  async function selectRow(grid, rowEl, expectedIdx) {
    const cell = rowEl.querySelector('[role="gridcell"]') || rowEl;
    simulateClick(cell);
    await sleep(120);
    if (getActiveRowIndex(grid) !== expectedIdx) {
      simulateClick(rowEl);
      await sleep(120);
    }
  }
  async function goToRow(gridOrLabel, idx) {
    const getG = () => typeof gridOrLabel === "string" ? getGrid(gridOrLabel) : document.contains(gridOrLabel) ? gridOrLabel : null;
    for (let attempt = 0; attempt < d365Config.goToRowMaxAttempts; attempt++) {
      const grid = getG();
      if (!grid) throw new Error("goToRow: grid is no longer in the DOM");
      const rowEl = getRowByIndex(grid, idx);
      if (rowEl) {
        await selectRow(grid, rowEl, idx);
        if (getActiveRowIndex(grid) === idx) return rowEl;
        await sleep(100);
        continue;
      }
      const rendered = Array.from(grid.querySelectorAll('[role="row"][aria-rowindex]')).map((r) => parseInt(r.getAttribute("aria-rowindex"), 10)).filter((n) => !isNaN(n));
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
  function findButton(label, idSuffix = null) {
    if (idSuffix) {
      const byId = document.querySelector(`[id$="${idSuffix}"]`);
      if (byId) {
        const clickable = byId.closest('button,[role="button"],a') || byId.querySelector('button,[role="button"],a') || byId;
        if (isVisible(clickable)) return clickable;
      }
    }
    return findByLabel(label) || findByText(label);
  }
  async function switchEntity(entityCode) {
    const currentBtn = document.querySelector("#CompanyButton_button");
    if (!currentBtn) throw new Error("switchEntity: company button not found");
    const currentCode = currentBtn.textContent.trim();
    if (currentCode === entityCode) {
      _log.info(`Already on entity ${entityCode} \u2014 skipping switch`);
      return;
    }
    _log.info(`Switching entity: ${currentCode} \u2192 ${entityCode}`);
    simulateClick(currentBtn);
    const searchInput = await waitFor(
      () => {
        return query('input[aria-label*="company" i]', { visibleOnly: true }) || query('input[aria-label*="entity" i]', { visibleOnly: true }) || query('input[placeholder*="Search" i]', { visibleOnly: true }) || query(".navigationBar-searchInput input", { visibleOnly: true }) || query('[data-dyn-controlname*="Company"] input', { visibleOnly: true });
      },
      { timeout: 1e4, label: "company picker search input" }
    );
    console.log("---BEFORE----");
    console.log("1. ", searchInput.isConnected);
    console.log("2. ", searchInput.value);
    console.log("3. ", document.activeElement === searchInput);
    await fill(searchInput, entityCode);
    await sleep(600);
    console.log("---After----");
    console.log("1. ", searchInput.isConnected);
    console.log("2. ", searchInput.value);
    console.log("3. ", document.activeElement === searchInput);
    const listItem = await waitFor(
      () => {
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
      { timeout: 8e3, label: `company list item for "${entityCode}"` }
    );
    simulateClick(listItem);
    await waitReady();
    const newCode = document.querySelector("#CompanyButton_button")?.textContent.trim();
    if (newCode !== entityCode) {
      _log.warn(`switchEntity: button shows "${newCode}" instead of "${entityCode}" \u2014 continuing anyway`);
    } else {
      _log.ok(`Switched to entity ${entityCode}`);
    }
  }
  async function navigate(module, entity = null) {
    if (entity) await switchEntity(entity);
    const base = `${location.origin}/`;
    const cmp = document.querySelector("#CompanyButton_button")?.textContent.trim() || "";
    location.href = `${base}?cmp=${cmp}&mi=${module}`;
  }
  function createBlobInterceptor() {
    const captured = [];
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(...args) {
      this._d365url = args[1] || "";
      return origOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      if (this._d365url && this._d365url.includes("ReliableCommunicationManager")) {
        this.addEventListener("load", () => {
          try {
            const data = JSON.parse(this.responseText);
            for (const msg of data.Messages || []) {
              for (const interaction of msg.Interactions || []) {
                if (interaction.$type === "NavigationInteraction") {
                  const url = interaction.NamedParameters?.url || "";
                  if (url.includes("blob.core.windows.net") && url.includes(".xlsx")) {
                    captured.push(url);
                  }
                }
              }
            }
          } catch (_) {
          }
        });
      }
      return origSend.apply(this, args);
    };
    const promise = new Promise((resolve, reject) => {
      const check = setInterval(() => {
        if (captured.length) {
          clearInterval(check);
          resolve(captured[captured.length - 1]);
        }
      }, 300);
      setTimeout(() => {
        clearInterval(check);
        reject(new Error("Blob URL not captured within timeout"));
      }, 10 * 60 * 1e3);
    });
    function stop() {
      XMLHttpRequest.prototype.open = origOpen;
      XMLHttpRequest.prototype.send = origSend;
    }
    return { promise, stop };
  }
  function downloadBlob(url) {
    const bridge = window.gmXmlHttpRequest;
    if (typeof bridge === "function") {
      return new Promise((resolve, reject) => {
        bridge({
          method: "GET",
          url,
          responseType: "arraybuffer",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0"
          },
          timeout: 12e4,
          onload: (r) => resolve(r.response),
          onerror: (e) => reject(new Error(`downloadBlob failed: ${JSON.stringify(e)}`)),
          ontimeout: () => reject(new Error("downloadBlob timed out"))
        });
      });
    }
    _log.warn("downloadBlob: window.gmXmlHttpRequest not found \u2014 falling back to window.fetch (may fail on CORS)");
    return fetch(url).then((r) => r.arrayBuffer());
  }
  var _xlsxReady = null;
  async function loadSheetJS() {
    if (typeof XLSX !== "undefined") return;
    if (_xlsxReady) return _xlsxReady;
    _xlsxReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load SheetJS from CDN"));
      document.head.appendChild(s);
    });
    await _xlsxReady;
    _log.ok("SheetJS loaded");
  }
  async function parseXlsx(buffer, sheetName = null) {
    await loadSheetJS();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[sheetName || workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }

  // src/workflows.js
  init_core();
  var BatchJobMonitor = /* @__PURE__ */ (() => {
    const CONFIG = {
      shortDurationThresholdSec: 10,
      // flag jobs that ran < this many seconds
      retriesPerJob: 1,
      maxJobs: null
      // null = all; set a number to limit test runs
    };
    let _lastReport = [];
    function readMainRow(rowEl) {
      return {
        jobId: readCell(rowEl, "Job ID"),
        status: readCell(rowEl, "Status"),
        description: readCell(rowEl, "Job description")
      };
    }
    function readHistoryRow(rowEl) {
      return {
        status: readCell(rowEl, "Status"),
        start: readCell(rowEl, "Actual start date/time"),
        end: readCell(rowEl, "End date/time")
      };
    }
    async function openHistoryAndReadFirstRow() {
      const btn = findButton("Batch job history", "_BatchJobHistory");
      if (!btn) throw new Error('Could not find the "Batch job history" button');
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      let data = { status: "NO_HISTORY", start: "", end: "" };
      let readError = null;
      try {
        await waitFor(
          () => getGrid("Batch jobs history"),
          { timeout: d365Config.navigationTimeoutMs, label: "history grid" }
        );
        let firstRow = null;
        try {
          firstRow = await waitFor(
            () => {
              const g = getGrid("Batch jobs history");
              return g ? getRowByIndex(g, 2) : null;
            },
            { timeout: d365Config.historyRowTimeoutMs, label: "first history row" }
          );
        } catch (_) {
          firstRow = null;
        }
        if (firstRow) data = readHistoryRow(firstRow);
      } catch (err) {
        readError = err;
      } finally {
        const backBtn = document.querySelector('button[aria-label="Back" i],[role="button"][aria-label="Back" i]') || document.querySelector('button[aria-label="Close" i],[role="button"][aria-label="Close" i]');
        if (backBtn) {
          backBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        } else {
          history.back();
        }
        try {
          await waitFor(
            () => getGrid("Batch job"),
            { timeout: d365Config.navigationTimeoutMs, label: "main grid to reappear" }
          );
          await sleep(d365Config.stepDelayMs);
        } catch (backErr) {
          throw new Error(
            `Could not return to main grid${readError ? " (after: " + readError.message + ")" : ""}: ${backErr.message}`
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
    function evaluateJob(hist) {
      if (hist.status === "NO_HISTORY") {
        return { flag: "ATTENTION", note: "No execution history found", durationSec: null };
      }
      if (hist.status !== "Ended") {
        return { flag: "ATTENTION", note: `Last run status is "${hist.status}", not Ended`, durationSec: null };
      }
      const dur = durationSeconds(hist.start, hist.end);
      if (dur === null) {
        return { flag: "ATTENTION", note: "Could not parse start/end time", durationSec: null };
      }
      if (dur < CONFIG.shortDurationThresholdSec) {
        return { flag: "ATTENTION", note: `Ended after only ${dur}s \u2014 possible failure`, durationSec: dur };
      }
      return { flag: "OK", note: `Ran for ${dur}s`, durationSec: dur };
    }
    function selfTest() {
      const grid = getGrid("Batch job");
      const histBtn = findButton("Batch job history", "_BatchJobHistory");
      const backBtn = document.querySelector('button[aria-label="Back" i]');
      _log.info("Self-test results:");
      _log.info("  Main grid found:", !!grid);
      _log.info("  Active row found:", !!(grid && getActiveRow(grid)));
      _log.info('  "Batch job history" btn:', !!histBtn, histBtn);
      _log.info('  "Back" button found:', !!backBtn, backBtn);
      if (!grid) _log.warn("  \u2192 Navigate to the Batch Job list page first.");
      if (!histBtn) _log.warn('  \u2192 Update findButton() for "Batch job history".');
      if (!backBtn) _log.warn("  \u2192 Back button not found \u2014 will fall back to history.back().");
    }
    async function testOne() {
      const grid = getGrid("Batch job");
      if (!grid) throw new Error("Main grid not found");
      const active = getActiveRow(grid);
      if (!active) throw new Error("No active row");
      const job = readMainRow(active);
      _log.info("Testing job:", job);
      const hist = await openHistoryAndReadFirstRow();
      _log.info("History first row:", hist);
      _log.info("Evaluation:", evaluateJob(hist));
    }
    async function run() {
      let grid = getGrid("Batch job");
      if (!grid) throw new Error("Main grid not found \u2014 navigate to the Batch Job list page first.");
      const total = getRowCount(grid);
      const limit = CONFIG.maxJobs ? Math.min(CONFIG.maxJobs, total) : total;
      _log.info(`Found ${total} job(s). Processing ${limit}.`);
      const report = [];
      let idx = 2;
      for (let i = 0; i < limit; i++) {
        grid = getGrid("Batch job");
        if (!grid) {
          _log.error(`Stopped at job ${i + 1}: grid gone.`);
          break;
        }
        let rowEl;
        try {
          rowEl = await goToRow(grid, idx);
        } catch (err) {
          _log.error(`Stopped at job ${i + 1}: ${err.message}`);
          break;
        }
        const job = readMainRow(rowEl);
        const label = `[${i + 1}/${limit}] ${job.jobId} \u2014 ${job.description}`;
        _log.info(label);
        const entry = { ...job, historyStatus: "", start: "", end: "", durationSec: null, flag: "ERROR", note: "" };
        try {
          const hist = await openHistoryWithRetry(CONFIG.retriesPerJob);
          const evalResult = evaluateJob(hist);
          Object.assign(entry, {
            historyStatus: hist.status,
            start: hist.start,
            end: hist.end,
            durationSec: evalResult.durationSec,
            flag: evalResult.flag,
            note: evalResult.note
          });
        } catch (err) {
          entry.note = `Failed to read history: ${err.message}`;
          _log.error(`  ${job.jobId}: ${entry.note}`);
        }
        report.push(entry);
        idx++;
        await sleep(d365Config.stepDelayMs);
      }
      _lastReport = report;
      _printReport(report);
      return report;
    }
    function _printReport(report) {
      _log.info("\n========== BATCH JOB MONITOR REPORT ==========");
      console.table(report.map((r) => ({
        "Job ID": r.jobId,
        "Description": r.description,
        "Last Status": r.historyStatus,
        "Start": r.start,
        "End": r.end,
        "Duration (s)": r.durationSec,
        "Flag": r.flag,
        "Note": r.note
      })));
      const attention = report.filter((r) => r.flag !== "OK");
      if (attention.length) {
        _log.warn(`${attention.length} of ${report.length} job(s) need attention:`);
        attention.forEach((r) => _log.warn(`  \u2022 ${r.jobId} (${r.description}): ${r.note}`));
      } else {
        _log.ok(`All ${report.length} job(s) look healthy.`);
      }
    }
    function doExportCsv(filename = "batch-job-report.csv") {
      if (!_lastReport.length) {
        _log.warn("No report yet \u2014 run BatchJobMonitor.run() first.");
        return;
      }
      exportCsv(_lastReport.map((r) => ({
        "Job ID": r.jobId,
        "Description": r.description,
        "Last Status": r.historyStatus,
        "Start": r.start,
        "End": r.end,
        "Duration (s)": String(r.durationSec ?? ""),
        "Flag": r.flag,
        "Note": r.note
      })), filename);
    }
    return {
      CONFIG,
      selfTest,
      testOne,
      run,
      exportCsv: doExportCsv,
      getReport: () => _lastReport
    };
  })();
  var InvoiceCrossCheck = /* @__PURE__ */ (() => {
    const CONFIG = {
      ixosBase: "http://pstam-web.akzonobel.intra/GATS/ArchivedInvoices/",
      ixosMaxRows: 3e4,
      batchHours: 12,
      // Invoice types to query in IXOS
      ixosTypes: [
        { desc: "sales+invoice", label: "SI" },
        { desc: "free+text+invoice", label: "FTI" }
      ]
    };
    let _ixosIds = /* @__PURE__ */ new Set();
    let _results = [];
    function parseIxosHtml(html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const rows = doc.querySelectorAll("table tr");
      const invoices = [];
      let headerDone = false;
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("th, td"));
        if (!headerDone) {
          if (cells.some((c) => c.tagName === "TH")) {
            headerDone = true;
          }
          continue;
        }
        if (cells.length >= 7) {
          const invId = cells[1]?.textContent.trim().replace(/^'/, "") || "";
          const legalEnt = cells[6]?.textContent.trim() || "";
          if (invId && legalEnt) invoices.push({ invId, legalEnt });
        }
      }
      return invoices;
    }
    function buildIxosUrl(desc, fromDt, toDt) {
      return CONFIG.ixosBase + `?axObjectID=&axObjectID_case_insensitive=true&Description=${desc}&Description_case_insensitive=true&DocumentDate_from=${fmtIxos(fromDt)}&DocumentDate_until=${fmtIxos(toDt)}&LinkDate_from=&LinkDate_until=&axDestination=*ALL*&axObjectType=*ALL*&axObjectType2=*NONE*&ixArchiveID=*ALL*&Sort=axObjectID&MaxRows=${CONFIG.ixosMaxRows}&invoiceForm=Submit`;
    }
    async function fetchIxosInvoices(fromDt, toDt) {
      const allIds = /* @__PURE__ */ new Set();
      for (const { desc, label } of CONFIG.ixosTypes) {
        _log.info(`[IXOS/${label}] Querying...`);
        try {
          const url = buildIxosUrl(desc, fromDt, toDt);
          const resp = await gmFetch(url, { timeout: 18e4 });
          if (resp.status !== 200) {
            _log.warn(`[IXOS/${label}] HTTP ${resp.status} \u2014 skipping`);
            continue;
          }
          const rows = parseIxosHtml(resp.text);
          rows.forEach((r) => allIds.add(normalizeId(r.invId)));
          _log.ok(`[IXOS/${label}] ${rows.length} invoices`);
        } catch (err) {
          _log.warn(`[IXOS/${label}] Error: ${err.message}`);
        }
      }
      _log.ok(`[IXOS] Total (SI+FTI): ${allIds.size}`);
      return allIds;
    }
    async function downloadBatch(fromDt, toDt, batchLabel) {
      _log.info(`  Batch ${batchLabel}: ${fmtD365(fromDt)} \u2192 ${fmtD365(toDt)}`);
      const interceptor = createBlobInterceptor();
      try {
        await waitReady('[role="grid"]');
        const grid = document.querySelector('[role="grid"]');
        if (!grid) throw new Error("Invoice journal grid not found");
        const dateHeader = findButton("Created date and time") || Array.from(document.querySelectorAll('[role="columnheader"]')).find((h) => h.textContent.includes("Created date"));
        if (dateHeader) {
          dateHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await sleep(400);
        }
        const fromInput = document.querySelector('input[name$="_createdDateTime_Input_0"]') || document.querySelector('input[aria-label*="From" i][aria-label*="date" i]');
        const toInput = document.querySelector('input[name$="_createdDateTime_Input_1"]') || document.querySelector('input[aria-label*="To" i][aria-label*="date" i]');
        if (fromInput) await (await Promise.resolve().then(() => (init_core(), core_exports))).fill(fromInput, fmtD365(fromDt));
        if (toInput) await (await Promise.resolve().then(() => (init_core(), core_exports))).fill(toInput, fmtD365(toDt));
        const applyBtn = findButton("Apply") || findButton("OK");
        if (applyBtn) {
          applyBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await waitReady('[role="grid"]');
        }
        const selectAll = document.querySelector('[role="checkbox"][aria-label*="Select or unselect all" i]') || document.querySelector('[role="checkbox"][aria-label*="all rows" i]');
        if (selectAll) {
          selectAll.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await sleep(300);
        }
        const officeBtn = findButton("Open in Microsoft Office");
        if (!officeBtn) throw new Error('"Open in Microsoft Office" button not found');
        officeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await sleep(600);
        const exportItem = findButton("Export to Excel Customer") || Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent.includes("Export to Excel"));
        if (!exportItem) throw new Error('"Export to Excel" menu item not found');
        exportItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await sleep(400);
        const downloadBtn = findButton("Download") || Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Download");
        if (downloadBtn) {
          downloadBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
        _log.info("  \u23F3 Waiting for D365 to generate XLSX...");
        const blobUrl = await interceptor.promise;
        _log.ok(`  Blob URL captured`);
        const buffer = await downloadBlob(blobUrl);
        const rows = await parseXlsx(buffer);
        if (!rows.length || !("Invoice" in rows[0])) {
          _log.warn(`  "Invoice" column not found. Available: ${Object.keys(rows[0] || {}).join(", ")}`);
          return /* @__PURE__ */ new Set();
        }
        const ids = new Set(
          rows.map((r) => r["Invoice"]).filter((v) => v && String(v).trim() !== "").map(normalizeId)
        );
        _log.ok(`  ${ids.size} invoice IDs in this batch`);
        return ids;
      } finally {
        interceptor.stop();
      }
    }
    async function fetchD365Invoices(entity, fromDt, toDt) {
      const batches = generateBatches(fromDt, toDt, CONFIG.batchHours);
      _log.info(`[${entity}] ${batches.length} batch(es) to process`);
      const allIds = /* @__PURE__ */ new Set();
      for (let i = 0; i < batches.length; i++) {
        const [bFrom, bTo] = batches[i];
        const label = `${i + 1}/${batches.length}`;
        try {
          const ids = await downloadBatch(bFrom, bTo, label);
          ids.forEach((id) => allIds.add(id));
        } catch (err) {
          _log.warn(`[${entity}] Batch ${label} failed: ${err.message}`);
        }
      }
      _log.ok(`[${entity}] ${allIds.size} unique invoice IDs after all batches`);
      return allIds;
    }
    async function run({ fromDt, toDt, entities }) {
      if (!fromDt || !toDt || !entities?.length) {
        throw new Error("run() requires { fromDt, toDt, entities }");
      }
      _results = [];
      _log.info("\u2550".repeat(50));
      _log.info("  D365 \u2194 IXOS Invoice Cross-Check");
      _log.info("\u2550".repeat(50));
      _log.info(`Date range : ${fmtD365(fromDt)} \u2192 ${fmtD365(toDt)}`);
      _log.info(`Entities   : ${entities.join(", ")}`);
      _log.info("\n\u2500\u2500 IXOS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
      _ixosIds = await fetchIxosInvoices(fromDt, toDt);
      for (const entity of entities) {
        _log.info(`
\u2500\u2500 Entity: ${entity} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
        await switchEntity(entity);
        await waitReady();
        const d365Ids = await fetchD365Invoices(entity, fromDt, toDt);
        if (!d365Ids.size) {
          _log.warn(`[${entity}] No D365 invoices found \u2014 skipping.`);
          _results.push({ entity, d365Count: 0, ixosCount: _ixosIds.size, missingCount: 0, missing: [] });
          continue;
        }
        const missing = [...d365Ids].filter((id) => !_ixosIds.has(id));
        _log.info(`[${entity}] D365=${d365Ids.size} | IXOS=${_ixosIds.size} | Missing=${missing.length}`);
        _results.push({
          entity,
          d365Count: d365Ids.size,
          ixosCount: _ixosIds.size,
          missingCount: missing.length,
          missing
        });
        if (missing.length) {
          _log.warn(`[${entity}] \u274C ${missing.length} invoice(s) missing from IXOS`);
        } else {
          _log.ok(`[${entity}] \u2705 All D365 invoices present in IXOS`);
        }
      }
      _printSummary();
      return _results;
    }
    function _printSummary() {
      _log.info("\n========== INVOICE CROSS-CHECK SUMMARY ==========");
      console.table(_results.map((r) => ({
        Entity: r.entity,
        D365: r.d365Count,
        IXOS: r.ixosCount,
        Missing: r.missingCount
      })));
    }
    function doExportCsv(filename = "invoice-missing.csv") {
      const rows = _results.flatMap(
        (r) => r.missing.map((id) => ({ Entity: r.entity, "Invoice ID": id }))
      );
      if (!rows.length) {
        _log.warn("No missing invoices to export.");
        return;
      }
      exportCsv(rows, filename);
    }
    function doExportSummaryCsv(filename = "invoice-summary.csv") {
      if (!_results.length) {
        _log.warn("No results yet.");
        return;
      }
      exportCsv(_results.map((r) => ({
        Entity: r.entity,
        "D365 count": String(r.d365Count),
        "IXOS count": String(r.ixosCount),
        "Missing": String(r.missingCount)
      })), filename);
    }
    return {
      CONFIG,
      run,
      exportCsv: doExportCsv,
      exportSummaryCsv: doExportSummaryCsv,
      getResults: () => _results,
      getIxosIds: () => _ixosIds
    };
  })();
  var workflows = { BatchJobMonitor, InvoiceCrossCheck };

  // src/ui.js
  init_core();
  var CSS = `
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
  color: #cdd6f4;
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
  color: #cdd6f4;
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
  color: #cdd6f4;
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
  var _panel = null;
  var _logEl = null;
  var _statusEl = null;
  var _progressEl = null;
  var _resultsEl = null;
  var _running = false;
  function panelLog(msg, level = "info") {
    if (!_logEl) return;
    const line = document.createElement("div");
    line.className = `tk-log-${level}`;
    line.textContent = `\u203A ${msg}`;
    _logEl.appendChild(line);
    _logEl.scrollTop = _logEl.scrollHeight;
  }
  function clearLog() {
    if (_logEl) _logEl.innerHTML = "";
  }
  function _patchLogger() {
    const orig = { ..._log };
    _log.info = (...a) => {
      orig.info(...a);
      panelLog(a.join(" "), "info");
    };
    _log.ok = (...a) => {
      orig.ok(...a);
      panelLog(a.join(" "), "ok");
    };
    _log.warn = (...a) => {
      orig.warn(...a);
      panelLog(a.join(" "), "warn");
    };
    _log.error = (...a) => {
      orig.error(...a);
      panelLog(a.join(" "), "error");
    };
  }
  function setStatus(label, cls = "idle") {
    if (!_statusEl) return;
    _statusEl.textContent = label;
    _statusEl.className = `tk-status tk-status-${cls}`;
  }
  function setProgress(pct) {
    if (!_progressEl) return;
    _progressEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }
  function renderBatchJobReport(report) {
    if (!_resultsEl) return;
    const attention = report.filter((r) => r.flag !== "OK");
    const summary = `${report.length} jobs \xB7 ${attention.length} need attention`;
    const cols = ["Job ID", "Description", "Last Status", "Duration (s)", "Flag", "Note"];
    const rows = report.map((r) => [
      r.jobId,
      r.description.length > 22 ? r.description.slice(0, 22) + "\u2026" : r.description,
      r.historyStatus,
      r.durationSec ?? "\u2014",
      r.flag,
      r.note.length > 30 ? r.note.slice(0, 30) + "\u2026" : r.note
    ]);
    _resultsEl.innerHTML = _buildTable(cols, rows, (r) => r[4] === "OK" ? "" : "tk-flag-attention", 4);
    _resultsEl.insertAdjacentHTML("afterbegin", `<div style="margin-bottom:6px;color:#a6adc8;font-size:11px;">${summary}</div>`);
  }
  function renderCrossCheckResults(results) {
    if (!_resultsEl) return;
    const totalMissing = results.reduce((s, r) => s + r.missingCount, 0);
    const summary = `${results.length} entities \xB7 ${totalMissing} missing invoice(s)`;
    const cols = ["Entity", "D365", "IXOS", "Missing"];
    const rows = results.map((r) => [r.entity, r.d365Count, r.ixosCount, r.missingCount]);
    _resultsEl.innerHTML = _buildTable(cols, rows, (r) => r[3] > 0 ? "tk-flag-attention" : "tk-flag-ok", 3);
    _resultsEl.insertAdjacentHTML("afterbegin", `<div style="margin-bottom:6px;color:#a6adc8;font-size:11px;">${summary}</div>`);
  }
  function _buildTable(cols, rows, classForRow = () => "", flagColIdx = -1) {
    const ths = cols.map((c) => `<th>${c}</th>`).join("");
    const tbrs = rows.map((r) => {
      const tds = r.map((cell, i) => {
        let cls = "";
        if (i === flagColIdx) {
          cls = cell === "OK" ? "tk-flag-ok" : cell === "ATTENTION" ? "tk-flag-attention" : "tk-flag-error";
        }
        return `<td class="${cls}">${cell}</td>`;
      }).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    return `<div class="tk-table-wrap"><table class="tk-table"><thead><tr>${ths}</tr></thead><tbody>${tbrs}</tbody></table></div>`;
  }
  async function _runBatchJobMonitor() {
    if (_running) return;
    _running = true;
    clearLog();
    setStatus("Running\u2026", "running");
    setProgress(0);
    if (_resultsEl) _resultsEl.innerHTML = "";
    try {
      const report = await BatchJobMonitor.run();
      setStatus("Done", "done");
      setProgress(100);
      renderBatchJobReport(report);
    } catch (err) {
      _log.error(err.message);
      setStatus("Error", "error");
    } finally {
      _running = false;
      _refreshButtons();
    }
  }
  async function _runInvoiceCrossCheck(fromDt, toDt, entities) {
    if (_running) return;
    _running = true;
    clearLog();
    setStatus("Running\u2026", "running");
    setProgress(0);
    if (_resultsEl) _resultsEl.innerHTML = "";
    try {
      const results = await InvoiceCrossCheck.run({ fromDt, toDt, entities });
      setStatus("Done", "done");
      setProgress(100);
      renderCrossCheckResults(results);
    } catch (err) {
      _log.error(err.message);
      setStatus("Error", "error");
    } finally {
      _running = false;
      _refreshButtons();
    }
  }
  function _refreshButtons() {
    if (!_panel) return;
    _panel.querySelectorAll(".tk-run-btn").forEach((btn) => {
      btn.disabled = _running;
    });
  }
  function _buildPanel() {
    if (!document.querySelector("#d365tk-style")) {
      const style = document.createElement("style");
      style.id = "d365tk-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const panel = document.createElement("div");
    panel.id = "d365tk-panel";
    panel.innerHTML = `
    <div id="d365tk-header">
      <span>\u2699 D365 Toolkit</span>
      <span id="d365tk-toggle">\u25C0</span>
    </div>

    <div id="d365tk-body">

      <!-- Status row -->
      <div class="tk-section" style="display:flex;align-items:center;gap:8px;padding:7px 10px;">
        <span id="d365tk-status" class="tk-status tk-status-idle">Idle</span>
        <div class="tk-progress-wrap" style="flex:1">
          <div id="d365tk-progress" class="tk-progress-bar" style="width:0%"></div>
        </div>
      </div>

      <!-- \u2500\u2500 Batch Job Monitor \u2500\u2500 -->
      <div class="tk-section">
        <div class="tk-section-title">\u{1F4CB} Batch Job Monitor</div>

        <button class="tk-btn tk-btn-neutral" id="bjm-selftest">Run self-test</button>
        <button class="tk-btn tk-btn-warning tk-run-btn" id="bjm-testone">Test current row</button>
        <button class="tk-btn tk-btn-primary tk-run-btn" id="bjm-run">\u25B6 Run all jobs</button>
        <button class="tk-btn tk-btn-success" id="bjm-export" style="margin-top:4px;">\u2B07 Export CSV</button>

        <div style="margin-top:6px;">
          <label class="tk-label">Short-run threshold (seconds)</label>
          <input class="tk-input" id="bjm-threshold" type="number" value="${BatchJobMonitor.CONFIG.shortDurationThresholdSec}" min="1" />
        </div>
        <div>
          <label class="tk-label">Max jobs (blank = all)</label>
          <input class="tk-input" id="bjm-maxjobs" type="number" placeholder="all" />
        </div>
      </div>

      <!-- \u2500\u2500 Invoice Cross-Check \u2500\u2500 -->
      <div class="tk-section">
        <div class="tk-section-title">\u{1F9FE} Invoice Cross-Check</div>

        <label class="tk-label">From date (MM/DD/YYYY)</label>
        <input class="tk-input" id="icc-from" type="text" placeholder="01/01/2024" />

        <label class="tk-label">To date (MM/DD/YYYY)</label>
        <input class="tk-input" id="icc-to" type="text" placeholder="01/31/2024" />

        <label class="tk-label">Entities (space or comma separated)</label>
        <input class="tk-input" id="icc-entities" type="text" placeholder="4111 0051" />

        <label class="tk-label">Batch window (hours)</label>
        <input class="tk-input" id="icc-batchhours" type="number" value="${InvoiceCrossCheck.CONFIG.batchHours}" min="1" max="24" />

        <button class="tk-btn tk-btn-primary tk-run-btn" id="icc-run" style="margin-top:4px;">\u25B6 Run cross-check</button>
        <button class="tk-btn tk-btn-success" id="icc-export">\u2B07 Export missing CSV</button>
        <button class="tk-btn tk-btn-ghost"   id="icc-export-summary">\u2B07 Export summary CSV</button>
      </div>

      <!-- \u2500\u2500 Live log \u2500\u2500 -->
      <div class="tk-section">
        <div class="tk-section-title" style="display:flex;justify-content:space-between;">
          <span>\u{1F4DF} Log</span>
          <span id="d365tk-clearlog" style="cursor:pointer;color:#a6adc8;font-size:10px;font-weight:400;">clear</span>
        </div>
        <div id="d365tk-log"></div>
      </div>

      <!-- \u2500\u2500 Results \u2500\u2500 -->
      <div class="tk-section" id="d365tk-results-section">
        <div class="tk-section-title">\u{1F4CA} Results</div>
        <div id="d365tk-results"></div>
      </div>

    </div><!-- /body -->
  `;
    document.body.appendChild(panel);
    return panel;
  }
  function _wireEvents(panel) {
    const header = panel.querySelector("#d365tk-header");
    const toggleEl = panel.querySelector("#d365tk-toggle");
    header.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      toggleEl.textContent = collapsed ? "\u25B6" : "\u25C0";
    });
    panel.querySelector("#d365tk-clearlog").addEventListener("click", clearLog);
    panel.querySelector("#bjm-selftest").addEventListener("click", () => {
      BatchJobMonitor.selfTest();
    });
    panel.querySelector("#bjm-testone").addEventListener("click", async () => {
      if (_running) return;
      _running = true;
      _refreshButtons();
      clearLog();
      setStatus("Running\u2026", "running");
      try {
        await BatchJobMonitor.testOne();
        setStatus("Done", "done");
      } catch (err) {
        _log.error(err.message);
        setStatus("Error", "error");
      } finally {
        _running = false;
        _refreshButtons();
      }
    });
    panel.querySelector("#bjm-run").addEventListener("click", () => {
      const threshold = parseInt(panel.querySelector("#bjm-threshold").value, 10);
      const maxJobs = parseInt(panel.querySelector("#bjm-maxjobs").value, 10);
      if (!isNaN(threshold)) BatchJobMonitor.CONFIG.shortDurationThresholdSec = threshold;
      BatchJobMonitor.CONFIG.maxJobs = isNaN(maxJobs) ? null : maxJobs;
      _runBatchJobMonitor();
    });
    panel.querySelector("#bjm-export").addEventListener("click", () => {
      BatchJobMonitor.exportCsv();
    });
    panel.querySelector("#icc-run").addEventListener("click", () => {
      const fromStr = panel.querySelector("#icc-from").value.trim();
      const toStr = panel.querySelector("#icc-to").value.trim();
      const entStr = panel.querySelector("#icc-entities").value.trim();
      const batchHrs = parseInt(panel.querySelector("#icc-batchhours").value, 10);
      if (!fromStr || !toStr || !entStr) {
        panelLog("Please fill in From date, To date, and Entities.", "warn");
        return;
      }
      const fromDt = new Date(fromStr);
      let toDt = new Date(toStr);
      toDt.setHours(23, 59, 59, 0);
      if (isNaN(fromDt) || isNaN(toDt)) {
        panelLog("Invalid date \u2014 use MM/DD/YYYY format.", "error");
        return;
      }
      const entities = entStr.replace(/,/g, " ").split(/\s+/).filter(Boolean);
      if (!isNaN(batchHrs) && batchHrs > 0) {
        InvoiceCrossCheck.CONFIG.batchHours = batchHrs;
      }
      _runInvoiceCrossCheck(fromDt, toDt, entities);
    });
    panel.querySelector("#icc-export").addEventListener("click", () => {
      InvoiceCrossCheck.exportCsv();
    });
    panel.querySelector("#icc-export-summary").addEventListener("click", () => {
      InvoiceCrossCheck.exportSummaryCsv();
    });
  }
  function initUI() {
    if (_panel) {
      _log.warn("UI already initialised \u2014 remove the existing panel first if you want to re-init.");
      return;
    }
    _panel = _buildPanel();
    _logEl = _panel.querySelector("#d365tk-log");
    _statusEl = _panel.querySelector("#d365tk-status");
    _progressEl = _panel.querySelector("#d365tk-progress");
    _resultsEl = _panel.querySelector("#d365tk-results");
    _wireEvents(_panel);
    _patchLogger();
    _log.ok("D365 Toolkit UI ready");
  }
  function destroyUI() {
    if (_panel) {
      _panel.remove();
      _panel = _logEl = _statusEl = _progressEl = _resultsEl = null;
    }
    const style = document.querySelector("#d365tk-style");
    if (style) style.remove();
  }

  // src/index.js
  var D365Toolkit = {
    // ── config (callers can mutate these) ────────────────────────────────────
    d365Config,
    // ── core primitives ───────────────────────────────────────────────────────
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
    // ── date helpers ──────────────────────────────────────────────────────────
    parseDate,
    durationSeconds,
    fmtD365,
    fmtIxos,
    generateBatches,
    normalizeId,
    // ── D365 helpers ──────────────────────────────────────────────────────────
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
    // ── workflows ─────────────────────────────────────────────────────────────
    workflows,
    BatchJobMonitor,
    InvoiceCrossCheck,
    // ── UI ────────────────────────────────────────────────────────────────────
    ui: { init: initUI, destroy: destroyUI, log: panelLog, setStatus, setProgress },
    // ── lifecycle ─────────────────────────────────────────────────────────────
    /**
     * Called automatically by TamperMonkey after the script loads.
     * Injects the floating panel into the page.
     */
    init() {
      _log.ok("D365 Toolkit initialising\u2026");
      initUI();
    },
    /**
     * Remove the UI panel and clean up.
     * Useful during development when hot-reloading.
     */
    destroy() {
      destroyUI();
      _log.ok("D365 Toolkit destroyed.");
    }
  };
  window.D365Toolkit = D365Toolkit;
  var index_default = D365Toolkit;
})();
