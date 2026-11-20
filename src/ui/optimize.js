// The optimiser page (#/v/<id>/optimize): pick the variables and their bounds, an objective and how the requirements
// constrain it, run, and see the search path, the optimum against the design, and the requirements that bind.
// Applying the optimum first saves a snapshot of the current design, so Compare can undo it.
import { h, icon, brand, themeButton, fx, fsig, pct, minus, toast } from './dom.js';
import { saveVehicle } from '../model/store.js';
import { applyEdit, getPath } from '../model/vehicle.js';
import { saveSnapshot } from '../model/compare.js';
import { noteEdit } from '../model/history.js';
import { analysisNodes, MAIN_METRIC } from '../analyses/classes.js';
import { AERO_LEVELS, STRUCTURE_LEVELS } from '../analyses/fixedWing.js';
import { tradeVariables, variableInfo, defaultRange, metricsFor, metricInfo } from '../analyses/trade.js';
import { optimize } from '../analyses/optimize.js';
import { chart, extent } from './charts.js';

const KEY = 'works-opt:';
const DEFAULT_VARS = { 'fixed-wing': ['wing.span', 'wing.rootChord', 'battery.energy', 'wing.x'], sailplane: ['wing.span', 'wing.rootChord', 'wing.taper', 'wing.x'], rotorcraft: ['rotor.radius', 'battery.energy', 'wing.rootChord', 'mission.cruiseSpeed'], 'launch-vehicle': ['stage1.propellant', 'stage2.propellant', 'mission.stage1Angle'] };

export function renderOptimize(root, doc) {
  const vars = tradeVariables(doc), metrics = metricsFor(doc);
  const def = () => {
    const obj = MAIN_METRIC[doc.class] || metrics[0].metric;
    return { objective: obj, sense: (metricInfo(doc, obj).better ?? 1) < 0 ? -1 : 1, constraints: 'pass', aero: 'vlm', mass: 'areal', evals: 220,
      vars: (DEFAULT_VARS[doc.class] || []).filter(p => variableInfo(doc, p)).map(p => ({ path: p, ...range(p) })) };
  };
  const range = p => { const v = variableInfo(doc, p), r = defaultRange(doc, v); return { lo: r.from, hi: r.to }; };
  let st; try { st = JSON.parse(localStorage.getItem(KEY + doc.id) || 'null'); } catch { st = null; }
  if (!st || !metrics.some(m => m.metric === st.objective) || !Array.isArray(st.vars) || !st.vars.every(v => variableInfo(doc, v.path))) st = def();
  const save = () => { try { localStorage.setItem(KEY + doc.id, JSON.stringify(st)); } catch { } };
  let job = null, res = null;

  const setup = h('div', { class: 'pnl pnl-pad tr-setup' }), out = h('div', { class: 'tr-out' }), status = h('div', { class: 'tr-status', role: 'status' });
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'), h('a', { class: 'vtab', href: '#/v/' + doc.id }, h('span', { class: 'dot' }), doc.name),
        h('span', { class: 'vtab on', 'aria-current': 'page' }, icon('bars'), 'Optimise')),
      h('span', { class: 'grow' }), status, themeButton('btn small')),
    h('div', { class: 'tr-main' }, h('aside', { class: 'col', 'aria-label': 'Optimisation setup' }, setup), h('section', { class: 'tr-results', 'aria-label': 'Optimisation results' }, out))));

  function paintSetup() {
    const sel = (label, opts, value, set) => h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, label)),
      h('select', { class: 'txt tr-sel', 'aria-label': label, onchange: e => { set(e.target.value); save(); paintSetup(); } }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))));
    const groups = [...new Set(vars.map(v => v.group))];
    const addSel = h('select', { class: 'txt tr-sel', 'aria-label': 'Add a variable', onchange: e => { const p = e.target.value; if (p && !st.vars.some(v => v.path === p)) { st.vars.push({ path: p, ...range(p) }); save(); paintSetup(); } } },
      h('option', { value: '' }, '+ Add a variable…'), groups.map(g => h('optgroup', { label: g }, vars.filter(v => v.group === g && !st.vars.some(x => x.path === v.path)).map(v => h('option', { value: v.path }, `${v.label}${v.unit ? ` (${v.unit})` : ''}`)))));
    setup.replaceChildren(
      h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Optimise'), h('span', { class: 'muted', style: { fontSize: '12px' } }, doc.name)),
      h('p', { class: 'note', style: { margin: '0 0 12px' } }, 'Each evaluation is a full coupled run. The search starts from the design, explores with Nelder–Mead and polishes with a pattern search.'),
      sel('Objective', metrics.map(m => [m.metric, m.label + (m.unit ? ` (${m.unit})` : '')]), st.objective, v => { st.objective = v; st.sense = (metricInfo(doc, v).better ?? 1) < 0 ? -1 : 1; }),
      sel('Direction', [[1, 'Maximise'], [-1, 'Minimise']], st.sense, v => { st.sense = +v; }),
      sel('Requirements', [['pass', 'Must all pass (margin ≥ 0)'], ['margin', 'Must all be met (margin ≥ 5%)'], ['none', 'Ignore them']], st.constraints, v => { st.constraints = v; }),
      h('div', { class: 'sec', style: { margin: '14px 0 8px' } }, `Variables · ${st.vars.length}`),
      ...st.vars.map((v, i) => {
        const info = variableInfo(doc, v.path);
        const num = (k, label) => { const inp = h('input', { class: 'num', type: 'number', step: info.step, min: info.min, max: info.max, value: +(+v[k]).toPrecision(6), 'aria-label': `${label} of ${info.label}` });
          inp.addEventListener('change', () => { const x = +inp.value; if (!isFinite(x) || x < info.min || x > info.max) { inp.classList.add('invalid'); return; } inp.classList.remove('invalid'); v[k] = x; save(); }); return h('label', { class: 'tr-num' }, h('span', {}, label), inp); };
        return h('div', { class: 'opt-var' }, h('div', { class: 'opt-var-head' }, h('span', {}, h('b', {}, info.label), h('span', { class: 'muted' }, ` · ${info.group}`)), h('button', { class: 'ms-btn', type: 'button', title: 'Remove', 'aria-label': `Remove ${info.label}`, onclick: () => { st.vars.splice(i, 1); save(); paintSetup(); } }, '×')),
          h('div', { class: 'tr-range' }, num('lo', 'From'), num('hi', 'To'), h('span', { class: 'tr-num' }, h('span', {}, 'Design'), h('span', { class: 'mono', style: { fontSize: '12px', paddingTop: '4px' } }, `${fsig(info.value, 4)} ${info.unit}`))));
      }),
      addSel,
      h('div', { class: 'sec', style: { margin: '16px 0 8px' } }, 'Fidelity'),
      sel('Aero', AERO_LEVELS.map(l => [l.id, l.label]), st.aero, v => { st.aero = v; }),
      sel('Structure', STRUCTURE_LEVELS.map(l => [l.id, l.label]), st.mass, v => { st.mass = v; }),
      sel('Evaluations', [[120, '120 (quick)'], [220, '220'], [400, '400 (thorough)']], st.evals, v => { st.evals = +v; }),
      h('div', { class: 'row', style: { gap: '8px', marginTop: '14px' } },
        job ? h('button', { class: 'btn small', type: 'button', onclick: () => { job.aborted = true; } }, 'Stop')
          : h('button', { class: 'btn small primary', type: 'button', disabled: !st.vars.length, onclick: run }, 'Run the optimiser'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { st = def(); save(); paintSetup(); } }, icon('reset'), 'Defaults')));
  }

  async function run() {
    const me = job = { aborted: false }; res = null; paintSetup();
    out.replaceChildren(h('div', { class: 'placeholder' }, 'Optimising…'));
    const vs = st.vars.map(v => ({ ...v, value: getPath(doc, v.path) }));
    try {
      res = await optimize({ doc, nodes: analysisNodes(doc), fidelity: { aero: st.aero, mass: st.mass }, vars: vs, objective: st.objective, sense: st.sense, constraints: st.constraints, maxEvals: st.evals, signal: me,
        onProgress: (k, n, best) => { status.replaceChildren(h('span', { class: 'pill' }, `Evaluation ${k} / ${n}${best ? ` · best ${fx(best.obj, metricInfo(doc, st.objective).d)}` : ''}`), h('span', { class: 'tr-bar' }, h('i', { style: { width: (k / n * 100).toFixed(1) + '%' } }))); } });
      status.replaceChildren(h('span', { class: 'pill' }, `${res.evals} coupled runs`));
    } catch (e) { status.replaceChildren(); out.replaceChildren(h('div', { class: 'placeholder' }, e.message === 'stopped' ? 'Stopped.' : 'The optimiser could not run: ' + e.message)); }
    job = null; paintSetup(); if (res) paintResults();
  }

  function paintResults() {
    const m = metricInfo(doc, res.objective), b = res.best, s0 = res.start;
    const f = v => `${minus(fx(v, m.d))}${m.unit ? ' ' + m.unit : ''}`;
    const head = h('div', { class: 'pnl pnl-pad tr-head' },
      b ? h('h3', {}, `${m.label}: ${f(s0.obj)} → `, h('b', {}, f(b.obj)), h('span', { class: 'muted', style: { fontWeight: 400 } }, ` (${pct((b.obj - s0.obj) / Math.abs(s0.obj || 1))})`))
        : h('h3', {}, h('span', { class: 'bad' }, 'No design in these bounds meets the requirements')),
      h('p', { class: 'note' }, b ? `${res.evals} coupled runs. ${s0.feasible ? 'The design met the constraints to begin with.' : 'The design did not meet the constraints; the optimum does.'} ${binding(b)}` : 'Widen the bounds, add a variable, or relax the requirements.'));
    // the path: every evaluation's objective, feasible ones filled, and the best so far
    let bestSoFar = -Infinity * res.sense; const line = [];
    for (const r of res.history) { if (r.feasible && res.sense * r.obj > res.sense * bestSoFar) bestSoFar = r.obj; line.push([r.k, r.feasible || isFinite(bestSoFar) ? bestSoFar : NaN]); }
    const ys = res.history.map(r => r.obj).filter(isFinite);
    const path = chart({ w: 900, h: 240, x: [0, res.evals], y: extent(ys, 0.06), xLabel: 'Evaluation', yLabel: m.unit ? `${m.label} (${m.unit})` : m.label, label: 'Optimisation path',
      series: [{ pts: line.filter(p => isFinite(p[1])), cls: 's-accent' }], points: res.history.filter(r => isFinite(r.obj)).map(r => ({ x: r.k, y: r.obj, r: 2.2, color: r.feasible ? 'var(--accent)' : 'var(--text-3)' })),
      legend: [{ label: 'Best design meeting the constraints', cls: 's-accent' }] });
    const parts = [head, h('div', { class: 'plot-card' }, h('h4', {}, 'Search path', h('span', { class: 'sub' }, 'blue: meets the constraints · grey: does not')), path)];
    if (b) {
      parts.push(h('div', { class: 'cmp-grid' },
        h('div', { class: 'pnl' }, h('div', { class: 'sec-row', style: { padding: '14px 16px 0' } }, h('span', { class: 'sec' }, 'Variables'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'at a bound ◆')),
          h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' }, h('thead', {}, h('tr', {}, ['Variable', 'Design', 'Optimum', 'Change', 'Bounds'].map(t => h('th', {}, t)))),
            h('tbody', {}, res.vars.map((v, i) => { const info = variableInfo(doc, v.path), x = b.x[i], atB = Math.abs(x - v.lo) < 1e-3 * (v.hi - v.lo) || Math.abs(x - v.hi) < 1e-3 * (v.hi - v.lo);
              return h('tr', {}, h('td', { style: { color: 'var(--text)' } }, `${info.label} · ${info.group}`), h('td', { class: 'num-c' }, fsig(info.value, 4)), h('td', { class: 'num-c' }, `${fsig(x, 4)} ${info.unit}${atB ? ' ◆' : ''}`),
                h('td', { class: 'num-c' }, pct((x - info.value) / Math.abs(info.value || 1))), h('td', { class: 'num-c muted' }, `${fsig(v.lo, 3)} … ${fsig(v.hi, 3)}`)); }))))),
        h('div', { class: 'pnl' }, h('div', { class: 'sec-row', style: { padding: '14px 16px 0' } }, h('span', { class: 'sec' }, 'Requirements at the optimum')),
          h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' }, h('thead', {}, h('tr', {}, ['ID', 'Start', 'Optimum', 'Margin'].map(t => h('th', {}, t)))),
            h('tbody', {}, b.reqs.map(r => { const a = s0.reqs.find(q => q.id === r.id); return h('tr', {}, h('td', { class: 'mono' }, r.id), h('td', {}, h('span', { class: 'status ' + a.status }, a.status === 'fail' ? 'failing' : a.status)), h('td', {}, h('span', { class: 'status ' + r.status }, r.status === 'fail' ? 'failing' : r.status)), h('td', { class: 'num-c' }, pct(r.margin))); })))))),
        h('div', { class: 'row', style: { gap: '10px' } },
          h('button', { class: 'btn primary', type: 'button', onclick: apply }, `Apply the optimum to ${doc.name}`),
          h('span', { class: 'note' }, 'A snapshot of the current design is saved first; compare or restore it under Compare.')));
    }
    out.replaceChildren(...parts);
  }
  // the requirements that hold the optimum back (margin under 2%)
  function binding(b) {
    const tight = b.reqs.filter(r => isFinite(r.margin) && r.margin < 0.02).map(r => r.id);
    const atBound = res.vars.map((v, i) => { const x = b.x[i], span = v.hi - v.lo; return Math.abs(x - v.hi) < 1e-3 * span ? `${variableInfo(doc, v.path).label.toLowerCase()} at its upper bound` : Math.abs(x - v.lo) < 1e-3 * span ? `${variableInfo(doc, v.path).label.toLowerCase()} at its lower bound` : null; }).filter(Boolean);
    const all = [...tight.map(id => `${id} at its limit`), ...atBound];
    return all.length ? `It is held back by ${all.join(', ')}.${atBound.length ? ' Widen a bound to let it go further.' : ''}` : 'Nothing is at a limit or a bound: this is an interior optimum.';
  }
  function apply() {
    const b = res.best; if (!b) return;
    const snap = saveSnapshot(doc, `Before optimising ${metricInfo(doc, res.objective).label.toLowerCase()}`);
    noteEdit(doc.id, `Optimiser: ${res.sense > 0 ? 'maximised' : 'minimised'} ${metricInfo(doc, res.objective).label.toLowerCase()}`);
    res.vars.forEach((v, i) => applyEdit(doc, v.path, +b.x[i].toPrecision(6)));
    doc.updated = new Date().toISOString(); saveVehicle(doc);
    toast(`${doc.name} now has the optimum. The previous design is the snapshot "${snap.name}".`);
  }

  paintSetup();
  out.replaceChildren(h('div', { class: 'placeholder' }, 'Choose the objective and variables, then run the optimiser.'));
  window.__opt = { doc, get res() { return res; } };
}
