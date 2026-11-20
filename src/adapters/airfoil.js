// Viscous section analysis on the core's mfoil port (core/solvers/mfoil/): single operating points and polar
// sweeps, packaged for the airfoil lab and the coupling graph. Pure functions of an AirfoilSession, so they run
// the same in the airfoil worker (src/workers/airfoil.worker.js) and directly in the tests.
import { AirfoilSession } from '../../core/solvers/mfoil/api.js';

export { AirfoilSession };
export const NPANEL = 140;

const geom = (code, npanel = NPANEL) => ({ kind: 'naca', code: String(code).padStart(4, '0'), npanel });

// One operating point. op: { code, mode: 'alpha' | 'cl', alpha, cl, Re, Ma, ncrit, viscous, npanel }
export function solvePoint(session, op) {
  const r = session.solve({
    geom: geom(op.code, op.npanel),
    oper: { mode: op.mode === 'cl' ? 'cl' : 'alpha', alpha: op.alpha ?? 0, cl: op.cl ?? 0.5, Re: op.Re, Ma: op.Ma || 0, viscous: op.viscous !== false },
    param: { ncrit: op.ncrit ?? 9 },
  });
  return r;
}

// A compact polar point from a full result
const pointOf = r => ({
  alpha: r.alpha, cl: r.coef.cl, cd: r.coef.cd, cm: r.coef.cm, cdf: r.coef.cdf, cdp: r.coef.cdp, conv: r.conv,
  xtrU: r.transition ? r.transition[1].x : null, xtrL: r.transition ? r.transition[0].x : null,
});

// Polar sweep in angle of attack. Marches up from a0 = 0 (warm starts make each point quick) until the lift has
// fallen past its peak, then from 0 down to `amin`. Unconverged points are kept but flagged and left out of the
// summary. onPoint(point, all) is called after each point.
export function sweepPolar(session, { code, Re, Ma = 0, ncrit = 9, amin = -4, amax = 18, step = 1, npanel = NPANEL, onPoint } = {}) {
  const pts = [];
  const at = alpha => {
    let r;
    try { r = solvePoint(session, { code, mode: 'alpha', alpha, Re, Ma, ncrit, npanel }); } catch (e) { r = null; }
    const p = r && r.ok ? pointOf(r) : { alpha, cl: NaN, cd: NaN, cm: NaN, conv: false };
    pts.push(p); onPoint && onPoint(p, pts);
    return p;
  };
  let peak = -Infinity, past = 0;
  for (let a = 0; a <= amax + 1e-9; a += step) {
    const p = at(a);
    if (!p.conv) { if (++past >= 3) break; continue; }
    if (p.cl > peak) { peak = p.cl; past = 0; } else if (p.cl < peak - 0.02 && ++past >= 2) break;
  }
  session.lastGoodVisc = false;                      // the next march starts cold, from zero lift
  for (let a = -step; a >= amin - 1e-9; a -= step) at(a);
  pts.sort((p, q) => p.alpha - q.alpha);
  return { code: String(code).padStart(4, '0'), Re, Ma, ncrit, points: pts, ...polarSummary(pts) };
}

// cl,max, cd,min, zero-lift angle, lift slope and best cl/cd from the converged points of a polar
export function polarSummary(pts) {
  const ok = pts.filter(p => p.conv && isFinite(p.cl) && isFinite(p.cd));
  if (ok.length < 3) return { clmax: NaN, alphaClmax: NaN, cdmin: NaN, clCdmin: NaN, alpha0: NaN, cla: NaN, LDmax: NaN, clLDmax: NaN };
  let top = ok[0], low = ok[0], best = ok[0];
  for (const p of ok) { if (p.cl > top.cl) top = p; if (p.cd < low.cd) low = p; if (p.cl / p.cd > best.cl / best.cd) best = p; }
  // zero lift and slope by least squares over the linear range (−2° … 6°)
  const lin = ok.filter(p => p.alpha >= -2 && p.alpha <= 6);
  let cla = NaN, alpha0 = NaN;
  if (lin.length >= 3) {
    const n = lin.length, sx = lin.reduce((s, p) => s + p.alpha, 0), sy = lin.reduce((s, p) => s + p.cl, 0);
    const sxx = lin.reduce((s, p) => s + p.alpha * p.alpha, 0), sxy = lin.reduce((s, p) => s + p.alpha * p.cl, 0);
    const k = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - k * sx) / n;
    cla = k * 180 / Math.PI; alpha0 = -b / k;
  }
  return { clmax: top.cl, alphaClmax: top.alpha, cdmin: low.cd, clCdmin: low.cl, alpha0, cla, LDmax: best.cl / best.cd, clLDmax: best.cl };
}

// Drag at a given cl, interpolated along the converged polar below the stall
export function cdAt(polar, cl) {
  const pts = polar.points.filter(p => p.conv && isFinite(p.cl) && p.alpha <= polar.alphaClmax);
  if (!pts.length) return NaN;
  if (cl <= pts[0].cl) return pts[0].cd;
  for (let i = 1; i < pts.length; i++) if (cl <= pts[i].cl) { const a = pts[i - 1], b = pts[i], u = (cl - a.cl) / (b.cl - a.cl); return a.cd + u * (b.cd - a.cd); }
  return pts[pts.length - 1].cd;
}

// Reynolds numbers in bins about 4% wide, so a sweep is reused while a slider moves a little
export const reBin = Re => Math.round(Math.exp(Math.round(Math.log(Re) / 0.04) * 0.04) / 100) * 100;
