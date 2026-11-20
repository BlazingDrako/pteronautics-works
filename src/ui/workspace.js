// The aircraft workspace: systems tree and editors on the left, the vehicle view with lens panels in the centre,
// the coupling graph and fidelity on the right, stat cards and the live requirements list along the bottom.
import { h, s, icon, brand, themeButton, fx, fsig, pct, minus, ago, toast } from './dom.js';
import { COMPONENT_TYPES, VEHICLE_CLASSES, applyEdit, firstOf, getPath, LINKS } from '../model/vehicle.js';
import { saveVehicle, downloadVehicle, pickVehicleFile, resetVehicle, isModified } from '../model/store.js';
import { seeds } from '../model/seeds.js';
import { CouplingGraph } from '../engine/graph.js';
import { fixedWingNodes, AERO_LEVELS, SECTION_LEVELS } from '../analyses/fixedWing.js';
import { vehicleView } from './planform.js';
import { mountView3d, defaultCamera } from './view3d.js';
import { createAirfoilLab } from './airfoilLab.js';
import { graphSvg, graphSummary } from './graphView.js';
import { chart, extent } from './charts.js';
import { nacaPanels } from '../../core/solvers/airfoilTheory.js';

const LEVELS = [
  { id: 'mission', label: 'Mission' }, { id: 'vehicle', label: 'Vehicle' }, { id: 'wing', label: 'Wing' },
  { id: 'section', label: 'Section' }, { id: 'bl', label: 'Boundary layer' },
];
const SECTION_ETA = 0.45;

const MISSION_FIELDS = [
  { key: 'cruiseSpeed', label: 'Cruise speed', unit: 'm/s', min: 10, max: 45, step: 0.5, smin: 12, smax: 40 },
  { key: 'altitude', label: 'Altitude (ISA)', unit: 'm', min: 0, max: 6000, step: 10, smin: 0, smax: 4000 },
  { key: 'dT', label: 'ISA deviation', unit: 'K', min: -40, max: 40, step: 1, smin: -30, smax: 30 },
];

export function renderWorkspace(root, doc) {
  const graph = new CouplingGraph(fixedWingNodes());
  const ui = { sel: 'wing', level: 'vehicle', view: 'top', cam: defaultCamera(), layers: { clmap: true, load: true, mac: true, cg: true, items: false, lenses: true } };
  let saveTimer = null;

  // ---------- layout ----------
  const tree = h('div', { class: 'pnl tree' });
  const editor = h('div', { class: 'pnl pnl-pad' });
  const condition = h('div', { class: 'pnl pnl-pad' });
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Zoom level' });
  const layerBar = h('div', { class: 'row', role: 'group', 'aria-label': 'Layers', style: { gap: '6px' } });
  const canvas = h('div', { class: 'canvas' });
  const graphHead = h('span', { style: { fontSize: '12px', fontWeight: '500' } });
  const graphBox = h('div');
  const fidelity = h('div', { class: 'fid' });
  const fidNote = h('div', { class: 'note' });
  const stats = h('div', { class: 'stats' });
  const reqs = h('section', { class: 'pnl reqs', 'aria-label': 'Requirements' });
  const revPill = h('span', { class: 'pill' });

  const isSeed = seeds().some(v => v.id === doc.id);
  let mainEl;
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', role: 'tablist', 'aria-label': 'Vehicles', style: { gap: '4px' } },
        h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'),
        h('button', { class: 'vtab on', type: 'button', role: 'tab', 'aria-selected': 'true' }, h('span', { class: 'dot' }), doc.name),
        h('a', { class: 'vtab', href: '#/v/vireo-2', role: 'tab', 'aria-selected': 'false' }, 'Vireo-2')),
      h('span', { class: 'grow' }),
      revPill,
      h('a', { class: 'btn small', href: `#/v/${doc.id}/mission`, title: 'Plan the mission profile: climb, transits, survey, reserve' }, icon('mission'), 'Mission'),
      h('a', { class: 'btn small', href: `#/v/${doc.id}/trade`, title: 'Sweep design values through the coupled analyses' }, icon('bars'), 'Trade study'),
      h('button', { class: 'btn small', type: 'button', title: 'Download this vehicle as a .json file', onclick: () => downloadVehicle(doc) }, icon('download'), 'Save .json'),
      h('button', { class: 'btn small', type: 'button', title: 'Replace this vehicle with one from a .json file', onclick: loadFile }, icon('upload'), 'Load .json'),
      isSeed ? h('button', { class: 'btn small', type: 'button', title: 'Discard local edits and go back to the seeded design', onclick: reset }, icon('reset'), 'Reset') : null,
      themeButton('btn small')),
    mainEl = h('div', { class: 'ws-main' },
      h('aside', { class: 'col', 'aria-label': 'Systems and flight condition' }, tree, editor, condition),
      h('section', { class: 'pnl view', 'aria-label': 'Vehicle view' }, h('div', { class: 'view-bar' }, crumbs, h('span', { class: 'grow' }), layerBar), canvas),
      h('aside', { class: 'col right', 'aria-label': 'Coupling' },
        h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Coupling'), graphHead), graphBox),
        h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Fidelity')), fidelity, h('div', { style: { height: '8px' } }), fidNote))),
    stats, reqs));

  // ---------- editing ----------
  function edit(path, value) {
    const changed = applyEdit(doc, path, value);
    doc.updated = new Date().toISOString();
    graph.invalidate(changed);
    if (changed.length > 1) { paintTree(); syncFields(changed, path); }
    run();
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveVehicle(doc); paintRev(); }, 250);
  }
  // a linked edit (battery energy moves its mass) updates the other fields of the open part in place
  function syncFields(changed, path) {
    const f = editor._fields; if (!f) return;
    for (const p of changed) { if (p === path) continue; const [cid, key] = p.split('.'); if (cid === ui.sel && f[key]) f[key](getPath(doc, p)); }
  }
  function editRequirement(id, target) {
    const r = doc.requirements.find(x => x.id === id); if (!r) return;
    r.target = target; doc.updated = new Date().toISOString();
    graph.invalidate('requirements.' + id); run();
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveVehicle(doc); paintRev(); }, 250);
  }
  async function run() {
    canvas.classList.add('busy');
    await graph.run(doc);
  }
  addEventListener('themechange', () => { if (canvas.isConnected) paintCanvas(); });
  graph.on(ev => { paintGraph(); if (ev.done) { canvas.classList.toggle('busy', !graph.isCurrent()); paintOutputs(); } });
  const lab = createAirfoilLab({ doc, edit });

  async function loadFile() {
    try {
      const d = await pickVehicleFile();
      if (!VEHICLE_CLASSES[d.class]?.implemented) throw new Error(`${d.name} is a ${VEHICLE_CLASSES[d.class]?.label || d.class} vehicle; this build analyses fixed-wing vehicles only`);
      if (d.id !== doc.id && !confirm(`The file holds "${d.name}" (id ${d.id}). Open it in its own workspace?`)) return;
      saveVehicle(d);
      if (d.id !== doc.id) { location.hash = '#/v/' + d.id; return; }
      renderWorkspace(root, d); toast(`Loaded ${d.name} rev ${d.revision}`);
    } catch (e) { if (e.message !== 'No file chosen') toast(e.message, true); }
  }
  function reset() {
    if (!confirm(`Discard your local edits to ${doc.name} and go back to the seeded design?`)) return;
    renderWorkspace(root, resetVehicle(doc.id)); toast('Reset to the seeded design');
  }

  // ---------- left: systems tree, component editor, flight condition ----------
  function treeValue(c, out) {
    const m = out.mass, g = out.geometry;
    if (c.type === 'wing') return g ? `b ${fx(g.span, 2)} m · ${c.rootAirfoil}` : c.rootAirfoil;
    if (c.type === 'fuselage') return `${fx(c.length, 2)} m`;
    if (c.type === 'battery') return `${c.energy} Wh`;
    if (c.type === 'propulsor') return `${fx(c.power / 1000, 2)} kW`;
    if (c.type === 'htail' || c.type === 'vtail') return `${fx(c.area, 3)} m²`;
    return typeof c.mass === 'number' ? `${fx(c.mass, 2)} kg` : '';
  }
  function paintTree() {
    const out = outputs();
    const item = (id, label, v) => h('button', { class: 'tree-item' + (ui.sel === id ? ' on' : ''), type: 'button', 'aria-pressed': ui.sel === id ? 'true' : 'false', onclick: () => { ui.sel = id; paintTree(); paintEditor(); } }, label, h('span', { class: 'v' }, v));
    tree.replaceChildren(h('div', { class: 'sec' }, `${doc.name} · systems`),
      ...doc.components.map(c => item(c.id, c.name, treeValue(c, out))),
      item('mass', 'Mass & balance', out.mass ? `${fx(out.mass.total, 2)} kg` : '—'));
  }

  function numberField(label, unit, value, { min, max, step, smin, smax }, onInput) {
    const lo = Math.max(min, smin ?? min), hi = Math.min(max, smax ?? max);
    const range = h('input', { type: 'range', min: lo, max: hi, step, value, 'aria-label': label });
    const num = h('input', { class: 'num', type: 'number', min, max, step, value: +(+value).toPrecision(6), 'aria-label': label + (unit ? ` (${unit})` : '') });
    const fill = () => range.style.setProperty('--fill', ((+range.value - lo) / (hi - lo) * 100) + '%');
    range.addEventListener('input', () => { num.value = +(+range.value).toPrecision(6); num.classList.remove('invalid'); fill(); onInput(+range.value); });
    num.addEventListener('change', () => {
      const v = +num.value;
      if (num.value === '' || !isFinite(v) || v < min || v > max) { num.classList.add('invalid'); toast(`${label} must be between ${min} and ${max}${unit ? ' ' + unit : ''}`, true); return; }
      num.classList.remove('invalid'); range.value = v; fill(); onInput(v);
    });
    fill();
    const el = h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, label), h('span', { class: 'row', style: { gap: '6px' } }, num, h('span', { class: 'unit' }, unit || ''))), range);
    el._set = v => { range.value = v; num.value = +(+v).toPrecision(6); num.classList.remove('invalid'); fill(); };
    return el;
  }
  // slider range around the current design (the number box accepts the full valid range)
  function sliderRange(p, v, comp) {
    if (p.unit === '°' || p.unit === '' || p.unit === 'kg/m²') return { smin: p.min, smax: p.max };
    if (p.key === 'x') { const L = firstOf(doc, 'fuselage')?.length || 2; return { smin: Math.max(p.min, v - 0.4 * L), smax: v + 0.4 * L }; }
    return { smin: Math.max(p.min, v * 0.5), smax: Math.min(p.max, v * 1.6 || p.max) };
  }

  function paintEditor() {
    if (ui.sel === 'mass') return paintMassPanel();
    const comp = doc.components.find(c => c.id === ui.sel);
    if (!comp) { editor.replaceChildren(); return; }
    const T = COMPONENT_TYPES[comp.type], setters = {};
    const fields = T.params.map(p => {
      const path = `${comp.id}.${p.key}`, v = comp[p.key];
      if (p.kind === 'number') { const f = numberField(p.label, p.unit, v, { ...p, ...sliderRange(p, v, comp) }, val => edit(path, val)); setters[p.key] = f._set; return f; }
      if (p.kind === 'choice') {
        const sel = h('select', { class: 'txt', 'aria-label': p.label, onchange: e => { edit(path, e.target.value); if (p.key === 'sizing') paintDerived(); } }, p.options.map(o => h('option', { value: o, selected: o === v }, o)));
        return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, p.label), sel));
      }
      const airfoil = /Airfoil$/.test(p.key);
      const inp = h('input', { class: 'txt', type: 'text', value: v, 'aria-label': p.label, maxlength: airfoil ? 4 : 80, inputmode: airfoil ? 'numeric' : 'text' });
      inp.addEventListener('change', () => {
        const val = inp.value.trim();
        if (airfoil && !/^\d{4}$/.test(val)) { inp.classList.add('invalid'); toast('Use a NACA 4-digit code, for example 4415', true); return; }
        inp.classList.remove('invalid'); edit(path, val); if (airfoil) paintTree();
      });
      return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, p.label), inp));
    });
    const derived = h('div', { class: 'derived-box' });
    editor.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, comp.name), h('span', { class: 'muted', style: { fontSize: '12px' } }, T.label)), ...fields, derived);
    editor._derived = { box: derived, comp }; editor._fields = setters;
    paintDerived();
  }
  function paintDerived() {
    const d = editor._derived; if (!d || !d.box.isConnected) return;
    const out = outputs(), g = out.geometry, m = out.mass, rows = [];
    if (d.comp.type === 'wing' && g) rows.push(['Area S', `${fx(g.S, 3)} m²`], ['Aspect ratio', fx(g.AR, 2)], ['Tip chord', `${fx(g.ct * 1000, 0)} mm`], ['MAC', `${fx(g.mac * 1000, 0)} mm`], ['Wing mass', m ? `${fx(m.items.find(i => i.derived)?.mass, 2)} kg` : '—']);
    if (d.comp.type === 'htail' && g && g.ht && out.stability) rows.push(['Tail volume V_H', fx(out.stability.VH, 3)], ['Span', `${fx(g.ht.b, 3)} m`]);
    if (d.comp.type === 'vtail' && out.stability) rows.push(['Fin volume V_V', fx(out.stability.VV, 4)]);
    if (d.comp.type === 'battery' && m) rows.push(['Usable energy', `${fx(d.comp.energy * d.comp.usable, 0)} Wh`]);
    if (d.comp.type === 'propulsor' && m) rows.push(['Power loading', `${fx(d.comp.power / m.total, 0)} W/kg`]);
    const L = LINKS[d.comp.type];
    const link = L ? h('p', { class: 'note', style: { marginTop: '8px' } }, d.comp.sizing === 'fixed'
      ? `Fixed: the mass stays as set; changing the ${L.a} changes the ${L.k === 'specificEnergy' ? 'specific energy' : 'specific power'}.`
      : `Linked: the mass follows the ${L.a} at ${fx(d.comp[L.k], 0)} ${L.k === 'specificEnergy' ? 'Wh/kg' : 'W/kg'}, so a bigger ${d.comp.type === 'battery' ? 'pack' : 'motor'} weighs more. Setting the mass changes the ${L.a}.`) : null;
    d.box.replaceChildren(...(rows.length ? [h('div', { class: 'sec', style: { margin: '14px 0 4px' } }, 'Derived')] : []), ...rows.map(([k, v]) => h('div', { class: 'derived' }, h('span', {}, k), h('span', { class: 'mono' }, v))), ...(link ? [link] : []));
  }
  function paintMassPanel() {
    editor._derived = null;
    const m = outputs().mass;
    if (!m) { editor.replaceChildren(h('div', { class: 'sec' }, 'Mass & balance'), h('p', { class: 'note' }, 'Not computed.')); return; }
    editor.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Mass & balance'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'build-up')),
      ...m.items.slice().sort((a, b) => b.mass - a.mass).map(i => h('div', { class: 'derived' }, h('span', {}, i.name + (i.derived ? ' (from area)' : '')), h('span', { class: 'mono' }, `${fx(i.mass, 2)} kg @ ${fx(i.x, 2)} m`))),
      h('div', { class: 'derived', style: { borderTop: '1px solid var(--border)', marginTop: '6px', paddingTop: '6px' } }, h('b', {}, 'Total'), h('b', { class: 'mono' }, `${fx(m.total, 2)} kg`)),
      h('div', { class: 'derived' }, h('span', {}, 'CG'), h('span', { class: 'mono' }, `${fx(m.xcg, 3)} m · ${fx(m.h * 100, 1)}% MAC`)),
      h('p', { class: 'note', style: { marginTop: '8px' } }, 'Edit each part\'s mass and position in its own panel. Wing mass follows its area.'));
  }

  function paintCondition() {
    condition.replaceChildren(h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Flight condition'), h('span', { style: { fontSize: '12px', color: 'var(--accent)' } }, 'Cruise')),
      ...MISSION_FIELDS.map(f => numberField(f.label, f.unit, doc.mission[f.key] ?? 0, f, v => edit('mission.' + f.key, v))),
      h('div', { class: 'note', id: 'trim-note' }));
  }
  function paintTrimNote() {
    const n = condition.querySelector('#trim-note'); if (!n) return;
    const st = outputs().stability, p = outputs().performance;
    n.textContent = st && p ? `Trimmed at α ${minus(fx(st.trim.alpha, 1))}°, elevator ${minus(fx(st.trim.de, 1))}° (tail incidence ${minus(fx(st.it, 1))}°, set to trim at 25% MAC). Shaft power ${fx(p.cruise.P * prop().motorEff, 0)} W, battery draw ${fx(p.cruise.P, 0)} W.` : 'Trim not available.';
  }
  const prop = () => firstOf(doc, 'propulsor') || { motorEff: 1 };

  // ---------- centre: zoom levels ----------
  function paintCrumbs() {
    crumbs.replaceChildren(...LEVELS.flatMap((l, i) => [
      i ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›') : null,
      h('button', { class: 'crumb' + (ui.level === l.id ? ' on' : ''), type: 'button', 'aria-current': ui.level === l.id ? 'true' : null, onclick: () => { ui.level = l.id; paintCrumbs(); paintCanvas(); } }, l.label),
    ]).filter(Boolean));
    const toggles = [['clmap', 'Lift colouring (cℓ / cℓ,max)'], ['load', 'Span load'], ['mac', 'Mean aerodynamic chord'], ['cg', 'CG and neutral point'], ['items', 'Mass items'], ['lenses', 'Lens panels']];
    const focus = h('button', { class: 'tg sm focus-btn' + (ui.focus ? ' on' : ''), type: 'button', 'aria-pressed': ui.focus ? 'true' : 'false', title: 'Hide the side panels so the view fills the window (F)', onclick: toggleFocus }, ui.focus ? 'Exit focus' : 'Focus');
    if (ui.level !== 'vehicle') { layerBar.replaceChildren(focus); return; }
    const views = h('span', { class: 'seg', role: 'group', 'aria-label': 'View' }, ...[['top', 'Top · to scale'], ['3d', '3D']].map(([id, t]) =>
      h('button', { class: 'tg sm' + (ui.view === id ? ' on' : ''), type: 'button', 'aria-pressed': ui.view === id ? 'true' : 'false', onclick: () => { ui.view = id; paintCrumbs(); paintCanvas(); } }, t)));
    // the layers live in a small menu of Atlas-style switches
    const menu = h('div', { class: 'layer-menu', role: 'menu', hidden: !ui.layersOpen },
      h('div', { class: 'sec', style: { marginBottom: '6px' } }, 'Layers'),
      ...toggles.map(([k, label]) => {
        const inp = h('input', { type: 'checkbox', checked: ui.layers[k] });
        inp.addEventListener('change', () => { ui.layers[k] = inp.checked; paintCanvas(); });
        return h('label', { class: 'toggle' }, h('span', {}, label), inp, h('span', { class: 'sw' }));
      }));
    const on = toggles.filter(([k]) => ui.layers[k]).length;
    const btn = h('button', { class: 'tg sm' + (ui.layersOpen ? ' on' : ''), type: 'button', 'aria-expanded': ui.layersOpen ? 'true' : 'false', onclick: e => { e.stopPropagation(); ui.layersOpen = !ui.layersOpen; paintCrumbs(); } }, `Layers · ${on}`, h('span', { 'aria-hidden': 'true', style: { opacity: '.6' } }, '▾'));
    layerBar.replaceChildren(views, focus, h('div', { class: 'layer-wrap', onclick: e => e.stopPropagation() }, btn, menu));
  }
  addEventListener('click', () => { if (ui.layersOpen && canvas.isConnected) { ui.layersOpen = false; paintCrumbs(); } });

  function paintCanvas() {
    const out = outputs();
    canvas.classList.toggle('busy', !graph.isCurrent());
    canvas.classList.toggle('v3d-on', ui.level === 'vehicle' && ui.view === '3d');   // 3D draws its own ground grid
    if (ui.level !== 'vehicle') {
      canvas.replaceChildren(ui.level === 'mission' ? missionPane(out) : ui.level === 'wing' ? wingPane(out) : lab.pane(ui.level, out));
      return;
    }
    // the airframe is drawn at the canvas's own pixel size so it fills the view; lenses float over the right edge
    const holder = h('div', { class: 'view-svg' });
    const lenses = ui.layers.lenses ? h('div', { class: 'lenses' }, stabilityLens(out), powerLens(out), sectionLens(out)) : null;
    canvas.replaceChildren(holder, ...(lenses ? [lenses] : []));
    const overlay = lenses && getComputedStyle(lenses).position === 'absolute';
    const size = { w: holder.clientWidth || 900, h: holder.clientHeight || 640 };
    lastSize = size.w + 'x' + size.h;
    try {
      if (ui.view === '3d') { holder.classList.add('v3d-wrap'); view3d = mountView3d(holder, doc, out, ui.layers, ui.cam, { reserveRight: overlay ? 232 : 0 }); }
      else { view3d = null; holder.append(vehicleView(doc, out, ui.layers, size, { reserveRight: overlay ? 232 : 0 }).svg); }
    } catch (e) { holder.append(h('div', { class: 'level-pane' }, h('div', { class: 'placeholder' }, 'Cannot draw this geometry: ' + e.message))); }
  }
  let view3d = null;
  // redraw when the canvas changes size (window resize, panels wrapping)
  let lastSize = '', resizeFrame = 0;
  new ResizeObserver(() => {
    if (ui.level !== 'vehicle' || !canvas.isConnected) return;
    const holder = canvas.querySelector('.view-svg'); if (!holder) return;
    if (holder.clientWidth + 'x' + holder.clientHeight === lastSize) return;
    if (view3d) { lastSize = holder.clientWidth + 'x' + holder.clientHeight; view3d.redraw(); return; }
    cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(paintCanvas);
  }).observe(canvas);
  function toggleFocus() { ui.focus = !ui.focus; mainEl.classList.toggle('focus', ui.focus); paintCrumbs(); }
  addEventListener('keydown', e => {
    if (!canvas.isConnected || e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    toggleFocus();
  });
  const goto = level => () => { ui.level = level; paintCrumbs(); paintCanvas(); };

  function stabilityLens(out) {
    const st = out.stability;
    const box = h('div', { class: 'lens plain' }, h('h4', {}, 'Dynamic modes', h('span', {}, 's-plane')));
    if (!st) { box.append(h('div', { class: 'cap' }, 'not computed')); return box; }
    const roots = [...st.roots.lon.map(r => ({ r, c: 'var(--accent)' })), ...st.roots.lat.map(r => ({ r, c: 'var(--hl)' }))];
    const re = roots.map(x => x.r[0]), im = roots.map(x => x.r[1]);
    const xr = extent([...re, 0], 0.12), yr = extent([...im, 0], 0.12);
    box.append(chart({ w: 196, h: 104, compact: true, x: xr, y: yr, series: [{ pts: [[0, yr[0]], [0, yr[1]]], cls: 's-muted' }], points: roots.map(({ r, c }) => ({ x: r[0], y: r[1], color: c })), label: 'Eigenvalues in the s-plane' }));
    const sp = st.sp, dr = st.dr, spi = st.spiral;
    box.append(h('div', { class: 'cap' }, 'Short period ζ ', h('b', {}, sp.real ? 'real' : fx(sp.zeta, 2)), ' · Dutch roll ζ ', h('b', {}, dr ? fx(dr.zeta, 3) : '—')),
      h('div', { class: 'cap' }, h('span', { style: { color: 'var(--accent)' } }, '● longitudinal'), '   ', h('span', { style: { color: 'var(--hl)' } }, '● lateral'), spi && spi.re > 0 ? ` · spiral doubles in ${fx(spi.t2, 1)} s` : ' · spiral stable'));
    return box;
  }
  function powerCurve(p, w, hgt, compact) {
    const xs = p.curve.map(c => c.V), top = Math.max(...p.curve.map(c => c.Pav).filter(isFinite), p.Pend * 1.5) * 1.12;
    return chart({
      w, h: hgt, compact, x: [Math.min(...xs), Math.max(...xs)], y: [0, top],
      xLabel: compact ? null : 'True airspeed (m/s)', yLabel: compact ? null : 'Power (W)', label: 'Power required against airspeed',
      series: [{ pts: p.curve.map(c => [c.V, c.Pel]), cls: 's-accent' }, { pts: p.curve.map(c => [c.V, c.Preq]), cls: 's-muted' }, ...(compact ? [] : [{ pts: p.curve.map(c => [c.V, c.Pav]), cls: 's-good' }])],
      legend: [{ label: 'Battery power', cls: 's-accent' }, { label: 'Aerodynamic power required', cls: 's-muted' }, { label: 'Shaft power available', cls: 's-good' }],
      marks: [{ x: p.Vs, label: compact ? '' : `Stall ${fx(p.Vs, 1)} m/s`, cls: 's-warn', color: 'var(--text-3)' }, { x: p.Vend, label: compact ? '' : `Best endurance ${fx(p.Vend, 1)}`, cls: 's-warn', row: 1, color: 'var(--text-2)' }, { x: p.Vrange, label: compact ? '' : `Best range ${fx(p.Vrange, 1)}`, cls: 's-warn', row: 2, color: 'var(--text-2)' }, { x: p.cruise.V, label: compact ? '' : `Cruise ${fx(p.cruise.V, 1)}`, cls: 's-hl', row: 3, color: 'var(--hl)' }],
      points: [{ x: p.cruise.V, y: p.cruise.P, color: 'var(--hl)' }],
    });
  }
  function powerLens(out) {
    const p = out.performance;
    const box = h('button', { class: 'lens', type: 'button', onclick: goto('mission') }, h('h4', {}, 'Power curve', h('span', {}, `${fx(p?.E, 0)} Wh usable`)));
    if (!p) { box.append(h('div', { class: 'cap' }, 'not computed')); return box; }
    box.append(powerCurve(p, 196, 104, true), h('div', { class: 'cap' }, 'Cruise draw ', h('b', {}, `${fx(p.cruise.P, 0)} W`), ' · ', h('b', {}, `${fx(p.cruise.endurance, 0)} min`)), h('div', { class: 'go' }, 'Open mission view →'));
    return box;
  }
  function airfoilSvg(code, w, hgt, chordPx) {
    const { X, Y } = nacaPanels(code, 120);
    const k = chordPx, x0 = (w - k) / 2, y0 = hgt / 2;
    const svg = s('svg', { viewBox: `0 0 ${w} ${hgt}`, role: 'img', 'aria-label': `NACA ${code} section` });
    svg.append(s('line', { x1: 4, x2: w - 4, y1: y0, y2: y0, class: 'grid-l' }));
    svg.append(s('path', { d: 'M' + X.map((x, i) => `${(x0 + x * k).toFixed(1)},${(y0 - Y[i] * k).toFixed(1)}`).join(' L') + ' Z', class: 'pf-wing' }));
    return svg;
  }
  function sectionAt(out) {
    const g = out.geometry, ae = out.aero, st = out.stability, atm = out.atmosphere;
    if (!g || !ae || !st || !atm) return null;
    const strips = ae.spanLoad(st.CLtrim);
    let best = strips[0]; for (const p of strips) if (Math.abs(p.eta - SECTION_ETA) < Math.abs(best.eta - SECTION_ETA)) best = p;
    const code = SECTION_ETA < 0.5 ? g.wing.rootAirfoil : g.wing.tipAirfoil, sec = SECTION_ETA < 0.5 ? g.root : g.tip;
    const c = g.P.chord(SECTION_ETA), V = doc.mission.cruiseSpeed;
    return { code, sec, c, cl: best.cl, Re: atm.cruise.rho * V * c / atm.cruise.mu };
  }
  function sectionLens(out) {
    const x = sectionAt(out);
    const box = h('button', { class: 'lens', type: 'button', onclick: goto('section') }, h('h4', {}, `Section at η ${SECTION_ETA}`, h('span', {}, x ? `Re ${fx(x.Re / 1e6, 2)} M` : '')));
    if (!x) { box.append(h('div', { class: 'cap' }, 'not computed')); return box; }
    box.append(airfoilSvg(x.code, 196, 54, 180), h('div', { class: 'cap' }, `NACA ${x.code} · chord `, h('b', {}, `${fx(x.c * 1000, 0)} mm`), ' · cℓ ', h('b', {}, fx(x.cl, 2))), h('div', { class: 'go' }, 'Open the airfoil lab →'));
    return box;
  }

  function missionPane(out) {
    const p = out.performance, atm = out.atmosphere;
    if (!p) return h('div', { class: 'level-pane' }, h('div', { class: 'placeholder' }, 'Performance is not computed (see the coupling graph).'));
    return h('div', { class: 'level-pane' },
      h('h3', {}, 'Mission · cruise power and endurance'),
      h('div', { class: 'note' }, 'At the current flight condition. Best endurance is the speed of least battery power, best range the speed of most distance per joule, both kept above 1.2 × stall speed.'),
      plotCard('Power against airspeed', powerCurve(p, 900, 340, false)),
      h('div', { class: 'kv' },
        kv('Endurance (best)', `${fx(p.endurance, 0)} min @ ${fx(p.Vend, 1)} m/s`), kv('Range (best)', `${fx(p.range, 0)} km @ ${fx(p.Vrange, 1)} m/s`),
        kv('Cruise endurance', `${fx(p.cruise.endurance, 0)} min`), kv('Cruise range', `${fx(p.cruise.range, 0)} km`),
        kv('Cruise CL', fx(p.cruise.CL, 3)), kv('Cruise L/D', fx(p.cruise.LD, 1)), kv('Max L/D', fx(p.LDmax, 1)), kv('Best climb', `${fx(p.RoC, 2)} m/s @ ${fx(p.Vy, 1)} m/s`),
        kv('Max level speed', `${fx(p.Vmax, 1)} m/s`), kv('Stall (1 g)', `${fx(p.Vs, 1)} m/s`), kv('Usable energy', `${fx(p.E, 0)} Wh`),
        atm ? kv('Air density', `${fx(atm.cruise.rho, 4)} kg/m³`) : null, atm ? kv('Temperature', `${fx(atm.cruise.T - 273.15, 1)} °C`) : null),
      missionCard(out));
  }
  function missionCard(out) {
    const m = out.mission;
    const link = h('a', { class: 'btn small primary', href: `#/v/${doc.id}/mission` }, icon('mission'), 'Open the mission planner');
    if (!m) return h('div', { class: 'placeholder' }, 'The mission profile is not computed (see the coupling graph). ', link);
    return h('div', { class: 'plot-card' }, h('h4', {}, 'Mission profile', h('span', { class: 'sub' }, `${m.segments.length} segments`)),
      h('div', { class: 'kv' },
        kv('Mission energy', isFinite(m.energy) ? `${fx(m.energy, 0)} of ${fx(m.usable, 0)} Wh` : 'cannot be flown'), kv('Left after reserve', isFinite(m.margin) ? `${fx(m.margin, 1)}%` : '—'),
        kv('Flight time', `${fx(m.duration, 0)} min`), kv('Distance', `${fx(m.distance, 1)} km`)),
      m.errors.length ? h('p', { class: 'note bad' }, m.errors.join(' · ')) : null,
      h('div', { style: { marginTop: '10px' } }, link));
  }
  function wingPane(out) {
    const g = out.geometry, ae = out.aero, st = out.stability;
    if (!g || !ae || !st) return h('div', { class: 'level-pane' }, h('div', { class: 'placeholder' }, 'Aero is not computed (see the coupling graph).'));
    const strips = ae.spanLoad(st.CLtrim), stripsMax = ae.spanLoad(ae.CLmax);
    const sec = out.sections || g, clmax = Math.min(sec.root.clmax, sec.tip.clmax);
    const cl = chart({ w: 900, h: 250, x: [0, 1], y: [0, Math.max(clmax, ...stripsMax.map(p => p.cl)) * 1.1], xLabel: 'Span station η = 2y/b', yLabel: 'Local cℓ', label: 'Local lift coefficient along the span',
      series: [{ pts: strips.map(p => [p.eta, p.cl]), cls: 's-accent' }, { pts: stripsMax.map(p => [p.eta, p.cl]), cls: 's-hl' }, { pts: [[0, clmax], [1, clmax]], cls: 's-warn' }],
      legend: [{ label: `Cruise trim, CL ${fx(st.CLtrim, 2)}`, cls: 's-accent' }, { label: `At CL,max ${fx(ae.CLmax, 2)}`, cls: 's-hl' }, { label: `Section cℓ,max ${fx(clmax, 2)}`, cls: 's-warn' }],
      marks: ae.stall?.firstStall ? [{ x: ae.stall.firstStall.eta, label: `Stall starts at η ${fx(ae.stall.firstStall.eta, 2)}`, cls: 's-hl', color: 'var(--hl)' }] : [] });
    const drag = ae.drag.map(d => kv(d.name, `${fx(d.CD * 1e4, 1)} counts`));
    return h('div', { class: 'level-pane' },
      h('h3', {}, `Wing · ${ae.method}${ae.stall ? ' + nonlinear stall strips' : ''}`),
      h('div', { class: 'note' }, `Local cℓ at cruise trim (blue, CL ${fx(st.CLtrim, 2)}) and scaled linearly to CL,max ${fx(ae.CLmax, 2)} (orange), against the section cℓ,max ${fx(clmax, 2)} (amber). Where orange crosses amber first is where a linear model expects the stall to start.`),
      plotCard('Local lift coefficient along the span', cl),
      h('div', { class: 'kv' },
        kv('Area S', `${fx(g.S, 3)} m²`), kv('Span b', `${fx(g.span, 2)} m`), kv('Aspect ratio', fx(g.AR, 2)), kv('MAC', `${fx(g.mac, 3)} m`),
        kv('CLα', `${fx(ae.CLa, 3)} /rad`), kv('αL0', `${minus(fx(ae.alphaL0, 2))}°`), kv('Span efficiency (inviscid)', fx(ae.eInv, 3)), kv('Oswald e', fx(ae.e, 3)),
        kv('Aerodynamic centre', `${fx(ae.xac * 100, 1)}% MAC`), kv('Cm,ac', minus(fx(ae.Cm0, 3))), kv('CL,max', `${fx(ae.CLmax, 3)} (${ae.clSource})`), kv('Reynolds (MAC)', `${fx(ae.Re / 1e6, 2)} M`)),
      h('h3', {}, `Zero-lift drag CD0 ${fx(ae.CD0, 4)} · component build-up`), h('div', { class: 'kv' }, drag));
  }
  const kv = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
  const plotCard = (title, el) => h('div', { class: 'plot-card' }, h('h4', {}, title), el);

  // ---------- right: coupling graph and fidelity ----------
  function paintGraph() {
    const sm = graphSummary(graph);
    graphHead.className = sm.cls; graphHead.textContent = sm.text;
    graphBox.replaceChildren(graphSvg(graph));
  }
  function paintFidelity() {
    const nd = graph.nodes.get('aero');
    const opt = (label, on, onclick, disabled, title) => h('button', { class: 'tg sm' + (on ? ' on' : ''), type: 'button', disabled, title, 'aria-pressed': on ? 'true' : 'false', onclick }, label);
    fidelity.replaceChildren(
      h('span', {}, 'Aero'), h('span', { class: 'opts' }, AERO_LEVELS.map(l => opt(l.label, nd.fidelity.value === l.id, () => { graph.setFidelity('aero', l.id); paintFidelity(); run(); }, false, l.note))),
      h('span', {}, 'Sections'), h('span', { class: 'opts' }, SECTION_LEVELS.map(l => opt(l.label, graph.nodes.get('sections').fidelity.value === l.id, () => { graph.setFidelity('sections', l.id); paintFidelity(); run(); }, false, l.note))),
      h('span', {}, 'Stability'), h('span', { class: 'opts' }, opt('linear (Nelson)', true)),
      h('span', {}, 'Performance'), h('span', { class: 'opts' }, opt('point mass', true)),
      h('span', {}, 'Structure'), h('span', { class: 'opts' }, opt('areal mass', true), opt('beam', false, null, true, 'later slice')));
    const sl = SECTION_LEVELS.find(l => l.id === graph.nodes.get('sections').fidelity.value);
    fidNote.textContent = AERO_LEVELS.find(l => l.id === nd.fidelity.value).note + '. Sections: ' + sl.note + '.';
  }

  // ---------- bottom: stats and requirements ----------
  function paintStats() {
    const o = outputs(), p = o.performance, st = o.stability, m = o.mass, ae = o.aero, rq = o.requirements, g = o.geometry;
    const status = metric => { const r = rq?.list.find(x => x.metric === metric && x.status !== 'met') || rq?.list.find(x => x.metric === metric); return r ? r.status : null; };
    const color = st => st === 'fail' ? 'var(--bad)' : st === 'marginal' ? 'var(--warn)' : null;
    const card = (label, value, unit, sub, metric) => h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label),
      h('span', { class: 'stat-v', style: { color: metric ? color(status(metric)) : null } }, value, unit ? h('small', {}, unit) : null), h('span', { class: 'stat-s' }, sub));
    stats.replaceChildren(
      card('Lift-to-drag, max', fx(p?.LDmax, 1), '', p ? `cruise ${fx(p.cruise.LD, 1)} at ${fx(p.cruise.V, 0)} m/s` : '—', 'performance.LDmax'),
      card('Endurance', fx(p?.endurance, 0), 'min', p ? `at ${fx(p.Vend, 1)} m/s · ${fx(p.Pend, 0)} W` : '—', 'performance.endurance'),
      card('Stall speed, 1 g', fx(p?.Vs, 1), 'm/s', ae ? `CL,max ${fx(ae.CLmax, 2)} · ${ae.clSource}` : '—', 'performance.Vs'),
      card('Static margin', st ? minus(fx(st.SM, 1)) : '—', '% MAC', st ? `NP ${fx(st.xnp, 3)} m · CG ${fx(m?.xcg, 3)} m` : '—', 'stability.SM'),
      card('Takeoff mass', fx(m?.total, 2), 'kg', m && g ? `W/S ${fx(m.total * 9.80665 / g.S, 0)} N/m²` : '—', 'mass.total'),
      card('Requirements met', rq ? `${rq.met} / ${rq.total}` : '—', '', rq ? `${rq.marginal} marginal · ${rq.failing} failing` : '—'));
  }
  function paintRequirements() {
    const rq = outputs().requirements;
    const label = { met: 'met', marginal: 'marginal', fail: 'failing' };
    reqs.replaceChildren(
      h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Requirements'), h('span', { class: 'muted', style: { fontSize: '12px' } }, rq ? `${rq.met} met · ${rq.marginal} marginal · ${rq.failing} failing · margin < 5% is marginal` : 'not computed')),
      h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' },
        h('thead', {}, h('tr', {}, ['ID', 'Requirement', 'Area', 'Target', 'Value', 'Margin', 'Status'].map(t => h('th', {}, t)))),
        h('tbody', {}, (rq ? rq.list : doc.requirements).map(r => {
          const tgt = h('input', { class: 'num', type: 'number', step: 'any', value: r.target, 'aria-label': `Target for ${r.id}` });
          tgt.addEventListener('change', () => { const v = +tgt.value; if (tgt.value === '' || !isFinite(v)) { tgt.classList.add('invalid'); return; } editRequirement(r.id, v); });
          return h('tr', {},
            h('td', { class: 'mono' }, r.id), h('td', { style: { color: 'var(--text)' } }, r.title), h('td', {}, r.group || ''),
            h('td', {}, h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, h('span', { class: 'mono' }, r.op === '>=' ? '≥' : '≤'), tgt, h('span', { class: 'unit' }, r.unit))),
            h('td', { class: 'num-c' }, fsig(r.value, 4)), h('td', { class: 'num-c' }, pct(r.margin)),
            h('td', {}, r.status ? h('span', { class: 'status ' + r.status }, label[r.status]) : ''));
        })))));
  }

  function paintRev() { revPill.replaceChildren('rev ', h('b', {}, String(doc.revision)), ` · ${doc.branch} · ${isModified(doc.id) ? 'saved locally ' + ago(doc.updated) : 'seed'}`); }

  function outputs() { const o = {}; for (const id of graph.order) o[id] = graph.outputs(id); return o; }
  function paintOutputs() { lab.update(outputs()); paintTree(); paintDerived(); if (ui.sel === 'mass') paintMassPanel(); paintTrimNote(); paintCanvas(); paintStats(); paintRequirements(); }

  paintRev(); paintTree(); paintEditor(); paintCondition(); paintCrumbs(); paintFidelity(); paintGraph();
  run();
  window.__works = { doc, graph, edit };     // handy for the console and the browser checks
}
