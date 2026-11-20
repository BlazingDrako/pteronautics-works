// Small-disturbance (linearized) compressible flow, no DOM: subsonic compressibility corrections (Prandtl–Glauert,
// Kármán–Tsien, Laitone), the critical pressure coefficient and critical Mach number, and a supersonic ramp in a
// duct by linear theory against the exact oblique-shock / Prandtl–Meyer wave system with wall reflections.
import { betaFromTheta, obliqueShock, expansion, thetaMax, bisect } from './gasdyn.js';

// ---------------- subsonic corrections ----------------
export const RULES = {
  pg: { label: 'Prandtl–Glauert', cp: (cp0, M) => cp0 / Math.sqrt(1 - M * M) },
  kt: { label: 'Kármán–Tsien', cp: (cp0, M) => { const b = Math.sqrt(1 - M * M); return cp0 / (b + M * M / (1 + b) * cp0 / 2); } },
  laitone: { label: 'Laitone', cp: (cp0, M, g = 1.4) => { const b = Math.sqrt(1 - M * M); return cp0 / (b + M * M * (1 + (g - 1) / 2 * M * M) / (2 * b) * cp0); } },
};
// Cp where the local flow is exactly sonic
export function cpStar(M, g = 1.4) { return 2 / (g * M * M) * (Math.pow((2 + (g - 1) * M * M) / (g + 1), g / (g - 1)) - 1); }
// critical Mach number for an incompressible minimum pressure coefficient cp0 (< 0) with one rule
export function criticalMach(cp0, rule = 'kt', g = 1.4) {
  if (!(cp0 < 0)) return NaN;
  const f = M => RULES[rule].cp(cp0, M, g) - cpStar(M, g);
  // f > 0 at low M (|Cp*| is huge). Step up in M to the first crossing; a corrected Cp that has blown up
  // (Kármán–Tsien and Laitone denominators can pass through zero for strong suction) has no critical Mach number.
  let a = 0.02;
  for (let M = 0.021; M < 0.9999; M += 0.001) {
    const c = RULES[rule].cp(cp0, M, g), fm = c - cpStar(M, g);
    if (!isFinite(c) || c > 0) return NaN;
    if (fm < 0) return bisect(f, a, M);
    a = M;
  }
  return NaN;
}
export const BODIES = [
  { id: 'cyl', label: 'Circular cylinder', cp0: -3, note: 'Potential flow over a cylinder has Cp = 1 − 4 sin²θ, so −3 at the top and bottom.' },
  { id: 'sphere', label: 'Sphere', cp0: -1.25, note: 'In 3-D the flow escapes round the sides, so the peak suction is only −5/4.' },
  { id: 'n0012', label: 'NACA 0012 at α = 0', cp0: -0.43, note: 'A typical 12% airfoil; the peak suction grows quickly with angle of attack, and the critical Mach number falls with it.' },
  { id: 'sc', label: 'Supercritical-style 10% airfoil', cp0: -0.3, note: 'A flatter, lower suction peak spread over the upper surface: a higher critical Mach number for the same lift.' },
  { id: 'custom', label: 'Your own Cp,min', cp0: -0.6, note: 'Use the incompressible minimum pressure coefficient from the Airfoil Lab (inviscid, Mach 0).' },
];

// ---------------- supersonic ramp in a duct ----------------
// A uniform supersonic stream (M1) in a duct of height H. The lower wall turns through θ at x = 0 (θ > 0 into the flow,
// a compression; θ < 0, an expansion) and stays straight; the upper wall is flat. The wave from the corner reflects
// back and forth between the walls. Returns the waves, the regions between them and the wall pressures, both exact and
// by linear theory (Cp = ±2θ/√(M²−1) per wave, waves along the free-stream Mach angle).
export function rampInDuct({ M1 = 2, theta = 0.1, H = 1, L = 8, g = 1.4 } = {}) {
  const regions = [{ M: M1, p: 1, dir: 0 }], waves = [], lowHits = [0], upHits = [];
  let x = 0, y = 0, onLower = true, M = M1, p = 1, dir = 0, stop = null;
  const turn = Math.abs(theta), comp = theta > 0;
  for (let k = 0; k < 40 && x < L; k++) {
    // the wave turns the flow by ±|θ|: from horizontal to the wall's angle (leaving the lower wall) or back
    let ang, Mn, pn;
    if (comp) {
      if (turn > thetaMax(M, g)) { stop = { x, reason: 'detached' }; break; }
      const b = betaFromTheta(M, turn, g), s = obliqueShock(M, b, g);
      ang = b; Mn = s.M2; pn = p * s.p2_p1;
    } else {
      const e = expansion(M, turn, g);
      ang = 0.5 * (e.mu1 + e.mu2); Mn = e.M2; pn = p * e.p2_p1;
    }
    // wave direction relative to horizontal: left-running (up) from the lower wall, right-running (down) from the upper
    const flowDir = dir, wdir = onLower ? flowDir + ang : -(ang - flowDir);
    // where it meets the other wall
    let x2, y2;
    if (onLower) { x2 = x + (H - y) / Math.tan(wdir); y2 = H; }
    else { const lw = Math.tan(theta); const t = (y - x * lw) / (lw - Math.tan(wdir)); x2 = x + t; y2 = y + t * Math.tan(wdir); } // lower wall y = x tan θ
    waves.push({ x0: x, y0: y, x1: x2, y1: y2, kind: comp ? 'shock' : 'fan', fan: comp ? null : expansion(M, turn, g) });
    dir = onLower ? theta : 0; M = Mn; p = pn;
    regions.push({ M, p, dir });
    x = x2; y = y2; onLower = !onLower;
    (onLower ? lowHits : upHits).push(x);
    if (comp && M <= 1) { stop = { x, reason: 'subsonic' }; break; }
  }
  // wall pressures: a region index steps up each time a wave reaches that wall
  const q = g * M1 * M1 / 2, cpOf = r => (regions[r].p - 1) / q;
  const wall = (hits, startRegion) => { const xs = [], cp = []; let r = startRegion; for (let k = 0; k < hits.length; k++) { const xa = hits[k], xb = k + 1 < hits.length ? hits[k + 1] : L; if (r >= regions.length) break; xs.push(xa, Math.min(xb, L)); cp.push(cpOf(r), cpOf(r)); r += 2; if (xb >= L) break; } return { x: xs, cp }; };
  const lower = wall(lowHits, 1), upper = wall(upHits, 2);
  // linear theory: every wave at the free-stream Mach angle, Cp jumps by 2θ/β at each
  const beta = Math.sqrt(M1 * M1 - 1), dx = H * beta, dcp = 2 * theta / beta;
  const lin = side => { const xs = [], cp = []; const first = side === 'lower' ? 0 : dx; let n = side === 'lower' ? 1 : 2; for (let xa = first; xa < L; xa += 2 * dx) { xs.push(xa, Math.min(xa + 2 * dx, L)); cp.push(n * dcp, n * dcp); n += 2; } return { x: xs, cp }; };
  return { regions, waves, lower, upper, linLower: lin('lower'), linUpper: lin('upper'), stop, beta, mu: Math.asin(1 / M1), linSpacing: dx };
}
