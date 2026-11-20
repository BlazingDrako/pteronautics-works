// The hangar: vehicle cards for every class, and the solver-coverage matrix.
import { h, icon, brand, themeButton, ago, fx, toast } from './dom.js';
import { VEHICLE_CLASSES, clone } from '../model/vehicle.js';
import { allVehicles, saveVehicle, pickVehicleFile, uniqueId, loadVehicle } from '../model/store.js';
import { kestrel } from '../model/seeds.js';
import { CouplingGraph } from '../engine/graph.js';
import { fixedWingNodes } from '../analyses/fixedWing.js';
import { sketch } from './sketches.js';

let filter = 'all';

// which vehicles open a workspace in this build
export const opensWorkspace = v => (VEHICLE_CLASSES[v.class]?.implemented) || v.preview;

function liveSummary(doc) {
  try {
    const g = new CouplingGraph(fixedWingNodes());
    g.runSync(doc);
    return g.outputs('requirements');
  } catch { return null; }
}

function reqBar(sum) {
  if (!sum) return h('div', { class: 'reqbar' }, h('span', { class: 'muted' }, 'Concept · analyses for this class come in a later slice'));
  const w = k => (100 * k / Math.max(1, sum.total)) + '%';
  return h('div', { class: 'reqbar', title: `${sum.met} met, ${sum.marginal} marginal, ${sum.failing} failing` },
    h('span', { class: 'bar' }, h('i', { style: { width: w(sum.met), background: 'var(--accent)' } }), h('i', { style: { width: w(sum.marginal), background: 'var(--warn)' } }), h('i', { style: { width: w(sum.failing), background: 'var(--bad)' } })),
    h('span', { class: 'mono' }, `${sum.met} / ${sum.total} req`));
}

function card(v) {
  const live = VEHICLE_CLASSES[v.class]?.implemented;
  const sum = live ? liveSummary(v) : null;
  const tags = v.tags || (v.class === 'fixed-wing' ? fixedWingTags(v) : []);
  const badge = v.badge || (v.class === 'fixed-wing' ? `b ${fx(v.components.find(c => c.type === 'wing')?.span, 1)} m` : VEHICLE_CLASSES[v.class]?.label);
  const body = [
    h('div', { class: 'stage' }, sketch(v), h('span', { class: 'tag' }, badge),
      h('span', { class: 'state' }, live ? h('span', { class: 'tag live' }, 'live analysis') : v.preview ? h('span', { class: 'tag accent' }, 'workspace preview') : h('span', { class: 'tag' }, 'concept'))),
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, h('b', {}, v.name), h('span', {}, v.role || VEHICLE_CLASSES[v.class]?.label)),
      h('div', { class: 'tags' }, tags.map(t => h('span', { class: 'tag' }, t))),
      reqBar(sum),
      h('div', { class: 'card-foot' }, `rev ${v.revision} · ${v.branch} · edited ${ago(v.updated)}`)),
  ];
  return opensWorkspace(v) ? h('a', { class: 'card', href: '#/v/' + v.id, 'aria-label': `Open ${v.name}` }, body) : h('div', { class: 'card' }, body);
}

function fixedWingTags(v) {
  const w = v.components.find(c => c.type === 'wing'), b = v.components.find(c => c.type === 'battery'), p = v.components.find(c => c.type === 'propulsor');
  return [w && `NACA ${w.rootAirfoil}`, b && `${b.chemistry ? b.chemistry.split(' ').pop() + ' ' : ''}${b.energy} Wh`, p && `${(p.power / 1000).toFixed(1)} kW`].filter(Boolean);
}

// The core solvers against the vehicle classes: ● drives the design, ○ coupled in, – not used. "live" = wired in this build.
const MATRIX = [
  ['Airfoil & sections · viscous panel', 'airfoil', [1, 1, 2, 0, 0, 1]],
  ['Wings · vortex lattice, lifting line', 'wing', [1, 2, 1, 2, 0, 1], [0]],
  ['Compressible · shocks, nozzles, Euler CFD', 'gasdyn', [0, 0, 1, 1, 0, 0]],
  ['Propellers & rotors · BEM, momentum', 'rotors', [2, 1, 0, 0, 0, 0]],
  ['Jet cycles, inlets & turbomachinery', 'cycles', [0, 0, 1, 0, 0, 0]],
  ['Rocket engines · equilibrium chemistry, feed', 'rocket', [0, 0, 0, 1, 2, 0]],
  ['Heat transfer · conduction, radiation', 'heat', [2, 2, 2, 1, 1, 0]],
  ['Structures · frames, FEA, buckling', 'structures', [2, 2, 2, 1, 2, 1]],
  ['Flight dynamics · performance, stability', 'flight', [1, 1, 1, 2, 0, 1], [0]],
  ['GNC · autopilot, navigation, Kalman', 'gnc', [2, 1, 2, 2, 2, 0]],
  ['Orbital mechanics · transfers, J2', 'orbits', [0, 0, 0, 1, 1, 0]],
  ['Standard atmosphere · ISA 1976', 'atmosphere', [2, 2, 2, 2, 0, 2], [0]],
];
const CLASS_ORDER = ['fixed-wing', 'rotorcraft', 'high-speed', 'launch-vehicle', 'spacecraft', 'sailplane'];

function matrix() {
  const dot = k => h('span', { class: ['d0', 'd1', 'd2'][k], 'aria-label': ['not used', 'drives the design', 'coupled in'][k] });
  return h('section', { class: 'card matrix-card', 'aria-label': 'Solver core coverage by vehicle class' },
    h('div', { class: 'matrix-head' },
      h('b', {}, 'One core, every vehicle class'),
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'The validated Atlas solvers, coupled differently for each class'),
      h('span', { class: 'grow' }),
      h('span', { class: 'legend' }, h('span', { class: 'd1' }), 'drives the design', h('span', { class: 'd2' }), 'coupled in', h('span', { class: 'd0' }), 'not used', h('span', { class: 'live-dot' }), 'wired in this build')),
    h('div', { class: 'mx-wrap' }, h('table', { class: 'mx' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Solver core'), CLASS_ORDER.map(c => h('th', {}, VEHICLE_CLASSES[c].label)))),
      h('tbody', {}, MATRIX.map(([name, , cells, live = []]) => h('tr', {}, h('td', {}, name), cells.map((k, i) => h('td', {}, dot(k), live.includes(i) ? h('span', { class: 'live-dot', title: 'wired in this build' }) : null))))))));
}

function sidebar() {
  // trade studies open on the most recently edited vehicle this build analyses
  const live = allVehicles().filter(v => VEHICLE_CLASSES[v.class]?.implemented).sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];
  const planned = (ic, label) => h('div', { class: 'nav-item planned', title: label + ' (coming in a later slice)' }, icon(ic), h('span', {}, label), h('span', { class: 'soon' }, 'soon'));
  return h('nav', { class: 'sidebar', 'aria-label': 'Works navigation' },
    brand(),
    h('a', { class: 'nav-item active', href: '#/' }, icon('hangar'), h('span', {}, 'Hangar')),
    live ? h('a', { class: 'nav-item', href: `#/v/${live.id}/mission`, title: `The mission profile of ${live.name}` }, icon('mission'), h('span', {}, 'Missions')) : planned('mission', 'Missions'),
    live ? h('a', { class: 'nav-item', href: `#/v/${live.id}/requirements`, title: `The requirements of ${live.name}` }, icon('list'), h('span', {}, 'Requirements')) : planned('list', 'Requirements'),
    live ? h('a', { class: 'nav-item', href: `#/v/${live.id}/trade`, title: `Trade studies on ${live.name}` }, icon('bars'), h('span', {}, 'Trade studies')) : planned('bars', 'Trade studies'),
    h('div', { class: 'nav-group' }, 'Libraries'),
    planned('airfoil', 'Airfoils'), planned('motor', 'Engines & motors'), planned('grid', 'Materials'), planned('cell', 'Propellants & cells'),
    h('div', { class: 'nav-group' }, 'Output'),
    live ? h('a', { class: 'nav-item', href: `#/v/${live.id}/report`, title: `The design report of ${live.name}` }, icon('doc'), h('span', {}, 'Reports')) : planned('doc', 'Reports'),
    h('div', { class: 'sidebar-foot' }, themeButton(), h('div', { class: 'sidebar-credit' }, 'Made by Andrew Aguiar · ', h('a', { href: 'https://blazingdrako.github.io/pteronautics/' }, 'Pteronautics'))));
}

async function importVehicle(rerender) {
  try {
    const doc = await pickVehicleFile();
    if (!VEHICLE_CLASSES[doc.class]?.implemented && !loadVehicle(doc.id)) toast(`Imported ${doc.name}. This build analyses fixed-wing vehicles only, so it opens as a concept.`);
    else toast(`Imported ${doc.name}`);
    saveVehicle(doc);
    if (VEHICLE_CLASSES[doc.class]?.implemented) location.hash = '#/v/' + doc.id; else rerender();
  } catch (e) { if (e.message !== 'No file chosen') toast(e.message, true); }
}

function newVehicle() {
  const name = prompt('Name of the new fixed-wing vehicle (starts as a copy of Kestrel):', 'Kestrel B');
  if (!name) return;
  const doc = clone(kestrel());
  Object.assign(doc, { id: uniqueId(name), name: name.trim(), revision: 1, branch: 'main', updated: new Date().toISOString(), role: 'Fixed-wing UAS' });
  saveVehicle(doc);
  location.hash = '#/v/' + doc.id;
}

export function renderHangar(root) {
  const draw = () => {
    const vs = allVehicles();
    const counts = Object.fromEntries(CLASS_ORDER.map(c => [c, vs.filter(v => v.class === c).length]));
    const shown = vs.filter(v => filter === 'all' || v.class === filter);
    const chip = (id, label, n) => h('button', { class: 'chip' + (filter === id ? ' on' : ''), type: 'button', 'aria-pressed': filter === id ? 'true' : 'false', onclick: () => { filter = id; draw(); } }, label, n !== undefined ? h('span', { class: 'count' }, n) : null);
    root.replaceChildren(h('div', { class: 'shell' }, sidebar(),
      h('main', { class: 'hangar' },
        h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '16px' } },
          h('div', {}, h('div', { class: 'eyebrow' }, 'Hangar · My workspace'), h('h1', { class: 'hero-title' }, `${words(vs.length)} vehicles. `, h('em', {}, 'One physics core.'))),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', onclick: () => importVehicle(draw) }, icon('upload'), 'Import vehicle'),
          h('button', { class: 'btn primary', type: 'button', onclick: newVehicle }, icon('plus'), 'New vehicle')),
        h('div', { class: 'row', role: 'group', 'aria-label': 'Vehicle class', style: { gap: '8px' } },
          chip('all', 'All classes', vs.length), CLASS_ORDER.map(c => chip(c, VEHICLE_CLASSES[c].label, counts[c]))),
        shown.length ? h('div', { class: 'cards' }, shown.map(card)) : h('div', { class: 'placeholder' }, 'No vehicles of this class yet.'),
        matrix())));
  };
  draw();
}

const words = n => (['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][n] || String(n));
