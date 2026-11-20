// The part libraries (#/library/<tab>?v=<vehicle>): airfoils, motors, battery cells and wing construction, each
// with its numbers and a button to apply it to a vehicle. Applying is an ordinary edit, so linked sizing follows
// (better cells on a linked pack make it lighter) and the requirement history records it.
import { h, s, icon, brand, themeButton, fx, toast } from './dom.js';
import { AIRFOILS, MOTORS, CELLS, MATERIALS, TARGETS, applyEntry } from '../model/libraries.js';
import { allVehicles, saveVehicle, loadVehicle } from '../model/store.js';
import { VEHICLE_CLASSES, applyEdit, firstOf, getPath } from '../model/vehicle.js';
import { noteEdit, describeEdit } from '../model/history.js';
import { sectionOf } from '../adapters/aircraft.js';
import { nacaPanels } from '../../core/solvers/airfoilTheory.js';

const TABS = [
  { id: 'airfoils', label: 'Airfoils', kind: 'airfoil', list: AIRFOILS, intro: 'NACA 4-digit sections. The numbers are thin-airfoil theory and a handbook cℓ,max at Re ≈ 0.5–1 million; the airfoil lab runs the viscous solution at your own Reynolds number.' },
  { id: 'motors', label: 'Engines & motors', kind: 'motor', list: MOTORS, intro: 'Classes of electric motor, with their controllers. Applying one sets the motor\'s efficiency and specific power; with linked sizing its mass follows.' },
  { id: 'cells', label: 'Propellants & cells', kind: 'cell', list: CELLS, intro: 'Battery chemistries at pack level (cells, casing, wiring, management). Applying one keeps the pack\'s energy and series count; with linked sizing its mass follows the specific energy.' },
  { id: 'materials', label: 'Materials', kind: 'material', list: MATERIALS, intro: 'Wing construction as a structural areal mass (kg per m² of wing). Typical figures; areal mass grows with span, so pick one for your scale.' },
];

export function renderLibrary(root, tabId = 'airfoils', vehicleId = null) {
  const live = () => allVehicles().filter(v => VEHICLE_CLASSES[v.class]?.implemented);
  let tab = TABS.find(t => t.id === tabId) || TABS[0];
  let vid = vehicleId && live().some(v => v.id === vehicleId) ? vehicleId : live()[0]?.id;
  const bar = h('div', { class: 'pnl pnl-pad lib-head' }), list = h('div', { class: 'lib-list' });
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } }, h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'), h('span', { class: 'vtab on', 'aria-current': 'page' }, icon('airfoil'), 'Libraries')),
      h('span', { class: 'grow' }), themeButton('btn small')),
    h('div', { class: 'page-main' }, bar, list)));

  const vehicle = () => (vid ? loadVehicle(vid) : null);
  function paint() {
    const v = vehicle();
    bar.replaceChildren(
      h('div', { class: 'row', role: 'tablist', 'aria-label': 'Library', style: { gap: '6px' } }, TABS.map(t => h('button', { class: 'chip' + (t === tab ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': t === tab ? 'true' : 'false', onclick: () => { tab = t; history.replaceState(null, '', `#/library/${t.id}${vid ? '?v=' + vid : ''}`); paint(); } }, t.label, h('span', { class: 'count' }, t.list.length)))),
      h('div', { class: 'row', style: { gap: '10px', marginTop: '12px', alignItems: 'center' } },
        h('span', { class: 'sec' }, 'Apply to'),
        h('select', { class: 'txt tr-sel', style: { width: 'auto', minWidth: '220px' }, 'aria-label': 'Vehicle', onchange: e => { vid = e.target.value; history.replaceState(null, '', `#/library/${tab.id}?v=${vid}`); paint(); } },
          live().map(x => h('option', { value: x.id, selected: x.id === vid }, `${x.name} · ${VEHICLE_CLASSES[x.class].label}`))),
        v ? h('a', { href: '#/v/' + v.id }, `Open ${v.name} →`) : null),
      h('p', { class: 'note', style: { margin: '10px 0 0' } }, tab.intro));
    const has = v && firstOf(v, TARGETS[tab.kind].need);
    list.replaceChildren(...tab.list.map(e => card(e, v, has)));
  }

  function card(e, v, has) {
    const target = has ? firstOf(v, TARGETS[tab.kind].need) : null;
    const btn = (label, where, current) => h('button', { class: 'btn small' + (current ? '' : ' primary'), type: 'button', disabled: !has || current, title: !has ? `${v?.name || 'This vehicle'} has no ${TARGETS[tab.kind].label}` : current ? 'Already in use' : '', onclick: () => apply(e, where) }, current ? `${label} ✓` : label);
    let figure = null, rows = [], actions = [];
    if (tab.kind === 'airfoil') {
      const sec = sectionOf(e.code);
      figure = section(e.code);
      rows = [['Thickness', `${fx(sec.tc * 100, 0)}%`], ['Camber', `${fx(sec.camber * 100, 0)}%`], ['Zero-lift angle', `${fx(sec.alpha0, 2)}°`], ['cm,c/4', fx(sec.cm, 3)], ['cℓ,max (handbook)', fx(sec.clmax, 2)]];
      actions = [btn('Root', 'root', target?.rootAirfoil === e.code), btn('Tip', 'tip', target?.tipAirfoil === e.code), btn('Both', 'both', target?.rootAirfoil === e.code && target?.tipAirfoil === e.code)];
      return h('article', { class: 'pnl pnl-pad lib-card' }, h('div', { class: 'lib-title' }, h('b', {}, `NACA ${e.code}`), h('span', { class: 'muted' }, e.use)), figure, kvs(rows), h('p', { class: 'note' }, e.note), h('div', { class: 'row lib-actions' }, ...actions));
    }
    if (tab.kind === 'motor') { rows = [['Power range', e.range], ['Specific power', `${fx(e.specificPower, 0)} W/kg`], ['Motor + controller efficiency', fx(e.motorEff, 2)]]; actions = [btn('Apply to the motor', null, target && target.motorEff === e.motorEff && target.specificPower === e.specificPower)]; }
    if (tab.kind === 'cell') { rows = [['Specific energy (pack)', `${fx(e.specificEnergy, 0)} Wh/kg`], ['Usable fraction', fx(e.usable, 2)], ['Cell voltage', `${fx(e.cellVoltage, 2)} V`]]; actions = [btn('Apply to the battery', null, target && target.chemistry === e.chemistry && target.specificEnergy === e.specificEnergy)]; }
    if (tab.kind === 'material') { rows = [['Structural areal mass', `${fx(e.arealMass, 1)} kg/m²`], ['Scale', e.scale]]; actions = [btn('Apply to the wing', null, target && target.arealMass === e.arealMass)]; }
    const now = target ? currentLine(target) : null;
    return h('article', { class: 'pnl pnl-pad lib-card' }, h('div', { class: 'lib-title' }, h('b', {}, e.name)), kvs(rows), h('p', { class: 'note' }, e.note), now, h('div', { class: 'row lib-actions' }, ...actions));
  }
  const kvs = rows => h('dl', { class: 'lib-kv' }, rows.map(([k, x]) => h('div', {}, h('dt', {}, k), h('dd', {}, x))));
  function currentLine(c) {
    const t = tab.kind;
    const txt = t === 'motor' ? `Now: η ${fx(c.motorEff, 2)}, ${fx(c.specificPower, 0)} W/kg` : t === 'cell' ? `Now: ${c.chemistry}, ${fx(c.specificEnergy, 0)} Wh/kg, ${fx(c.voltage, 1)} V` : `Now: ${fx(c.arealMass, 1)} kg/m²`;
    return h('p', { class: 'note lib-now' }, txt);
  }
  function section(code) {
    const { X, Y } = nacaPanels(code, 100), w = 260, hgt = 70, k = 240, x0 = 10, y0 = hgt / 2;
    const svg = s('svg', { viewBox: `0 0 ${w} ${hgt}`, role: 'img', 'aria-label': `NACA ${code} section`, class: 'lib-sec' });
    svg.append(s('line', { x1: 4, x2: w - 4, y1: y0, y2: y0, class: 'grid-l' }), s('path', { d: 'M' + X.map((x, i) => `${(x0 + x * k).toFixed(1)},${(y0 - Y[i] * k).toFixed(1)}`).join(' L') + ' Z', class: 'pf-wing' }));
    return svg;
  }

  function apply(e, where) {
    const v = vehicle(); if (!v) return;
    try {
      const edits = applyEntry(v, tab.kind, e, where), changed = [];
      noteEdit(v.id, `Library: ${e.name || 'NACA ' + e.code} on the ${tab.kind === 'airfoil' ? `wing (${where === 'both' ? 'root and tip' : where})` : TARGETS[tab.kind].label}`);
      for (const [p, x] of edits) changed.push(...applyEdit(v, p, x));
      v.updated = new Date().toISOString();
      saveVehicle(v);
      const linked = [...new Set(changed)].filter(p => !edits.some(([q]) => q === p)).map(p => describeEdit(v, p, getPath(v, p)));
      toast(`${v.name}: applied ${e.name || 'NACA ' + e.code}.${linked.length ? ' Linked: ' + linked.join('; ') + '.' : ''}`);
      paint();
    } catch (err) { toast(err.message, true); }
  }

  paint();
}
