/**
 * index.js — esbuild entry point
 * ───────────────────────────────
 * Imports every module and assembles window.D365Toolkit.
 * TamperMonkey loads the compiled dist/d365-toolkit.js, which calls
 * D365Toolkit.init() automatically.
 */

import {
  _log,
  sleep, waitFor, waitForGone, isProcessing, waitForD365Idle,
  isVisible, query, findByText, findByLabel,
  simulateClick, click, fill, press, scrollGrid,
  gmFetch, exportCsv,
  parseDate, durationSeconds,
  fmtD365, fmtIxos,
  generateBatches, normalizeId,
  waitForElement,
  getByRole,
} from './core.js';

import {
  d365Config,
  waitReady,
  getGrid, getRowCount, getRowByIndex, getActiveRow, getActiveRowIndex,
  readCell, selectRow, goToRow,
  findButton,
  switchEntity, navigate,
  createBlobInterceptor, downloadBlob,
  loadSheetJS, parseXlsx,
} from './d365.js';

import { workflows, BatchJobMonitor, InvoiceCrossCheck } from './workflows.js';
import { initUI, destroyUI, panelLog, setStatus, setProgress } from './ui.js';

const version = "16";

// ─────────────────────────────────────────────────────────────────────────────
// Assemble the public API
// ─────────────────────────────────────────────────────────────────────────────

const D365Toolkit = {
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
  isProcessing,
  waitForD365Idle,
  waitForElement,
  getByRole,

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
    _log.ok(`Version: ${version}; D365 Toolkit initialising…`);
    initUI();
  },

  /**
   * Remove the UI panel and clean up.
   * Useful during development when hot-reloading.
   */
  destroy() {
    destroyUI();
    _log.ok('D365 Toolkit destroyed.');
  },
};

// Expose globally so the TamperMonkey loader and console calls both work
window.D365Toolkit = D365Toolkit;

export default D365Toolkit;
