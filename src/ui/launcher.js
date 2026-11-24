// The launcher workspace: the stack and its parts on the left, the ascent, the vehicle to scale or the Δv budget in the
// centre, the coupling graph on the right, the key numbers and the requirements along the bottom. Every edit reruns
// the launch-vehicle graph (stack → staging, ascent → orbit).
import { h, s, icon, brand, themeButton, fx, fsig, pct, minus, ago, toast } from './dom.js';
import { COMPONENT_TYPES, applyEdit, LAUNCH_DEFAULTS } from '../model/vehicle.js';
import { saveVehicle, downloadVehicle, resetVehicle, isModified } from '../model/store.js';
import { seeds } from '../model/seeds.js';
import { noteEdit, recordStatuses, describeEdit } from '../model/history.js';
import { CouplingGraph } from '../engine/graph.js';
import { analysisNodes } from '../analyses/classes.js';
import { graphSvg, graphSummary } from './graphView.js';
import { chart, extent } from './charts.js';

const VIEWS = [{ id: 'ascent', label: 'Ascent' }, { id: 'vehicle', label: 'Vehicle' }, { id: 'budget', label: 'Δv budget' }];
const MISSION = [
  { key: 'orbitAltitude', label: 'Target orbit (circular)', unit: 'km', min: 150, max: 2000, step: 10 },
  { key: 'inclination', label: 'Inclination', unit: '°', min: 0, max: 180, step: 0.1 },
  { key: 'latitude', label: 'Launch site latitude', unit: '°', min: -70, max: 70, step: 0.1 },
  { key: 'payload', label: 'Payload', unit: 'kg', min: 0, max: 1e5, step: 1 },
  { key: 'stage1Angle', label: 'Flight-path angle at stage 1 burnout', unit: '°', min: 5, max: 45, step: 0.5 },
];

export function renderLauncher(root, doc) {
  const graph = new CouplingGraph(analysisNodes(doc));
  const ui = { sel: doc.components[0]?.id, view: 'ascent' };
  let saveTimer = 0;
  const tree = h('div', { class: 'pnl tree' }), editor = h('div', { class: 'pnl pnl-pad' }), mission = h('div', { class: 'pnl pnl-pad' });
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'View' }), canvas = h('div', { class: 'canvas lv-canvas' });
  const graphHead = h('span', { style: { fontSize: '12px', fontWeight: '500' } }), graphBox = h('div'), budget = h('div', { class: 'pnl pnl-pad' });
  const stats = h('div', { class: 'stats' }), reqs = h('section', { class: 'pnl reqs', 'aria-label': 'Requirements' }), rev = h('span', { class: 'pill' });
  const isSeed = seeds().some(v => v.id === doc.id);
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' }, brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } }, h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'), h('span', { class: 'vtab on' }, h('span', { class: 'dot' }), doc.name),
        h('span', { class: 'vsep' }), h('a', { class: 'vtab', href: '#/orbit/' + doc.id, title: `Size ${doc.name}'s payload to orbit in the Orbit tab` }, icon('orbit'), 'Orbit')),
      h('span', { class: 'grow' }), rev,
      h('a', { class: 'btn small', href: `#/v/${doc.id}/trade` }, icon('bars'), 'Trade study'),
      h('a', { class: 'btn small', href: `#/v/${doc.id}/optimize` }, icon('bars'), 'Optimise'),
      h('a', { class: 'btn small', href: `#/v/${doc.id}/compare` }, icon('grid'), 'Compare'),
      h('a', { class: 'btn small', href: `#/v/${doc.id}/report` }, icon('doc'), 'Report'),
      h('button', { class: 'btn small', type: 'button', onclick: () => downloadVehicle(doc) }, icon('download'), 'Save .json'),
      isSeed ? h('button', { class: 'btn small', type: 'button', onclick: () => { if (confirm(`Discard your local edits to ${doc.name}?`)) { renderLauncher(root, resetVehicle(doc.id)); toast('Reset to the seeded design'); } } }, icon('reset'), 'Reset') : null,
      themeButton('btn small')),
    h('div', { class: 'ws-main' },
      h('aside', { class: 'col' }, tree, editor, mission),
      h('section', { class: 'pnl view' }, h('div', { class: 'view-bar' }, crumbs), canvas),
      h('aside', { class: 'col right' }, h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Coupling'), graphHead), graphBox), budget)),
    stats, reqs));

  function edit(path, value) {
    noteEdit(doc.id, describeEdit(doc, path, value));
    const changed = applyEdit(doc, path, value); doc.updated = new Date().toISOString();
    graph.invalidate(changed); graph.run(doc);
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveVehicle(doc); paintRev(); }, 250);
  }
  graph.on(ev => { const sm = graphSummary(graph); graphHead.className = sm.cls; graphHead.textContent = sm.text; graphBox.replaceChildren(graphSvg(graph));
    if (ev.done) { const rq = graph.outputs('requirements'); if (rq) recordStatuses(doc.id, rq.list); paintOutputs(); } });
  const out = () => { const o = {}; for (const id of graph.order) o[id] = graph.outputs(id); return o; };
  function paintRev() { rev.replaceChildren('rev ', h('b', {}, String(doc.revision)), ` · ${doc.branch} · ${isModified(doc.id) ? 'saved locally ' + ago(doc.updated) : 'seed'}`); }

  // ---------- left ----------
  function paintTree() {
    const o = out(), st = o.stack;
    const val = c => c.type === 'stage' ? `${fx((c.dry + c.propellant) / 1000, 2)} t` : c.type === 'rocketEngine' ? `${c.count} × ${fx((c.thrustVac || c.thrustSL) / 1000, 1)} kN` : c.type === 'fairing' ? `⌀ ${fx(c.diameter, 2)} m` : '';
    const sorted = doc.components.slice().sort((a, b) => a.x - b.x);
    tree.replaceChildren(h('div', { class: 'sec' }, `${doc.name} · stack, top down`),
      h('button', { class: 'tree-item' + (ui.sel === 'payload' ? ' on' : ''), type: 'button', onclick: () => { ui.sel = 'payload'; paintTree(); paintEditor(); } }, 'Payload', h('span', { class: 'v' }, `${fx(doc.mission.payload, 0)} kg`)),
      ...sorted.map(c => h('button', { class: 'tree-item' + (ui.sel === c.id ? ' on' : ''), type: 'button', onclick: () => { ui.sel = c.id; paintTree(); paintEditor(); } }, (c.type === 'rocketEngine' ? '  ' : '') + c.name, h('span', { class: 'v' }, val(c)))),
      h('div', { class: 'tree-item', style: { cursor: 'default' } }, h('b', {}, 'Liftoff mass'), h('span', { class: 'v' }, st ? `${fx(st.liftoff / 1000, 2)} t` : '—')));
  }
  const field = (label, unit, value, { min, max, step }, onChange) => {
    const inp = h('input', { class: 'num', type: 'number', min, max, step, value: +(+value).toPrecision(6), 'aria-label': label + (unit ? ` (${unit})` : '') });
    inp.addEventListener('change', () => { const v = +inp.value; if (inp.value === '' || !isFinite(v) || v < min || v > max) { inp.classList.add('invalid'); toast(`${label} must be between ${min} and ${max}${unit ? ' ' + unit : ''}`, true); return; } inp.classList.remove('invalid'); onChange(v); });
    return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, label), h('span', { class: 'row', style: { gap: '6px' } }, inp, h('span', { class: 'unit' }, unit || ''))));
  };
  function paintEditor() {
    if (ui.sel === 'payload') { editor.replaceChildren(h('div', { class: 'sec', style: { marginBottom: '10px' } }, 'Payload'), field('Payload mass', 'kg', doc.mission.payload, MISSION[3], v => edit('mission.payload', v)), h('p', { class: 'note' }, 'The payload capacity to the target orbit is computed in the Orbit node; this is the mass the stack is sized and flown with.')); return; }
    const c = doc.components.find(x => x.id === ui.sel); if (!c) { editor.replaceChildren(); return; }
    const T = COMPONENT_TYPES[c.type];
    editor.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, c.name), h('span', { class: 'muted', style: { fontSize: '12px' } }, T.label)),
      ...T.params.map(p => {
        if (p.kind === 'number') return field(p.label, p.unit, c[p.key], p, v => edit(`${c.id}.${p.key}`, v));
        if (p.kind === 'choice') return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, p.label), h('select', { class: 'txt', onchange: e => edit(`${c.id}.${p.key}`, e.target.value) }, p.options.map(o => h('option', { value: o, selected: o === c[p.key] }, o)))));
        const inp = h('input', { class: 'txt', type: 'text', value: c[p.key] }); inp.addEventListener('change', () => edit(`${c.id}.${p.key}`, inp.value.trim()));
        return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, p.label), inp));
      }),
      ...(c.type === 'rocketEngine' ? [h('p', { class: 'note' }, 'An engine belongs to the stage whose length holds its position x. A vacuum thrust of 0 means sea-level thrust / 0.88.')] : []));
  }
  function paintMission() {
    mission.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Mission'), h('span', { style: { fontSize: '12px', color: 'var(--accent)' } }, doc.mission.orbit || `${doc.mission.orbitAltitude} km`)),
      ...MISSION.filter(m => m.key !== 'payload').map(m => field(m.label, m.unit, doc.mission[m.key] ?? LAUNCH_DEFAULTS[m.key], m, v => edit('mission.' + m.key, v))));
  }

  // ---------- centre ----------
  function paintCrumbs() { crumbs.replaceChildren(...VIEWS.map(v => h('button', { class: 'crumb' + (ui.view === v.id ? ' on' : ''), type: 'button', onclick: () => { ui.view = v.id; paintCrumbs(); paintCanvas(); } }, v.label))); }
  function paintCanvas() {
    const o = out();
    canvas.classList.toggle('busy', !graph.isCurrent());
    const pane = (...kids) => h('div', { class: 'level-pane' }, ...kids);
    if (!o.ascent || !o.stack) { canvas.replaceChildren(pane(h('div', { class: 'placeholder' }, failText() || 'Computing…'))); return; }
    const a = o.ascent, kv = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
    if (ui.view === 'ascent') {
      const tr = a.track, ev = a.events.filter(e => !/ignition/.test(e.name));
      const path = chart({ w: 900, h: 300, x: [0, Math.max(...tr.map(p => p.x)) / 1000 * 1.04], y: [0, Math.max(...tr.map(p => p.h), (o.orbit?.altitude ?? 0) * 1000) / 1000 * 1.12], xLabel: 'Downrange (km)', yLabel: 'Altitude (km)', label: 'Ascent trajectory',
        series: [{ pts: tr.map(p => [p.x / 1000, p.h / 1000]), cls: 's-accent' }], hlines: o.orbit ? [{ y: o.orbit.altitude, label: `target orbit ${fx(o.orbit.altitude, 0)} km`, cls: 's-target', color: 'var(--text-2)' }] : [],
        points: ev.map(e => ({ x: e.x / 1000, y: e.h / 1000, color: 'var(--hl)' })) });
      const vq = chart({ w: 900, h: 220, x: [0, Math.max(...tr.map(p => p.t))], y: [0, Math.max(...tr.map(p => p.v)) * 1.08], xLabel: 'Time (s)', yLabel: 'Speed (m/s)', label: 'Speed and dynamic pressure',
        series: [{ pts: tr.map(p => [p.t, p.v]), cls: 's-accent' }, { pts: tr.map(p => [p.t, p.q / a.qmax * Math.max(...tr.map(x => x.v)) * 0.6]), cls: 's-hl' }],
        legend: [{ label: 'Speed', cls: 's-accent' }, { label: `Dynamic pressure (scaled; Max-Q ${fx(a.qmax / 1000, 1)} kPa)`, cls: 's-hl' }],
        marks: a.events.filter(e => /burnout/i.test(e.name)).map((e, k) => ({ x: e.t, label: e.name.replace(' · separation', ''), cls: 's-muted', row: k })) });
      canvas.replaceChildren(pane(h('h3', {}, 'Ascent · gravity turn'),
        h('div', { class: 'note' }, `Vertical to 50 m/s, a ${fx(a.kickAngle, 2)}° pitch kick (solved so stage 1 burns out at ${fx(doc.mission.stage1Angle ?? 22, 1)}°), then a gravity turn with thrust along the velocity. Points mark the events.`),
        h('div', { class: 'plot-card' }, h('h4', {}, 'Trajectory'), path), h('div', { class: 'plot-card' }, h('h4', {}, 'Speed and dynamic pressure'), vq),
        h('div', { class: 'kv' }, ...a.events.map(e => kv(e.name, `T+${fx(e.t, 0)} s · ${fx(e.h / 1000, 1)} km · ${fx(e.v, 0)} m/s`)), kv('Max-Q', `${fx(a.qmax / 1000, 1)} kPa at ${fx(a.hq / 1000, 1)} km`), kv('Peak acceleration', `${fx(a.gmax, 2)} g`))));
    } else if (ui.view === 'vehicle') canvas.replaceChildren(pane(h('h3', {}, 'Vehicle · side view to scale'), h('div', { class: 'plot-card' }, stackSvg(o)), stageTable(o)));
    else canvas.replaceChildren(pane(h('h3', {}, 'Δv budget'), budgetBars(o), stageTable(o)));
  }
  const failText = () => { const f = graph.order.find(id => graph.state.get(id).state === 'failed'); return f ? `${graph.nodes.get(f).label}: ${graph.state.get(f).error}` : null; };
  function stackSvg(o) {
    const comps = doc.components, top = Math.min(...comps.map(c => c.x)) - 1, bottom = Math.max(...comps.filter(c => c.type === 'stage').map(c => c.x + c.length)) + 1.2;
    const D = Math.max(...comps.filter(c => c.diameter).map(c => c.diameter)), W = 900, H = 260, k = Math.min((W - 60) / (bottom - top), (H - 40) / (D * 1.6));
    const X = x => 30 + (x - top) * k, cy = H / 2;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${doc.name} side view` });
    svg.append(s('line', { x1: 20, x2: W - 20, y1: cy, y2: cy, class: 'grid-l' }));
    const fair = comps.find(c => c.type === 'fairing'), st = comps.filter(c => c.type === 'stage').sort((a, b) => a.x - b.x);
    if (fair && st[0]) { const r = fair.diameter / 2 * k, x1 = X(st[0].x); svg.append(s('path', { d: `M${X(fair.x - 1.2)},${cy} C${X(fair.x - 0.6)},${cy - r} ${X(fair.x)},${cy - r} ${X(fair.x + 0.6)},${cy - r} L${x1},${cy - r} L${x1},${cy + r} L${X(fair.x + 0.6)},${cy + r} C${X(fair.x)},${cy + r} ${X(fair.x - 0.6)},${cy + r} ${X(fair.x - 1.2)},${cy} Z`, class: 'pf-wing' })); }
    for (const c of st) {
      const r = c.diameter / 2 * k, f = c.propellant / (c.propellant + c.dry);
      svg.append(s('rect', { x: X(c.x), y: cy - r, width: c.length * k, height: 2 * r, rx: 3, class: 'pf-wing' }));
      svg.append(s('rect', { x: X(c.x) + 0.08 * c.length * k, y: cy - r * 0.8, width: c.length * k * 0.84 * f, height: 1.6 * r, rx: 2, style: 'fill:var(--accent-soft);stroke:var(--accent);stroke-width:1' }));
      svg.append(s('text', { x: X(c.x) + c.length * k / 2, y: cy + r + 16, class: 'ax-t', 'text-anchor': 'middle' }, `${c.name} · ${fx((c.dry + c.propellant) / 1000, 1)} t`));
    }
    for (const e of comps.filter(c => c.type === 'rocketEngine')) {
      const host = st.find(c => e.x >= c.x && e.x <= c.x + c.length); if (!host) continue;
      const xe = X(host.x + host.length), r = host.diameter / 2 * k * 0.7;
      svg.append(s('path', { d: `M${xe},${cy - r * 0.4} L${xe + 0.9 * k},${cy - r} L${xe + 0.9 * k},${cy + r} L${xe},${cy + r * 0.4} Z`, style: 'fill:var(--hl-soft);stroke:var(--hl);stroke-width:1' }));
      svg.append(s('text', { x: xe + 0.45 * k, y: cy - r - 6, class: 'ax-t', 'text-anchor': 'middle' }, `${e.count}×`));
    }
    return svg;
  }
  function stageTable(o) {
    const sg = o.staging; if (!sg) return h('div');
    return h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' }, h('thead', {}, h('tr', {}, ['Stage', 'Mass at ignition', 'Propellant', 'Dry + engines', 'Mass ratio', 'Isp used', 'Thrust', 'T/W at ignition', 'Ideal Δv'].map(t => h('th', {}, t)))),
      h('tbody', {}, sg.stages.map(r => h('tr', {}, h('td', { style: { color: 'var(--text)' } }, r.name), h('td', { class: 'num-c' }, `${fx(r.m0, 0)} kg`), h('td', { class: 'num-c' }, `${fx(r.prop, 0)} kg`), h('td', { class: 'num-c' }, `${fx(r.dry, 0)} kg`),
        h('td', { class: 'num-c' }, fx(r.MR, 2)), h('td', { class: 'num-c' }, `${fx(r.ispEff, 0)} s`), h('td', { class: 'num-c' }, `${fx((r.booster ? r.FSL : r.Fvac) / 1000, 0)} kN${r.booster ? ' SL' : ' vac'}`), h('td', { class: 'num-c' }, fx(r.TW0, 2)), h('td', { class: 'num-c' }, `${fx(r.dv, 0)} m/s`))))));
  }
  function budgetBars(o) {
    const or = o.orbit, a = o.ascent, sg = o.staging; if (!or || !sg) return h('div');
    const items = [['Orbital speed at the target', or.vCirc, 'var(--accent)'], ['Gravity loss', a.gravityLoss, 'var(--warn)'], ['Drag loss', a.dragLoss, 'var(--hl)'], [or.rotation >= 0 ? 'Earth rotation (helps)' : 'Earth rotation (retrograde: costs)', -or.rotation, 'var(--text-3)']];
    const max = Math.max(or.dvRequired, or.dvIdeal) * 1.05, w = v => (Math.abs(v) / max * 100).toFixed(2) + '%';
    const bar = (label, parts, total) => h('div', { class: 'lv-bar-row' }, h('span', { class: 'lv-bar-l' }, label), h('div', { class: 'lv-bar' }, parts.map(([n, v, c]) => h('i', { style: { width: w(Math.max(0, v)), background: c }, title: `${n}: ${fx(v, 0)} m/s` }))), h('b', { class: 'mono' }, `${fx(total, 0)} m/s`));
    return h('div', { class: 'plot-card' }, h('h4', {}, 'Δv the stack has against Δv the orbit needs'),
      bar('Required', items.filter(i => i[1] > 0), or.dvRequired), bar('Available (ideal)', sg.stages.map((r, k) => [r.name, r.dv, k ? 'var(--lam)' : 'var(--turb)']), or.dvIdeal),
      h('div', { class: 'ms-legend' }, ...items.map(([n, v, c]) => h('span', {}, h('span', { class: 'ms-dot', style: { background: c } }), `${n} ${minus(fx(v, 0))} m/s`)), ...sg.stages.map((r, k) => h('span', {}, h('span', { class: 'ms-dot', style: { background: k ? 'var(--lam)' : 'var(--turb)' } }), `${r.name} ${fx(r.dv, 0)} m/s`))),
      h('p', { class: 'note', style: { marginTop: '8px' } }, `Margin ${minus(fx(or.dvMargin, 0))} m/s → payload capacity ${fx(or.payloadCapacity, 0)} kg to ${fx(or.altitude, 0)} km at ${fx(or.inclination, 1)}° (losses held at this flight's values).`));
  }

  // ---------- right and bottom ----------
  function paintBudget() {
    const o = out(), or = o.orbit;
    budget.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Orbit'), h('span', { class: 'muted', style: { fontSize: '12px' } }, or ? `${fx(or.altitude, 0)} km · ${fx(or.inclination, 1)}°` : '')),
      ...(or ? [['Ideal Δv', `${fx(or.dvIdeal, 0)} m/s`], ['Required Δv', `${fx(or.dvRequired, 0)} m/s`], ['Margin', `${minus(fx(or.dvMargin, 0))} m/s`], ['Payload capacity', `${fx(or.payloadCapacity, 0)} kg`]] : []).map(([k, v]) => h('div', { class: 'derived' }, h('span', {}, k), h('span', { class: 'mono' }, v))),
      h('p', { class: 'note', style: { marginTop: '8px' } }, 'Δv required = orbital speed + gravity and drag losses from the flight − the Earth\'s eastward surface speed along the launch azimuth.'));
  }
  function paintStats() {
    const o = out(), st = o.stack, a = o.ascent, or = o.orbit, rq = o.requirements;
    const status = metric => rq?.list.find(x => x.metric === metric)?.status;
    const col = x => (x === 'fail' ? 'var(--bad)' : x === 'marginal' ? 'var(--warn)' : null);
    const card = (l, v, u, sub, metric) => h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, l), h('span', { class: 'stat-v', style: { color: metric ? col(status(metric)) : null } }, v, u ? h('small', {}, u) : null), h('span', { class: 'stat-s' }, sub));
    stats.replaceChildren(
      card('Payload capacity', fx(or?.payloadCapacity, 0), 'kg', or ? `to ${fx(or.altitude, 0)} km · margin ${pct(or.payloadMargin / 100)}` : '—', 'orbit.payloadCapacity'),
      card('Δv margin', or ? minus(fx(or.dvMargin, 0)) : '—', 'm/s', or ? `${fx(or.dvIdeal, 0)} available · ${fx(or.dvRequired, 0)} needed` : '—'),
      card('Liftoff T/W', fx(st?.TW, 2), '', st ? `${fx(st.liftoff / 1000, 1)} t at liftoff` : '—', 'stack.TW'),
      card('Max-Q', fx(a ? a.qmax / 1000 : NaN, 1), 'kPa', a ? `at ${fx(a.hq / 1000, 1)} km, T+${fx(a.tq, 0)} s` : '—', 'ascent.qmaxKPa'),
      card('Losses', a ? fx(a.gravityLoss + a.dragLoss, 0) : '—', 'm/s', a ? `gravity ${fx(a.gravityLoss, 0)} · drag ${fx(a.dragLoss, 0)}` : '—'),
      card('Requirements met', rq ? `${rq.met} / ${rq.total}` : '—', '', rq ? `${rq.marginal} marginal · ${rq.failing} failing` : '—'));
    const label = { met: 'met', marginal: 'marginal', fail: 'failing' };
    reqs.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Requirements'), h('a', { href: `#/v/${doc.id}/requirements`, style: { fontSize: '12px' } }, 'Edit requirements and see their history →')),
      h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' }, h('thead', {}, h('tr', {}, ['ID', 'Requirement', 'Target', 'Value', 'Margin', 'Status'].map(t => h('th', {}, t)))),
        h('tbody', {}, (rq ? rq.list : []).map(r => h('tr', {}, h('td', { class: 'mono' }, r.id), h('td', { style: { color: 'var(--text)' } }, r.title), h('td', { class: 'num-c' }, `${r.op === '>=' ? '≥' : '≤'} ${fsig(r.target, 4)} ${r.unit || ''}`), h('td', { class: 'num-c' }, fsig(r.value, 4)), h('td', { class: 'num-c' }, pct(r.margin)), h('td', {}, h('span', { class: 'status ' + r.status }, label[r.status]))))))));
  }
  function paintOutputs() { paintTree(); paintCanvas(); paintBudget(); paintStats(); }
  addEventListener('themechange', () => { if (canvas.isConnected) paintCanvas(); });

  paintRev(); paintTree(); paintEditor(); paintMission(); paintCrumbs(); paintBudget(); paintStats();
  graph.run(doc);
  window.__works = { doc, graph, edit };
}
