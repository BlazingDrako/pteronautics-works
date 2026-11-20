// The Pteronautics Works landing page. Every figure here comes from the real Works modules: the coupling graph
// solving Kestrel, the 3D view, the mfoil airfoil worker and the vehicle sketches. Nothing is a screenshot.
import { initTheme, themeButton, BRAND_SVG, h, fx, minus, fsig, pct } from '../src/ui/dom.js';
import { CouplingGraph } from '../src/engine/graph.js';
import { fixedWingNodes, AERO_LEVELS, SECTION_LEVELS } from '../src/analyses/fixedWing.js';
import { kestrel, seeds } from '../src/model/seeds.js';
import { applyEdit, clone, VEHICLE_CLASSES, firstOf } from '../src/model/vehicle.js';
import { mountView3d, defaultCamera } from '../src/ui/view3d.js';
import { vehicleView } from '../src/ui/planform.js';
import { graphSvg, graphSummary } from '../src/ui/graphView.js';
import { cpView, blStrip } from '../src/ui/airfoilLab.js';
import { AirfoilWorker } from '../src/workers/client.js';
import { NPANEL } from '../src/adapters/airfoil.js';
import { sketch } from '../src/ui/sketches.js';

initTheme();
const $ = sel => document.querySelector(sel);
for (const el of document.querySelectorAll('[data-brand]')) el.innerHTML = BRAND_SVG;
$('[data-theme-btn]').replaceWith(themeButton('btn small s-theme'));

const outputsOf = g => { const o = {}; for (const id of g.order) o[id] = g.outputs(id); return o; };
const solved = (doc, set = g => g) => { const g = set(new CouplingGraph(fixedWingNodes())); g.runSync(doc); return { g, o: outputsOf(g) }; };
const base = kestrel(), baseRun = solved(base);

// ---------------------------------------------------------------- hero: Kestrel in 3D with live numbers
{
  const holder = $('[data-hero3d]'), o = baseRun.o;
  const cam = { ...defaultCamera(), yaw: -128, pitch: 20 };
  let view = null;
  const mount = () => { view = mountView3d(holder, base, o, { clmap: true, load: true, cg: false }, cam, { chrome: false, autoRotate: true }); };
  mount();
  addEventListener('themechange', () => view && view.redraw());
  new ResizeObserver(() => view && view.redraw()).observe(holder);
  const p = o.performance, st = o.stability, m = o.mass;
  const chip = (label, value, unit) => h('div', { class: 's-chip' }, h('span', {}, label), h('b', {}, value, unit ? h('small', {}, unit) : null));
  $('[data-hero-chips]').replaceChildren(
    chip('L/D max', fx(p.LDmax, 1)), chip('Endurance', fx(p.endurance, 0), 'min'),
    chip('Static margin', minus(fx(st.SM, 1)), '% MAC'), chip('Takeoff mass', fx(m.total, 1), 'kg'));
}

// ---------------------------------------------------------------- the coupling demo
{
  const doc = clone(base), graph = new CouplingGraph(fixedWingNodes());
  graph.runSync(doc);
  const ctl = $('[data-demo-controls]'), view = $('[data-demo-view]'), gbox = $('[data-demo-graph]'), ghead = $('[data-demo-graph-head]'), stats = $('[data-demo-stats]');
  const w = firstOf(doc, 'wing'), bat = firstOf(doc, 'battery');
  const SLIDERS = [
    { path: `${w.id}.span`, label: 'Wing span', unit: 'm', min: 2.4, max: 4.0, step: 0.02, get: () => w.span, note: 'geometry → aero, mass → stability, performance' },
    { path: `${w.id}.sweep`, label: 'Wing sweep', unit: '°', min: -5, max: 25, step: 0.5, get: () => w.sweep, note: 'geometry → aero → stability' },
    { path: `${bat.id}.x`, label: 'Battery position', unit: 'm', min: 0.3, max: 1.0, step: 0.01, get: () => bat.x, note: 'mass → stability, performance (geometry and aero stay current)' },
    { path: 'mission.cruiseSpeed', label: 'Cruise speed', unit: 'm/s', min: 16, max: 34, step: 0.5, get: () => doc.mission.cruiseSpeed, note: 'sections, aero → stability, performance' },
  ];
  const slow = () => new Promise(r => setTimeout(r, 55));     // slow the run a little so you can watch it
  const notes = h('div', { class: 's-demo-note' }, 'Drag a slider and watch the graph.');
  ctl.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Edit Kestrel'), h('button', { class: 'tg sm', type: 'button', onclick: reset }, 'Reset')),
    ...SLIDERS.map(sl => {
      const out = h('b', { class: 'mono' });
      const r = h('input', { type: 'range', min: sl.min, max: sl.max, step: sl.step, 'aria-label': sl.label });
      const fill = () => { r.style.setProperty('--fill', ((+r.value - sl.min) / (sl.max - sl.min) * 100) + '%'); out.textContent = `${fsig(+r.value, 3)} ${sl.unit}`; };
      sl.sync = () => { r.value = sl.get(); fill(); };
      r.addEventListener('input', () => { fill(); edit(sl.path, +r.value); notes.textContent = sl.note; });
      sl.sync();
      return h('label', { class: 's-slider' }, h('span', {}, sl.label, out), r);
    }), notes);
  function edit(path, value) { graph.invalidate(applyEdit(doc, path, value)); graph.run(doc, { yield: slow }); }
  function reset() {
    const fresh = kestrel();
    for (const c of doc.components) Object.assign(c, fresh.components.find(x => x.id === c.id));
    Object.assign(doc.mission, fresh.mission);
    graph.invalidateAll(); SLIDERS.forEach(sl => sl.sync()); graph.run(doc, { yield: slow });
  }
  function paintGraph() { const sm = graphSummary(graph); ghead.className = sm.cls; ghead.textContent = sm.text; gbox.replaceChildren(graphSvg(graph)); }
  function paintView() {
    const o = outputsOf(graph), size = { w: view.clientWidth || 520, h: view.clientHeight || 420 };
    try { view.replaceChildren(vehicleView(doc, o, { clmap: true, load: true, mac: false, cg: true, items: false }, size).svg); } catch { }
  }
  function paintStats() {
    const o = outputsOf(graph), p = o.performance, st = o.stability, m = o.mass, rq = o.requirements, ref = baseRun.o;
    const delta = (v, r, d, good) => { if (!isFinite(v) || !isFinite(r) || Math.abs(v - r) < 10 ** -d / 2) return h('span', { class: 'stat-s' }, 'as designed'); const up = v > r; return h('span', { class: 'stat-s ' + ((up === good) ? 'good' : 'bad') }, `${up ? '▲' : '▼'} ${fx(Math.abs(v - r), d)} from the design`); };
    const card = (l, v, u, d) => h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, l), h('span', { class: 'stat-v' }, v, u ? h('small', {}, u) : null), d);
    stats.replaceChildren(
      card('Lift-to-drag, max', fx(p?.LDmax, 1), '', delta(p?.LDmax, ref.performance.LDmax, 1, true)),
      card('Endurance', fx(p?.endurance, 0), 'min', delta(p?.endurance, ref.performance.endurance, 0, true)),
      card('Stall speed', fx(p?.Vs, 1), 'm/s', delta(p?.Vs, ref.performance.Vs, 1, false)),
      card('Static margin', st ? minus(fx(st.SM, 1)) : '—', '% MAC', st ? h('span', { class: 'stat-s' + (st.SM < 5 || st.SM > 20 ? ' bad' : '') }, st.SM < 0 ? 'unstable: CG behind the NP' : st.SM < 5 ? 'below the 5% minimum' : st.SM > 20 ? 'above the 20% maximum' : 'within 5–20%') : null),
      card('Takeoff mass', fx(m?.total, 2), 'kg', delta(m?.total, ref.mass.total, 2, false)),
      card('Requirements met', rq ? `${rq.met} / ${rq.total}` : '—', '', h('span', { class: 'stat-s' }, rq ? `${rq.marginal} marginal · ${rq.failing} failing` : '')));
  }
  graph.on(ev => { paintGraph(); if (ev.done) { paintView(); paintStats(); } });
  paintGraph(); paintStats();
  requestAnimationFrame(paintView);
  let lastW = 0;
  new ResizeObserver(() => { if (Math.abs(view.clientWidth - lastW) > 4) { lastW = view.clientWidth; paintView(); } }).observe(view);
  addEventListener('themechange', paintView);
}

// ---------------------------------------------------------------- airfoil lab: a real mfoil run at η 0.45
const whenVisible = (el, fn) => {
  if (typeof IntersectionObserver === 'undefined') return fn();
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '400px' });
  io.observe(el);
};
{
  const o = baseRun.o, g = o.geometry, atm = o.atmosphere.cruise, eta = 0.45, c = g.P.chord(eta), V = base.mission.cruiseSpeed;
  const strips = o.aero.spanLoad(o.stability.CLtrim);
  let near = strips[0]; for (const p of strips) if (Math.abs(p.eta - eta) < Math.abs(near.eta - eta)) near = p;
  const op = { code: String(g.wing.rootAirfoil), mode: 'cl', cl: +near.cl.toFixed(3), Re: Math.round(atm.rho * V * c / atm.mu / 1000) * 1000, Ma: +(V / atm.a).toFixed(3), ncrit: 9, viscous: true, npanel: NPANEL };
  const cpBox = $('[data-lab-cp]'), blBox = $('[data-lab-bl]'), cap = $('[data-lab-caption]');
  let res = null;
  const paint = () => {
    if (!res) return;
    cpBox.replaceChildren(h('h4', {}, 'Pressure and boundary layer', h('span', { class: 'sub' }, '−Cp against x/c')), cpView(res));
    blBox.replaceChildren(h('h4', {}, 'Boundary layer on the section', h('span', { class: 'sub' }, 'displacement thickness × 8')), blStrip(res, 640, 190));
  };
  whenVisible(cpBox, () => new AirfoilWorker().point(op).then(r => {
    res = r; paint();
    const tr = r.transition || [];
    cap.innerHTML = '';
    cap.append(`NACA ${op.code} at η ${eta}: chord ${fx(c * 1000, 0)} mm, Re ${fx(op.Re / 1e6, 2)} M, cℓ ${fx(r.coef.cl, 2)} at α ${minus(fx(r.alpha, 1))}°. `,
      `cd ${fx(r.coef.cd, 4)}, upper transition at ${tr[1]?.x != null ? fx(tr[1].x, 2) + 'c' : '—'}, solved in ${fx(r.timeMs, 0)} ms (${r.iters} iterations).`);
  }).catch(e => { cap.textContent = 'The solver could not run here: ' + e.message; }));
  addEventListener('themechange', paint);
}

// ---------------------------------------------------------------- fidelity: thin airfoil against viscous sections
{
  const lv = $('[data-fid-levels]');
  const row = (name, levels, on) => h('div', { class: 's-fid-row' }, h('span', {}, name), h('span', { class: 'opts' }, levels.map(l => h('span', { class: 'tg sm' + (l.id === on ? ' on' : ''), title: l.note || '' }, l.label))));
  lv.replaceChildren(row('Wing', AERO_LEVELS, 'vlm'), row('Sections', SECTION_LEVELS, 'viscous'), row('Stability', [{ id: 'n', label: 'linear (Nelson)' }], 'n'), row('Performance', [{ id: 'p', label: 'point mass' }], 'p'));
  const box = $('[data-compare]');
  whenVisible(box, async () => {
    const g = new CouplingGraph(fixedWingNodes()); g.setFidelity('sections', 'viscous');
    const t0 = performance.now();
    await g.run(clone(base), { yield: () => Promise.resolve() });
    const ms = performance.now() - t0;
    if (!g.isCurrent()) { box.replaceChildren(h('h4', {}, 'Kestrel, thin airfoil against viscous sections'), h('div', { class: 's-ph' }, 'The viscous run did not finish: ' + (g.state.get('sections').error || ''))); return; }
    const A = baseRun.o, B = outputsOf(g);
    const rows = [
      ['Zero-lift drag CD0', A.aero.CD0, B.aero.CD0, 4, false], ['Wing CL,max', A.aero.CLmax, B.aero.CLmax, 2, true],
      ['L/D max', A.performance.LDmax, B.performance.LDmax, 1, true], ['Endurance (min)', A.performance.endurance, B.performance.endurance, 0, true],
      ['Stall speed (m/s)', A.performance.Vs, B.performance.Vs, 1, false], ['Requirements met', A.requirements.met, B.requirements.met, 0, true],
    ];
    const max = r => Math.max(r[1], r[2]);
    box.replaceChildren(h('h4', {}, 'Kestrel, thin airfoil against viscous sections', h('span', { class: 'sub' }, `viscous graph solved in ${fx(ms / 1000, 1)} s`)),
      h('div', { class: 's-legend' }, h('span', { class: 'k thin' }), 'thin airfoil', h('span', { class: 'k visc' }), 'viscous sections'),
      ...rows.map(r => h('div', { class: 's-cmp' }, h('span', { class: 'l' }, r[0]),
        h('div', { class: 'bars' }, h('i', { class: 'thin', style: { width: (r[1] / max(r) * 100) + '%' } }), h('i', { class: 'visc', style: { width: (r[2] / max(r) * 100) + '%' } })),
        h('span', { class: 'v' }, `${fx(r[1], r[3])} → ${fx(r[2], r[3])}`, h('small', { class: (r[2] > r[1]) === r[4] ? 'good' : 'bad' }, r[1] ? ' ' + pct(r[2] / r[1] - 1, 0) : '')))));
  });
}

// ---------------------------------------------------------------- requirements
{
  const rq = baseRun.o.requirements, lab = { met: 'met', marginal: 'marginal', fail: 'failing' };
  $('[data-reqs]').replaceChildren(
    h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Kestrel requirements'), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${rq.met} met · ${rq.marginal} marginal · ${rq.failing} failing`)),
    h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' },
      h('thead', {}, h('tr', {}, ['Requirement', 'Target', 'Value', 'Margin', 'Status'].map(t => h('th', {}, t)))),
      h('tbody', {}, rq.list.map(r => h('tr', {},
        h('td', { style: { color: 'var(--text)' } }, r.title), h('td', { class: 'mono' }, `${r.op === '>=' ? '≥' : '≤'} ${r.target} ${r.unit}`),
        h('td', { class: 'num-c' }, fsig(r.value, 4)), h('td', { class: 'num-c' }, pct(r.margin)), h('td', {}, h('span', { class: 'status ' + r.status }, lab[r.status]))))))));
}

// ---------------------------------------------------------------- vehicle classes
{
  const byClass = new Map(); for (const v of seeds()) if (!byClass.has(v.class)) byClass.set(v.class, v);
  $('[data-classes]').replaceChildren(...Object.entries(VEHICLE_CLASSES).map(([id, C]) => {
    const v = byClass.get(id), live = C.implemented;
    const state = live ? h('span', { class: 'tag live' }, 'live analysis') : v?.preview ? h('span', { class: 'tag accent' }, 'workspace preview') : h('span', { class: 'tag' }, 'concept');
    const inner = [h('div', { class: 'stage' }, v ? sketch(v) : null, h('span', { class: 'state' }, state)),
      h('div', { class: 's-class-body' }, h('b', {}, C.label), h('span', {}, v ? `${v.name} · ${v.role}` : ''))];
    return live || v?.preview ? h('a', { class: 's-class pnl', href: `app/#/v/${v.id}` }, ...inner) : h('div', { class: 's-class pnl' }, ...inner);
  }));
}
