// Plug (aerospike) and expansion-deflection nozzles, planar (no DOM).
// Both expand the flow through a centered Prandtl–Meyer fan at a sharp corner: the cowl lip of a plug, the edge of
// the deflector of an E-D nozzle. The solid contour is designed by Angelino's method: the Mach line of Mach M leaves
// the corner at φ = ν_e − ν(M) + μ(M) from the axis, and continuity across it puts the wall at distance
// l = (A/A*)(M) / sin μ (planar, throat gap h* = 1). Off design, the fan stops (or continues) where p = p_b and the
// other side of the jet is a free, pressure-matched boundary: that is the altitude compensation.
// Coordinates: x along the axis (0 at the corner), y ≥ 0 (upper half; the nozzle is mirrored), lengths in h*.
import { isen, M_from_p, M_from_A, M_from_nu } from './gasdyn.js';

const { nu, mu, A_As, p0_p, T0_T, r0_r } = isen;
const pRatio = (M, g) => 1 / p0_p(M, g);

// type: 'plug' (full-length spike to the axis), 'aerospike' (truncated at a fraction `trunc` of that length),
// 'ed' (expansion-deflection, deflector edge at height Rd = rd·ε above the axis). eps: area ratio (exit / throat).
export function design({ type = 'aerospike', eps = 10, g = 1.4, trunc = 0.25, rd = 0.5, n = 80 }) {
  const Me = M_from_A(eps, g, true), nue = nu(Me, g), ed = type === 'ed';
  const cornerY = ed ? rd * eps : eps;           // plug: lip at y = ε so the exit (to the axis) has height ε
  const s = ed ? 1 : -1;                         // direction from the corner toward the wall: plug down (−y), E-D up (+y)
  const ray = M => nue - nu(M, g) + mu(M);       // angle of the Mach-M line from the +x axis, turned toward the wall
  const wallPt = M => { const l = A_As(M, g) / Math.sin(mu(M)), a = ray(M); return { x: l * Math.cos(a), y: cornerY + s * l * Math.sin(a), M }; };
  const pts = [];
  for (let i = 0; i <= n; i++) { const M = 1 + (Me - 1) * (1 - Math.cos(Math.PI * i / n)) / 2; pts.push(wallPt(Math.max(1.0000001, M))); }
  const tip = pts[pts.length - 1];               // plug: on the axis; E-D: the exit lip of the wall
  let wall = pts, xCut = tip.x, base = null;
  if (type === 'aerospike') {
    xCut = pts[0].x + trunc * (tip.x - pts[0].x);
    wall = pts.filter(p => p.x <= xCut);
    const k = pts.findIndex(p => p.x > xCut), a = pts[k - 1], b = pts[k], f = (xCut - a.x) / (b.x - a.x);
    const yb = a.y + f * (b.y - a.y), Mb = a.M + f * (b.M - a.M);
    wall.push({ x: xCut, y: yb, M: Mb });
    base = { x: xCut, y: yb, M: Mb };
  }
  // lookup table for the inverse of ray(M) (ray decreases with M): φ → M by interpolation instead of bisection
  const numax = 0.5 * Math.PI * (Math.sqrt((g + 1) / (g - 1)) - 1), NT = 600, Mt = new Float64Array(NT), Pt = new Float64Array(NT);
  let Mtop = Me * 1.5; while (nu(Mtop, g) < 0.985 * numax && Mtop < 1e4) Mtop *= 1.5;
  for (let i = 0; i < NT; i++) { const M = 1.0000001 * Math.exp(Math.log(Mtop) * (i / (NT - 1)) ** 1.6); Mt[i] = M; Pt[i] = ray(M); }
  const machOfRay = phi => {
    if (phi >= Pt[0]) return Mt[0];
    if (phi <= Pt[NT - 1]) return Mt[NT - 1];
    let lo = 0, hi = NT - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Pt[m] > phi) lo = m; else hi = m; }
    const f = (Pt[lo] - phi) / (Pt[lo] - Pt[hi]); return Mt[lo] + f * (Mt[hi] - Mt[lo]);
  };
  return { type, eps, g, Me, nue, pe: pRatio(Me, g), cornerY, s, ray, machOfRay, wallPt, pts, wall, tip, xCut, base, throat: pts[0],
    length: tip.x - pts[0].x, trunc: type === 'aerospike' ? trunc : 1 };
}

// Mach number at the end of the corner fan for back pressure pb/p0: below design it stops early (M_b < M_e), above it
// keeps expanding past M_e. Flow direction there δ (toward the wall side positive): δ = ν_e − ν(M_b).
export function operating(D, pb) {
  const g = D.g, Mb = pb >= pRatio(1.0001, g) ? 1.0001 : M_from_p(pb, g);
  const regime = Math.abs(Mb / D.Me - 1) < 0.003 ? 'design' : Mb < D.Me ? 'over' : 'under';
  return { pb, Mb, regime, deltaB: D.nue - nu(Mb, g), rayB: D.ray(Mb) };
}

// wall height of the solid contour at x (NaN where there is none)
export function wallY(D, x) {
  const w = D.wall;
  if (x < w[0].x || x > w[w.length - 1].x) return NaN;
  for (let i = 1; i < w.length; i++) if (x <= w[i].x) { const a = w[i - 1], b = w[i], f = (x - a.x) / ((b.x - a.x) || 1); return a.y + f * (b.y - a.y); }
  return NaN;
}

// Flow state at (x, y ≥ 0): { M, th, p, T, rho, p0, k } with k = 1 for gas, 2 for ambient; null inside solids.
// Only the corner fan and the uniform region past its last wave are modeled (no reflected waves or shear layers).
export const UPSTREAM = { upstream: true };
export function stateAt(D, O, x, y) {
  const g = D.g, ed = D.type === 'ed';
  const ambient = { M: 0, th: 0, p: O.pb, T: 1, rho: 1, p0: 1, k: 2 };
  const gas = (M, delta) => ({ M, th: (ed ? 1 : -1) * delta, p: pRatio(M, g), T: 1 / T0_T(M, g), rho: 1 / r0_r(M, g), p0: 1, k: 1 });
  // solids
  const yw = wallY(D, x);
  if (!ed && isFinite(yw) && y < yw) return null;            // inside the plug
  if (ed && isFinite(yw) && y > yw) return null;             // inside the E-D wall
  // truncated plug: recirculating base region behind the cut
  if (D.base && x > D.base.x) {
    const Lw = 1.4 * D.base.y + 0.15 * D.length, yb = D.base.y * Math.max(0, 1 - (x - D.base.x) / Lw);
    if (y < yb) return { M: 0.15, th: 0, p: Math.max(O.pb, 0.6 * D.pe), T: 0.95, rho: 1, p0: 1, k: 1, base: true };
  }
  if (x < D.throat.x) return UPSTREAM;                     // behind the throat: chamber or outside, decided by the caller
  // position relative to the corner, as an angle measured toward the wall side
  const dx = x, dy = ed ? y - D.cornerY : D.cornerY - y;
  if (dx < 0 && dy < 0) return UPSTREAM;                    // behind the corner, on its far side: still chamber, not jet
  const phi = Math.atan2(dy, dx);
  const phi1 = D.ray(1.0000001);
  if (phi > phi1) return UPSTREAM;                         // behind the throat line: the caller decides (chamber or outside)
  if (ed && x > D.tip.x && y > D.tip.y) return ambient;     // outside the E-D exit lip
  if (phi < O.deltaB) return ambient;                      // beyond the free jet boundary
  if (phi <= O.rayB) return gas(O.Mb, O.deltaB);           // uniform region after the last wave
  // inside the fan: the Mach number of this Mach line
  const M = Math.min(O.Mb, D.machOfRay(phi));
  return gas(M, D.nue - nu(M, g));
}

// Pressure and Mach number along the solid contour at back pressure pb (wall points whose Mach line lies beyond the
// end of the fan see the uniform region instead).
export function wallDistribution(D, O) {
  const x = [], p = [], M = [];
  for (const w of D.wall) { const m = Math.min(w.M, O.Mb); x.push(w.x); M.push(m); p.push(pRatio(m, D.g)); }
  return { x, p, M };
}

// Thrust coefficient CF = F/(p0·A*) per unit total throat area. Ideal compensation: when pb ≥ pe the jet ends at
// p = pb with all the momentum axial; below pe it behaves like a fixed nozzle of area ratio ε. A truncated spike
// loses a little to its base (≈ 1–2%).
export function cfMomentum(M, g) { return Math.sqrt(2 * g * g / (g - 1) * (2 / (g + 1)) ** ((g + 1) / (g - 1)) * (1 - pRatio(M, g) ** ((g - 1) / g))); }
export function thrustCoefficient(D, pb) {
  const g = D.g;
  let CF;
  if (pb >= D.pe) { const M = M_from_p(Math.min(pb, 0.5), g); CF = cfMomentum(Math.max(1, M), g); }
  else CF = cfMomentum(D.Me, g) + (D.pe - pb) * D.eps;
  if (D.type === 'aerospike') CF *= 1 - 0.02 * (1 - D.trunc);
  if (D.type === 'ed') CF *= 0.99;
  return CF;
}
// fixed (bell-like, uniform exit) nozzle of the same ε, for comparison, ignoring separation
export function cfFixed(eps, g, pb) { const Me = M_from_A(eps, g, true); return cfMomentum(Me, g) + (pRatio(Me, g) - pb) * eps; }
export { M_from_nu };
