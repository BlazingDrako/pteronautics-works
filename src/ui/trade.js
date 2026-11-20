// The trade-study page (#/v/<id>/trade): set up a sweep, a two-variable map or a sensitivity study on the left,
// see it on the right. Every sample runs the same coupled graph as the workspace, so a sample is the design you
// would get by making that edit. A sample can be applied to the vehicle.
import { h, s, icon, brand, themeButton, fx, fsig, pct, minus, toast } from './dom.js';
import { applyEdit, getPath } from '../model/vehicle.js';
import { saveVehicle } from '../model/store.js';
import { fixedWingNodes, AERO_LEVELS, SECTION_LEVELS } from '../analyses/fixedWing.js';
import {
  runStudy, runSensitivity, linspace, tradeVariables, variableInfo, defaultRange, metricsFor, metricInfo,
  feasibleRanges, worstMargin, contourZero, SENSITIVITY_DEFAULTS,
} from '../analyses/trade.js';
import { chart, extent, nice } from './charts.js';

const KEY = 'works-trade:';
const MODES = [{ id: 'sweep', label: 'Sweep' }, { id: 'map', label: 'Map' }, { id: 'sens', label: 'Sensitivity' }];
const LIMITS = { sweep: [3, 41], map: [3, 25] };

function defaults(doc) {
  const vars = tradeVariables(doc), has = p => vars.some(v => v.path === p);
  const px = has('wing.span') ? 'wing.span' : vars[0].path;
  const py = has('wing.rootChord') ? 'wing.rootChord' : vars.find(v => v.path !== px).path;
  const axis = (path, n) => ({ path, ...defaultRange(doc, variableInfo(doc, path)), n });
  const reqMetrics = [...new Set((doc.requirements || []).map(r => r.metric))];
  return {
    mode: 'sweep',
    sweep: { ...axis(px, 13), metrics: reqMetrics.length ? reqMetrics : ['performance.endurance', 'performance.Vs', 'stability.SM'] },
    map: { x: axis(px, 13), y: axis(py, 11), metric: 'performance.endurance' },
    sens: { metric: 'performance.endurance', frac: 10, paths: SENSITIVITY_DEFAULTS.filter(has) },
    fid: { aero: 'vlm', sections: 'thin' },
  };
}
// stored settings, kept only where they still fit this vehicle
function loadSettings(doc) {
  const d = defaults(doc);
  let st = null;
  try { st = JSON.parse(localStorage.getItem(KEY + doc.id) || 'null'); } catch { }
  if (!st || typeof st !== 'object') return d;
  const okPath = p => !!variableInfo(doc, p), okMetric = m => metricsFor(doc).some(x => x.metric === m);
  const okAxis = (a, lim) => a && okPath(a.path) && isFinite(a.from) && isFinite(a.to) && a.to > a.from && a.n >= lim[0] && a.n <= lim[1];
  const out = { ...d, mode: MODES.some(m => m.id === st.mode) ? st.mode : d.mode };
  if (okAxis(st.sweep, LIMITS.sweep) && Array.isArray(st.sweep.metrics)) out.sweep = { ...st.sweep, metrics: st.sweep.metrics.filter(okMetric) };
  if (st.map && okAxis(st.map.x, LIMITS.map) && okAxis(st.map.y, LIMITS.map) && st.map.x.path !== st.map.y.path && okMetric(st.map.metric)) out.map = st.map;
  if (st.sens && okMetric(st.sens.metric) && Array.isArray(st.sens.paths) && st.sens.frac > 0) out.sens = { ...st.sens, paths: st.sens.paths.filter(okPath) };
  if (st.fid && AERO_LEVELS.some(l => l.id === st.fid.aero) && SECTION_LEVELS.some(l => l.id === st.fid.sections)) out.fid = st.fid;
  return out;
}
const saveSettings = (doc, st) => { try { localStorage.setItem(KEY + doc.id, JSON.stringify(st)); } catch { } };

export function renderTrade(root, doc) {
  const st = loadSettings(doc);
  let res = null, sel = null, job = null, timer = 0;

  const setup = h('div', { class: 'pnl pnl-pad tr-setup' });
  const status = h('div', { class: 'tr-status', role: 'status' });
  const out = h('div', { class: 'tr-out' });
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'),
        h('a', { class: 'vtab', href: '#/v/' + doc.id }, h('span', { class: 'dot' }), doc.name),
        h('span', { class: 'vtab on', 'aria-current': 'page' }, icon('bars'), 'Trade study')),
      h('span', { class: 'grow' }), status, themeButton('btn small')),
    h('div', { class: 'tr-main' }, h('aside', { class: 'col', 'aria-label': 'Study setup' }, setup), h('section', { class: 'tr-results', 'aria-label': 'Study results' }, out))));
  addEventListener('themechange', () => { if (out.isConnected && res) paintResults(); });

  // ---------- running ----------
  function changed({ now = false } = {}) {
    saveSettings(doc, st);
    clearTimeout(timer); timer = setTimeout(run, now ? 0 : 280);
  }
  async function run() {
    if (job) job.aborted = true;
    const me = job = { aborted: false }, mode = st.mode;
    const fidelity = { aero: st.fid.aero, sections: st.fid.sections };
    const progress = (d, n) => { if (job === me) paintStatus(`Running ${d} / ${n}…`, d / n); };
    paintStatus('Running…', 0);
    out.classList.add('busy');
    let r;
    try {
      if (mode === 'sens') {
        r = await runSensitivity({ doc, nodes: fixedWingNodes(), fidelity, paths: st.sens.paths, metric: st.sens.metric, frac: st.sens.frac / 100, signal: me, onProgress: progress });
      } else {
        const ax = mode === 'sweep' ? [st.sweep] : [st.map.x, st.map.y];
        r = await runStudy({ doc, nodes: fixedWingNodes(), fidelity, axes: ax.map(a => ({ path: a.path, values: linspace(a.from, a.to, a.n).map(v => +v.toPrecision(10)) })), signal: me, onProgress: progress });
      }
    } catch (e) { if (job === me) { paintStatus(''); out.classList.remove('busy'); out.replaceChildren(h('div', { class: 'placeholder' }, 'The study could not run: ' + e.message)); } return; }
    if (!r || job !== me) return;
    job = null; res = { mode, ...r }; sel = defaultSelection();
    out.classList.remove('busy');
    const n = mode === 'sens' ? r.rows.length * 2 + 1 : r.samples.length + 1;
    paintStatus(`${n} coupled runs`);
    paintResults();
  }
  function paintStatus(text, frac = null) {
    status.replaceChildren(text ? h('span', { class: 'pill' }, text) : '', frac !== null ? h('span', { class: 'tr-bar' }, h('i', { style: { width: (frac * 100).toFixed(1) + '%' } })) : '');
  }
  // the sample nearest the design
  function defaultSelection() {
    if (!res || res.mode === 'sens') return null;
    const d = res.axes.map(a => getPath(doc, a.path));
    let best = 0, bd = Infinity;
    res.samples.forEach((smp, k) => {
      const dist = smp.at.reduce((acc, v, i) => { const a = res.axes[i].values, span = a[a.length - 1] - a[0] || 1; return acc + ((v - d[i]) / span) ** 2; }, 0);
      if (dist < bd) { bd = dist; best = k; }
    });
    return best;
  }

  // ---------- setup panel ----------
  function paintSetup() {
    const vars = tradeVariables(doc), metrics = metricsFor(doc);
    const seg = h('span', { class: 'seg', role: 'group', 'aria-label': 'Study type' }, MODES.map(m =>
      h('button', { class: 'tg' + (st.mode === m.id ? ' on' : ''), type: 'button', 'aria-pressed': st.mode === m.id ? 'true' : 'false', onclick: () => { st.mode = m.id; res = null; paintSetup(); paintResults(); changed({ now: true }); } }, m.label)));
    const intro = {
      sweep: 'One design value over a range. Each sample is a full coupled run; the shading shows where every requirement holds.',
      map: 'Two design values over a grid. The colour is one metric; the lines are where each requirement passes its target.',
      sens: 'Each value moved up and down on its own from the design, ranked by how much it moves one metric.',
    }[st.mode];
    const body = st.mode === 'sweep' ? [axisFields('Variable', st.sweep, LIMITS.sweep), metricChips()]
      : st.mode === 'map' ? [axisFields('Across (x)', st.map.x, LIMITS.map, st.map.y.path), axisFields('Up (y)', st.map.y, LIMITS.map, st.map.x.path), metricSelect('Colour by', st.map.metric, m => { st.map.metric = m; paintResults(); saveSettings(doc, st); })]
      : [metricSelect('Metric', st.sens.metric, m => { st.sens.metric = m; changed({ now: true }); }), numField('Step', '%', st.sens.frac, 1, 50, 1, v => { st.sens.frac = v; changed(); }), sensVars(vars)];
    setup.replaceChildren(...[
      h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Trade study'), h('span', { class: 'muted', style: { fontSize: '12px' } }, doc.name)),
      seg, h('p', { class: 'note', style: { margin: '10px 0 14px' } }, intro), ...body,
      h('div', { class: 'sec', style: { margin: '16px 0 8px' } }, 'Fidelity'),
      selectField('Aero', AERO_LEVELS.map(l => [l.id, l.label]), st.fid.aero, v => { st.fid.aero = v; changed({ now: true }); }),
      selectField('Sections', SECTION_LEVELS.map(l => [l.id, l.label]), st.fid.sections, v => { st.fid.sections = v; changed({ now: true }); }),
      st.fid.sections === 'viscous' ? h('p', { class: 'note' }, 'Viscous sections run an mfoil polar for each new Reynolds number, so studies that change the chord, speed or altitude take longer.') : null,
      h('div', { class: 'row', style: { gap: '8px', marginTop: '14px' } },
        h('button', { class: 'btn small primary', type: 'button', onclick: () => changed({ now: true }) }, 'Run again'),
        h('button', { class: 'btn small', type: 'button', title: 'Go back to the default study for this vehicle', onclick: () => { Object.assign(st, defaults(doc)); paintSetup(); changed({ now: true }); } }, icon('reset'), 'Defaults'))].filter(Boolean));
    function metricChips() {
      return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, 'Metrics'), h('span', { class: 'muted', style: { fontSize: '11.5px' } }, `${st.sweep.metrics.length} shown`)),
        h('div', { class: 'tr-chips' }, metrics.map(m => {
          const on = st.sweep.metrics.includes(m.metric);
          return h('button', { class: 'tg sm' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: () => {
            st.sweep.metrics = on ? st.sweep.metrics.filter(x => x !== m.metric) : [...st.sweep.metrics, m.metric];
            paintSetup(); paintResults(); saveSettings(doc, st);
          } }, m.label);
        })));
    }
    function sensVars(all) {
      const groups = [...new Set(all.map(v => v.group))];
      return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, 'Variables'), h('span', { class: 'muted', style: { fontSize: '11.5px' } }, `${st.sens.paths.length} of ${all.length}`)),
        h('div', { class: 'tr-vars' }, groups.map(g => h('div', {}, h('div', { class: 'tr-grp' }, g), h('div', { class: 'tr-chips' }, all.filter(v => v.group === g).map(v => {
          const on = st.sens.paths.includes(v.path);
          return h('button', { class: 'tg sm' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', title: v.path, onclick: () => {
            st.sens.paths = on ? st.sens.paths.filter(x => x !== v.path) : [...st.sens.paths, v.path];
            paintSetup(); changed();
          } }, v.label);
        }))))));
    }
    function axisFields(title, ax, lim, other) {
      const v = variableInfo(doc, ax.path);
      const sel = h('select', { class: 'txt tr-sel', 'aria-label': title }, [...new Set(vars.map(x => x.group))].map(g => h('optgroup', { label: g },
        vars.filter(x => x.group === g).map(x => h('option', { value: x.path, selected: x.path === ax.path, disabled: x.path === other }, x.label + (x.unit ? ` (${x.unit})` : ''))))));
      sel.addEventListener('change', () => { const nv = variableInfo(doc, sel.value); Object.assign(ax, { path: nv.path, ...defaultRange(doc, nv) }); paintSetup(); changed(); });
      return h('div', { class: 'tr-axis' },
        h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, title), h('span', { class: 'muted mono', style: { fontSize: '11.5px' } }, `design ${fsig(v.value, 4)} ${v.unit}`)), sel),
        h('div', { class: 'tr-range' },
          numField('From', v.unit, ax.from, v.min, v.max, v.step, x => { ax.from = x; changed(); }, () => ax.to),
          numField('To', v.unit, ax.to, v.min, v.max, v.step, x => { ax.to = x; changed(); }, () => ax.from, true),
          numField('Steps', '', ax.n, lim[0], lim[1], 1, x => { ax.n = Math.round(x); changed(); })));
    }
    function numField(label, unit, value, min, max, step, set, other, upper) {
      const inp = h('input', { class: 'num', type: 'number', min, max, step, value: +(+value).toPrecision(6), 'aria-label': label + (unit ? ` (${unit})` : '') });
      inp.addEventListener('change', () => {
        const x = +inp.value;
        const bad = inp.value === '' || !isFinite(x) || x < min || x > max || (other && (upper ? x <= other() : x >= other()));
        inp.classList.toggle('invalid', bad);
        if (bad) { toast(other ? `${label} must be within ${min}…${max}${unit ? ' ' + unit : ''}, with From below To` : `${label} must be between ${min} and ${max}`, true); return; }
        set(x);
      });
      return h('label', { class: 'tr-num' }, h('span', {}, label), inp, unit ? h('span', { class: 'unit' }, unit) : null);
    }
    function metricSelect(label, value, set) {
      return selectField(label, metrics.map(m => [m.metric, m.label + (m.unit ? ` (${m.unit})` : '')]), value, set);
    }
    function selectField(label, opts, value, set) {
      const sel = h('select', { class: 'txt tr-sel', 'aria-label': label, onchange: e => set(e.target.value) }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
      return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, label)), sel);
    }
  }

  // ---------- results ----------
  function paintResults() {
    if (!res || res.mode !== st.mode) { if (!job) out.replaceChildren(h('div', { class: 'placeholder' }, 'Running the study…')); return; }
    const failNote = failures();
    if (res.mode === 'sweep') out.replaceChildren(...sweepView(), ...failNote);
    else if (res.mode === 'map') out.replaceChildren(...mapView(), ...failNote);
    else out.replaceChildren(...sensView(), ...failNote);
  }
  function failures() {
    const smps = res.mode === 'sens' ? res.rows.flatMap(r => [r.down, r.up]) : res.samples;
    const bad = smps.filter(x => x.failed.length);
    if (!bad.length) return [];
    const first = bad[0].failed[0];
    return [h('div', { class: 'placeholder' }, `${bad.length} of ${smps.length} samples did not solve: ${first.id} — ${first.error}. Those samples are left blank.`)];
  }
  const vlabel = (path, withUnit = true) => { const v = variableInfo(doc, path); return v ? `${v.group === 'Flight condition' ? '' : v.group + ' '}${v.label.toLowerCase()}${withUnit && v.unit ? ` (${v.unit})` : ''}` : path; };
  const vfmt = (path, x) => { const v = variableInfo(doc, path); return `${fsig(x, 4)}${v?.unit ? ' ' + v.unit : ''}`; };
  const mfmt = (metric, x) => { const m = metricInfo(doc, metric); return `${minus(fx(x, m.d))}${m.unit ? ' ' + m.unit : ''}`; };
  // a sentence when the design itself already fails something
  const designNote = () => { const f = res.baseline.reqs.filter(r => r.status === 'fail').map(r => r.id); return f.length ? `The design itself fails ${f.join(', ')}. ` : ''; };
  const reqFor = metric => (doc.requirements || []).filter(r => r.metric === metric);

  // a sweep: the feasible span of the variable, then one chart per metric
  function sweepView() {
    const ax = res.axes[0], xs = ax.values, xd = getPath(doc, ax.path), smp = res.samples;
    const worst = smp.map(x => worstMargin(x.reqs)), ranges = feasibleRanges(xs, worst);
    const bands = ranges.map(([a, b]) => ({ x0: a, x1: b, cls: 'band-good' }));
    const marks = sel => [{ x: xd, label: 'design', cls: 's-muted', color: 'var(--text-3)' }, ...(sel !== null ? [{ x: smp[sel].at[0], cls: 's-sel', label: '', color: 'var(--hl)' }] : [])];
    const pick = x => { let k = 0; xs.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(xs[k] - x)) k = i; }); sel = k; paintResults(); };
    const xr = [xs[0], xs[xs.length - 1]], xLabel = vlabel(ax.path);

    // which requirements end each feasible range
    const binding = (i) => smp[i] ? smp[i].reqs.filter(r => r.status === 'fail').map(r => r.id) : [];
    const ends = ranges.map(([a, b]) => {
      const iLo = xs.findIndex(v => v >= a) - 1, iHi = xs.findIndex(v => v > b);
      return { a, b, lo: a > xs[0] ? binding(iLo) : [], hi: b < xs[xs.length - 1] && iHi >= 0 ? binding(iHi) : [] };
    });
    const head = ranges.length
      ? h('div', {}, h('h3', {}, 'Every requirement is met ', ends.map((e, k) => {
        const first = e.a <= xs[0], last = e.b >= xs[xs.length - 1];
        const what = first && last ? ['across ', h('b', {}, 'the whole range')] : last ? ['from ', h('b', { class: 'mono' }, vfmt(ax.path, e.a)), ' up'] : first ? ['up to ', h('b', { class: 'mono' }, vfmt(ax.path, e.b))] : ['for ', h('b', { class: 'mono' }, `${fsig(e.a, 3)}–${vfmt(ax.path, e.b)}`)];
        return h('span', {}, k ? ' and ' : '', ...what);
      }), ends.some(e => e.a <= xs[0] || e.b >= xs[xs.length - 1]) ? h('span', { class: 'muted', style: { fontWeight: '400', fontSize: '13px' } }, ' (within this sweep)') : null),
        h('p', { class: 'note' }, `${vlabel(ax.path, false).replace(/^./, c => c.toUpperCase())} from ${vfmt(ax.path, xs[0])} to ${vfmt(ax.path, xs[xs.length - 1])} in ${xs.length} steps; the design is at ${vfmt(ax.path, xd)}. `,
          ends.map(e => [e.lo.length ? `Below ${vfmt(ax.path, e.a)}: ${e.lo.join(', ')} fail. ` : '', e.hi.length ? `Above ${vfmt(ax.path, e.b)}: ${e.hi.join(', ')} fail. ` : '']).flat().join('')))
      : h('div', {}, h('h3', {}, 'No value in this range meets every requirement'),
        h('p', { class: 'note' }, `${designNote()}The requirements that fail most often here: ${mostFailing(smp).join(', ') || '—'}. Widen the range, or change another part first.`));

    const worstChart = plotCard('Worst requirement margin', 'the requirement closest to failing, at each sample', chart({
      w: 440, h: 220, x: xr, y: extent([...worst.filter(isFinite).map(v => v * 100), 0, 5]), xLabel, yLabel: 'Margin (%)', label: 'Worst requirement margin along the sweep',
      series: [{ pts: xs.map((x, i) => [x, worst[i] * 100]), cls: 's-accent' }], bands, hlines: [{ y: 0, cls: 's-target', label: 'fails below 0' }, { y: 5, cls: 's-warn', label: 'marginal below 5%' }],
      marks: marks(sel), points: sel !== null ? [{ x: xs[sel], y: worst[sel] * 100, color: 'var(--hl)' }] : [], onPick: pick,
    }));
    const charts = st.sweep.metrics.map(metric => {
      const m = metricInfo(doc, metric), ys = smp.map(x => x.outputs[metric]), rq = reqFor(metric);
      const yr = extent([...ys, ...rq.map(r => r.target)], 0.08);
      return plotCard(m.label, rq.map(r => `${r.id} ${r.op === '>=' ? '≥' : '≤'} ${fsig(r.target, 4)}`).join(' · ') || (m.unit || ''), chart({
        w: 440, h: 220, x: xr, y: yr, xLabel, yLabel: m.unit ? `${m.label} (${m.unit})` : m.label, label: `${m.label} against ${xLabel}`,
        series: [{ pts: xs.map((x, i) => [x, ys[i]]), cls: 's-accent' }], bands,
        ybands: rq.map(r => r.op === '>=' ? { y0: yr[0], y1: r.target } : { y0: r.target, y1: yr[1] }),
        hlines: rq.map(r => ({ y: r.target, label: r.id, cls: 's-target', color: 'var(--bad)' })),
        marks: marks(sel), points: sel !== null ? [{ x: xs[sel], y: ys[sel], color: 'var(--hl)' }] : [], onPick: pick,
      }));
    });
    return [h('div', { class: 'pnl pnl-pad tr-head' }, head),
      h('div', { class: 'tr-split' }, h('div', { class: 'tr-grid' }, worstChart, ...charts), sampleCard(sel))];
  }
  function mostFailing(smps) {
    const n = new Map(); for (const x of smps) for (const r of x.reqs) if (r.status === 'fail') n.set(r.id, (n.get(r.id) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  }

  // the selected sample: its values against the design, its requirements, and a button to apply it
  function sampleCard(k) {
    if (k === null || !res.samples[k]) return h('div', { class: 'pnl pnl-pad tr-sample' }, h('p', { class: 'note' }, 'Click a chart to pick a sample.'));
    const smp = res.samples[k], base = res.baseline;
    const at = res.axes.map((a, i) => [a.path, smp.at[i]]);
    const isDesign = at.every(([p, v]) => Math.abs(v - getPath(doc, p)) <= 1e-9 * Math.max(1, Math.abs(v)));
    const shown = [...new Set([...(res.mode === 'map' ? [st.map.metric] : []), ...st.sweep.metrics, ...(doc.requirements || []).map(r => r.metric)])];
    const label = { met: 'met', marginal: 'marginal', fail: 'failing' };
    return h('div', { class: 'pnl pnl-pad tr-sample' },
      h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Sample'), h('span', { class: smp.feasible ? 'good' : 'bad', style: { fontSize: '12px', fontWeight: '500' } }, smp.feasible ? 'meets every requirement' : `${smp.reqs.filter(r => r.status === 'fail').length} failing`)),
      ...at.map(([p, v]) => h('div', { class: 'derived' }, h('span', {}, vlabel(p, false)), h('b', { class: 'mono' }, vfmt(p, v)))),
      h('div', { class: 'tr-sub' }, 'Against the design'),
      ...shown.map(metric => {
        const a = smp.outputs[metric], b = base.outputs[metric], d = a - b;
        return h('div', { class: 'derived' }, h('span', {}, metricInfo(doc, metric).label), h('span', { class: 'mono' }, mfmt(metric, a), h('small', { class: 'tr-d' }, isFinite(d) && Math.abs(d) > 1e-12 * Math.max(1, Math.abs(b)) ? ` ${d > 0 ? '+' : '−'}${fx(Math.abs(d), metricInfo(doc, metric).d)}` : '')));
      }),
      h('div', { class: 'tr-sub' }, 'Requirements'),
      h('div', { class: 'tr-reqs' }, smp.reqs.map(r => h('span', { class: 'status ' + r.status, title: `${r.id}: ${label[r.status]}, margin ${pct(r.margin)}` }, r.id))),
      h('button', { class: 'btn small' + (isDesign ? '' : ' primary'), type: 'button', disabled: isDesign, style: { marginTop: '14px', width: '100%', justifyContent: 'center' }, onclick: () => apply(at) },
        isDesign ? 'This is the design' : `Apply to ${doc.name}`));
  }
  function apply(at) {
    for (const [p, v] of at) applyEdit(doc, p, v);
    doc.updated = new Date().toISOString();
    saveVehicle(doc);
    toast(`${doc.name}: ${at.map(([p, v]) => `${vlabel(p, false)} ${vfmt(p, v)}`).join(', ')}. The workspace shows the new design.`);
    paintSetup(); changed({ now: true });
  }

  // a map: the metric as coloured cells, infeasible cells hatched, each requirement's boundary as a contour
  function mapView() {
    const [ax, ay] = res.axes, xs = ax.values, ys = ay.values, nx = xs.length, ny = ys.length, smp = res.samples;
    const metric = st.map.metric, m = metricInfo(doc, metric);
    const at = (i, j) => smp[j * nx + i];
    const vals = smp.map(x => x.outputs[metric]), fin = vals.filter(isFinite);
    const lo = Math.min(...fin), hi = Math.max(...fin);
    const W = 760, H = 470, pad = { l: 62, r: 18, t: 14, b: 46 };
    const dx = (xs[nx - 1] - xs[0]) / (nx - 1), dy = (ys[ny - 1] - ys[0]) / (ny - 1);
    const x0 = xs[0] - dx / 2, x1 = xs[nx - 1] + dx / 2, y0 = ys[0] - dy / 2, y1 = ys[ny - 1] + dy / 2;
    const X = v => pad.l + (v - x0) / (x1 - x0) * (W - pad.l - pad.r), Y = v => H - pad.b - (v - y0) / (y1 - y0) * (H - pad.t - pad.b);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'tr-map pickable', 'aria-label': `${m.label} over ${vlabel(ax.path)} and ${vlabel(ay.path)}` });
    const pid = 'tr-hatch-' + Math.random().toString(36).slice(2, 8);
    svg.append(s('defs', {}, s('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: 7, height: 7, patternTransform: 'rotate(45)' }, s('line', { x1: 0, y1: 0, x2: 0, y2: 7, class: 'tr-hatch-l' }))));
    const t = v => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
    const shade = v => `color-mix(in oklab, var(--accent) ${(10 + 80 * (m.better < 0 ? 1 - t(v) : t(v))).toFixed(0)}%, var(--bg-elev))`;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = at(i, j), v = c.outputs[metric];
      const r = { x: X(xs[i] - dx / 2), y: Y(ys[j] + dy / 2), width: X(xs[i] + dx / 2) - X(xs[i] - dx / 2) + 0.4, height: Y(ys[j] - dy / 2) - Y(ys[j] + dy / 2) + 0.4 };
      svg.append(s('rect', { ...r, style: `fill:${isFinite(v) ? shade(v) : 'var(--bg-sunk)'}` }));
      if (!c.feasible) svg.append(s('rect', { ...r, fill: `url(#${pid})`, class: 'tr-hatch' }));
    }
    // requirement boundaries
    const reqIds = (doc.requirements || []).map(r => r.id);
    for (const id of reqIds) {
      const field = ys.map((_, j) => xs.map((_, i) => at(i, j).reqs.find(r => r.id === id)?.margin));
      const segs = contourZero(xs, ys, field);
      if (!segs.length) continue;
      svg.append(s('path', { d: segs.map(([a, b]) => `M${X(a[0]).toFixed(1)},${Y(a[1]).toFixed(1)} L${X(b[0]).toFixed(1)},${Y(b[1]).toFixed(1)}`).join(' '), class: 'tr-contour' }));
      const mid = segs[Math.floor(segs.length / 2)][0];
      svg.append(s('text', { x: X(mid[0]) + 4, y: Y(mid[1]) - 4, class: 'tr-clabel' }, id));
    }
    // axes
    for (const v of nice(xs[0], xs[nx - 1], 7)) svg.append(s('text', { x: X(v), y: H - pad.b + 15, class: 'ax-t', 'text-anchor': 'middle' }, fsig(v, 4)));
    for (const v of nice(ys[0], ys[ny - 1], 6)) svg.append(s('text', { x: pad.l - 6, y: Y(v) + 3.5, class: 'ax-t', 'text-anchor': 'end' }, fsig(v, 4)));
    svg.append(s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, class: 'tr-frame' }));
    svg.append(s('text', { x: (pad.l + W - pad.r) / 2, y: H - 8, class: 'ax-label', 'text-anchor': 'middle' }, vlabel(ax.path)));
    svg.append(s('text', { x: 14, y: (pad.t + H - pad.b) / 2, class: 'ax-label', 'text-anchor': 'middle', transform: `rotate(-90 14 ${(pad.t + H - pad.b) / 2})` }, vlabel(ay.path)));
    // the design and the selected cell
    const xd = getPath(doc, ax.path), yd = getPath(doc, ay.path);
    if (xd >= x0 && xd <= x1 && yd >= y0 && yd <= y1) svg.append(s('circle', { cx: X(xd), cy: Y(yd), r: 6, class: 'tr-design' }), s('text', { x: X(xd) + 8, y: Y(yd) - 9, class: 'tr-clabel tr-dlabel' }, 'design'));
    if (sel !== null) { const c = smp[sel]; svg.append(s('rect', { x: X(c.at[0] - dx / 2), y: Y(c.at[1] + dy / 2), width: X(c.at[0] + dx / 2) - X(c.at[0] - dx / 2), height: Y(c.at[1] - dy / 2) - Y(c.at[1] + dy / 2), class: 'tr-selcell' })); }
    svg.addEventListener('click', e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, py = (e.clientY - r.top) * H / r.height;
      const vx = x0 + (px - pad.l) / (W - pad.l - pad.r) * (x1 - x0), vy = y0 + (H - pad.b - py) / (H - pad.t - pad.b) * (y1 - y0);
      if (vx < x0 || vx > x1 || vy < y0 || vy > y1) return;
      const i = Math.min(nx - 1, Math.max(0, Math.round((vx - xs[0]) / dx))), j = Math.min(ny - 1, Math.max(0, Math.round((vy - ys[0]) / dy)));
      sel = j * nx + i; paintResults();
    });

    // best feasible cell for the metric, when the metric has a better direction
    const feas = smp.map((x, k) => [x, k]).filter(([x]) => x.feasible && isFinite(x.outputs[metric]));
    let best = null;
    if (m.better && feas.length) best = feas.reduce((a, b) => (m.better * (b[0].outputs[metric] - a[0].outputs[metric]) > 0 ? b : a));
    const legend = h('div', { class: 'tr-legend' },
      h('span', { class: 'mono' }, mfmt(metric, m.better < 0 ? hi : lo)), h('span', { class: 'tr-ramp', 'aria-hidden': 'true' }), h('span', { class: 'mono' }, mfmt(metric, m.better < 0 ? lo : hi)),
      h('span', { class: 'muted' }, m.better ? (m.better > 0 ? '· darker is more' : '· darker is less') : ''),
      h('span', { class: 'grow' }), h('span', { class: 'tr-hatch-key', 'aria-hidden': 'true' }), h('span', {}, 'a requirement fails'), h('span', { class: 'tr-line-key', 'aria-hidden': 'true' }), h('span', {}, 'requirement boundary'));
    const head = h('div', { class: 'pnl pnl-pad tr-head' },
      h('h3', {}, `${feas.length} of ${smp.length} points meet every requirement`),
      h('p', { class: 'note' }, best
        ? [`Best ${m.label.toLowerCase()} among them: `, h('b', { class: 'mono' }, mfmt(metric, best[0].outputs[metric])), ` at ${vfmt(ax.path, best[0].at[0])}, ${vfmt(ay.path, best[0].at[1])} (the design: ${mfmt(metric, res.baseline.outputs[metric])}). `,
          h('button', { class: 'linkbtn', type: 'button', onclick: () => { sel = best[1]; paintResults(); } }, 'Select it')]
        : feas.length ? 'Pick a cell to see it against the design.' : `${designNote()}The requirements that fail most often here: ${mostFailing(smp).join(', ') || '—'}.`));
    return [head, h('div', { class: 'tr-split' }, h('div', { class: 'plot-card' }, h('h4', {}, `${m.label} over ${vlabel(ax.path, false)} and ${vlabel(ay.path, false)}`, h('span', { class: 'sub' }, `${nx} × ${ny} coupled runs`)), svg, legend), sampleCard(sel))];
  }

  // a sensitivity: a tornado of the metric's change for each variable moved down and up
  function sensView() {
    const { rows, y0, metric, frac } = res, m = metricInfo(doc, metric);
    if (!rows.length) return [h('div', { class: 'placeholder' }, 'Pick at least one variable.')];
    const big = Math.max(...rows.flatMap(r => [Math.abs(r.dLo), Math.abs(r.dHi)]).filter(isFinite), 1e-9), span = big * 1.16;
    const W = 1000, rowH = 34, pad = { l: 290, r: 24, t: 36, b: 28 }, H = pad.t + pad.b + rows.length * rowH;
    const dfmt = d => Math.abs(d) < 1e-9 * Math.max(1, Math.abs(y0)) ? '0' : (d > 0 ? '+' : '−') + fsig(Math.abs(d), 2);
    const X = d => pad.l + (d / span + 1) / 2 * (W - pad.l - pad.r), cx = X(0);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'tr-tornado', 'aria-label': `Sensitivity of ${m.label}` });
    for (const v of nice(-big, big, 6)) {
      svg.append(s('line', { x1: X(v), x2: X(v), y1: pad.t - 6, y2: H - pad.b, class: 'grid-l' }), s('text', { x: X(v), y: H - pad.b + 15, class: 'ax-t', 'text-anchor': 'middle' }, (v > 0 ? '+' : '') + minus(fsig(v, 3))));
    }
    svg.append(s('text', { x: cx, y: 16, class: 'ax-label', 'text-anchor': 'middle' }, `${m.label} at the design: ${mfmt(metric, y0)}`));
    svg.append(s('rect', { x: 14, y: 7, width: 12, height: 12, rx: 2, class: 'tr-bar-lo' }), s('text', { x: 31, y: 17, class: 'leg-t' }, `variable −${fsig(frac * 100, 3)}%`),
      s('rect', { x: 128, y: 7, width: 12, height: 12, rx: 2, class: 'tr-bar-hi' }), s('text', { x: 145, y: 17, class: 'leg-t' }, `variable +${fsig(frac * 100, 3)}%`));
    rows.forEach((r, k) => {
      const yc = pad.t + k * rowH + rowH / 2;
      const name = `${r.v.group === 'Flight condition' ? '' : r.v.group + ' · '}${r.v.label}`;
      svg.append(s('text', { x: pad.l - 14, y: yc - 2, class: 'tr-rl', 'text-anchor': 'end' }, name.length > 40 ? name.slice(0, 39) + '…' : name),
        s('text', { x: pad.l - 14, y: yc + 12, class: 'ax-t', 'text-anchor': 'end' }, `${fsig(r.lo, 4)} … ${fsig(r.hi, 4)} ${r.v.unit}`));
      for (const [d, cls] of [[r.dLo, 'tr-bar-lo'], [r.dHi, 'tr-bar-hi']]) {
        if (!isFinite(d)) continue;
        const a = Math.min(cx, X(d)), b = Math.max(cx, X(d));
        svg.append(s('rect', { x: a, y: yc - 9, width: Math.max(1, b - a), height: 18, rx: 3, class: cls }));
      }
      const right = Math.max(r.dLo, r.dHi), left = Math.min(r.dLo, r.dHi);
      if (isFinite(right) && right >= 0) svg.append(s('text', { x: X(right) + 5, y: yc + 4, class: 'tr-val' }, dfmt(right)));
      if (isFinite(left) && left < 0) svg.append(s('text', { x: X(left) - 5, y: yc + 4, class: 'tr-val', 'text-anchor': 'end' }, dfmt(left)));
    });
    svg.append(s('line', { x1: cx, x2: cx, y1: pad.t - 6, y2: H - pad.b, class: 'ax' }));
    const top = rows[0];
    return [h('div', { class: 'pnl pnl-pad tr-head' },
      h('h3', {}, `${m.label} moves most with `, h('b', {}, top.v.label.toLowerCase()), ` (${top.v.group})`),
      h('p', { class: 'note' }, `Each value is moved by ±${fsig(frac * 100, 3)}% from the design (angles and temperatures by ±1, positions by ±2% of the fuselage), one at a time. Parts do not resize with it: more battery energy keeps the battery's mass unless you change that as well.`)),
    h('div', { class: 'plot-card' }, h('h4', {}, `Sensitivity of ${m.label.toLowerCase()}`, h('span', { class: 'sub' }, `${rows.length} variables · ${m.unit || 'no unit'}`)), svg)];
  }

  const plotCard = (title, sub, el) => h('div', { class: 'plot-card' }, h('h4', {}, title, h('span', { class: 'sub' }, sub)), el);

  paintSetup(); paintResults(); changed({ now: true });
  window.__trade = { doc, st, get res() { return res; } };
}
