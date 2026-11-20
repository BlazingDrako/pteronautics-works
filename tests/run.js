// Test runner for tests/index.html. ?only=works runs the Works tests, ?only=core the copied Atlas solver tests.
import * as core from './core/index.js';
import { modelTests } from './works/model.tests.js';
import { engineTests } from './works/engine.tests.js';
import { analysesTests } from './works/analyses.tests.js';
import { viscousTests } from './works/viscous.tests.js';
import { tradeTests } from './works/trade.tests.js';
import { missionTests } from './works/mission.tests.js';
import { requirementsTests } from './works/requirements.tests.js';
import { sailplaneTests } from './works/sailplane.tests.js';

const results = [];
const log = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail ?? '') });

export async function runAll(out, summary) {
  const only = new URLSearchParams(location.search).get('only');
  const works = [['Vehicle model', modelTests], ['Coupling engine', engineTests], ['Fixed-wing analyses', analysesTests], ['Viscous sections & 3D', viscousTests], ['Trade studies', tradeTests], ['Sizing & missions', missionTests], ['Requirements', requirementsTests], ['Sailplanes', sailplaneTests]];
  const coreSteps = Object.entries(core).filter(([k, f]) => /Tests$/.test(k) && typeof f === 'function').map(([k, f]) => [`Core · ${k.replace(/Tests$/, '')}`, f]);
  const steps = only === 'works' ? works : only === 'core' ? coreSteps : [...works, ...coreSteps];
  for (const [group, fn] of steps) {
    const before = results.length;
    try { await fn(log); } catch (e) { log(`${group} threw`, false, e.stack || String(e)); }
    for (let i = before; i < results.length; i++) results[i].group = group;
    render(out, summary, false);
    await new Promise(r => setTimeout(r, 0));
  }
  render(out, summary, true);
  window.__results = results;
  return results;
}

function render(out, summary, done) {
  const fail = results.filter(r => !r.pass).length;
  summary.textContent = `${done ? '' : 'Running… '}${results.length - fail} passed, ${fail} failed, ${results.length} checks`;
  summary.className = done ? (fail ? 'bad' : 'ok') : '';
  const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // failures first, then everything grouped
  const groups = [...new Set(results.map(r => r.group))];
  out.innerHTML = groups.map(g => {
    const rs = results.filter(r => r.group === g), f = rs.filter(r => !r.pass).length;
    return `<details${f ? ' open' : ''}><summary><b>${esc(g || '…')}</b> <span class="${f ? 'bad' : 'okc'}">${rs.length - f}/${rs.length}</span></summary>` +
      rs.map(r => `<div class="r ${r.pass ? 'ok' : 'bad'}"><b>${r.pass ? 'PASS' : 'FAIL'}</b> ${esc(r.name)}<div class="d">${esc(r.detail)}</div></div>`).join('') + '</details>';
  }).join('');
}
