// The design report (#/v/<id>/report): the vehicle's current analyses as a document to print or save as PDF. It runs
// the same coupled graph as the workspace and lays out the summary, requirements, configuration and mass, aero,
// stability, performance and mission, and how they were computed. Always drawn on a light "paper" page.
import { h, icon, brand, fx, fsig, pct, minus, fW, fWh } from './dom.js';
import { CouplingGraph } from '../engine/graph.js';
import { analysisNodes } from '../analyses/classes.js';
import { COMPONENT_TYPES, VEHICLE_CLASSES } from '../model/vehicle.js';
import { AERO_LEVELS } from '../analyses/fixedWing.js';
import { history } from '../model/history.js';
import { vehicleView } from './planform.js';
import { chart } from './charts.js';

const LABEL = { met: 'met', marginal: 'marginal', fail: 'failing' };
const HQ = ['', 'level 1', 'level 2', 'level 3'];

export function renderReport(root, doc) {
  const graph = new CouplingGraph(analysisNodes(doc));
  const fid = { aero: 'vlm', sections: 'thin' };
  const page = h('article', { class: 'report', 'aria-label': `${doc.name} design report` }, h('p', { class: 'note' }, 'Running the analyses…'));
  const aeroSel = h('select', { class: 'txt', 'aria-label': 'Aero fidelity', onchange: e => { fid.aero = e.target.value; graph.setFidelity('aero', fid.aero); run(); } }, AERO_LEVELS.map(l => h('option', { value: l.id, selected: l.id === fid.aero }, l.label)));
  root.replaceChildren(h('div', { class: 'ws report-ws' },
    h('header', { class: 'topbar no-print' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'),
        h('a', { class: 'vtab', href: '#/v/' + doc.id }, h('span', { class: 'dot' }), doc.name),
        h('span', { class: 'vtab on', 'aria-current': 'page' }, icon('doc'), 'Report')),
      h('span', { class: 'grow' }),
      h('label', { class: 'row', style: { gap: '6px', fontSize: '12.5px', color: 'var(--text-2)' } }, 'Aero', aeroSel),
      h('button', { class: 'btn small primary', type: 'button', onclick: () => print(), title: 'Print, or choose "Save as PDF" in the print dialog' }, icon('download'), 'Print or save PDF')),
    h('div', { class: 'report-scroll' }, page)));

  async function run() { await graph.run(doc); paint(); }

  function paint() {
    const o = {}; for (const id of graph.order) o[id] = graph.outputs(id);
    const failed = graph.order.filter(id => graph.state.get(id).state === 'failed');
    const g = o.geometry, ae = o.aero, m = o.mass, st = o.stability, p = o.performance, ms = o.mission, rq = o.requirements, gl = o.glide;
    const date = new Date();
    // sections are numbered in the order they appear (a vehicle shows only the ones its graph has)
    let secN = 0;
    const sec = (_, title, ...body) => h('section', { class: 'rp-sec' }, h('h2', {}, h('span', { class: 'rp-n' }, String(++secN)), title), ...body);
    const kv = rows => h('dl', { class: 'rp-kv' }, rows.filter(Boolean).map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
    const table = (head, rows, cls = '') => h('div', { class: 'rp-tw' }, h('table', { class: 'rp-t ' + cls }, h('thead', {}, h('tr', {}, head.map(t => h('th', {}, t)))), h('tbody', {}, rows.map(r => h('tr', {}, r.map(c => h('td', {}, c)))))));
    const fig = (n, caption, el) => h('figure', { class: 'rp-fig' }, el, h('figcaption', {}, h('b', {}, `Figure ${n}. `), caption));

    // 1 summary
    const fails = rq ? rq.list.filter(r => r.status === 'fail') : [];
    const summary = [
      `${doc.name} is ${/^([aeiou]|8|11\b|18\b|80)/i.test(doc.role || '') ? 'an' : 'a'} ${(r => r.charAt(0).toLowerCase() + r.slice(1))(doc.role || VEHICLE_CLASSES[doc.class]?.label || 'vehicle')}`,
      m && g ? ` of ${fx(m.total, 2)} kg takeoff mass and ${fx(g.span, 2)} m span (aspect ratio ${fx(g.AR, 1)}).` : '.',
      gl ? ` It glides at ${fx(gl.LDmax, 1)} to 1 at ${fx(gl.Vmd * 3.6, 0)} km/h, sinks ${fx(gl.minSink, 2)} m/s at best, and averages ${fx(gl.xcSpeed, 0)} km/h across country in ${fx(gl.Wc, 1)} m/s thermals.` : '',
      p ? ` It stalls at ${fx(p.Vs, 1)} m/s, reaches a lift-to-drag ratio of ${fx(p.LDmax, 1)}, and flies for ${fx(p.endurance, 0)} min at its best-endurance speed.` : '',
      ms && isFinite(ms.margin) ? ` Its ${ms.segments.length}-segment mission takes ${fx(ms.duration, 0)} min and leaves ${fx(ms.margin, 1)}% of usable energy after the reserve.` : ms ? ' Its mission cannot be flown as planned.' : '',
      rq ? ` It meets ${rq.met} of ${rq.total} requirements${fails.length ? `; ${fails.map(r => r.id).join(', ')} ${fails.length === 1 ? 'fails' : 'fail'}` : ''}${rq.marginal ? `, ${rq.marginal} marginal` : ''}.` : '',
    ].join('');

    const parts = [];
    parts.push(h('header', { class: 'rp-title' },
      h('div', { class: 'rp-brand' }, brand({ compact: true }), h('span', {}, 'Design report')),
      h('h1', {}, doc.name), h('p', { class: 'rp-role' }, doc.role || VEHICLE_CLASSES[doc.class]?.label),
      kv([['Class', VEHICLE_CLASSES[doc.class]?.label], ['Revision', `${doc.revision} · ${doc.branch}`], ['Last edited', new Date(doc.updated).toLocaleString()], ['Generated', date.toLocaleString()]])));
    if (failed.length) parts.push(h('p', { class: 'rp-warn' }, `Not computed: ${failed.map(id => `${graph.nodes.get(id).label} (${graph.state.get(id).error})`).join('; ')}.`));

    parts.push(sec(1, 'Summary', h('p', {}, summary),
      kv([m && ['Takeoff mass', `${fx(m.total, 2)} kg`], g && ['Span · area', `${fx(g.span, 2)} m · ${fx(g.S, 3)} m²`], p && ['Stall speed (1 g)', `${fx(p.Vs, 1)} m/s`], p && ['Max L/D', fx(p.LDmax, 1)],
        gl && ['Best glide', `${fx(gl.LDmax, 1)} @ ${fx(gl.Vmd * 3.6, 0)} km/h`], gl && ['Minimum sink', `${fx(gl.minSink, 2)} m/s`], gl && ['Cross-country speed', `${fx(gl.xcSpeed, 0)} km/h`],
        p && ['Endurance (best)', `${fx(p.endurance, 0)} min @ ${fx(p.Vend, 1)} m/s`], p && ['Range (best)', `${fx(p.range, 0)} km @ ${fx(p.Vrange, 1)} m/s`], st && ['Static margin', `${minus(fx(st.SM, 1))}% MAC`],
        ms && ['Mission margin', isFinite(ms.margin) ? `${fx(ms.margin, 1)}% after reserve` : 'cannot be flown']]),
      g ? fig(1, `${doc.name} top view to scale, with the span load at cruise trim, the mean aerodynamic chord, the CG and the neutral point.`, (() => { try { return vehicleView(doc, o, { clmap: true, load: true, mac: true, cg: true, items: false }, { w: 760, h: 470 }).svg; } catch { return h('p', {}, 'Top view not available.'); } })()) : null));

    // 2 requirements
    if (rq) {
      const log = history(doc.id).slice(0, 6);
      parts.push(sec(2, 'Requirements', h('p', {}, `${rq.met} met, ${rq.marginal} marginal (margin under 5%), ${rq.failing} failing.`),
        table(['ID', 'Requirement', 'Target', 'Value', 'Margin', 'Status'], rq.list.map(r => [h('span', { class: 'mono' }, r.id), r.title, `${r.op === '>=' ? '≥' : '≤'} ${fsig(r.target, 4)} ${r.unit || ''}`, `${fsig(r.value, 4)}`, pct(r.margin), h('span', { class: 'rp-st ' + r.status }, LABEL[r.status])]), 'rp-req'),
        log.length ? h('div', {}, h('h3', {}, 'Recent changes'), h('ul', { class: 'rp-log' }, log.map(e => h('li', {}, `${e.id} went from ${LABEL[e.from]} to ${LABEL[e.to]} after: ${e.cause}.`)))) : null));
    }

    // 3 configuration and mass
    if (m) {
      const spec = c => (COMPONENT_TYPES[c.type]?.params || []).filter(q => q.kind !== 'text' && !['mass', 'x'].includes(q.key)).slice(0, 5).map(q => `${q.label.toLowerCase()} ${typeof c[q.key] === 'number' ? fsig(c[q.key], 4) : c[q.key]}${q.unit && typeof c[q.key] === 'number' ? ' ' + q.unit : ''}`).join(' · ');
      parts.push(sec(3, 'Configuration and mass',
        table(['Part', 'Type', 'Main values'], doc.components.map(c => [c.name, COMPONENT_TYPES[c.type]?.label || c.type, spec(c)]), 'rp-cfg'),
        table(['Item', 'Mass', 'Share', 'x (CG)'], [...m.items.slice().sort((a, b) => b.mass - a.mass).map(i => [i.name + (i.derived ? ' (from area)' : ''), `${fx(i.mass, 2)} kg`, `${fx(i.mass / m.total * 100, 1)}%`, `${fx(i.x, 3)} m`]),
          [h('b', {}, 'Total'), h('b', {}, `${fx(m.total, 2)} kg`), '100%', `${fx(m.xcg, 3)} m (${fx(m.h * 100, 1)}% MAC)`]], 'rp-num')));
    }

    // 4 aerodynamics
    if (ae && g && st) {
      const strips = ae.spanLoad(st.CLtrim), sec2 = o.sections || g, clmax = Math.min(sec2.root.clmax, sec2.tip.clmax);
      parts.push(sec(4, 'Aerodynamics', h('p', {}, `${ae.method}${ae.stall ? ' with the nonlinear stall strips' : ''}; sections by ${o.sections?.method || 'thin airfoil theory'}.`),
        kv([['Lift slope CLα', `${fx(ae.CLa, 3)} /rad`], ['Zero-lift angle', `${minus(fx(ae.alphaL0, 2))}°`], ['Span efficiency (inviscid)', fx(ae.eInv, 3)], ['Oswald e', fx(ae.e, 3)], ['CL,max', `${fx(ae.CLmax, 3)} (${ae.clSource})`], ['Zero-lift drag CD0', fx(ae.CD0, 4)], ['Reynolds (MAC)', `${fx(ae.Re / 1e6, 2)} million`], ['Aerodynamic centre', `${fx(ae.xac * 100, 1)}% MAC`]]),
        fig(2, `Local lift coefficient along the span at cruise trim (CL ${fx(st.CLtrim, 2)}), against the section cℓ,max ${fx(clmax, 2)}.`, chart({ w: 720, h: 230, x: [0, 1], y: [0, Math.max(clmax, ...strips.map(q => q.cl)) * 1.1], xLabel: 'Span station η = 2y/b', yLabel: 'Local cℓ', series: [{ pts: strips.map(q => [q.eta, q.cl]), cls: 's-accent' }], hlines: [{ y: clmax, label: 'section cℓ,max', cls: 's-target', color: 'var(--bad)' }] })),
        table(['Drag item', 'CD (counts)'], ae.drag.map(d => [d.name, fx(d.CD * 1e4, 1)]), 'rp-num')));
    }

    // 5 stability
    if (st) {
      const mode = (name, x, hq) => x ? [name, x.real ? '—' : `${fx(x.wn, 2)} rad/s`, x.real ? '—' : fx(x.zeta, 3), x.real ? (isFinite(x.t2) && x.t2 > 0 ? `doubles in ${fx(x.t2, 1)} s` : `time constant ${fx(Math.abs(x.tau), 2)} s`) : `period ${fx(x.period, 2)} s`, HQ[hq] || '—'] : [name, '—', '—', '—', '—'];
      parts.push(sec(5, 'Stability and handling', h('p', {}, `Linear small-disturbance analysis at cruise (Nelson), CG at ${fx(m?.h * 100, 1)}% MAC. Handling-quality levels are MIL-F-8785C, class I.`),
        kv([['Static margin', `${minus(fx(st.SM, 1))}% MAC`], ['Neutral point', `${fx(st.xnp, 3)} m (${fx(st.hn * 100, 1)}% MAC)`], ['Trim', `α ${minus(fx(st.trim.alpha, 1))}°, elevator ${minus(fx(st.trim.de, 1))}°`], ['Tail volumes', `V_H ${fx(st.VH, 3)} · V_V ${fx(st.VV, 4)}`]]),
        table(['Mode', 'Natural frequency', 'Damping ratio', 'Time', 'Handling'], [mode('Short period', st.sp, st.hq?.sp), mode('Phugoid', st.ph, st.hq?.ph), mode('Dutch roll', st.dr, st.hq?.dr), mode('Roll', st.roll, st.hq?.roll), mode('Spiral', st.spiral, st.hq?.spiral)], 'rp-num')));
    }

    // 6 performance
    if (p) {
      const xs = p.curve.map(c => c.V);
      parts.push(sec(6, 'Performance', h('p', {}, 'Point-mass performance at the flight condition, with the propeller efficiency rising with speed and the motor and controller losses.'),
        kv([['Stall (1 g)', `${fx(p.Vs, 1)} m/s`], ['Best endurance', `${fx(p.endurance, 0)} min @ ${fx(p.Vend, 1)} m/s`], ['Best range', `${fx(p.range, 0)} km @ ${fx(p.Vrange, 1)} m/s`], ['Best climb', `${fx(p.RoC, 2)} m/s @ ${fx(p.Vy, 1)} m/s`], ['Max level speed', `${fx(p.Vmax, 1)} m/s`], ['Cruise', `${fx(p.cruise.V, 1)} m/s · ${fW(p.cruise.P)} · L/D ${fx(p.cruise.LD, 1)}`]]),
        fig(3, 'Battery power and aerodynamic power required against airspeed, with the shaft power available.', chart({ w: 720, h: 250, x: [Math.min(...xs), Math.max(...xs)], y: [0, Math.max(...p.curve.map(c => c.Pav).filter(isFinite)) * 1.12], xLabel: 'True airspeed (m/s)', yLabel: 'Power (W)',
          series: [{ pts: p.curve.map(c => [c.V, c.Pel]), cls: 's-accent' }, { pts: p.curve.map(c => [c.V, c.Preq]), cls: 's-muted' }, { pts: p.curve.map(c => [c.V, c.Pav]), cls: 's-good' }],
          legend: [{ label: 'Battery power', cls: 's-accent' }, { label: 'Power required', cls: 's-muted' }, { label: 'Shaft power available', cls: 's-good' }],
          marks: [{ x: p.Vs, label: 'stall', cls: 's-warn' }, { x: p.Vend, label: 'best endurance', cls: 's-warn', row: 1 }, { x: p.cruise.V, label: 'cruise', cls: 's-hl', row: 2, color: 'var(--hl)' }] }))));
    }

    // hover (eVTOL)
    if (o.hover) {
      const hv = o.hover;
      parts.push(sec(5.5, 'Hover', h('p', {}, `Momentum theory on ${hv.n} lift rotors (${fx(hv.A, 1)} m² of disc), with a figure of merit for the profile and tip losses, at the field elevation.`),
        h('dl', { class: 'rp-kv' }, [['Battery power to hover', `${fx(hv.kW, 0)} kW`], ['Shaft power', `${fx(hv.P / 1000, 0)} kW`], ['Disk loading', `${fx(hv.diskLoadingKg, 1)} kg/m²`], ['Induced velocity', `${fx(hv.vh, 1)} m/s`], ['Power loading', `${fx(hv.powerLoading * 1000 / 9.80665, 1)} kg/kW`], ['Tip Mach', fx(hv.tipMach, 2)]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))))));
    }

    // 6 glide (sailplanes)
    if (gl) {
      const xs = gl.curve.map(c => c.V);
      parts.push(sec(6, 'Glide and cross-country', h('p', {}, `The drag polar at the flight weight and altitude${gl.flaps ? ', flattened by the camber flaps' : ''}, and MacCready\'s speed to fly between thermals. Skin friction is mixed laminar and turbulent from each part\'s laminar run.`),
        kv([['Best glide', `${fx(gl.LDmax, 1)} @ ${fx(gl.Vmd * 3.6, 0)} km/h`], ['Minimum sink', `${fx(gl.minSink, 2)} m/s @ ${fx(gl.Vms * 3.6, 0)} km/h`], ['Stall (1 g)', `${fx(gl.Vs * 3.6, 0)} km/h`], ['Wing loading', `${fx(gl.wingLoading, 1)} kg/m²`]]),
        fig(3, `Glide polar (sink rate against airspeed) with the MacCready tangent for ${fx(gl.Wc, 1)} m/s climbs.`, chart({ w: 720, h: 250, x: [0, Math.max(...xs)], y: [-Math.min(Math.max(...gl.curve.map(c => c.sink)), gl.minSink * 6), gl.Wc * 1.15], xLabel: 'Airspeed (m/s)', yLabel: 'Vertical speed (m/s)',
          series: [{ pts: gl.curve.map(c => [c.V, -c.sink]), cls: 's-accent' }, { pts: [[0, gl.Wc], [gl.xc.V, -gl.xc.sink]], cls: 's-hl' }, { pts: [[0, 0], [Math.max(...xs), 0]], cls: 's-muted' }] })),
        table(['Thermal climb', 'Speed to fly', 'Cross-country speed'], gl.mc.map(r => [`${fx(r.Wc, 1)} m/s`, `${fx(r.V * 3.6, 0)} km/h`, `${fx(r.Vxc * 3.6, 1)} km/h`]), 'rp-num')));
    }

    // 7 mission
    if (ms) {
      parts.push(sec(7, 'Mission', h('p', {}, isFinite(ms.energy) ? `The mission uses ${fx(ms.energy, 0)} of ${fWh(ms.usable)} usable, leaving ${fx(ms.margin, 1)}% after a ${fWh(ms.reserve)} reserve. The hotel load takes ${fWh(ms.hotelEnergy)} and ${fWh(ms.loss)} is lost in the pack's resistance.` : `The mission cannot be flown: ${ms.errors.join('; ')}.`),
        table(['#', 'Segment', 'Time', 'Distance', 'Height', 'Airspeed', 'Power', 'Energy'], ms.segments.map((s, k) => [String(k + 1), s.name + (s.error ? ` — ${s.error}` : ''), s.reserve ? 'held' : `${fx((s.t1 - s.t0) / 60, 1)} min`, s.reserve ? '—' : `${fx(s.x1 - s.x0, 1)} km`, s.z0 === s.z1 ? `${fx(s.z0, 0)} m` : `${fx(s.z0, 0)}→${fx(s.z1, 0)} m`, isFinite(s.V) ? `${fx(s.V, 1)} m/s` : '—', isFinite(s.P) ? `${fW(s.P)}` : '—', `${fWh(s.E)}`]), 'rp-num'),
        fig(4, 'Usable battery energy left through the mission; the dashed line is the reserve.', ((u, unit) => chart({ w: 720, h: 220, x: [0, Math.max(ms.duration, 1)], y: [Math.min(0, ...ms.track.map(q => (ms.usable - q.E) / u)), ms.usable / u * 1.05], xLabel: 'Time (min)', yLabel: `Energy left (${unit})`,
          series: [{ pts: ms.track.map(q => [q.t / 60, (ms.usable - q.E) / u]), cls: 's-accent' }], hlines: [{ y: ms.reserve / u, label: 'reserve', cls: 's-target', color: 'var(--bad)' }] }))(ms.usable >= 2e4 ? 1000 : 1, ms.usable >= 2e4 ? 'kWh' : 'Wh'))));
    }

    // 8 method
    const nodes = graph.order.map(id => { const nd = graph.nodes.get(id), s = graph.state.get(id); return [nd.label, nd.fidelity ? (nd.fidelity.levels.find(l => l.id === nd.fidelity.value)?.note || nd.fidelity.value) : (nd.detail || ''), s.state, s.ms != null ? `${s.ms < 1 ? '<1' : fx(s.ms, 0)} ms` : '—']; });
    parts.push(sec(8, 'How this was computed', h('p', {}, 'Pteronautics Works couples the analyses in a dependency graph; each node reruns only when something it reads changes. The solvers are a recorded snapshot of the Pteronautics Atlas core (core/SOURCE.md).'),
      table(['Analysis', 'Method', 'State', 'Time'], nodes, 'rp-cfg')));

    page.replaceChildren(...parts, h('footer', { class: 'rp-foot' }, `${doc.name} rev ${doc.revision} · Pteronautics Works · ${date.toLocaleDateString()}`));
  }

  run();
  window.__report = { doc, graph };
}
