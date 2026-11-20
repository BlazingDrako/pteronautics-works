// The launcher workspace, as a preview: the layout of the approved design with illustrative numbers.
// Nothing here is computed yet; the launch-vehicle analysis graph (rocket engines, ascent, orbits) is a later slice.
import { h, s, icon, brand, themeButton } from './dom.js';

const LEVELS = ['Orbit', 'Ascent', 'Vehicle', 'S1 engine', 'Injector & chamber'];

export function renderLauncher(root, doc) {
  let level = 'Ascent';
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Zoom level' });
  const paintCrumbs = () => crumbs.replaceChildren(...LEVELS.flatMap((l, i) => [i ? h('span', { class: 'crumb-sep' }, '›') : null,
    h('button', { class: 'crumb' + (l === level ? ' on' : ''), type: 'button', onclick: () => { level = l; paintCrumbs(); } }, l)]).filter(Boolean));
  paintCrumbs();
  const tree = [['Payload & fairing', '⌀ 1.2 m'], ['Stage 2', '2.9 t'], ['  Tanks · Al-Li', ''], ['  Engine · vacuum', ''], ['Interstage', ''], ['Stage 1', '21.4 t'], ['  Tanks · CFRP', ''], ['  Engines · 9× GG', ''], ['Avionics & GNC', ''], ['Mass budget', '24.8 t']];
  const stat = (l, v, sub) => h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, l), h('span', { class: 'stat-v' }, v), h('span', { class: 'stat-s' }, sub));
  const nodes = [['Geometry', 'stack · tanks', 0, 0], ['Chemistry', 'equilibrium', 0, 1], ['Engines', 'cycle · cooling', 1, 0], ['Aero', 'drag · Max-Q', 1, 1], ['Structure', 'buckling', 2, 0], ['Trajectory', '3-DOF + guidance', 2, 1], ['Thermal', 'ascent heating', 3, 0], ['Orbit', 'insertion', 3, 1]];
  const graph = s('svg', { viewBox: '0 0 310 330', role: 'img', 'aria-label': 'Planned launch-vehicle coupling graph' });
  for (const [label, d, r, c] of nodes) {
    const x = 12 + c * 150, y = 8 + r * 80, g = s('g', { class: 'cg-node stale' });
    g.append(s('rect', { x, y, width: 136, height: 42, rx: 8 }), s('text', { x: x + 68, y: y + 17, class: 't', 'text-anchor': 'middle' }, label), s('text', { x: x + 68, y: y + 32, class: 'd', 'text-anchor': 'middle' }, d + ' · planned'));
    graph.append(g);
    if (r < 3) graph.append(s('path', { d: `M${x + 68},${y + 42} L${x + 68},${y + 80}`, class: 'cg-edge stale' }));
  }
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' }, brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', role: 'tablist', style: { gap: '4px' } }, h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'), h('a', { class: 'vtab', href: '#/v/kestrel' }, 'Kestrel'),
        h('button', { class: 'vtab on', type: 'button', role: 'tab', 'aria-selected': 'true' }, h('span', { class: 'dot' }), doc.name)),
      h('span', { class: 'grow' }), h('span', { class: 'pill' }, 'rev ', h('b', {}, String(doc.revision)), ` · ${doc.branch}`), themeButton('btn small')),
    h('div', { class: 'banner' }, h('b', {}, 'Preview. '), 'This is the launcher workspace layout with illustrative numbers. Launch-vehicle analyses (rocket engines, ascent trajectory, orbit insertion) are wired in a later slice; only the fixed-wing graph runs in this build.'),
    h('div', { class: 'ws-main' },
      h('aside', { class: 'col' },
        h('div', { class: 'pnl tree' }, h('div', { class: 'sec' }, `${doc.name} · stack`), tree.map(([l, v]) => h('div', { class: 'tree-item' }, l.trim(), h('span', { class: 'v' }, v)))),
        h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Ascent profile'), h('span', { style: { fontSize: '12px', color: 'var(--accent)' } }, '500 km SSO')),
          ...[['Pitch kick', '2.1°'], ['Kick time', '8.0 s'], ['Max-Q throttle', '72%'], ['Coast before SECO', '310 s']].map(([k, v]) => h('div', { class: 'derived' }, h('span', {}, k), h('span', { class: 'mono' }, v))),
          h('p', { class: 'note' }, 'Gravity turn, closed-loop upper-stage guidance. Targets inclination 97.4°.'))),
      h('section', { class: 'pnl view' }, h('div', { class: 'view-bar' }, crumbs), h('div', { class: 'canvas', style: { gridTemplateColumns: 'minmax(0,1fr)' } }, trajectory())),
      h('aside', { class: 'col right' }, h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Coupling'), h('span', { class: 'mono warn', style: { fontSize: '11px' } }, 'planned')), graph))),
    h('div', { class: 'stats' }, stat('Payload to 500 km SSO', '312 kg', 'target 300 kg'), stat('Liftoff thrust-to-weight', '1.38', '9 × 37.6 kN SL'), stat('Max-Q', '34.1 kPa', 'limit 35 kPa'),
      stat('S1 buckling margin', '1.31', 'knockdown 0.65'), stat('Δv budget', '9.42 km/s', 'gravity loss 1.32'), stat('Requirements met', '16 / 17', 'illustrative'))));
}

function trajectory() {
  const svg = s('svg', { viewBox: '0 0 1000 520', role: 'img', 'aria-label': 'Illustrative ascent trajectory with Max-Q, staging, fairing separation and orbit insertion' });
  svg.append(s('path', { d: 'M0,470 Q500,440 1000,470', class: 'pf-thin' }));
  svg.append(s('path', { d: 'M0,330 Q500,300 1000,330', class: 's-muted' }), s('text', { x: 16, y: 320, class: 'pf-lbl-s' }, '100 km'));
  svg.append(s('path', { d: 'M0,110 Q500,70 1000,110', class: 's-muted' }), s('text', { x: 16, y: 100, class: 'pf-lbl-s' }, '500 km SSO'));
  svg.append(s('path', { d: 'M120,462 C150,380 210,290 330,215 C460,140 640,98 900,90', class: 's-accent', style: 'stroke-width:2.4' }));
  const ev = [[170, 390, 'Max-Q · T+62 s'], [262, 270, 'MECO · stage sep · T+158 s'], [330, 215, 'fairing sep · 118 km'], [900, 90, 'SECO · orbit insertion']];
  for (const [x, y, t] of ev) svg.append(s('circle', { cx: x, cy: y, r: 5, class: 'pf-np' }), s('text', { x: x + 10, y: y + 4, class: 'pf-lbl' }, t));
  return svg;
}
