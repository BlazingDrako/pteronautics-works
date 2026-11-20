// Design optimisation on the coupled graph.
//
// The designer picks variables with bounds, an objective (an analysis output to maximise or minimise) and how the
// requirements constrain it. Each evaluation is a full coupled run (the trade-study evaluator: only the nodes an edit
// reaches rerun). The search works on the variables scaled to [0, 1]:
//
//   f(x) = −sense·(objective / |objective at the start|) + penalty·Σ shortfall²
//
// where a requirement's shortfall is how far its margin is below the limit (0 for "must pass", 0.05 for "must be
// met with margin"). Nelder–Mead finds the basin; if nothing feasible has turned up, a pattern search minimises the
// shortfall alone to find the constraints' edge; then a pattern search (coordinate steps, halving) polishes the result.
// The best design that meets the constraints is kept throughout, and every evaluation is recorded for the path.
import { makeEvaluator } from './trade.js';

// the penalty weight starts gentle for the exploration and is raised in stages while polishing, so the optimum is
// pushed onto the feasible side of a constraint; a last bisection then lands on the constraint's edge
const PENALTIES = [200, 2e3, 2e4, 2e5];

export async function optimize({ doc, nodes, fidelity = {}, vars, objective, sense = 1, constraints = 'pass', maxEvals = 220, signal, onProgress, yieldEvery = 25 }) {
  if (!vars.length) throw new Error('choose at least one variable');
  for (const v of vars) if (!(v.hi > v.lo)) throw new Error(`the bounds of ${v.path} are empty`);
  const ev = makeEvaluator({ doc, nodes, fidelity });
  const limit = constraints === 'margin' ? 0.05 : 0;
  const toValues = u => vars.map((v, i) => v.lo + (v.hi - v.lo) * Math.min(1, Math.max(0, u[i])));
  const history = [];
  let scale = null, best = null, t = Date.now(), evals = 0, pen = PENALTIES[0];
  let restore = false;     // feasibility phase: minimise the shortfall alone
  const valueOf = rec => (!isFinite(rec.obj) ? 1e6 : restore ? rec.shortfall : -sense * rec.obj / scale + pen * rec.shortfall);

  async function evaluate(u) {
    if (signal?.aborted) throw new Error('stopped');
    const x = toValues(u), s = await ev.at(vars.map((v, i) => [v.path, x[i]]));
    const obj = s.outputs[objective];
    if (scale === null) scale = Math.abs(obj) > 1e-12 ? Math.abs(obj) : 1;
    const shortfall = constraints === 'none' ? 0 : s.reqs.reduce((acc, r) => acc + Math.max(0, limit - (isFinite(r.margin) ? r.margin : -1)) ** 2, 0);
    const feasible = shortfall === 0 && isFinite(obj);
    const rec = { k: evals++, u: u.slice(), x, obj, shortfall, feasible, worst: Math.min(...s.reqs.map(r => (isFinite(r.margin) ? r.margin : -1)), Infinity), reqs: s.reqs, outputs: s.outputs };
    history.push(rec);
    if (feasible && (!best || sense * obj > sense * best.obj)) best = rec;
    if (Date.now() - t > yieldEvery) { onProgress?.(evals, maxEvals, best); await new Promise(r => setTimeout(r, 0)); t = Date.now(); }
    return rec;
  }
  const f = async u => valueOf(await evaluate(u));

  // start from the design, clamped into the bounds
  const u0 = vars.map(v => { const x = v.value ?? (v.lo + v.hi) / 2; return Math.min(1, Math.max(0, (x - v.lo) / (v.hi - v.lo))); });
  const start = { u: u0, value: await f(u0) };
  const startRec = history[0];
  // the start sets the objective's scale; value it again now that the scale is known
  start.value = valueOf(startRec);

  // Nelder–Mead
  const n = vars.length, budget = Math.round(maxEvals * 0.7);
  let simplex = [start];
  for (let i = 0; i < n; i++) { const u = u0.slice(); u[i] = u[i] + (u[i] > 0.5 ? -0.25 : 0.25); simplex.push({ u, value: await f(u) }); }
  const clampU = u => u.map(x => Math.min(1, Math.max(0, x)));
  while (evals < budget) {
    simplex.sort((a, b) => a.value - b.value);
    const spread = Math.max(...simplex.map(p => Math.max(...p.u.map((x, i) => Math.abs(x - simplex[0].u[i])))));
    if (spread < 1e-3) break;
    const c = new Array(n).fill(0); for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) c[i] += simplex[k].u[i] / n;
    const worst = simplex[n], along = a => clampU(c.map((ci, i) => ci + a * (worst.u[i] - ci)));
    const r = { u: along(-1) }; r.value = await f(r.u);
    if (r.value < simplex[0].value) {
      const e = { u: along(-2) }; e.value = await f(e.u);
      simplex[n] = e.value < r.value ? e : r;
    } else if (r.value < simplex[n - 1].value) simplex[n] = r;
    else {
      const k = { u: along(r.value < worst.value ? -0.5 : 0.5) }; k.value = await f(k.u);
      if (k.value < Math.min(worst.value, r.value)) simplex[n] = k;
      else for (let i = 1; i <= n; i++) { simplex[i] = { u: simplex[i].u.map((x, j) => simplex[0].u[j] + 0.5 * (x - simplex[0].u[j])) }; simplex[i].value = await f(simplex[i].u); }
    }
  }
  simplex.sort((a, b) => a.value - b.value);

  const search = async (cur, step, until) => {
    while (evals < until && step > 1e-4) {
      let moved = false;
      for (let i = 0; i < n && evals < until; i++) for (const d of [1, -1]) {
        const u = cur.u.slice(); u[i] = Math.min(1, Math.max(0, u[i] + d * step));
        if (u[i] === cur.u[i]) continue;
        const value = await f(u);
        if (value < cur.value - 1e-12) { cur = { u, value }; moved = true; break; }
      }
      if (!moved) step /= 2;
      if (restore && best) break;            // feasible: back to the objective
    }
    return cur;
  };
  let cur = simplex[0], step = 0.05;
  // nothing feasible yet: look for the nearest design that meets the constraints
  if (!best && constraints !== 'none') {
    restore = true; cur = { u: cur.u, value: await f(cur.u) };
    cur = await search(cur, 0.05, maxEvals * 0.85);
    restore = false; if (best) cur = { u: best.u, value: 0 };
  }
  // pattern search polish, raising the penalty in stages
  for (const p of PENALTIES) {
    pen = p; cur = { u: cur.u, value: await f(cur.u) }; step = Math.max(step, 0.01);
    const reserve = Math.round(maxEvals * 0.05 * (PENALTIES.length - PENALTIES.indexOf(p) - 1));
    cur = await search(cur, step, maxEvals - reserve);
  }
  // land on the constraint's edge: bisect between the best feasible design and the polished point if it is not
  const last = history.find(h => h.u.every((x, i) => x === cur.u[i]));
  if (best && last && !last.feasible) {
    let a = best.u, b = cur.u;
    for (let k = 0; k < 24 && evals < maxEvals + 30; k++) {
      const m = a.map((x, i) => (x + b[i]) / 2), r = await evaluate(m);
      if (r.feasible) a = m; else b = m;
    }
  }
  onProgress?.(evals, maxEvals, best);
  return { vars: vars.map(v => ({ ...v })), objective, sense, constraints, start: startRec, best, history, evals, converged: step <= 1e-4 };
}
