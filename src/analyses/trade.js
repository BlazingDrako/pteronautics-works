// Trade studies: run the coupled analysis graph over a range of design values.
//
//   sweep        one design variable over a range; every metric and requirement at each sample
//   map          two design variables over a grid; a metric as a field, each requirement's boundary as a contour
//   sensitivity  each of a set of variables nudged up and down from the design, one at a time
//
// The runner works on a copy of the vehicle and reuses one coupling graph, so each sample reruns only the nodes the
// edited path reaches (a battery-mass sample skips geometry and aero). Nothing here touches the DOM; the trade page
// draws the results.
import { CouplingGraph } from '../engine/graph.js';
import { COMPONENT_TYPES, applyEdit, clone, getPath, firstOf, MISSION_SETTINGS } from '../model/vehicle.js';
import { SEGMENT_KINDS } from '../model/segments.js';
import { analysisNodes, hasGraph } from './classes.js';
import { evaluateRequirements, readMetric } from './requirements.js';

// Outputs worth trading on, with how to show them; better: 1 more is better, −1 less is, 0 neither. Requirement metrics not listed here are added by metricsFor().
export const TRADE_METRICS = [
  { metric: 'mission.margin', label: 'Mission energy margin', unit: '% usable', d: 1, better: 1 },
  { metric: 'mission.energy', label: 'Mission energy', unit: 'Wh', d: 0, better: -1 },
  { metric: 'mission.duration', label: 'Mission time', unit: 'min', d: 0, better: 0 },
  { metric: 'performance.endurance', label: 'Endurance (best)', unit: 'min', d: 0, better: 1 },
  { metric: 'performance.range', label: 'Range (best)', unit: 'km', d: 0, better: 1 },
  { metric: 'performance.cruise.endurance', label: 'Endurance at cruise', unit: 'min', d: 0, better: 1 },
  { metric: 'performance.cruise.P', label: 'Cruise battery power', unit: 'W', d: 0, better: -1 },
  { metric: 'performance.Vs', label: 'Stall speed, 1 g', unit: 'm/s', d: 1, better: -1 },
  { metric: 'performance.RoC', label: 'Best rate of climb', unit: 'm/s', d: 2, better: 1 },
  { metric: 'performance.Vmax', label: 'Max level speed', unit: 'm/s', d: 1, better: 1 },
  { metric: 'performance.LDmax', label: 'Max lift-to-drag', unit: '', d: 1, better: 1 },
  { metric: 'glide.LDmax', label: 'Best glide ratio', unit: '', d: 1, better: 1 },
  { metric: 'glide.minSink', label: 'Minimum sink', unit: 'm/s', d: 3, better: -1 },
  { metric: 'glide.xcSpeed', label: 'Cross-country speed', unit: 'km/h', d: 1, better: 1 },
  { metric: 'glide.Vs', label: 'Stall speed, 1 g', unit: 'm/s', d: 1, better: -1 },
  { metric: 'glide.Vmd', label: 'Best-glide speed', unit: 'm/s', d: 1, better: 0 },
  { metric: 'glide.wingLoading', label: 'Wing loading', unit: 'kg/m²', d: 1, better: 0 },
  { metric: 'stability.SM', label: 'Static margin', unit: '% MAC', d: 1, better: 0 },
  { metric: 'stability.drZeta', label: 'Dutch roll damping ζ', unit: '', d: 3, better: 1 },
  { metric: 'stability.spZeta', label: 'Short period damping ζ', unit: '', d: 2, better: 0 },
  { metric: 'mass.total', label: 'Takeoff mass', unit: 'kg', d: 2, better: -1 },
  { metric: 'geometry.span', label: 'Wingspan', unit: 'm', d: 2, better: 0 },
  { metric: 'geometry.S', label: 'Wing area', unit: 'm²', d: 3, better: 0 },
  { metric: 'geometry.AR', label: 'Aspect ratio', unit: '', d: 2, better: 0 },
  { metric: 'aero.CD0', label: 'Zero-lift drag CD0', unit: '', d: 4, better: -1 },
  { metric: 'aero.CLmax', label: 'Wing CL,max', unit: '', d: 2, better: 1 },
  { metric: 'aero.e', label: 'Oswald e', unit: '', d: 3, better: 1 },
  { metric: 'requirements.met', label: 'Requirements met', unit: '', d: 0, better: 1 },
];

// The metrics a study of this vehicle can show: the list above plus any requirement metric it lacks
export function metricsFor(doc) {
  // only outputs of the nodes this vehicle's graph has
  let ids = null; try { if (hasGraph(doc)) ids = new Set(analysisNodes(doc).map(n => n.id)); } catch { }
  const out = TRADE_METRICS.filter(m => !ids || ids.has(m.metric.split('.')[0]));
  for (const r of doc.requirements || []) if (!out.some(m => m.metric === r.metric)) out.push({ metric: r.metric, label: r.title, unit: r.unit || '', d: 3, better: r.op === '>=' ? 1 : -1 });
  return out;
}
export const metricInfo = (doc, metric) => metricsFor(doc).find(m => m.metric === metric) || { metric, label: metric, unit: '', d: 3, better: 0 };

// Flight-condition variables (the workspace edits these in "Flight condition")
const MISSION_VARS = [
  { key: 'cruiseSpeed', label: 'Cruise speed', unit: 'm/s', min: 10, max: 45, step: 0.5 },
  { key: 'altitude', label: 'Altitude (ISA)', unit: 'm', min: 0, max: 6000, step: 10 },
  { key: 'dT', label: 'ISA deviation', unit: 'K', min: -40, max: 40, step: 1 },
];

// Every number the designer can set: each component's numeric parameters, then the flight condition.
//   { path, label, group, unit, value, min, max, step }
export function tradeVariables(doc) {
  const out = [];
  for (const c of doc.components) {
    const T = COMPONENT_TYPES[c.type]; if (!T) continue;
    for (const p of T.params) if (p.kind === 'number' && typeof c[p.key] === 'number')
      out.push({ path: `${c.id}.${p.key}`, label: p.label, group: c.name, unit: p.unit || '', value: c[p.key], min: p.min, max: p.max, step: p.step });
  }
  for (const m of MISSION_VARS) out.push({ path: 'mission.' + m.key, label: m.label, group: 'Flight condition', unit: m.unit, value: doc.mission?.[m.key] ?? 0, min: m.min, max: m.max, step: m.step });
  // the mission: its settings and each segment's values
  if (Array.isArray(doc.mission?.segments)) {
    for (const m of MISSION_SETTINGS) if (typeof doc.mission[m.key] === 'number') out.push({ path: 'mission.' + m.key, label: m.label, group: 'Mission', unit: m.unit, value: doc.mission[m.key], min: m.min, max: m.max, step: m.step });
    for (const sg of doc.mission.segments) for (const p of SEGMENT_KINDS[sg.kind]?.params || [])
      out.push({ path: `mission.segments.${sg.id}.${p.key}`, label: p.label, group: `Mission · ${sg.name || SEGMENT_KINDS[sg.kind].label}`, unit: p.unit, value: sg[p.key], min: p.min, max: p.max, step: p.step });
  }
  return out;
}
export const variableInfo = (doc, path) => tradeVariables(doc).find(v => v.path === path) || null;

// A default range around the design value: ±25% (or a fixed span for angles, positions and values near zero),
// clamped to the parameter's valid range
export function defaultRange(doc, v) {
  const L = firstOf(doc, 'fuselage')?.length || 2;
  let half = Math.abs(v.value) * 0.25;
  if (v.unit === '°' || v.unit === 'K') half = Math.max(half, 4);
  else if (/\.x$/.test(v.path)) half = 0.12 * L;
  else if (!(half > 0)) half = (v.max - v.min) / 10;
  const snap = x => Math.round(x / v.step) * v.step;
  let lo = Math.max(v.min, snap(v.value - half)), hi = Math.min(v.max, snap(v.value + half));
  if (!(hi > lo)) { lo = v.min; hi = v.max; }
  return { from: +lo.toPrecision(6), to: +hi.toPrecision(6) };
}

export function linspace(a, b, n) {
  n = Math.max(2, Math.round(n));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + (b - a) * i / (n - 1)));
}

// Runs one study. spec: {
//   doc, nodes (the analysis nodes, e.g. fixedWingNodes()), fidelity: { nodeId: level },
//   axes: [{ path, values }] (one axis: a sweep, two: a map; the first axis varies fastest),
//   onProgress(done, total), signal ({ aborted }), yieldEvery (ms between yields to the event loop),
// }
// Returns { axes, samples: [{ idx: [i] or [i, j], at: [values], outputs (flattened metrics), reqs, feasible, failed }],
//           baseline: the design's own sample, metrics: names recorded }
export async function runStudy(spec) {
  const { doc, nodes, fidelity = {}, axes, onProgress, signal, yieldEvery = 30 } = spec;
  if (!axes || !axes.length || axes.length > 2) throw new Error('a study takes one or two axes');
  for (const a of axes) if (getPath(doc, a.path) === undefined) throw new Error(`no design value "${a.path}"`);
  if (axes.length === 2 && axes[0].path === axes[1].path) throw new Error('the two axes must be different variables');
  const ev = makeEvaluator({ doc, nodes, fidelity });
  const total = axes.reduce((n, a) => n * a.values.length, 1);
  const samples = [];
  const baseline = await ev.at([]);
  let t = now(), done = 0;
  const [A, B] = axes;
  const jn = B ? B.values.length : 1;
  for (let j = 0; j < jn; j++) {
    for (let i = 0; i < A.values.length; i++) {
      if (signal?.aborted) return null;
      const edits = [[A.path, A.values[i]]]; if (B) edits.push([B.path, B.values[j]]);
      const smp = await ev.at(edits);
      samples.push({ idx: B ? [i, j] : [i], at: edits.map(e => e[1]), ...smp });
      done++;
      if (now() - t > yieldEvery) { onProgress?.(done, total); await tick(); t = now(); }
    }
  }
  onProgress?.(done, total);
  return { axes: axes.map(a => ({ path: a.path, values: a.values.slice() })), samples, baseline, total };
}

// One-at-a-time sensitivity: each variable set to value·(1 ± frac) (angles and positions by a fixed step), with
// everything else at the design. Returns rows sorted by the largest swing of `metric`, each with both ends' samples.
export async function runSensitivity({ doc, nodes, fidelity = {}, paths, metric, frac = 0.1, signal, onProgress }) {
  const ev = makeEvaluator({ doc, nodes, fidelity });
  const base = await ev.at([]), y0 = base.outputs[metric];
  const L = firstOf(doc, 'fuselage')?.length || 2, rows = [];
  for (const [k, path] of paths.entries()) {
    if (signal?.aborted) return null;
    const v = variableInfo(doc, path); if (!v) continue;
    const step = sensitivityStep(v, frac, L);
    const lo = Math.max(v.min, v.value - step), hi = Math.min(v.max, v.value + step);
    const down = await ev.at([[path, lo]]), up = await ev.at([[path, hi]]);
    rows.push({ path, v, lo, hi, step, down, up, dLo: down.outputs[metric] - y0, dHi: up.outputs[metric] - y0 });
    onProgress?.(k + 1, paths.length);
    if (k % 4 === 3) await tick();
  }
  const swing = r => Math.max(Math.abs(r.dLo), Math.abs(r.dHi));
  rows.sort((a, b) => (isFinite(swing(b)) ? swing(b) : -1) - (isFinite(swing(a)) ? swing(a) : -1));
  return { metric, base, y0, frac, rows };
}
export function sensitivityStep(v, frac, fuselageLength = 2) {
  if (v.unit === '°' || v.unit === 'K') return 1;                 // angles and temperature: ±1
  if (/\.x$/.test(v.path)) return 0.02 * fuselageLength;           // positions: ±2% of the fuselage
  const s = Math.abs(v.value) * frac;
  return s > 0 ? s : v.step;
}
// Variables a sensitivity study starts with: the ones that size a small electric aircraft
export const SENSITIVITY_DEFAULTS = ['wing.span', 'wing.rootChord', 'wing.taper', 'wing.twist', 'wing.x', 'wing.arealMass', 'htail.area', 'htail.x',
  'vtail.area', 'fuselage.length', 'battery.energy', 'battery.mass', 'propulsor.power', 'propulsor.propEff', 'propulsor.motorEff', 'payload.mass', 'mission.cruiseSpeed', 'mission.altitude'];

// An evaluator: a working copy of the vehicle and one graph. at(edits) sets those paths (others at the design),
// reruns what they reach, and returns the flattened metrics and the requirements.
function makeEvaluator({ doc, nodes, fidelity }) {
  const work = clone(doc), graph = new CouplingGraph(nodes);
  for (const [id, level] of Object.entries(fidelity)) if (level && graph.nodes.get(id)?.fidelity) graph.setFidelity(id, level);
  const asyncGraph = [...graph.nodes.values()].some(n => n.fidelity && n.fidelity.value === 'viscous');
  const metrics = metricsFor(doc).map(m => m.metric);
  let set = new Map();          // paths currently away from the design
  const put = (path, value) => { graph.invalidate(applyEdit(work, path, value)); };
  return {
    async at(edits) {
      const want = new Map(edits);
      // put back anything this sample does not set (in reverse so linked edits unwind cleanly)
      for (const [p] of [...set].reverse()) if (!want.has(p)) put(p, getPath(doc, p));
      // twice: a linked edit (a fuselage length moves the tails) can move a path set just before it
      for (let pass = 0; pass < 2; pass++) for (const [p, v] of want) if (getPath(work, p) !== v) put(p, v);
      set = want;
      if (asyncGraph) await graph.run(work, { yield: async () => {} }); else graph.runSync(work);
      const o = {}; for (const id of graph.order) o[id] = graph.outputs(id);
      const outputs = {}; for (const m of metrics) outputs[m] = readMetric(o, m);
      const reqs = evaluateRequirements(work.requirements || [], o).map(r => ({ id: r.id, value: r.value, margin: r.margin, status: r.status }));
      const failed = graph.order.filter(id => graph.state.get(id).state === 'failed').map(id => ({ id, error: graph.state.get(id).error }));
      return { outputs, reqs, feasible: reqs.every(r => r.status !== 'fail'), failed };
    },
  };
}

// The x ranges of a sweep where a test holds (e.g. every requirement met), as [[x0, x1]] in axis units. The ends
// of each range are placed where the margin crosses zero, by linear interpolation between samples.
export function feasibleRanges(xs, margins) {
  const out = []; let start = null;
  const cross = (i) => { const a = margins[i - 1], b = margins[i]; return xs[i - 1] + (xs[i] - xs[i - 1]) * (a / (a - b)); };
  for (let i = 0; i < xs.length; i++) {
    const ok = margins[i] >= 0;
    if (ok && start === null) start = i === 0 || !isFinite(margins[i - 1]) ? xs[i] : cross(i);
    if (!ok && start !== null) { out.push([start, isFinite(margins[i]) ? cross(i) : xs[i - 1]]); start = null; }
  }
  if (start !== null) out.push([start, xs[xs.length - 1]]);
  return out;
}

// The worst requirement margin at a sample (the one closest to failing); NaN values count as failing
export const worstMargin = reqs => reqs.reduce((m, r) => Math.min(m, isFinite(r.margin) ? r.margin : -1), Infinity);

// Marching squares: the zero contour of field[j][i] on the grid xs × ys, as line segments [[x0, y0], [x1, y1]].
// Cells with a non-finite corner are skipped. Saddles take the cell-centre value to choose their pairing.
export function contourZero(xs, ys, field) {
  const segs = [];
  for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
    const v = [field[j][i], field[j][i + 1], field[j + 1][i + 1], field[j + 1][i]];   // corners: bl, br, tr, tl
    if (!v.every(isFinite)) continue;
    const P = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]];
    const code = v.reduce((c, val, k) => c | ((val >= 0 ? 1 : 0) << k), 0);
    if (code === 0 || code === 15) continue;
    // the crossing on edge k (between corner k and k+1)
    const e = k => { const a = v[k], b = v[(k + 1) % 4], t = a / (a - b), p = P[k], q = P[(k + 1) % 4]; return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
    const edges = [0, 1, 2, 3].filter(k => (v[k] >= 0) !== (v[(k + 1) % 4] >= 0));
    if (edges.length === 2) segs.push([e(edges[0]), e(edges[1])]);
    else {            // saddle: four crossings
      const centre = (v[0] + v[1] + v[2] + v[3]) / 4, c0 = v[0] >= 0;
      if ((centre >= 0) === c0) segs.push([e(0), e(1)], [e(2), e(3)]);
      else segs.push([e(3), e(0)], [e(1), e(2)]);
    }
  }
  return segs;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tick = () => new Promise(r => setTimeout(r, 0));
