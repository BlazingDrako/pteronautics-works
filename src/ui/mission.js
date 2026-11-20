// The mission page (#/v/<id>/mission): the vehicle's flight as a list of segments on the left, and on the right
// what flying it takes: the altitude and battery energy through the flight, each segment's time, distance, power
// and energy, and what is left at landing. The profile runs through the same coupled graph as the workspace, so a
// change to the airframe there shows here, and a segment edited here reaches the requirements there.
import { h, icon, brand, themeButton, fx, toast } from './dom.js';
import { saveVehicle } from '../model/store.js';
import { SEGMENT_KINDS, makeSegment, newSegmentId } from '../model/segments.js';
import { CouplingGraph } from '../engine/graph.js';
import { fixedWingNodes } from '../analyses/fixedWing.js';
import { graphSummary } from './graphView.js';
import { chart, extent } from './charts.js';

const KIND_ORDER = ['climb', 'cruise', 'loiter', 'descent', 'reserve'];

export function renderMission(root, doc) {
  const graph = new CouplingGraph(fixedWingNodes());
  const segs = () => doc.mission.segments;
  let saveTimer = 0;

  const editor = h('div', { class: 'pnl pnl-pad ms-editor' });
  const status = h('span', { class: 'pill' });
  const out = h('div', { class: 'tr-out' });
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'),
        h('a', { class: 'vtab', href: '#/v/' + doc.id }, h('span', { class: 'dot' }), doc.name),
        h('span', { class: 'vtab on', 'aria-current': 'page' }, icon('mission'), 'Mission'),
        h('a', { class: 'vtab', href: `#/v/${doc.id}/trade` }, icon('bars'), 'Trade study')),
      h('span', { class: 'grow' }), status, themeButton('btn small')),
    h('div', { class: 'tr-main' }, h('aside', { class: 'col', 'aria-label': 'Mission segments' }, editor), h('section', { class: 'tr-results', 'aria-label': 'Mission results' }, out))));

  graph.on(ev => { const sm = graphSummary(graph); status.className = 'pill ' + sm.cls; status.textContent = 'Analyses ' + sm.text; if (ev.done) { out.classList.toggle('busy', !graph.isCurrent()); paintResults(); } });
  addEventListener('themechange', () => { if (out.isConnected) paintResults(); });

  function commit({ structure = false } = {}) {
    doc.updated = new Date().toISOString();
    graph.invalidate('mission.segments');
    if (structure) paintEditor();
    out.classList.add('busy');
    graph.run(doc);
    clearTimeout(saveTimer); saveTimer = setTimeout(() => saveVehicle(doc), 250);
  }

  // ---------- the segment list ----------
  function paintEditor() {
    const list = segs();
    editor.replaceChildren(
      h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Mission profile'), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${list.length} segments`)),
      h('p', { class: 'note', style: { margin: '0 0 12px' } }, 'The flight starts on the ground at 0 m (ISA). Each segment starts where the one before it ends.'),
      ...list.map((sg, i) => segCard(sg, i, list.length)),
      h('div', { class: 'sec', style: { margin: '14px 0 6px' } }, 'Add a segment'),
      h('div', { class: 'tr-chips' }, KIND_ORDER.map(k => h('button', { class: 'tg sm', type: 'button', title: SEGMENT_KINDS[k].note, onclick: () => add(k) }, '+ ' + SEGMENT_KINDS[k].label))));
  }
  function segCard(sg, i, n) {
    const K = SEGMENT_KINDS[sg.kind];
    const name = h('input', { class: 'txt ms-name', type: 'text', value: sg.name || '', placeholder: K.label, maxlength: 40, 'aria-label': `Name of segment ${i + 1}` });
    name.addEventListener('change', () => { sg.name = name.value.trim() || undefined; if (!sg.name) delete sg.name; commit(); });
    const btn = (label, title, fn, disabled) => h('button', { class: 'ms-btn', type: 'button', title, 'aria-label': title, disabled, onclick: fn }, label);
    return h('div', { class: 'ms-seg k-' + sg.kind },
      h('div', { class: 'ms-seg-head' },
        h('span', { class: 'ms-idx' }, String(i + 1)), h('span', { class: 'ms-kind' }, K.label), name,
        btn('↑', 'Move up', () => move(i, -1), i === 0), btn('↓', 'Move down', () => move(i, 1), i === n - 1), btn('×', 'Remove this segment', () => remove(i), n <= 1)),
      h('div', { class: 'ms-fields' }, K.params.map(p => {
        const inp = h('input', { class: 'num', type: 'number', min: p.min, max: p.max, step: p.step, value: sg[p.key], 'aria-label': `${p.label} (${p.unit}), segment ${i + 1}` });
        inp.addEventListener('change', () => {
          const v = +inp.value;
          if (inp.value === '' || !isFinite(v) || v < p.min || v > p.max) { inp.classList.add('invalid'); toast(`${p.label} must be between ${p.min} and ${p.max} ${p.unit}`, true); return; }
          inp.classList.remove('invalid'); sg[p.key] = v; commit();
        });
        return h('label', { class: 'tr-num' }, h('span', {}, `${p.label} (${p.unit})`), inp);
      })),
      h('div', { class: 'ms-note' }, K.note));
  }
  function add(kind) {
    const list = segs(), sg = makeSegment(kind, newSegmentId(list));
    if (kind === 'cruise' || kind === 'loiter') sg.speed = doc.mission.cruiseSpeed ?? sg.speed;
    // new flying segments go before a trailing reserve
    let at = list.length; while (kind !== 'reserve' && at > 0 && list[at - 1].kind === 'reserve') at--;
    list.splice(at, 0, sg);
    commit({ structure: true });
  }
  function move(i, d) { const list = segs(), [x] = list.splice(i, 1); list.splice(i + d, 0, x); commit({ structure: true }); }
  function remove(i) { segs().splice(i, 1); commit({ structure: true }); }

  // ---------- results ----------
  function paintResults() {
    const m = graph.outputs('mission'), st = graph.state.get('mission');
    if (!m) {
      out.replaceChildren(h('div', { class: 'placeholder' }, st.state === 'failed' ? `The mission could not be flown: ${st.error}` : 'Flying the mission…'));
      return;
    }
    const mass = graph.outputs('mass'), perf = graph.outputs('performance'), rq = graph.outputs('requirements');
    const req = rq?.list.find(r => r.metric === 'mission.margin');
    const flown = m.segments.filter(s => !s.reserve), tEnd = m.duration;
    const marks = flown.map((s, k) => ({ x: s.t0 / 60, label: s.name, cls: 's-muted', row: k % 3, color: 'var(--text-2)' }));

    // headline
    const ok = m.feasible, cls = !isFinite(m.margin) || m.margin < 0 ? 'bad' : req && req.status !== 'met' ? 'warn' : 'good';
    const head = h('div', { class: 'pnl pnl-pad tr-head' },
      h('h3', {}, isFinite(m.energy)
        ? [`Uses `, h('b', { class: 'mono' }, `${fx(m.energy, 0)} Wh`), ` of ${fx(m.usable, 0)} Wh usable · `, h('span', { class: cls }, m.margin >= 0 ? `${fx(m.margin, 1)}% left after the reserve` : `${fx(-m.margin, 1)}% short`)]
        : h('span', { class: 'bad' }, `${m.errors.length === 1 ? 'A segment' : m.errors.length + ' segments'} cannot be flown`)),
      h('p', { class: 'note' }, `${fx(tEnd, 0)} min and ${fx(m.distance, 1)} km in the air, ${fx(m.reserve, 0)} Wh held as reserve. `,
        mass ? `Flown at ${fx(mass.total, 2)} kg. ` : '', req ? `${req.id} (≥ ${req.target}%): ${req.status === 'fail' ? 'failing' : req.status}. ` : '',
        h('a', { href: '#/v/' + doc.id }, 'Change the airframe in the workspace'), ' — the mission follows it.'),
      m.errors.length ? h('ul', { class: 'ms-errors' }, m.errors.map(e => h('li', {}, e))) : null,
      energyBar(m));

    // altitude and energy through the flight
    const zs = m.track.map(p => p.z), left = m.track.map(p => m.usable - p.E);
    const alt = chart({ w: 900, h: 230, x: [0, Math.max(tEnd, 1)], y: [0, Math.max(...zs, 50) * 1.18], xLabel: 'Time (min)', yLabel: 'Altitude (m)', label: 'Altitude through the mission',
      series: [{ pts: m.track.map(p => [p.t / 60, p.z]), cls: 's-accent' }], marks });
    const yr = extent([...left, 0, m.reserve], 0.06); yr[0] = Math.min(yr[0], 0);
    const en = chart({ w: 900, h: 230, x: [0, Math.max(tEnd, 1)], y: yr, xLabel: 'Time (min)', yLabel: 'Usable energy left (Wh)', label: 'Battery energy left through the mission',
      series: [{ pts: m.track.map((p, k) => [p.t / 60, left[k]]), cls: 's-accent' }], marks,
      ybands: [{ y0: yr[0], y1: m.reserve, cls: 'band-bad' }], hlines: [{ y: m.reserve, label: `reserve ${fx(m.reserve, 0)} Wh`, cls: 's-target', color: 'var(--bad)' }, { y: 0, cls: 's-warn' }] });

    // per segment
    const T = (a, b) => b - a;
    const table = h('div', { class: 'mx-wrap' }, h('table', { class: 'rq ms-table' },
      h('thead', {}, h('tr', {}, ['#', 'Segment', 'Time', 'Distance', 'Altitude', 'Airspeed', 'Battery power', 'Energy', 'Left after'].map(t => h('th', {}, t)))),
      h('tbody', {}, (() => {
        let used = 0;
        return m.segments.map((s, k) => {
          used += s.E;
          const r = s.reserve;
          return h('tr', { class: s.error ? 'ms-bad' : '' },
            h('td', { class: 'mono' }, String(k + 1)),
            h('td', { style: { color: 'var(--text)' } }, h('span', { class: 'ms-dot k-' + s.kind }), s.name, s.error ? h('div', { class: 'ms-err' }, s.error) : null),
            h('td', { class: 'num-c' }, r ? 'held' : `${fx(T(s.t0, s.t1) / 60, 1)} min`),
            h('td', { class: 'num-c' }, r ? '—' : `${fx(s.x1 - s.x0, 1)} km`),
            h('td', { class: 'num-c' }, s.z0 === s.z1 ? `${fx(s.z0, 0)} m` : `${fx(s.z0, 0)} → ${fx(s.z1, 0)} m`),
            h('td', { class: 'num-c' }, isFinite(s.V) ? `${fx(s.V, 1)} m/s` : '—'),
            h('td', { class: 'num-c' }, isFinite(s.P) ? `${fx(s.P, 0)} W` : '—'),
            h('td', { class: 'num-c' }, `${fx(s.E, 0)} Wh`),
            h('td', { class: 'num-c' }, `${fx(m.usable - used, 0)} Wh`));
        });
      })())));

    const kv = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
    out.replaceChildren(head,
      h('div', { class: 'plot-card' }, h('h4', {}, 'Altitude', h('span', { class: 'sub' }, 'climbs at full power and the best-climb speed; descents glide at best L/D')), alt),
      h('div', { class: 'plot-card' }, h('h4', {}, 'Battery energy left', h('span', { class: 'sub' }, 'usable energy; the shaded band is the reserve')), en),
      h('div', { class: 'plot-card' }, h('h4', {}, 'Segments'), table),
      h('div', { class: 'kv' },
        kv('Flight time', `${fx(tEnd, 0)} min`), kv('Distance flown', `${fx(m.distance, 1)} km`), kv('Energy flown', `${fx(m.flown, 0)} Wh`), kv('Reserve', `${fx(m.reserve, 0)} Wh`),
        kv('Usable energy', `${fx(m.usable, 0)} Wh`), kv('Peak battery power', `${fx(m.maxPower, 0)} W`),
        perf ? kv('Best-endurance speed', `${fx(perf.Vend, 1)} m/s`) : null, perf ? kv('Stall speed, 1 g', `${fx(perf.Vs, 1)} m/s`) : null));
  }
  // the usable energy split by segment, with what is left
  function energyBar(m) {
    const segsE = m.segments.filter(s => s.E > 0), total = Math.max(m.usable, m.segments.reduce((a, s) => a + s.E, 0));
    const w = e => (100 * e / total).toFixed(2) + '%';
    const left = isFinite(m.left) ? Math.max(0, m.left) : 0;
    return h('div', { class: 'ms-bar-wrap' },
      h('div', { class: 'ms-bar', role: 'img', 'aria-label': 'Usable energy by segment: ' + segsE.map(s => `${s.name} ${fx(s.E, 0)} Wh`).join(', ') + `, ${fx(left, 0)} Wh left` },
        segsE.map(s => h('i', { class: 'k-' + s.kind, style: { width: w(s.E) }, title: `${s.name}: ${fx(s.E, 0)} Wh` })),
        left > 0 ? h('i', { class: 'ms-left', style: { width: w(left) }, title: `left: ${fx(left, 0)} Wh` }) : null),
      h('div', { class: 'ms-legend' }, KIND_ORDER.filter(k => segsE.some(s => s.kind === k)).map(k => h('span', {}, h('span', { class: 'ms-dot k-' + k }), SEGMENT_KINDS[k].label)), left > 0 ? h('span', {}, h('span', { class: 'ms-dot ms-left' }), 'left') : null));
  }

  paintEditor(); paintResults();
  graph.run(doc);
  window.__mission = { doc, graph };
}
