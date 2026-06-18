# D365 Toolkit

Browser-side automation library for **Dynamics 365 Finance & Operations**, loaded via TamperMonkey and bundled with esbuild. No page reloads required — everything runs in-page.

---

## Architecture

```
d365-toolkit/
├── src/
│   ├── core.js        Playwright-like primitives (click, fill, waitFor…)
│   ├── d365.js        D365-specific helpers (grid, entity switch, blob export…)
│   ├── workflows.js   BatchJobMonitor + InvoiceCrossCheck
│   ├── ui.js          Floating side-panel
│   └── index.js       esbuild entry point → window.D365Toolkit
├── dist/
│   └── d365-toolkit.js   compiled output (commit this)
├── build.js
└── package.json
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Build
```bash
npm run build          # one-shot build → dist/d365-toolkit.js
npm run watch          # watch mode (dev)
node build.js --minify # minified → dist/d365-toolkit.min.js
```

### 3. Push to GitHub
Commit `dist/d365-toolkit.js`. The TamperMonkey script fetches it from:
```
https://raw.githubusercontent.com/<your-org>/d365-toolkit/master/dist/d365-toolkit.js
```

### 4. TamperMonkey script
```js
// ==UserScript==
// @name         D365 Toolkit Loader
// @match        *://*.cloudax.dynamics.com/*
// @match        *://*.operations.eu.dynamics.com/*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      pstam-web.akzonobel.intra        ← IXOS intranet host
// @connect      *.blob.core.windows.net           ← Azure blob downloads
// ==/UserScript==
(function () {
  'use strict';
  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://raw.githubusercontent.com/<org>/d365-toolkit/master/dist/d365-toolkit.js?t=' + Date.now(),
    onload(response) {
      const script = document.createElement('script');
      script.textContent = response.responseText;
      document.head.appendChild(script);
      if (window.D365Toolkit?.init) window.D365Toolkit.init();
    },
    onerror(err) { console.error('Toolkit load failed', err); },
  });
})();
```

> **Important:** add `@connect` entries for the IXOS host and `*.blob.core.windows.net`
> so TamperMonkey allows GM_xmlhttpRequest to those domains.

---

## Floating UI Panel

Once loaded, a collapsible panel appears on the right side of the page.

- **Batch Job Monitor** section — configure threshold / max jobs, run, export CSV
- **Invoice Cross-Check** section — enter dates + entities, run, export missing/summary CSVs
- **Live log** — all `_log.*` calls stream here in real time
- **Results table** — rendered inline after each run

---

## Workflow: Batch Job Monitor

Walks the "Batch job" list, opens history for each job, reads the most recent run, and flags anything that didn't end cleanly or ran suspiciously fast.

### Console usage
```js
// 1. Self-test (verify selectors before running)
D365Toolkit.BatchJobMonitor.selfTest()

// 2. Test one row end-to-end
await D365Toolkit.BatchJobMonitor.testOne()

// 3. Run all
const report = await D365Toolkit.BatchJobMonitor.run()

// 4. Export CSV
D365Toolkit.BatchJobMonitor.exportCsv()

// 5. Tune config
D365Toolkit.BatchJobMonitor.CONFIG.shortDurationThresholdSec = 60
D365Toolkit.BatchJobMonitor.CONFIG.maxJobs = 10   // limit for test runs
```

### Flags
| Flag | Meaning |
|------|---------|
| `OK` | Ran for ≥ threshold seconds and ended with status "Ended" |
| `ATTENTION` | Status ≠ "Ended", ran too short, or no history found |
| `ERROR` | Script failed to read the history at all |

---

## Workflow: Invoice Cross-Check

Compares D365 invoice IDs against IXOS (SI + FTI) for a given date range and set of legal entities. Reports which D365 invoices are missing from IXOS.

### How it works
1. **IXOS** is queried once via `GM_xmlhttpRequest` (bypasses CORS) for the full date range — both Sales Invoices and Free Text Invoices.
2. For each **entity**: the company picker is used to switch entity in-place (no page reload). D365's `CustInvoiceJournal` is filtered by date in 12-hour batches. Each batch triggers an Excel export; the blob URL is intercepted from the `ReliableCommunicationManager` XHR response and downloaded via `GM_xmlhttpRequest`. SheetJS parses the XLSX in-browser.
3. D365 IDs are diffed against IXOS IDs → missing set reported and exported.

### Console usage
```js
await D365Toolkit.InvoiceCrossCheck.run({
  fromDt:   new Date('2024-01-01'),
  toDt:     new Date('2024-01-31T23:59:59'),
  entities: ['4111', '0051'],
})

D365Toolkit.InvoiceCrossCheck.exportCsv()          // missing invoices flat CSV
D365Toolkit.InvoiceCrossCheck.exportSummaryCsv()   // per-entity summary CSV
D365Toolkit.InvoiceCrossCheck.getResults()         // raw result objects
D365Toolkit.InvoiceCrossCheck.getIxosIds()         // Set of all IXOS IDs fetched
```

### Tuning
```js
D365Toolkit.InvoiceCrossCheck.CONFIG.batchHours  = 6      // smaller windows if D365 times out
D365Toolkit.InvoiceCrossCheck.CONFIG.ixosMaxRows = 50_000
```

---

## Core API reference

```js
// Timing
await D365Toolkit.sleep(ms)
await D365Toolkit.waitFor(fn, { timeout, interval, label })
await D365Toolkit.waitForGone(fn, { timeout, interval, label })

// DOM
D365Toolkit.isVisible(el)
D365Toolkit.query(selector, { visibleOnly, root })
D365Toolkit.findByText(text, { root, visibleOnly })
D365Toolkit.findByLabel(label, { root, visibleOnly })

// Interaction (Playwright-style)
await D365Toolkit.click(selectorOrEl, { timeout, root })
await D365Toolkit.fill(selectorOrEl, value, { timeout, root })
await D365Toolkit.press(selectorOrEl, key)
D365Toolkit.simulateClick(el)
D365Toolkit.scrollGrid(gridEl, amount)

// Network
await D365Toolkit.gmFetch(url, { method, headers, body, timeout })
D365Toolkit.exportCsv(rows, filename)

// D365 grid
D365Toolkit.getGrid(ariaLabel)
D365Toolkit.getRowCount(grid)
D365Toolkit.getRowByIndex(grid, idx)
D365Toolkit.getActiveRow(grid)
D365Toolkit.readCell(rowEl, columnLabel)
await D365Toolkit.goToRow(gridOrLabel, idx)

// D365 navigation
await D365Toolkit.waitReady(extraSelector)
await D365Toolkit.switchEntity(entityCode)   // uses top-bar company picker, no reload
await D365Toolkit.navigate(module, entity)   // hard navigation (causes reload)
D365Toolkit.findButton(label, idSuffix)

// D365 Excel export
D365Toolkit.createBlobInterceptor()          // returns { promise, stop }
await D365Toolkit.downloadBlob(url)          // returns ArrayBuffer via GM
await D365Toolkit.parseXlsx(buffer)          // returns row objects (SheetJS)

// Date helpers
D365Toolkit.fmtD365(date)        // "M/D/YYYY h:mm:ss AM/PM"
D365Toolkit.fmtIxos(date)        // "YYYYMMDD"
D365Toolkit.parseDate(str)
D365Toolkit.durationSeconds(startStr, endStr)
D365Toolkit.generateBatches(fromDt, toDt, batchHours)
D365Toolkit.normalizeId(val)

// UI panel
D365Toolkit.ui.init()
D365Toolkit.ui.destroy()
D365Toolkit.ui.log(msg, level)   // 'info' | 'ok' | 'warn' | 'error'
D365Toolkit.ui.setStatus(label, cls)
D365Toolkit.ui.setProgress(pct)
```

---

## Adding a new workflow

1. Add a new IIFE or class in `src/workflows.js` and export it.
2. Import and expose it in `src/index.js`.
3. Add a section to the panel in `src/ui.js` — copy the BatchJobMonitor section as a template.
4. `npm run build` → commit `dist/d365-toolkit.js`.
