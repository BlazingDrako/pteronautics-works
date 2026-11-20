// The optimiser: constrained optima it can be checked against, and that it never reports an infeasible best.
import { optimize } from '../../src/analyses/optimize.js';
import { analysisNodes } from '../../src/analyses/classes.js';
import { kestrel } from '../../src/model/seeds.js';
import { toJSON } from '../../src/model/vehicle.js';

export async function optimizeTests(log) {
  const ok = (name, cond, detail = '') => log('optimise: ' + name, !!cond, detail);
  const doc = kestrel(), before = toJSON(doc), nodes = analysisNodes(doc);
  // the largest span the transport requirement allows is its limit, 3.4 m (the other requirements must pass too)
  const r1 = await optimize({ doc, nodes, vars: [{ path: 'wing.span', lo: 2.8, hi: 3.8, value: 3.2 }], objective: 'geometry.span', sense: 1, constraints: 'none', maxEvals: 60 });
  ok('unconstrained, the optimum goes to the bound', Math.abs(r1.best.x[0] - 3.8) < 1e-3, r1.best.x[0].toFixed(4));
  const reqs = doc.requirements.filter(r => r.id === 'R-10');
  const d2 = { ...JSON.parse(before), requirements: reqs };
  const r2 = await optimize({ doc: d2, nodes, vars: [{ path: 'wing.span', lo: 2.8, hi: 3.8, value: 3.2 }], objective: 'geometry.span', sense: 1, maxEvals: 80 });
  ok('constrained by R-10 (span ≤ 3.4 m), the optimum is the limit', Math.abs(r2.best.x[0] - 3.4) < 2e-3 && r2.best.feasible, r2.best.x[0].toFixed(4));
  const r3 = await optimize({ doc: d2, nodes, vars: [{ path: 'wing.span', lo: 2.8, hi: 3.8, value: 3.2 }], objective: 'geometry.span', sense: 1, constraints: 'margin', maxEvals: 80 });
  ok('with a 5% margin required, it stops 5% short', Math.abs(r3.best.x[0] - 3.4 * 0.95) < 4e-3, r3.best.x[0].toFixed(4));
  const r4 = await optimize({ doc, nodes, vars: [{ path: 'wing.span', lo: 2.6, hi: 3.6, value: 3.2 }, { path: 'battery.energy', lo: 600, hi: 1300, value: 888 }], objective: 'performance.endurance', sense: 1, maxEvals: 120 });
  ok('Kestrel: more endurance than the design, with every requirement passing', r4.best && r4.best.obj > r4.start.obj && r4.best.reqs.every(q => q.status !== 'fail'), r4.best && `${r4.start.obj.toFixed(1)} → ${r4.best.obj.toFixed(1)} min`);
  ok('every recorded best is feasible and the best of the feasible', r4.history.filter(h => h.feasible).every(h => h.obj <= r4.best.obj + 1e-9));
  ok('the vehicle is untouched', toJSON(doc) === before);
  const r5 = await optimize({ doc, nodes, vars: [{ path: 'payload.mass', lo: 4, hi: 12, value: 4.5 }], objective: 'mass.total', sense: -1, constraints: 'none', maxEvals: 40 });
  ok('minimising goes the other way', Math.abs(r5.best.x[0] - 4) < 1e-3);
  ok('empty bounds are refused', await optimize({ doc, nodes, vars: [{ path: 'wing.span', lo: 3, hi: 3 }], objective: 'geometry.span' }).then(() => false, () => true));
}
