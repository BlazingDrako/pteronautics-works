// Trade studies: sweeps, maps and sensitivities through the fixed-wing graph on Kestrel.
import { CouplingGraph } from '../../src/engine/graph.js';
import { fixedWingNodes } from '../../src/analyses/fixedWing.js';
import { runStudy, runSensitivity, linspace, tradeVariables, defaultRange, feasibleRanges, contourZero, worstMargin, metricsFor } from '../../src/analyses/trade.js';
import { kestrel } from '../../src/model/seeds.js';
import { clone, setPath, toJSON } from '../../src/model/vehicle.js';

function direct(doc, fid = 'vlm') {
  const g = new CouplingGraph(fixedWingNodes()); g.setFidelity('aero', fid); g.runSync(doc);
  const o = {}; for (const id of g.order) o[id] = g.outputs(id);
  return o;
}

export async function tradeTests(log) {
  const ok = (name, cond, detail = '') => log('trade: ' + name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(7)}, expected ${(+ref).toPrecision(7)} (±${tol})`);
  const nodes = () => fixedWingNodes();

  // helpers
  const ls = linspace(2, 4, 5);
  ok('linspace hits both ends in n steps', ls.length === 5 && ls[0] === 2 && ls[4] === 4 && Math.abs(ls[2] - 3) < 1e-12, ls.join(', '));
  const doc = kestrel(), before = toJSON(doc);
  const vars = tradeVariables(doc), span = vars.find(v => v.path === 'wing.span');
  ok('the variables list every numeric part parameter and the flight condition', span && span.value === 3.2 && vars.some(v => v.path === 'battery.energy') && vars.some(v => v.path === 'mission.cruiseSpeed') && !vars.some(v => v.path === 'wing.rootAirfoil'), `${vars.length} variables`);
  const r = defaultRange(doc, span);
  ok('the default range brackets the design value', r.from < 3.2 && r.to > 3.2 && r.from >= span.min, `${r.from}…${r.to}`);
  ok('requirement metrics are among the study metrics', doc.requirements.every(q => metricsFor(doc).some(m => m.metric === q.metric)));

  // a sweep of span
  const xs = linspace(2.6, 3.8, 7);
  const sw = await runStudy({ doc, nodes: nodes(), axes: [{ path: 'wing.span', values: xs }] });
  ok('a sweep gives one sample per value', sw.samples.length === 7 && sw.samples.every((s, i) => s.at[0] === xs[i]));
  ok('the study leaves the vehicle untouched', toJSON(doc) === before);
  const ref = direct(doc);
  rel('the baseline sample equals a direct run of the design (endurance)', sw.baseline.outputs['performance.endurance'], ref.performance.endurance, 1e-12);
  const mid = clone(doc); setPath(mid, 'wing.span', xs[3]);
  rel('a sample equals a fresh run at that value (span 3.2 m, range)', sw.samples[3].outputs['performance.range'], direct(mid).performance.range, 1e-9);
  const hi = clone(doc); setPath(hi, 'wing.span', xs[6]);
  rel('…and at the far end, after reusing the graph (static margin)', sw.samples[6].outputs['stability.SM'], direct(hi).stability.SM, 1e-9);
  const m = sw.samples.map(s => s.outputs['mass.total']);
  ok('mass grows with span (wing mass follows its area)', m.every((v, i) => !i || v > m[i - 1]), m.map(v => v.toFixed(2)).join(' '));
  const vs = sw.samples.map(s => s.outputs['performance.Vs']);
  ok('stall speed falls as span (and area) grow', vs.every((v, i) => !i || v < vs[i - 1]), vs.map(v => v.toFixed(2)).join(' '));
  const r10 = sw.samples.map(s => s.reqs.find(q => q.id === 'R-10'));
  ok('the span limit R-10 (≤ 3.4 m) fails past 3.4 m only', r10.every((q, i) => (xs[i] > 3.4) === (q.status === 'fail')), r10.map(q => q.status).join(' '));
  ok('a sample is feasible exactly when no requirement fails', sw.samples.every(s => s.feasible === s.reqs.every(q => q.status !== 'fail')));

  // feasible ranges from margins
  const fr = feasibleRanges([0, 1, 2, 3, 4], [-1, 1, 1, -1, -1]);
  ok('feasible ranges interpolate where the margin crosses zero', fr.length === 1 && Math.abs(fr[0][0] - 0.5) < 1e-12 && Math.abs(fr[0][1] - 2.5) < 1e-12, JSON.stringify(fr));
  const fr2 = feasibleRanges([0, 1, 2], [1, 1, 1]);
  ok('…and run to the ends when the whole sweep passes', fr2.length === 1 && fr2[0][0] === 0 && fr2[0][1] === 2);
  ok('the worst margin of a sample is its smallest', worstMargin([{ margin: 0.3 }, { margin: -0.1 }, { margin: NaN }]) === -1 && worstMargin([{ margin: 0.3 }, { margin: 0.1 }]) === 0.1);

  // a map
  const ys = linspace(0.3, 0.42, 4);
  const mp = await runStudy({ doc, nodes: nodes(), axes: [{ path: 'wing.span', values: xs.slice(0, 5) }, { path: 'wing.rootChord', values: ys }] });
  ok('a map gives a sample per grid cell, the first axis fastest', mp.samples.length === 20 && mp.samples[1].idx.join() === '1,0' && mp.samples[5].idx.join() === '0,1');
  const c = clone(doc); setPath(c, 'wing.span', xs[2]); setPath(c, 'wing.rootChord', ys[3]);
  rel('a map cell equals a fresh run at both values', mp.samples[3 * 5 + 2].outputs['performance.endurance'], direct(c).performance.endurance, 1e-9);
  ok('two different variables are needed for a map', await runStudy({ doc, nodes: nodes(), axes: [{ path: 'wing.span', values: [3] }, { path: 'wing.span', values: [3] }] }).then(() => false, () => true));

  // linked edits: a fuselage length moves the tails, and the study unwinds that
  const fl = await runStudy({ doc, nodes: nodes(), axes: [{ path: 'fuselage.length', values: [1.5, 1.8] }, { path: 'htail.area', values: [0.14, 0.18] }] });
  const f2 = clone(doc); const { applyEdit } = await import('../../src/model/vehicle.js'); applyEdit(f2, 'fuselage.length', 1.8); setPath(f2, 'htail.area', 0.18);
  rel('a fuselage-length sample carries the tails with it, as an edit does (static margin)', fl.samples[3].outputs['stability.SM'], direct(f2).stability.SM, 1e-9);
  ok('…and the vehicle is still untouched', toJSON(doc) === before);

  // sensitivity: endurance is proportional to usable energy while the battery's mass is held
  const sn = await runSensitivity({ doc, nodes: nodes(), paths: ['battery.energy', 'wing.twist', 'payload.mass'], metric: 'performance.endurance', frac: 0.1 });
  const be = sn.rows.find(x => x.path === 'battery.energy');
  rel('+10% battery energy gives +10% endurance (mass held)', be.dHi / sn.y0, 0.1, 1e-9);
  rel('−10% gives −10%', -be.dLo / sn.y0, 0.1, 1e-9);
  ok('angles move by ±1°', sn.rows.find(x => x.path === 'wing.twist').step === 1);
  ok('rows are sorted by their largest swing', sn.rows.every((x, i, a) => !i || Math.max(Math.abs(a[i - 1].dLo), Math.abs(a[i - 1].dHi)) >= Math.max(Math.abs(x.dLo), Math.abs(x.dHi))), sn.rows.map(x => x.path).join(', '));
  const pm = sn.rows.find(x => x.path === 'payload.mass');
  ok('more payload, less endurance', pm.dHi < 0 && pm.dLo > 0);

  // cancelling
  const sig = { aborted: false };
  const p = runStudy({ doc, nodes: nodes(), axes: [{ path: 'mission.cruiseSpeed', values: linspace(14, 30, 400) }], signal: sig, yieldEvery: 0, onProgress: d => { if (d > 3) sig.aborted = true; } });
  ok('an aborted study stops and returns nothing', (await p) === null);

  // contours
  const gx = linspace(0, 1, 5), gy = linspace(0, 1, 4);
  const segs = contourZero(gx, gy, gy.map(() => gx.map(x => x - 0.55)));
  ok('the zero contour of x − 0.55 is the line x = 0.55', segs.length === 3 && segs.every(sg => sg.every(([x]) => Math.abs(x - 0.55) < 1e-12)), JSON.stringify(segs.slice(0, 1)));
  const circ = contourZero(linspace(-1, 1, 21), linspace(-1, 1, 21), linspace(-1, 1, 21).map(y => linspace(-1, 1, 21).map(x => 0.5 - Math.hypot(x, y))));
  ok('the zero contour of a cone is a circle of its radius', circ.length > 20 && circ.flat().every(([x, y]) => Math.abs(Math.hypot(x, y) - 0.5) < 0.02), `${circ.length} segments`);
  ok('cells with a missing corner are skipped', contourZero([0, 1], [0, 1], [[-1, NaN], [1, 1]]).length === 0);
}
