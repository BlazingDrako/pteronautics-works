// Classical airfoil theory (no DOM): thin-airfoil theory on any camber line (Fourier coefficients, lift, moment,
// center of pressure, zero-lift angle, chordwise loading, and inverse design of a cubic camber line), the Joukowski
// transformation with the Kutta condition, the lumped-vortex (discrete vortex) model on the camber line, and the
// linear-strength vortex panel method on the surface (Kuethe & Chow).
import { C } from '../lib/expr.js';
import { luFactor, luSolve } from '../lib/linalg.js';

const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
export const thetaOf = x => Math.acos(1 - 2 * Math.min(1, Math.max(0, x)));

// ---------------- camber lines (chord 0 → 1) ----------------
// Each returns { z(x), dz(x), segs? } where segs (if present) lists piecewise-constant slopes [{x0, x1, s}] so the
// Fourier integrals can be done exactly.
export function camberNACA4(m, p) {
  if (!m || !p) return { z: () => 0, dz: () => 0, segs: [{ x0: 0, x1: 1, s: 0 }] };
  return {
    z: x => x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x),
    dz: x => x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) ** 2) * (p - x),
  };
}
// NACA 5-digit LPQXX with Q = 0 (standard camber): design cl = 0.15 L, max camber at 0.05 P
const FIVE = { 1: [0.0580, 361.4], 2: [0.1260, 51.64], 3: [0.2025, 15.957], 4: [0.2900, 6.643], 5: [0.3910, 3.230] };
export function camberNACA5(code) {
  const s = String(code), L = +s[0], P = +s[1];
  const [r, k1a] = FIVE[P] || FIVE[3], k1 = k1a * (0.15 * L) / 0.3;
  return {
    z: x => x < r ? k1 / 6 * (x ** 3 - 3 * r * x * x + r * r * (3 - r) * x) : k1 * r ** 3 / 6 * (1 - x),
    dz: x => x < r ? k1 / 6 * (3 * x * x - 6 * r * x + r * r * (3 - r)) : -k1 * r ** 3 / 6,
  };
}
export const camberParabolic = h => ({ z: x => 4 * h * x * (1 - x), dz: x => 4 * h * (1 - 2 * x) });
export const camberCubic = (k1, k2) => ({ z: x => x * (1 - x) * (k1 + k2 * x), dz: x => k1 * (1 - 2 * x) + k2 * (2 * x - 3 * x * x) });
// straight segments through points [[x, z], …] (sorted, from (0, 0) to (1, 0))
export function camberPiecewise(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0]);
  const segs = [];
  for (let k = 0; k < P.length - 1; k++) if (P[k + 1][0] > P[k][0]) segs.push({ x0: P[k][0], x1: P[k + 1][0], s: (P[k + 1][1] - P[k][1]) / (P[k + 1][0] - P[k][0]), z0: P[k][1] });
  const find = x => segs.find(q => x <= q.x1) || segs[segs.length - 1];
  return { z: x => { const q = find(x); return q.z0 + q.s * (x - q.x0); }, dz: x => find(x).s, segs };
}
// flat plate with a plain flap hinged at xh, deflected δ (positive down)
export function camberFlap(xh, delta) {
  const s = -Math.tan(delta);
  return { z: x => x < xh ? 0 : s * (x - xh), dz: x => x < xh ? 0 : s, segs: [{ x0: 0, x1: xh, s: 0 }, { x0: xh, x1: 1, s }] };
}

// ---------------- thin-airfoil theory ----------------
// Fourier coefficients of the vortex sheet γ(θ) = 2V∞[A0 (1 + cos θ)/sin θ + Σ An sin nθ], x = (1 − cos θ)/2.
export function thinAirfoil(camber, alpha, { nTerms = 10, n = 4000 } = {}) {
  const I = new Float64Array(nTerms + 1); // ∫ dz/dx cos nθ dθ, n = 0..nTerms
  let J = 0;                               // ∫ dz/dx (cos θ − 1) dθ
  if (camber.segs) {
    for (const q of camber.segs) {
      const a = thetaOf(q.x0), b = thetaOf(q.x1);
      I[0] += q.s * (b - a);
      for (let k = 1; k <= nTerms; k++) I[k] += q.s * (Math.sin(k * b) - Math.sin(k * a)) / k;
      J += q.s * ((Math.sin(b) - Math.sin(a)) - (b - a));
    }
  } else {
    const d = PI / n;
    for (let i = 0; i < n; i++) {
      const th = (i + 0.5) * d, s = camber.dz((1 - Math.cos(th)) / 2);
      for (let k = 0; k <= nTerms; k++) I[k] += s * Math.cos(k * th) * d;
      J += s * (Math.cos(th) - 1) * d;
    }
  }
  const A = [alpha - I[0] / PI];
  for (let k = 1; k <= nTerms; k++) A.push(2 / PI * I[k]);
  const cl = PI * (2 * A[0] + A[1]);
  const cmc4 = PI / 4 * (A[2] - A[1]);
  const cmLE = -(cl / 4 + PI / 4 * (A[1] - A[2]));
  const xcp = Math.abs(cl) > 1e-12 ? 0.25 * (1 + PI / cl * (A[1] - A[2])) : NaN;
  const alphaL0 = -J / PI;
  const clIdeal = PI * A[1];                // lift at the ideal angle (A0 = 0: smooth flow onto the leading edge)
  const alphaIdeal = I[0] / PI;
  return { A, cl, cmc4, cmLE, xcp, alphaL0, clIdeal, alphaIdeal, cla: TAU, margin: 0.25 - xcp };
}
// chordwise loading ΔCp = Cp,lower − Cp,upper = 4[A0 (1 + cos θ)/sin θ + Σ An sin nθ]
export function deltaCp(A, n = 200) {
  const x = [], d = [];
  for (let i = 1; i < n; i++) {
    const th = PI * i / n; let s = A[0] * (1 + Math.cos(th)) / Math.sin(th);
    for (let k = 1; k < A.length; k++) s += A[k] * Math.sin(k * th);
    x.push((1 - Math.cos(th)) / 2); d.push(4 * s);
  }
  return { x, d };
}
// Inverse design: the cubic camber line z = x(1 − x)(k1 + k2 x) that gives a lift cl at angle α and a moment cm about c/4
export function designCubic(clTarget, cmTarget, alpha) {
  const t1 = thinAirfoil(camberCubic(1, 0), 0, { nTerms: 3 }), t2 = thinAirfoil(camberCubic(0, 1), 0, { nTerms: 3 });
  // with α = 0: cl = a·k, cm = b·k (linear in k); at angle α add 2πα to cl
  const a1 = t1.cl, a2 = t2.cl, b1 = t1.cmc4, b2 = t2.cmc4, r1 = clTarget - TAU * alpha, r2 = cmTarget;
  const det = a1 * b2 - a2 * b1;
  const k1 = (r1 * b2 - a2 * r2) / det, k2 = (a1 * r2 - r1 * b1) / det;
  return { k1, k2, camber: camberCubic(k1, k2) };
}
export function nacaCamber(code) {
  const s = String(code);
  if (/^\d{4}$/.test(s)) return camberNACA4(+s[0] / 100, +s[1] / 10);
  if (/^[1-6][1-5]0\d\d$/.test(s)) return camberNACA5(s);
  return null;
}

// ---------------- NACA surface coordinates ----------------
export function nacaThickness(t, x) { return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4); }
// nodes from the trailing edge along the lower surface to the leading edge and back along the upper (clockwise)
export function nacaPanels(code, N = 80) {
  const s = String(code), t = +s.slice(-2) / 100, cam = nacaCamber(s) || camberNACA4(0, 0), m = Math.floor(N / 2);
  const X = [], Y = [];
  const pt = (x, up) => { const yt = nacaThickness(t, x), th = Math.atan(cam.dz(x)), yc = cam.z(x); return up ? [x - yt * Math.sin(th), yc + yt * Math.cos(th)] : [x + yt * Math.sin(th), yc - yt * Math.cos(th)]; };
  for (let i = 0; i <= m; i++) { const x = (1 + Math.cos(PI * i / m)) / 2; const p = pt(x, false); X.push(p[0]); Y.push(p[1]); }
  for (let i = 1; i <= m; i++) { const x = (1 - Math.cos(PI * i / m)) / 2; const p = pt(x, true); X.push(p[0]); Y.push(p[1]); }
  return { X, Y };
}
// a triangle (isosceles, thickness t) with its apex at mid-chord, as surface nodes, clockwise from the trailing edge
export function trianglePanels(t = 0.1, N = 40) {
  const X = [], Y = [], m = Math.floor(N / 2);
  for (let i = 0; i <= m; i++) { const x = 1 - i / m; X.push(x); Y.push(0); }
  for (let i = 1; i <= m; i++) { const x = i / m; X.push(x); Y.push(x <= 0.5 ? 2 * t * x : 2 * t * (1 - x)); }
  return { X, Y };
}

// ---------------- lumped-vortex model on the camber line ----------------
// N panels; a point vortex at each panel's quarter point and a collocation point at its three-quarter point (the
// "1/4–3/4 rule" that reproduces thin-airfoil lift exactly for a flat plate). Clockwise Γ positive.
export function lumpedVortex(camber, alpha, N = 8, { spacing = 'uniform' } = {}) {
  const xe = []; for (let k = 0; k <= N; k++) xe.push(spacing === 'cosine' ? (1 - Math.cos(PI * k / N)) / 2 : k / N);
  const xv = [], zv = [], xc = [], zc = [], nx = [], nz = [], dx = [];
  for (let k = 0; k < N; k++) {
    const a = xe[k], b = xe[k + 1], d = b - a;
    dx.push(d);
    const pv = a + 0.25 * d, pc = a + 0.75 * d;
    xv.push(pv); zv.push(camber.z(pv)); xc.push(pc); zc.push(camber.z(pc));
    const sl = (camber.z(b) - camber.z(a)) / d, L = Math.hypot(sl, 1); nx.push(-sl / L); nz.push(1 / L);
  }
  const M = new Float64Array(N * N), r = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const rx = xc[i] - xv[j], rz = zc[i] - zv[j], r2 = rx * rx + rz * rz;
      // clockwise vortex of unit strength: u = Γ rz /(2π r²), w = −Γ rx /(2π r²)
      M[i * N + j] = (rz * nx[i] - rx * nz[i]) / (TAU * r2);
    }
    r[i] = -(Math.cos(alpha) * nx[i] + Math.sin(alpha) * nz[i]);
  }
  const G = luSolve(luFactor(M, N), r, 1);
  const Gt = G.reduce((a, b) => a + b, 0);
  let mLE = 0; for (let j = 0; j < N; j++) mLE -= G[j] * xv[j]; // nose-up positive, per ρV∞², ×2 below
  const cl = 2 * Gt, cmLE = 2 * mLE, cmc4 = cmLE + cl / 4;
  return { G: Array.from(G), cl, cmc4, cmLE, xv, zv, xc, zc, dx, M: Array.from(M), N, dcp: Array.from(G).map((g, j) => 2 * g / dx[j]) };
}

// ---------------- linear-strength vortex panels (Kuethe & Chow) ----------------
// X, Y: m + 1 nodes, clockwise from the trailing edge (lower surface first). Returns node strengths γ (per V∞),
// the influence matrices, surface Cp at the panel midpoints and the lift.
export function vortexPanels(X, Y, alpha) {
  const m = X.length - 1, x = [], y = [], S = [], th = [];
  for (let i = 0; i < m; i++) { x.push(0.5 * (X[i] + X[i + 1])); y.push(0.5 * (Y[i] + Y[i + 1])); S.push(Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i])); th.push(Math.atan2(Y[i + 1] - Y[i], X[i + 1] - X[i])); }
  const n = m + 1, AN = new Float64Array(n * n), AT = new Float64Array(m * n), RHS = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    let cn2p = 0, ct2p = 0; // CN2, CT2 of the previous panel j − 1
    for (let j = 0; j < m; j++) {
      let CN1, CN2, CT1, CT2;
      if (i === j) { CN1 = -1; CN2 = 1; CT1 = PI / 2; CT2 = PI / 2; }
      else {
        const dx = x[i] - X[j], dy = y[i] - Y[j];
        const A = -dx * Math.cos(th[j]) - dy * Math.sin(th[j]), B = dx * dx + dy * dy;
        const Cc = Math.sin(th[i] - th[j]), D = Math.cos(th[i] - th[j]);
        const E = dx * Math.sin(th[j]) - dy * Math.cos(th[j]);
        const F = Math.log(1 + S[j] * (S[j] + 2 * A) / B), Gg = Math.atan2(E * S[j], B + A * S[j]);
        const P = dx * Math.sin(th[i] - 2 * th[j]) + dy * Math.cos(th[i] - 2 * th[j]);
        const Q = dx * Math.cos(th[i] - 2 * th[j]) - dy * Math.sin(th[i] - 2 * th[j]);
        CN2 = D + 0.5 * Q * F / S[j] - (A * Cc + D * E) * Gg / S[j];
        CN1 = 0.5 * D * F + Cc * Gg - CN2;
        CT2 = Cc + 0.5 * P * F / S[j] + (A * D - Cc * E) * Gg / S[j];
        CT1 = 0.5 * Cc * F - D * Gg - CT2;
      }
      AN[i * n + j] += CN1; AT[i * n + j] += CT1;
      if (j > 0) { AN[i * n + j] += cn2p; AT[i * n + j] += ct2p; }
      cn2p = CN2; ct2p = CT2;
    }
    AN[i * n + m] += cn2p; AT[i * n + m] += ct2p;
    RHS[i] = Math.sin(th[i] - alpha);
  }
  AN[m * n + 0] = 1; AN[m * n + m] = 1; RHS[m] = 0; // Kutta condition: γ1 + γ(m+1) = 0
  const g = luSolve(luFactor(AN, n), RHS, 1);       // γ′ = γ/(2πV∞)
  const V = [], cp = [];
  for (let i = 0; i < m; i++) { let v = Math.cos(th[i] - alpha); for (let j = 0; j < n; j++) v += AT[i * n + j] * g[j]; V.push(v); cp.push(1 - v * v); }
  let Gam = 0; for (let j = 0; j < m; j++) Gam += PI * (g[j] + g[j + 1]) * S[j]; // ∫γ ds per V∞ (γ = 2πγ′)
  const chord = Math.max(...X) - Math.min(...X);
  // pressure moment about the quarter chord (nose-up +): from Cp acting on each panel
  let cm = 0, cn = 0, ca = 0;
  for (let i = 0; i < m; i++) {
    const nxp = -Math.sin(th[i]), nyp = Math.cos(th[i]); // outward normal of a clockwise contour (left of the tangent)
    const fx = -cp[i] * nxp * S[i], fy = -cp[i] * nyp * S[i];
    ca += fx; cn += fy; cm += -(x[i] - 0.25) * fy + y[i] * fx;
  }
  const clP = (cn * Math.cos(alpha) - ca * Math.sin(alpha)) / chord;
  return { gamma: Array.from(g, v => 2 * PI * v), x, y, S, th, V, cp, cl: 2 * Gam / chord, clPressure: clP, cmc4: cm / chord ** 2, AN: Array.from(AN), n, m };
}

// ---------------- Joukowski transformation ----------------
// z = ζ + 1/ζ maps a circle through ζ = 1 (center ζ0 = (mx, my), radius a = |1 − ζ0|) to an airfoil with its
// cusped trailing edge at z = 2. The Kutta condition fixes Γ = 4πV∞a sin(α + β), β = atan2(my, 1 − mx).
export function joukowski({ mx = -0.1, my = 0.1, alpha = 5 * DEG, U = 1, G = null } = {}) {
  const z0 = [mx, my], a = Math.hypot(1 - mx, my), beta = Math.atan2(my, 1 - mx);
  const Gcw = G === null ? 4 * PI * U * a * Math.sin(alpha + beta) : G; // clockwise; null: the Kutta value
  const ea = [Math.cos(alpha), Math.sin(alpha)], ema = [Math.cos(alpha), -Math.sin(alpha)];
  const F = zeta => { const d = C.sub(zeta, z0); const t = C.add(C.mul(ema, d), C.div([a * a * ea[0], a * a * ea[1]], d)); const L = C.log(d); return [U * t[0] - Gcw / TAU * L[1], U * t[1] + Gcw / TAU * L[0]]; };
  const Wz = zeta => { // dF/dζ
    const d = C.sub(zeta, z0), d2 = C.mul(d, d), q = C.div([a * a * ea[0], a * a * ea[1]], d2), v = C.div([0, Gcw / TAU], d);
    return [U * (ema[0] - q[0]) + v[0], U * (ema[1] - q[1]) + v[1]];
  };
  const map = zeta => C.add(zeta, C.div([1, 0], zeta));
  const dmap = zeta => C.sub([1, 0], C.div([1, 0], C.mul(zeta, zeta)));
  // velocity in the airfoil plane: W_z = W_ζ / (dz/dζ)
  const Wair = zeta => { const dd = dmap(zeta); if (Math.hypot(dd[0], dd[1]) < 1e-9) return [NaN, NaN]; return C.div(Wz(zeta), dd); };
  // inverse map: the root of ζ² − zζ + 1 = 0 that lies outside the circle
  const inv = z => {
    const s = C.sqrt(C.sub(C.mul(z, z), [4, 0])), r1 = [(z[0] + s[0]) / 2, (z[1] + s[1]) / 2], r2 = [(z[0] - s[0]) / 2, (z[1] - s[1]) / 2];
    return Math.hypot(r1[0] - mx, r1[1] - my) >= Math.hypot(r2[0] - mx, r2[1] - my) ? r1 : r2;
  };
  // the surface: θ from the trailing edge (ζ = 1) round the circle
  const n = 360, surf = [];
  const th0 = Math.atan2(-my, 1 - mx);
  for (let k = 0; k <= n; k++) {
    const t = th0 + TAU * k / n, zeta = [mx + a * Math.cos(t), my + a * Math.sin(t)], z = map(zeta);
    let w = Wair(zeta);
    if (!isFinite(w[0])) { const e = 1e-4; const z1 = [mx + a * Math.cos(t + e), my + a * Math.sin(t + e)], z2 = [mx + a * Math.cos(t - e), my + a * Math.sin(t - e)]; const w1 = Wair(z1), w2 = Wair(z2); w = [(w1[0] + w2[0]) / 2, (w1[1] + w2[1]) / 2]; }
    surf.push({ t, zeta, x: z[0], y: z[1], cp: 1 - (w[0] * w[0] + w[1] * w[1]) / (U * U) });
  }
  const xs = surf.map(p => p.x), xLE = Math.min(...xs), xTE = 2, chord = xTE - xLE;
  // thickness and camber (approximately, from the upper and lower curves)
  const ys = surf.map(p => p.y), tmax = (() => { let best = 0; for (const p of surf) { const q = surf.filter(o => Math.abs(o.x - p.x) < chord / 200 && o !== p); for (const o of q) best = Math.max(best, Math.abs(o.y - p.y)); } return best; })();
  const cl = 2 * Gcw / (U * chord);
  // moment about the quarter chord by pressure integration (nose-up +)
  let cm = 0, Fx = 0, Fy = 0;
  for (let k = 0; k < n; k++) {
    const p = surf[k], q = surf[k + 1], dxs = q.x - p.x, dys = q.y - p.y, cpm = 0.5 * (p.cp + q.cp), mx2 = 0.5 * (p.x + q.x), my2 = 0.5 * (p.y + q.y);
    // the contour runs counter-clockwise, so the outward normal is (dy, −dx)
    const fx = -cpm * dys, fy = cpm * dxs;
    Fx += fx; Fy += fy; cm += -(mx2 - (xLE + chord / 4)) * fy + my2 * fx;
  }
  const clP = (Fy * Math.cos(alpha) - Fx * Math.sin(alpha)) / chord;
  return { a, beta, G: Gcw, cl, clPressure: clP, cmc4: cm / chord ** 2, chord, xLE, t: tmax / chord, alphaL0: -beta, surf, F, Wz, Wair, map, inv, z0, ys };
}
