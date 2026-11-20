// Thermodynamic cycles and gas properties (no DOM): specific heats from molecular degrees of freedom, gas
// mixtures, the Peng–Robinson compressibility factor, ideal Otto and Diesel cycles with imep and shaft power,
// supercharging and turbocharging with intercooling, Brayton cycles with component efficiencies, regeneration,
// intercooling and reheat, and the constant-volume Humphrey cycle of pulse and detonation engines.
export const RU = 8.314462618; // J/(mol·K)

// ---------------- molecular degrees of freedom ----------------
// type: mono (atom), lin (linear molecule) or nonlin; vib: characteristic vibrational temperatures θv (K), one per mode.
// Critical constants (Tc K, pc Pa, ω acentric factor) for Peng–Robinson.
export const SPECIES = {
  He: { label: 'Helium He', M: 4.0026, type: 'mono', vib: [], Tc: 5.19, pc: 0.227e6, w: -0.39 },
  Ar: { label: 'Argon Ar', M: 39.948, type: 'mono', vib: [], Tc: 150.8, pc: 4.874e6, w: -0.002 },
  H2: { label: 'Hydrogen H₂', M: 2.016, type: 'lin', vib: [6332], Tc: 33.2, pc: 1.297e6, w: -0.216 },
  N2: { label: 'Nitrogen N₂', M: 28.0134, type: 'lin', vib: [3393], Tc: 126.2, pc: 3.398e6, w: 0.037 },
  O2: { label: 'Oxygen O₂', M: 31.999, type: 'lin', vib: [2273], Tc: 154.6, pc: 5.043e6, w: 0.022 },
  CO: { label: 'Carbon monoxide CO', M: 28.010, type: 'lin', vib: [3122], Tc: 132.9, pc: 3.499e6, w: 0.048 },
  CO2: { label: 'Carbon dioxide CO₂', M: 44.010, type: 'lin', vib: [960, 960, 1993, 3380], Tc: 304.1, pc: 7.38e6, w: 0.225 },
  H2O: { label: 'Water vapor H₂O', M: 18.015, type: 'nonlin', vib: [2295, 5255, 5400], Tc: 647.1, pc: 22.06e6, w: 0.344 },
  CH4: { label: 'Methane CH₄', M: 16.043, type: 'nonlin', vib: [4196, 2207, 2207, 4344, 4344, 4344, 1879, 1879, 1879], Tc: 190.6, pc: 4.599e6, w: 0.012 },
};
export const AIR = { N2: 0.78084, O2: 0.20946, Ar: 0.00934, CO2: 0.00036 };

// Einstein function: heat capacity (in units of R) of one vibrational mode at temperature T
export const einstein = x => (x > 300 ? 0 : x * x * Math.exp(x) / (Math.exp(x) - 1) ** 2);
// cv/R of one species. mode: 'quantum' (vibration excited by temperature), 'frozen' (no vibration), 'classical' (fully excited)
export function cvR(sp, T, mode = 'quantum') {
  const s = typeof sp === 'string' ? SPECIES[sp] : sp;
  const trans = 1.5, rot = s.type === 'mono' ? 0 : s.type === 'lin' ? 1 : 1.5;
  let vib = 0;
  if (mode === 'classical') vib = s.vib.length;
  else if (mode === 'quantum') for (const th of s.vib) vib += einstein(th / T);
  return { trans, rot, vib, total: trans + rot + vib };
}
// degrees of freedom counted the classical way, γ = 1 + 2/DOF
export function dof(sp, T, mode) {
  const c = cvR(sp, T, mode);
  return { ...c, dof: 2 * c.total, g: 1 + 1 / c.total, cpR: c.total + 1 };
}

// Mixture properties. amounts: { species: value }, by 'mole' or 'mass'.
export function mixture(amounts, { by = 'mole', T = 298.15, mode = 'quantum' } = {}) {
  const ids = Object.keys(amounts).filter(k => amounts[k] > 0 && SPECIES[k]);
  const n = {};
  for (const k of ids) n[k] = by === 'mole' ? amounts[k] : amounts[k] / SPECIES[k].M;
  const N = ids.reduce((a, k) => a + n[k], 0);
  const X = {}, Y = {};
  let M = 0;
  for (const k of ids) { X[k] = n[k] / N; M += X[k] * SPECIES[k].M; }
  for (const k of ids) Y[k] = X[k] * SPECIES[k].M / M;
  let cvm = 0; // molar cv/R
  for (const k of ids) cvm += X[k] * cvR(k, T, mode).total;
  const R = RU / (M / 1000), cv = cvm * R, cp = cv + R;
  return { ids, X, Y, M, R, cv, cp, g: cp / cv, cvR: cvm, cpR: cvm + 1, dof: 2 * cvm };
}

// ---------------- Peng–Robinson compressibility ----------------
export function cubicRoots(a, b, c) { // x³ + a x² + b x + c = 0, real roots ascending
  const q = (a * a - 3 * b) / 9, r = (2 * a ** 3 - 9 * a * b + 27 * c) / 54;
  if (r * r < q ** 3) {
    const t = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(q ** 3))));
    const m = -2 * Math.sqrt(q);
    return [m * Math.cos(t / 3) - a / 3, m * Math.cos((t + 2 * Math.PI) / 3) - a / 3, m * Math.cos((t - 2 * Math.PI) / 3) - a / 3].sort((x, y) => x - y);
  }
  const A = -Math.sign(r) * Math.cbrt(Math.abs(r) + Math.sqrt(r * r - q ** 3)), B = A === 0 ? 0 : q / A;
  return [A + B - a / 3];
}
export function pengRobinson(sp, T, p) {
  const s = typeof sp === 'string' ? SPECIES[sp] : sp;
  const kap = 0.37464 + 1.54226 * s.w - 0.26992 * s.w * s.w;
  const al = (1 + kap * (1 - Math.sqrt(T / s.Tc))) ** 2;
  const a = 0.45724 * RU * RU * s.Tc * s.Tc / s.pc * al, b = 0.07780 * RU * s.Tc / s.pc;
  const A = a * p / (RU * T) ** 2, B = b * p / (RU * T);
  const roots = cubicRoots(-(1 - B), A - 3 * B * B - 2 * B, -(A * B - B * B - B ** 3)).filter(z => z > B);
  // the gas (largest) root, and the liquid-like root when three exist
  return { Z: roots[roots.length - 1], Zl: roots.length > 1 ? roots[0] : null, Tr: T / s.Tc, pr: p / s.pc, A, B };
}

// ---------------- reciprocating engines ----------------
const curve = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
// One closed cycle in a cylinder of displacement Vd (m³). State 1: bottom dead center, start of compression.
// kind: 'otto' (heat at constant volume) or 'diesel' (constant pressure). q: heat added per kg of gas (J/kg).
export function pistonCycle({ kind = 'otto', r = 8, T1 = 300, p1 = 101325, g = 1.4, R = 287, q = 2.0e6, Vd = 1e-3 }) {
  const cv = R / (g - 1), cp = g * cv;
  const V1 = Vd * r / (r - 1), V2 = V1 / r, m = p1 * V1 / (R * T1);
  const T2 = T1 * r ** (g - 1), p2 = p1 * r ** g;
  let T3, p3, V3, rc = 1;
  if (kind === 'otto') { T3 = T2 + q / cv; V3 = V2; p3 = p2 * T3 / T2; }
  else { T3 = T2 + q / cp; rc = T3 / T2; V3 = V2 * rc; p3 = p2; }
  const T4 = T3 * (V3 / V1) ** (g - 1), p4 = p1 * T4 / T1, V4 = V1;
  const qout = cv * (T4 - T1), wnet = q - qout, eta = wnet / q;
  const etaFormula = kind === 'otto' ? 1 - r ** (1 - g) : 1 - r ** (1 - g) * (rc ** g - 1) / (g * (rc - 1));
  const v1 = R * T1 / p1, imep = wnet / (v1 - v1 / r);
  const S = (T, V) => cv * Math.log(T / T1) + R * Math.log(V / V1);
  const st = [{ n: 1, T: T1, p: p1, V: V1 }, { n: 2, T: T2, p: p2, V: V2 }, { n: 3, T: T3, p: p3, V: V3 }, { n: 4, T: T4, p: p4, V: V4 }];
  for (const s of st) s.s = S(s.T, s.V);
  // process paths: [V, p, T, s]
  const pt = (V, T) => ({ V, T, p: m * R * T / V, s: S(T, V) });
  const comp = curve(40, t => { const V = V1 + (V2 - V1) * t; return pt(V, T1 * (V1 / V) ** (g - 1)); });
  const heat = kind === 'otto' ? curve(30, t => pt(V2, T2 + (T3 - T2) * t)) : curve(30, t => { const V = V2 + (V3 - V2) * t; return pt(V, T2 * V / V2); });
  const exp = curve(40, t => { const V = V3 + (V1 - V3) * t; return pt(V, T3 * (V3 / V) ** (g - 1)); });
  const rej = curve(30, t => pt(V1, T4 + (T1 - T4) * t));
  return { kind, states: st, paths: [comp, heat, exp, rej], m, T1, T2, T3, T4, p1, p2, p3, p4, V1, V2, V3, rc, q, qout, wnet, eta, etaFormula, imep, imepRatio: imep / p1, cv, cp, Wcyl: wnet * m, r };
}
// nondimensional imep of the ideal Otto cycle from T3/T1 (lecture form)
export const ottoImep = (r, T3T1, g = 1.4) => (T3T1 - r ** (g - 1)) * (1 - r ** (1 - g)) / ((g - 1) * (1 - 1 / r));

// Shaft power of an engine: air flow ṁa = n·ρ·Vd·ηv/α (α = 2 for four-stroke), fuel ṁf = ṁa·(F/A),
// heat per kg of air q = (F/A)·LHV·ηb, power Ps = ṁa·wnet·(real-engine factor).
export function pistonEngine(o) {
  const { rpm = 2700, Vd = 5.9e-3, strokes = 4, etaV = 1, phi = 1, AFs = 14.8, LHV = 43.5e6, etaB = 1, factor = 1, p1 = 101325, T1 = 288.15, g = 1.4, R = 287 } = o;
  const FA = phi / AFs, q = FA * LHV * etaB;
  const cyc = pistonCycle({ ...o, q, p1, T1, g, R, Vd });
  const n = rpm / 60, alpha = strokes === 2 ? 1 : 2, rho = p1 / (R * T1);
  const ma = n * rho * Vd * etaV / alpha, mf = ma * FA;
  const Pi = ma * cyc.wnet, P = Pi * factor;
  const bsfc = mf / P; // kg/J
  return { ...cyc, FA, ma, mf, rho, Pi, P, bsfc, imepReal: cyc.imep * factor, eta: cyc.eta, etaReal: cyc.eta * factor, alpha, n };
}

// Supercharged / turbocharged engine at altitude. drive: 'none' | 'gear' (supercharger driven off the crank) | 'turbo'
// (exhaust-driven: no shaft power taken, back pressure neglected). Boost is limited to pMax manifold pressure (throttled).
export function boostedEngine(o, atm) {
  const { drive = 'gear', piS = 2.5, etaS = 0.75, ic = 0, pMax = Infinity, g = 1.4, R = 287 } = o;
  const k = (g - 1) / g, cp = g * R / (g - 1);
  const pa = atm.p, Ta = atm.T;
  let pi = drive === 'none' ? 1 : piS, throttled = false;
  if (pa * pi > pMax) { pi = Math.max(1, pMax / pa); throttled = true; }
  const T2 = Ta * (1 + (pi ** k - 1) / (drive === 'none' ? 1 : etaS));
  const T1 = T2 - ic * (T2 - Ta);
  const E = pistonEngine({ ...o, p1: pa * pi, T1, g, R });
  const Psc = drive === 'gear' ? E.ma * cp * (T2 - Ta) : 0;
  const Pturb = drive === 'turbo' ? E.ma * cp * (T2 - Ta) : 0;
  return { ...E, pi, throttled, T2s: T2, Tman: T1, pman: pa * pi, Psc, Pturb, Pnet: E.P - Psc, pa, Ta };
}

// ---------------- Brayton cycle ----------------
// rp overall pressure ratio, T1 inlet, T3 turbine inlet. nC compression stages with perfect intercooling back to T1,
// nT expansion stages with reheat back to T3, regenerator effectiveness eps. Returns states for a T–s diagram.
export function brayton({ rp = 10, T1 = 300, T3 = 1400, p1 = 101325, g = 1.4, R = 287, etaC = 1, etaT = 1, eps = 0, nC = 1, nT = 1 }) {
  const cp = g * R / (g - 1), k = (g - 1) / g;
  const s = (T, p) => cp * Math.log(T / T1) - R * Math.log(p / p1);
  const pts = [], path = [];
  const add = (T, p, label) => { const P = { T, p, s: s(T, p), label }; pts.push(P); return P; };
  const isobar = (Ta, Tb, p) => { for (let i = 0; i <= 24; i++) { const T = Ta + (Tb - Ta) * i / 24; path.push({ T, p, s: s(T, p) }); } };
  const line = (A, B) => { for (let i = 0; i <= 12; i++) { const t = i / 12; const T = A.T + (B.T - A.T) * t, p = A.p * (B.p / A.p) ** t; path.push({ T, p, s: A.s + (B.s - A.s) * t }); } };
  const piC = rp ** (1 / nC), piT = rp ** (1 / nT);
  let wc = 0, wt = 0, qic = 0, qrh = 0;
  let cur = add(T1, p1, '1');
  for (let i = 0; i < nC; i++) {
    const Tin = i === 0 ? T1 : T1, pin = p1 * piC ** i;
    if (i > 0) { isobar(cur.T, T1, pin); qic += cp * (cur.T - T1); cur = add(T1, pin, ''); }
    const Tout = Tin * (1 + (piC ** k - 1) / etaC);
    wc += cp * (Tout - Tin);
    const nx = add(Tout, pin * piC, i === nC - 1 ? '2' : ''); line(cur, nx); cur = nx;
  }
  const T2 = cur.T, p2 = cur.p;
  // turbine exit temperature without regeneration (needed for the regenerator), computed ahead
  let Tte = T3; for (let i = 0; i < nT; i++) Tte = T3 * (1 - etaT * (1 - piT ** -k));
  const useRegen = eps > 0 && Tte > T2;
  const Tx = useRegen ? T2 + eps * (Tte - T2) : T2;
  if (useRegen) { isobar(T2, Tx, p2); cur = add(Tx, p2, 'x'); }
  isobar(cur.T, T3, p2);
  const qin0 = cp * (T3 - Tx);
  cur = add(T3, p2, '3');
  for (let i = 0; i < nT; i++) {
    const pin = p2 / piT ** i;
    if (i > 0) { isobar(cur.T, T3, pin); qrh += cp * (T3 - cur.T); cur = add(T3, pin, ''); }
    const Tout = T3 * (1 - etaT * (1 - piT ** -k));
    wt += cp * (T3 - Tout);
    const nx = add(Tout, pin / piT, i === nT - 1 ? '4' : ''); line(cur, nx); cur = nx;
  }
  const T4 = cur.T;
  let Ty = T4;
  if (useRegen) { Ty = T4 - (Tx - T2); isobar(T4, Ty, p1); add(Ty, p1, 'y'); }
  isobar(Ty, T1, p1);
  const qin = qin0 + qrh, wnet = wt - wc, eta = wnet / qin;
  return {
    pts, path, T1, T2, T3, T4, Tx, Ty, p2, rp, cp, wc, wt, wnet, qin, qout: qin - wnet, eta, bwr: wc / wt,
    wnetRatio: wnet / (cp * T1), regenUsed: useRegen, regenBlocked: eps > 0 && !useRegen,
    etaIdeal: 1 - rp ** -k, rpOpt: (T3 / T1) ** (1 / (2 * k)), wmaxRatio: (Math.sqrt(T3 / T1) - 1) ** 2,
    carnot: 1 - T1 / T3,
  };
}
export function braytonSweep(o, rps) { return rps.map(rp => ({ rp, ...brayton({ ...o, rp }) })); }

// ---------------- Humphrey cycle (constant-volume heat addition) ----------------
// 1→2 isentropic compression by rp, 2→3 heat q at constant volume, 3→4 isentropic expansion to p1, 4→1 constant p.
export function humphrey({ rp = 2, T1 = 300, p1 = 101325, g = 1.4, R = 287, q = null, T3 = null }) {
  const cp = g * R / (g - 1), cv = cp / g, k = (g - 1) / g;
  const T2 = T1 * rp ** k, p2 = p1 * rp;
  const Q = q ?? cv * (T3 - T2);
  const t3 = T2 + Q / cv, p3 = p2 * t3 / T2;
  const T4 = t3 * (p1 / p3) ** k;
  const qout = cp * (T4 - T1), wnet = Q - qout;
  const s = (T, p) => cp * Math.log(T / T1) - R * Math.log(p / p1);
  const path = [];
  for (let i = 0; i <= 12; i++) { const p = p1 * rp ** (i / 12); path.push({ T: T1 * (p / p1) ** k, p, s: 0 }); }
  for (let i = 0; i <= 24; i++) { const T = T2 + (t3 - T2) * i / 24; path.push({ T, p: p2 * T / T2, s: s(T, p2 * T / T2) }); }
  for (let i = 0; i <= 12; i++) { const p = p3 * (p1 / p3) ** (i / 12); path.push({ T: t3 * (p / p3) ** k, p, s: s(t3, p3) }); }
  for (let i = 0; i <= 24; i++) { const T = T4 + (T1 - T4) * i / 24; path.push({ T, p: p1, s: s(T, p1) }); }
  const etaFormula = 1 - g * rp ** -k * ((p3 / p2) ** (1 / g) - 1) / (p3 / p2 - 1);
  return { T1, T2, T3: t3, T4, p2, p3, q: Q, qout, wnet, eta: wnet / Q, etaFormula, wnetRatio: wnet / (cp * T1), path, cp, cv,
    pts: [{ T: T1, p: p1, s: 0, label: '1' }, { T: T2, p: p2, s: 0, label: '2' }, { T: t3, p: p3, s: s(t3, p3), label: '3' }, { T: T4, p: p1, s: s(T4, p1), label: '4' }] };
}
