// test-switch-entity.js
// ─────────────────────────────────────────────────────────────────────────────
// Console test harness for switchEntity.
// Usage (from browser console):
//   await EntitySwitchTest.runSequence(['4111', '0051', '4111'])
//   await EntitySwitchTest.runSingle('0051')
//   EntitySwitchTest.setVerbose(true)   // extra DOM diagnostics
// ─────────────────────────────────────────────────────────────────────────────

export const EntitySwitchTest = (() => {

  let _verbose = false;

  // ── Tiny logger (mirrors your _log style) ──────────────────────────────────

  const log = {
    info:  (...a) => console.log( '%c[TEST] ℹ',  'color:#7eb8f7', ...a),
    ok:    (...a) => console.log( '%c[TEST] ✅', 'color:#6fcf97', ...a),
    warn:  (...a) => console.warn('%c[TEST] ⚠',  'color:#f2c94c', ...a),
    error: (...a) => console.error('%c[TEST] ❌', 'color:#eb5757', ...a),
    dim:   (...a) => { if (_verbose) console.log('%c[TEST] ·', 'color:#888', ...a); },
  };

  // ── DOM diagnostic helpers ─────────────────────────────────────────────────

  /** Dump every visible input on the page with id/name/aria-label */
  function dumpVisibleInputs(label = '') {
    const inputs = [...document.querySelectorAll('input')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    console.groupCollapsed(`[TEST] Visible inputs ${label} (${inputs.length})`);
    inputs.forEach(el => {
      console.log({
        id:         el.id,
        name:       el.name,
        ariaLabel:  el.getAttribute('aria-label'),
        type:       el.type,
        value:      el.value,
        placeholder:el.placeholder,
        el,
      });
    });
    console.groupEnd();
  }

  /** Try every known selector variant for the company search input */
  function probeCompanyInput() {
    const selectors = [
      '#SysCompanyChooser_2_DataArea_id_input',
      '#SysCompanyChooser_DataArea_id_input',
      'input[id*="CompanyChooser"]',
      'input[id*="DataArea"]',
      'input[aria-label*="company" i]',
      'input[aria-label*="legal entity" i]',
      'input[name*="DataArea" i]',
      '.lookupButton + input',
      'input[id*="chooser" i]',
    ];

    log.info('Probing known company-input selectors...');
    let found = false;
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length) {
        log.ok(`  HIT  "${sel}" → ${els.length} element(s)`, [...els]);
        found = true;
      } else {
        log.dim(`  miss "${sel}"`);
      }
    }
    if (!found) {
      log.warn('No known selector matched — dumping all visible inputs:');
      dumpVisibleInputs('(company picker not found)');
    }
    return found;
  }

  /** Open the company picker and immediately probe/dump inputs */
  async function openAndProbe() {
    const btn = document.querySelector('#CompanyButton_button');
    if (!btn) { log.error('#CompanyButton_button not found'); return; }
    log.info(`Current entity: "${btn.textContent.trim()}" — clicking to open picker...`);
    btn.click();
    await sleep(800);
    probeCompanyInput();
    dumpVisibleInputs('(after picker open)');
  }

  // ── Timing wrapper around switchEntity ────────────────────────────────────

  async function runSingle(entityCode) {
    log.info(`━━━ runSingle("${entityCode}") ━━━`);
    const t0 = Date.now();
    try {
      await switchEntity(entityCode);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log.ok(`runSingle done in ${elapsed}s`);
      return { ok: true, entity: entityCode, elapsed };
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log.error(`runSingle failed after ${elapsed}s:`, err.message);
      // After failure: open picker and dump DOM so we can see what's there
      log.warn('Running DOM probe to help diagnose...');
      await openAndProbe();
      return { ok: false, entity: entityCode, elapsed, error: err.message };
    }
  }

  // ── Sequential multi-entity test ──────────────────────────────────────────

  async function runSequence(entities = [], { delayBetween = 2000 } = {}) {
    if (!entities.length) { log.warn('No entities provided'); return []; }

    log.info(`━━━ runSequence(${JSON.stringify(entities)}) ━━━`);
    log.info(`Delay between switches: ${delayBetween}ms`);

    const results = [];

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      log.info(`\n[${i + 1}/${entities.length}] Switching to "${entity}"...`);

      const result = await runSingle(entity);
      results.push(result);

      // Confirm what the button now shows after the switch
      const shown = document.querySelector('#CompanyButton_button')?.textContent.trim();
      log.info(`  Button now shows: "${shown}"`);

      if (!result.ok) {
        log.error(`Sequence aborted at step ${i + 1} — fix the issue and retry`);
        break;
      }

      if (i < entities.length - 1) {
        log.info(`  Waiting ${delayBetween}ms before next switch...`);
        await sleep(delayBetween);
      }
    }

    // Summary table
    console.table(results.map(r => ({
      Entity:  r.entity,
      Result:  r.ok ? '✅ OK' : '❌ FAIL',
      'Time(s)': r.elapsed,
      Error:   r.error ?? '',
    })));

    return results;
  }

  // ── sleep shim (in case core isn't in scope here) ─────────────────────────
  // If your bundler makes sleep() global, this is a no-op fallback.

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  return {
    runSingle,
    runSequence,
    openAndProbe,       // open picker + dump DOM — call this if input not found
    probeCompanyInput,  // probe selectors without opening picker
    dumpVisibleInputs,  // dump all visible inputs at any time
    setVerbose: v => { _verbose = !!v; },
  };
})();
