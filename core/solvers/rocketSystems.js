// Rocket systems (no DOM): solid-motor grain burnback and internal ballistics, vertical flight with gravity and
// drag, the multistage rocket equation with optimal staging, and liquid-engine feed systems: pump and turbine
// power balance for every power cycle, centrifugal pump sizing, suction performance (NPSH) and turbine blading.
import { atmosphere } from './atmosphere.js';

export const G0 = 9.80665;
const RE = 6371e3;

// ================= solid motors =================
// Propellants: density ρ (kg/m³), characteristic velocity c* (m/s), exhaust γ, burn rate r = rRef·(Pc/pRef)^n.
export const SOLID_PROPS = {
  apcpAl: { label: 'AP/HTPB/Al composite (APCP, 16% Al)', rho: 1800, cstar: 1540, g: 1.18, rRef: 9.0e-3, pRef: 6.895e6, n: 0.35, Tc: 3400 },
  pban: { label: 'PBAN/AP/Al (Shuttle SRB, Ares)', rho: 1715, cstar: 1520, g: 1.18, rRef: 10.4e-3, pRef: 6.895e6, n: 0.35, Tc: 3360 },
  apcp: { label: 'AP/HTPB, no aluminum (smokeless)', rho: 1700, cstar: 1420, g: 1.22, rRef: 7.0e-3, pRef: 6.895e6, n: 0.40, Tc: 2900 },
  db: { label: 'Double-base (nitrocellulose/nitroglycerin)', rho: 1610, cstar: 1400, g: 1.23, rRef: 12.0e-3, pRef: 6.895e6, n: 0.30, Tc: 2600 },
  knsb: { label: 'KNSB "rocket candy" (KNO₃/sorbitol)', rho: 1750, cstar: 900, g: 1.13, rRef: 15.2e-3, pRef: 6.895e6, n: 0.319, Tc: 1600 },
};
export const GRAINS = { tube: 'Tubular (circular port)', star: 'Star', finocyl: 'Finocyl (port with slots)', moon: 'Moonburner (offset port)', end: 'End burner (cigarette)' };
export const MOTORS = [
  { id: 'hobby', label: 'Amateur KNSB motor (tubular, ends burning)', prop: 'knsb', grain: 'tube', D: 0.05, L: 0.3, rp: 0.01, ends: true, Dt: 0.014, eps: 5 },
  { id: 'tactical', label: 'Tactical missile motor (6-point star)', prop: 'apcp', grain: 'star', D: 0.127, L: 1.2, rp: 0.022, ro: 0.045, nPts: 6, ends: false, Dt: 0.042, eps: 8 },
  { id: 'srb', label: 'Shuttle SRB-like booster (11-point star, approximate)', prop: 'pban', grain: 'star', D: 3.71, L: 35, rp: 0.6, ro: 0.95, nPts: 11, ends: false, Dt: 1.37, eps: 7.16 },
  { id: 'finocyl', label: 'Finocyl upper-stage motor', prop: 'apcpAl', grain: 'finocyl', D: 1.0, L: 2.5, rp: 0.15, rs: 0.33, w: 0.05, nPts: 6, ends: false, Dt: 0.2, eps: 40 },
  { id: 'gasgen', label: 'End-burning gas generator', prop: 'apcp', grain: 'end', D: 0.2, L: 0.6, rp: 0, ends: false, Dt: 0.012, eps: 4 },
];

// signed in/out test for the port cross-section (x, y in m)
function inPort(G, x, y) {
  const r = Math.hypot(x, y);
  if (G.grain === 'tube') return r < G.rp;
  if (G.grain === 'moon') return Math.hypot(x - G.off, y) < G.rp;
  if (G.grain === 'star') {
    const phi = Math.PI / G.nPts;
    let t = Math.atan2(y, x); if (t < 0) t += 2 * Math.PI;
    t = t % (2 * phi); const u = t > phi ? 2 * phi - t : t;
    const ro = G.ro, x2 = G.rp * Math.cos(phi), y2 = G.rp * Math.sin(phi);
    const rb = ro * y2 / (Math.cos(u) * y2 - Math.sin(u) * (x2 - ro));
    return r < rb;
  }
  if (G.grain === 'finocyl') {
    if (r < G.rp) return true;
    for (let k = 0; k < G.nPts; k++) {
      const a = 2 * Math.PI * k / G.nPts, ca = Math.cos(a), sa = Math.sin(a);
      const along = x * ca + y * sa, across = -x * sa + y * ca;
      if (along > 0 && along < G.rs && Math.abs(across) < G.w / 2) return true;
    }
    return false;
  }
  return false;
}
// 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher)
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; }
    if (s <= z[k]) { v[0] = q; z[0] = -Infinity; z[1] = Infinity; k = 0; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
export function distanceField(mask, N) {
  const INF = 1e20, D = new Float64Array(N * N), f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  for (let i = 0; i < N * N; i++) D[i] = mask[i] ? 0 : INF;
  for (let x = 0; x < N; x++) { for (let y = 0; y < N; y++) f[y] = D[y * N + x]; edt1(f, N, d, v, z); for (let y = 0; y < N; y++) D[y * N + x] = d[y]; }
  for (let y = 0; y < N; y++) { for (let x = 0; x < N; x++) f[x] = D[y * N + x]; edt1(f, N, d, v, z); for (let x = 0; x < N; x++) D[y * N + x] = Math.sqrt(d[x]); }
  return D;
}

// Grain cross-section burnback: distance of every propellant cell from the initial port, then port area and
// burning perimeter against web burned y. Returns the field for drawing as well.
export function grainBurnback(G, N = 241) {
  const R = G.D / 2, h = G.D / (N - 1);
  if (G.grain === 'end') return { end: true, N: 0, h, R, Acase: Math.PI * R * R, Aport0: 0, web: G.L, P: y => 0, Aport: () => 0 };
  const mask = new Uint8Array(N * N), inside = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -R + i * h, y = -R + j * h, k = j * N + i;
    inside[k] = Math.hypot(x, y) <= R ? 1 : 0;
    mask[k] = inside[k] && inPort(G, x, y) ? 1 : 0;
  }
  const dist = distanceField(mask, N);
  let nPort = 0, maxD = 0;
  const ds = [];
  for (let k = 0; k < N * N; k++) {
    if (!inside[k]) { dist[k] = -1; continue; }
    if (mask[k]) { nPort++; dist[k] = 0; continue; }
    const dd = Math.max(0, (dist[k] - 0.5)) * h; dist[k] = dd; ds.push(dd); if (dd > maxD) maxD = dd;
  }
  ds.sort((a, b) => a - b);
  const cell = h * h, Acase = Math.PI * R * R;
  // exact initial port area where the shape allows it (keeps the burnback consistent with the case area)
  const Aport0 = nPort * cell;
  const web = maxD;
  const nb = Math.max(20, Math.round(web / h * 1.5)), dy = web / nb;
  const ys = [], A = [];
  let idx = 0;
  for (let b = 0; b <= nb; b++) {
    const y = b * dy;
    while (idx < ds.length && ds[idx] <= y) idx++;
    ys.push(y); A.push(Aport0 + idx * cell);
  }
  // perimeter = dA/dy, smoothed; area scaled so the full grain burns to the case area exactly
  const sA = (Acase - Aport0) / Math.max(1e-12, A[A.length - 1] - Aport0);
  for (let i = 0; i < A.length; i++) A[i] = Aport0 + (A[i] - Aport0) * sA;
  const Pr = A.map((_, i) => (A[Math.min(i + 1, nb)] - A[Math.max(i - 1, 0)]) / ((Math.min(i + 1, nb) - Math.max(i - 1, 0)) * dy));
  const P = Pr.map((_, i) => { let s = 0, c = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j <= nb) { s += Pr[j]; c++; } } return s / c; });
  // the first bins are biased by the grid; extrapolate the initial perimeter from the next ones
  if (nb > 4) { P[0] = 2 * P[2] - P[4]; P[1] = 0.5 * (P[0] + P[2]); }
  const interp = (arr, y) => { if (y <= 0) return arr[0]; if (y >= web) return arr[nb]; const t = y / dy, i = Math.floor(t), f = t - i; return arr[i] * (1 - f) + arr[Math.min(i + 1, nb)] * f; };
  return { N, h, R, dist, mask, inside, Acase, Aport0, web, ys, A, Pv: P, P: y => interp(P, y), Aport: y => interp(A, y) };
}

// Ideal thrust coefficient for γ, area ratio ε, chamber and ambient pressure
export function exitPressureRatio(eps, g) {
  // supersonic root of the area–Mach relation, then p/p0
  const am = M => (1 / M) * ((2 / (g + 1)) * (1 + (g - 1) / 2 * M * M)) ** ((g + 1) / (2 * (g - 1)));
  let lo = 1.0001, hi = 50;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (am(m) < eps) lo = m; else hi = m; }
  const M = (lo + hi) / 2;
  return { M, pr: (1 + (g - 1) / 2 * M * M) ** (-g / (g - 1)) };
}
export function thrustCoefficient(g, eps, Pc, pa = 0) {
  const { pr } = exitPressureRatio(eps, g);
  const mom = Math.sqrt(2 * g * g / (g - 1) * (2 / (g + 1)) ** ((g + 1) / (g - 1)) * (1 - pr ** ((g - 1) / g)));
  return { CF: mom + (pr - pa / Pc) * eps, CFvac: mom + pr * eps, pe: pr * Pc, mom };
}
export const cstarIdeal = (g, R, Tc) => Math.sqrt(R * Tc / g) / (2 / (g + 1)) ** ((g + 1) / (2 * (g - 1)));

// Internal ballistics: quasi-steady chamber pressure Pc = (Kn·ρp·a·c*)^(1/(1−n)), web stepped through.
export function solidMotor(o) {
  const P = SOLID_PROPS[o.prop] || SOLID_PROPS.apcpAl;
  const rho = o.rho ?? P.rho, cstar = (o.cstar ?? P.cstar) * (o.etaC ?? 1), g = o.g ?? P.g, n = o.n ?? P.n, rRef = o.rRef ?? P.rRef;
  const a = rRef / P.pRef ** n;
  const At = Math.PI * o.Dt * o.Dt / 4, eps = o.eps, pa = o.pa ?? 101325, etaF = o.etaF ?? 0.95;
  const B = o.burnback || grainBurnback(o, o.N || 241);
  const L0 = o.L;
  const steps = 260;
  const webMax = B.end ? L0 : Math.min(B.web, o.ends ? L0 / 2 : Infinity);
  const out = { t: [], y: [], Pc: [], F: [], Ab: [], Kn: [], r: [], mdot: [], portRatio: [] };
  let t = 0, I = 0, mp = 0;
  const mp0 = rho * (B.end ? B.Acase * L0 : (B.Acase - B.Aport0) * L0);
  for (let i = 0; i <= steps; i++) {
    const y = webMax * i / steps;
    let Ab, Ap;
    if (B.end) { Ab = B.Acase; Ap = 0; }
    else {
      const Lb = o.ends ? Math.max(0, L0 - 2 * y) : L0;
      Ab = B.P(y) * Lb + (o.ends ? 2 * Math.max(0, B.Acase - B.Aport(y)) : 0);
      Ap = B.Aport(y);
    }
    const Kn = Ab / At;
    const Pc = Kn > 0 ? (Kn * rho * a * cstar) ** (1 / (1 - n)) : 0;
    const r = a * Pc ** n;
    const cf = Pc > 0 ? thrustCoefficient(g, eps, Pc, pa) : { CF: 0 };
    const F = Math.max(0, cf.CF * etaF * Pc * At);
    const mdot = Pc * At / cstar;
    if (i > 0) {
      const dt = (webMax / steps) / Math.max(1e-9, 0.5 * (r + out.r[out.r.length - 1]));
      if (!isFinite(dt) || dt > 1e4) break;
      t += dt; I += 0.5 * (F + out.F[out.F.length - 1]) * dt; mp += 0.5 * (mdot + out.mdot[out.mdot.length - 1]) * dt;
    }
    out.t.push(t); out.y.push(y); out.Pc.push(Pc); out.F.push(F); out.Ab.push(Ab); out.Kn.push(Kn); out.r.push(r); out.mdot.push(mdot); out.portRatio.push(Ap / At);
  }
  const Pmax = Math.max(...out.Pc), Fmax = Math.max(...out.F);
  const tb = t, Favg = I / Math.max(tb, 1e-9);
  const Kn0 = out.Kn[0], KnEnd = out.Kn[Math.round(out.Kn.length * 0.85)];
  const shape = KnEnd > Kn0 * 1.15 ? 'progressive' : KnEnd < Kn0 * 0.85 ? 'regressive' : 'neutral';
  const cls = (() => { const iT = I / 1.0; const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let lim = 2.5, k = 0; while (iT > lim && k < 25) { lim *= 2; k++; } return iT <= 0.3125 ? '1/8A' : iT <= 0.625 ? '1/4A' : iT <= 1.25 ? '1/2A' : letters[Math.min(25, k)]; })();
  return { ...out, B, At, a, n, rho, cstar, g, eps, tb, I, mp0, mpBurned: mp, Isp: I / (mp0 * G0), Favg, Pmax, Fmax, shape, Kn0, KnEnd, webMax, cls,
    minPortRatio: B.end ? Infinity : out.portRatio[0], cf: thrustCoefficient(g, eps, out.Pc[0] || 1e6, pa) };
}

// ================= vertical flight =================
// Constant thrust and mass flow; gravity falls off with altitude; drag from the standard atmosphere (to 86 km).
export function verticalFlight({ m0, mp, F, Isp, Cd = 0, A = 0, drag = true, dt = 0.05, varG = true }) {
  const c = Isp * G0, mdot = F / c, tb = mp / mdot;
  const rhoAt = z => (z < 86000 ? atmosphere(Math.max(0, z)).rho : 0);
  const gAt = z => (varG ? G0 * (RE / (RE + z)) ** 2 : G0);
  let t = 0, h = 0, v = 0, gl = 0, dl = 0, qmax = 0, tq = 0;
  const T = [], H = [], V = [], Acc = [], Q = [], M = [];
  let burnout = null;
  const deriv = (tt, hh, vv) => {
    const m = tt < tb ? m0 - mdot * tt : m0 - mp, thr = tt < tb ? F : 0;
    const rho = rhoAt(hh), D = drag ? 0.5 * rho * vv * Math.abs(vv) * Cd * A : 0;
    return { a: (thr - D) / m - gAt(hh), D, m, q: 0.5 * rho * vv * vv };
  };
  for (let i = 0; i < 400000; i++) {
    const d0 = deriv(t, h, v);
    T.push(t); H.push(h); V.push(v); Acc.push(d0.a); Q.push(d0.q); M.push(d0.m);
    if (d0.q > qmax) { qmax = d0.q; tq = t; }
    if (t > tb && v <= 0) break;
    if (h < 0 && t > 0) break;
    // RK4 (step shortened to land exactly on burnout)
    const step = t < tb && t + dt > tb ? tb - t : dt;
    const k1 = d0, k2 = deriv(t + step / 2, h + v * step / 2, v + k1.a * step / 2), k3 = deriv(t + step / 2, h + (v + k2.a * step / 2) * step / 2, v + k2.a * step / 2), k4 = deriv(t + step, h + (v + k3.a * step) * step, v + k3.a * step);
    if (t < tb) { gl += gAt(h) * step; dl += d0.D / d0.m * step; }
    h += step * (v + step / 6 * (k1.a + k2.a + k3.a));
    v += step / 6 * (k1.a + 2 * k2.a + 2 * k3.a + k4.a);
    t += step;
    if (!burnout && t >= tb - 1e-9) burnout = { t, h, v };
  }
  const MR = m0 / (m0 - mp);
  // closed form (constant g, no drag)
  const vb = c * Math.log(MR) - G0 * tb;
  const hb = c * tb * (1 - Math.log(MR) / (MR - 1)) - 0.5 * G0 * tb * tb;
  return { t: T, h: H, v: V, a: Acc, q: Q, m: M, tb, mdot, c, MR, dvIdeal: c * Math.log(MR), gravLoss: gl, dragLoss: dl, burnout: burnout || { t: tb, h: NaN, v: NaN },
    apogee: Math.max(...H), tApogee: T[H.indexOf(Math.max(...H))], qmax, tq, TW: F / (m0 * G0), closed: { vb, hb, apogee: hb + Math.max(0, vb) ** 2 / (2 * G0) } };
}

// ================= staging =================
// stages: [{ Isp, ms (structure), mp (propellant) }], first stage first; payload mPL.
export function stackDv(stages, mPL) {
  const out = []; let above = mPL;
  for (let i = stages.length - 1; i >= 0; i--) above += stages[i].ms + stages[i].mp;
  let m = above;
  for (const s of stages) {
    const m0 = m, mf = m - s.mp, c = s.Isp * G0;
    const eps = s.ms / (s.ms + s.mp), lam = (m0 - s.ms - s.mp) / (s.ms + s.mp);
    out.push({ m0, mf, MR: m0 / mf, dv: c * Math.log(m0 / mf), eps, lam, c });
    m = m - s.ms - s.mp;
  }
  return { stages: out, dv: out.reduce((a, s) => a + s.dv, 0), m0: above, payloadFrac: mPL / above };
}
// Lecture form for a single stage: Δv = c ln((1 + λ)/(ε + λ))
export const stageDv = (c, eps, lam) => c * Math.log((1 + lam) / (eps + lam));
// Identical ("similar") stages: Δv = n c ln( RL^(1/n) / (ε (RL^(1/n) − 1) + 1) ), RL = m0/mPL
export const similarStagesDv = (n, c, eps, RL) => { const x = RL ** (1 / n); return n * c * Math.log(x / (eps * (x - 1) + 1)); };
// Payload fraction for n identical stages reaching Δv (inverse of the above), NaN if impossible
export function similarPayloadFraction(n, c, eps, dv) {
  const R = Math.exp(dv / (n * c)); // stage mass ratio m0/mf
  const x = R * (1 - eps) / (1 - R * eps); // m0,i / m0,i+1
  return x > 0 && R * eps < 1 ? x ** -n : NaN;
}
// Optimal staging (Lagrange multiplier): stage mass ratios n_i = (c_i η − 1)/(c_i ε_i η) with Σ c_i ln n_i = Δv
export function optimalStaging(stages, dv, mPL) {
  const lo0 = Math.max(...stages.map(s => 1 / (s.Isp * G0 * (1 - s.eps)))) * (1 + 1e-12);
  const dvOf = eta => stages.reduce((a, s) => { const c = s.Isp * G0; return a + c * Math.log((c * eta - 1) / (c * s.eps * eta)); }, 0);
  const dvMax = stages.reduce((a, s) => a + s.Isp * G0 * Math.log(1 / s.eps), 0);
  if (dv >= dvMax) return { ok: false, dvMax };
  let lo = lo0, hi = lo0 * 2;
  while (dvOf(hi) < dv) hi *= 2;
  for (let i = 0; i < 200; i++) { const m = Math.sqrt(lo * hi); if (dvOf(m) < dv) lo = m; else hi = m; }
  const eta = Math.sqrt(lo * hi);
  let m = mPL; const res = [];
  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i], c = s.Isp * G0, n = (c * eta - 1) / (c * s.eps * eta);
    const m0 = m * n * (1 - s.eps) / (1 - n * s.eps), prop = m0 * (1 - 1 / n), struct = prop * s.eps / (1 - s.eps);
    res.unshift({ n, m0, mp: prop, ms: struct, dv: c * Math.log(n) });
    m = m0;
  }
  return { ok: true, stages: res, m0: m, payloadFrac: mPL / m, dvMax };
}
export const ROCKETS = [
  { id: 'lecture', label: 'Lecture 17 single-stage example', mPL: 1000, stages: [{ name: 'Stage 1', Isp: 3048 / G0, ms: 2000, mp: 12000 }] },
  { id: 'atlas', label: 'Atlas V 401 (CCB + Centaur)', mPL: 4950, stages: [{ name: 'CCB (RD-180)', Isp: 325, ms: 21054, mp: 284089 }, { name: 'Centaur (RL10)', Isp: 450.5, ms: 2316, mp: 20830 }] },
  { id: 'f9', label: 'Falcon 9 (expendable)', mPL: 22800, stages: [{ name: 'First stage (9 Merlin)', Isp: 300, ms: 25600, mp: 395700 }, { name: 'Second stage (MVac)', Isp: 348, ms: 3900, mp: 92670 }] },
  { id: 'saturn', label: 'Saturn V (to translunar injection)', mPL: 48600, stages: [{ name: 'S-IC (5 F-1)', Isp: 280, ms: 137000, mp: 2077000 }, { name: 'S-II (5 J-2)', Isp: 421, ms: 36000, mp: 444000 }, { name: 'S-IVB (J-2)', Isp: 421, ms: 13300, mp: 109000 }] },
];

// ================= liquid feed systems =================
// Turbine gas by cycle and propellant: cp (J/kg·K), γ.
export function turbineGas(cycle, fuel, side = 'fuel') {
  if (side === 'ox') return { cp: 1100, g: 1.32, label: 'oxidizer-rich preburner gas' };
  if (cycle === 'expander') return fuel === 'H2(L)' ? { cp: 14300, g: 1.40, label: 'hydrogen heated in the cooling jacket' } : { cp: 2600, g: 1.25, label: 'fuel vapor heated in the cooling jacket' };
  if (fuel === 'H2(L)') return { cp: 9000, g: 1.37, label: 'fuel-rich H₂/H₂O' };
  if (fuel === 'CH4(L)') return { cp: 3200, g: 1.18, label: 'fuel-rich CH₄ products' };
  if (fuel === 'RP-1' || fuel === 'Jet-A(L)' || fuel === 'C2H5OH(L)') return { cp: 2300, g: 1.12, label: 'fuel-rich kerosene products (sooty)' };
  return { cp: 2000, g: 1.25, label: 'fuel-rich products' };
}
export const VAPOR = { 'H2(L)': 1.0e5, 'O2(L)': 1.0e5, 'CH4(L)': 1.0e5, 'RP-1': 2e3, 'C2H5OH(L)': 6e3, 'Jet-A(L)': 1e3, 'N2O4(L)': 0.96e5, 'MMH(L)': 5e3, 'UDMH(L)': 16e3, 'N2H4(L)': 2e3, 'H2O2(L)': 0.3e3 };
const tw = (gas, Tin, PR, eta) => eta * gas.cp * Tin * (1 - PR ** (-(gas.g - 1) / gas.g));
const prFor = (gas, Tin, w, eta) => { const x = 1 - w / (eta * gas.cp * Tin); return x > 0 ? x ** (-gas.g / (gas.g - 1)) : Infinity; };

// o: { cycle, Pc (Pa), mOx, mFuel, rhoOx, rhoFuel, fuel, injDp (fraction of Pc), coolDp (fraction, fuel side),
//      pTankOx, pTankFuel (Pa), etaP, etaT, Tgg (K), prGG, Qjacket (W), TfIn (K), cpFuelLiq }
export function feedSystem(o) {
  const { cycle, Pc, mOx, mFuel, rhoOx, rhoFuel, fuel, injDp = 0.2, coolDp = 0.15, pTankOx = 3e5, pTankFuel = 3e5, etaP = 0.7, etaT = 0.6, Tgg = 900, prGG = 20, Qjacket = 0, TfIn = 100, cpFuelLiq = 2000 } = o;
  const pInj = Pc * (1 + injDp), pJacket = coolDp * Pc;
  const res = { cycle, pInj };
  const pumpP = (m, rho, dp) => m * dp / (rho * etaP);
  if (cycle === 'pressure') {
    Object.assign(res, { pTankOxReq: pInj, pTankFuelReq: pInj + pJacket, Pox: 0, Pf: 0, Ptot: 0, ok: true });
    return res;
  }
  let dOx = pInj - pTankOx, dF = pInj + pJacket - pTankFuel;
  if (cycle === 'gg' || cycle === 'electric') {
    const Pox = pumpP(mOx, rhoOx, dOx), Pf = pumpP(mFuel, rhoFuel, dF), P = Pox + Pf;
    if (cycle === 'electric') return Object.assign(res, { Pox, Pf, Ptot: P, dOx, dF, ok: true });
    const gas = turbineGas('gg', fuel), w = tw(gas, Tgg, prGG, etaT), mT = P / w;
    return Object.assign(res, { Pox, Pf, Ptot: P, dOx, dF, gas, wT: w, mT, frac: mT / (mOx + mFuel + mT), ok: true, Tin: Tgg, PR: prGG });
  }
  if (cycle === 'expander') {
    // all fuel through the jacket then the turbine; find the turbine pressure ratio that powers both pumps
    const gas = turbineGas('expander', fuel), Tin = TfIn + Qjacket / (mFuel * (fuel === 'H2(L)' ? gas.cp : cpFuelLiq));
    let PR = 1.5, Pox = 0, Pf = 0, ok = true;
    for (let it = 0; it < 60; it++) {
      dF = pInj * PR + pJacket - pTankFuel; Pox = pumpP(mOx, rhoOx, dOx); Pf = pumpP(mFuel, rhoFuel, dF);
      const nPR = prFor(gas, Tin, (Pox + Pf) / mFuel, etaT);
      if (!isFinite(nPR) || nPR > 50) { ok = false; PR = nPR; break; }
      if (Math.abs(nPR - PR) < 1e-7) { PR = nPR; break; }
      PR = 0.5 * PR + 0.5 * nPR;
    }
    const wAvail = tw(gas, Tin, 1e9, etaT);
    return Object.assign(res, { Pox, Pf, Ptot: Pox + Pf, dOx, dF, gas, Tin, PR, ok, pPumpF: pInj * PR + pJacket, wAvail, wNeed: (Pox + Pf) / mFuel, mT: mFuel });
  }
  if (cycle === 'staged' || cycle === 'ffsc') {
    // staged: one fuel-rich preburner (hydrogen) or oxidizer-rich (others); FFSC: both. Turbine gas → main chamber.
    const sides = cycle === 'ffsc' ? ['fuel', 'ox'] : [fuel === 'H2(L)' ? 'fuel' : 'ox'];
    let PRf = 1.3, PRo = 1.3, ok = true, Pox = 0, Pf = 0;
    for (let it = 0; it < 80; it++) {
      const pPB_f = pInj * (sides.includes('fuel') ? PRf : 1), pPB_o = pInj * (sides.includes('ox') ? PRo : 1);
      dF = Math.max(pPB_f, pPB_o) * 1.05 + pJacket - pTankFuel; dOx = Math.max(pPB_o, pPB_f) * 1.05 - pTankOx;
      Pox = pumpP(mOx, rhoOx, dOx); Pf = pumpP(mFuel, rhoFuel, dF);
      let nf = PRf, no = PRo;
      if (cycle === 'ffsc') { nf = prFor(turbineGas('ffsc', fuel, 'fuel'), Tgg, Pf / mFuel, etaT); no = prFor(turbineGas('ffsc', fuel, 'ox'), Tgg, Pox / mOx, etaT); }
      else if (sides[0] === 'fuel') nf = prFor(turbineGas('staged', fuel, 'fuel'), Tgg, (Pox + Pf) / mFuel, etaT);
      else no = prFor(turbineGas('staged', fuel, 'ox'), Tgg, (Pox + Pf) / mOx, etaT);
      if (!isFinite(nf) || !isFinite(no) || nf > 20 || no > 20) { ok = false; break; }
      if (Math.abs(nf - PRf) + Math.abs(no - PRo) < 1e-8) { PRf = nf; PRo = no; break; }
      PRf = 0.5 * PRf + 0.5 * nf; PRo = 0.5 * PRo + 0.5 * no;
    }
    return Object.assign(res, { Pox, Pf, Ptot: Pox + Pf, dOx, dF, sides, PRf, PRo, ok, Tin: Tgg, pPumpF: dF + pTankFuel, pPumpO: dOx + pTankOx, gasF: turbineGas(cycle, fuel, 'fuel'), gasO: turbineGas(cycle, fuel, 'ox') });
  }
  return res;
}

// Centrifugal pump sizing and suction performance.
// Dimensionless specific speed Ns = ω√Q/(gH)^¾ (per stage), suction specific speed S = ω√Q/(g·NPSHr)^¾.
export function pump({ mdot, rho, dp, rpm, psi = 0.5, S = 3.0, pTank, pVap, headM = 0, stages = 0 }) {
  const w = rpm * Math.PI / 30, Q = mdot / rho, H = dp / (rho * G0);
  const nsOf = k => w * Math.sqrt(Q) / (G0 * H / k) ** 0.75;
  let k = stages || 1;
  if (!stages) while (nsOf(k) < 0.35 && k < 8) k++;
  const Hs = H / k, Ns = nsOf(k), U2 = Math.sqrt(G0 * Hs / psi), D2 = 2 * U2 / w;
  const NPSHa = (pTank + rho * G0 * headM - pVap) / (rho * G0);
  const NPSHr = (w * Math.sqrt(Q) / S) ** (4 / 3) / G0;
  const rpmMax = S * (G0 * Math.max(NPSHa, 1e-6)) ** 0.75 / Math.sqrt(Q) * 30 / Math.PI;
  return { Q, H, Hs, stages: k, Ns, NsUS: Ns * 2733, U2, D2, NPSHa, NPSHr, margin: NPSHa / NPSHr, rpmMax, thoma: NPSHa / H, hydraulicPower: mdot * dp / rho };
}
// Impulse turbine blade efficiency vs blade-speed ratio U/c0 (no friction, symmetric blades), nozzle angle α
export const impulseEta = (x, alpha) => Math.max(0, 4 * x * (Math.cos(alpha) - x));
export const curtisEta = (x, alpha) => Math.max(0, 8 * x * (Math.cos(alpha) - 2 * x));
export const spouting = (gas, Tin, PR) => Math.sqrt(2 * gas.cp * Tin * (1 - PR ** (-(gas.g - 1) / gas.g)));
