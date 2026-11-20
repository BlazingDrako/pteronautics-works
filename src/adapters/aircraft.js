// Adapters between the Works vehicle document and the Atlas solver core (core/solvers/).
// The solvers are used as they are; everything Works needs on top lives here.
import * as Wing from '../../core/solvers/wing.js';
import * as St from '../../core/solvers/stability.js';
import * as Perf from '../../core/solvers/performance.js';
import { atmosphere, G0 } from '../../core/solvers/atmosphere.js';

const DEG = Math.PI / 180;
export { G0 };

// ---------- geometry ----------
// The wing in the solver's description: { shape, S, AR, taper, sweep (c/4), twist, dihedral, root, tip }
export function wingOf(w) {
  const S = w.span * w.rootChord * (1 + w.taper) / 2;
  return { shape: 'trapezoid', S, AR: w.span * w.span / S, taper: w.taper, sweep: w.sweep, twist: w.twist, dihedral: w.dihedral,
    root: String(w.rootAirfoil), tip: String(w.tipAirfoil), winglet: { on: false, h: 0.12, cant: 15, taper: 0.4, sweep: 35 } };
}

// Section numbers for a NACA 4-digit code: camber m, thickness t/c, zero-lift angle (thin-airfoil theory, from
// the core) and a handbook cl,max at Re ≈ 0.5–1 million (Abbott & von Doenhoff trend: about 1.25 for symmetric
// sections, rising about 0.04 per percent of camber, falling off for thin sections).
export function sectionOf(code) {
  const s = String(code).padStart(4, '0');
  const m = +s[0] / 100, tc = Wing.thickness(s);
  const thin = Math.max(0, 0.10 - tc) * 4;
  return { code: s, camber: m, tc, alpha0: Wing.nacaAlpha0(s), cm: cmQuarter(s), clmax: Math.max(0.8, 1.25 + 4 * m - thin) };
}
// Thin-airfoil pitching moment about the quarter chord of a NACA 4-digit mean line: cm = (π/4)(A2 − A1)
export function cmQuarter(code) {
  const s = String(code).padStart(4, '0'), m = +s[0] / 100, p = +s[1] / 10;
  if (m === 0 || p === 0) return 0;
  const n = 400; let A1 = 0, A2 = 0;
  for (let i = 0; i < n; i++) {
    const th = (i + 0.5) * Math.PI / n, x = (1 - Math.cos(th)) / 2;
    const dz = x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) ** 2) * (p - x);
    A1 += dz * Math.cos(th) / n * 2; A2 += dz * Math.cos(2 * th) / n * 2;
  }
  return Math.PI / 4 * (A2 - A1);
}
// Wing pitching moment about its aerodynamic center from the sections (DATCOM: cm·AR cos²Λ / (AR + 2 cos Λ))
export const wingCmac = (W) => {
  const cm = (cmQuarter(W.root) + cmQuarter(W.tip)) / 2, cL = Math.cos(W.sweep * DEG);
  return cm * W.AR * cL * cL / (W.AR + 2 * cL);
};

// Tail surfaces as simple trapezoids (taper 0.6) for drawing and wetted area
export function surfaceOf(area, aspect, taper = 0.6) {
  const b = Math.sqrt(area * aspect), cr = 2 * area / (b * (1 + taper));
  return { S: area, AR: aspect, b, cr, ct: cr * taper, mac: 2 / 3 * cr * (1 + taper + taper * taper) / (1 + taper) };
}

// ---------- drag ----------
// Zero-lift drag by Raymer's component build-up (skin friction × form factor × wetted area; turbulent, or mixed where
// a part has a laminar run `lam`), with 10%
// for interference, the propeller and the gear. Re per metre from the flight condition.
const cfTurb = (Re, M) => 0.455 / (Math.log10(Re) ** 2.58 * (1 + 0.144 * M * M) ** 0.65);
// Laminar flat plate (Blasius)
const cfLam = Re => 1.328 / Math.sqrt(Re);
// Mixed flow with laminar flow over the first fraction `lam` of the length (transition at Re_tr = lam·Re): the
// turbulent plate, less its turbulent first part, plus that part laminar
//   cf = cf_t(Re) − lam·cf_t(Re_tr) + lam·cf_l(Re_tr)
export function cfMixed(Re, lam = 0, M = 0) {
  if (!(lam > 0)) return cfTurb(Re, M);
  const Rt = Math.max(1e3, lam * Re);
  return Math.max(cfLam(Re), cfTurb(Re, M) - lam * cfTurb(Rt, M) + lam * cfLam(Rt));
}
// `fixed` adds items whose CD is already known (a wing from viscous section polars).
export function zeroLiftDrag({ S, parts, rePerM, M, fixed = [] }) {
  let sum = 0; const items = [];
  for (const f of fixed) { items.push({ ...f }); sum += f.CD; }
  for (const p of parts) {
    const Re = Math.max(1e4, rePerM * p.len), cf = cfMixed(Re, p.lam || 0, M);
    const CD = cf * p.FF * p.Q * p.Swet / S;
    items.push({ name: p.name, CD, Swet: p.Swet, Re, cf, FF: p.FF, lam: p.lam || 0 });
    sum += CD;
  }
  const misc = 0.10 * sum;
  items.push({ name: 'Interference, prop, gear (+10%)', CD: misc });
  return { CD0: sum + misc, items };
}
// low-speed form factors: lifting surfaces (max thickness at 30% chord) and slender bodies of fineness f
export const wingFF = (tc, sweep = 0) => (1 + 0.6 / 0.3 * tc + 100 * tc ** 4) * Math.cos(sweep * DEG) ** 0.28;
export const bodyFF = f => 1 + 60 / f ** 3 + f / 400;

// Oswald efficiency from the inviscid span efficiency and the parasite drag (Kroo: 1/e = 1/e_inv + 0.38·π·AR·CD0)
export const oswald = (eInv, AR, CD0) => 1 / (1 / eInv + 0.38 * Math.PI * AR * CD0);

// ---------- wing aerodynamics ----------
// Linear solutions at two angles give everything at any lift by superposition (exact for the linear methods).
function strips2(a, b, CL) {
  const t = (CL - a.CL) / (b.CL - a.CL);
  return a.strips.map((s, i) => ({ eta: s.eta, y: s.y, c: s.c, ccl: s.ccl + t * (b.strips[i].ccl - s.ccl), cl: s.cl + t * (b.strips[i].cl - s.cl) }));
}
export function wingAero(W, { M = 0, method = 'vlm', nS = 24, nC = 6 } = {}) {
  const P = Wing.planform(W);
  if (method === 'llt') {
    const a = Wing.liftingLine(W, { alpha: 0 }), b = Wing.liftingLine(W, { alpha: 10 });
    const beta = Math.sqrt(Math.max(0.05, 1 - M * M));
    const CLa = (b.CL - a.CL) / (10 * DEG) / beta;          // Prandtl–Glauert on the lifting-line slope
    const sa = { CL: a.CL / beta, strips: a.strips.map(s => ({ ...s, c: P.chord(Math.abs(s.eta)) })) };
    const sb = { CL: b.CL / beta, strips: b.strips.map(s => ({ ...s, c: P.chord(Math.abs(s.eta)) })) };
    return { method: 'Lifting line (Glauert)', P, CLa, alphaL0: -a.CL / CLa / DEG / beta, e: b.e, xac: 0.25, Cm0: wingCmac(W),
      spanLoad: CL => strips2(sa, sb, CL).filter(s => s.eta >= 0).sort((p, q) => p.eta - q.eta) };
  }
  const a = Wing.analyze(W, { alpha: 0, M, nS, nC }), b = Wing.analyze(W, { alpha: 10, M, nS, nC });
  // the lattice has no camber line (camber enters as a zero-lift angle), so Cm,ac comes from the sections
  return { method: 'Vortex lattice', P, CLa: a.CLa, alphaL0: a.alphaL0, e: b.e, xac: a.xac, Cm0: wingCmac(W),
    spanLoad: CL => strips2(a, b, CL).filter(s => s.eta >= 0).sort((p, q) => p.eta - q.eta) };
}

// Wing CL,max by the nonlinear strip loop with a model section (the wing stalls strip by strip).
// sections: { root, tip } with { alpha0, clmax } to use instead of the handbook values (viscous polars).
export function wingStall(W, { M = 0, sections = null } = {}) {
  const r = sections ? sections.root : sectionOf(W.root), t = sections ? sections.tip : sectionOf(W.tip);
  const sr = Wing.modelSection({ alpha0: r.alpha0, clmax: r.clmax }), stp = Wing.modelSection({ alpha0: t.alpha0, clmax: t.clmax });
  const sect = eta => (Math.abs(eta) < 0.5 ? sr : stp);
  const sw = Wing.sweepAlpha(W, { a0: 0, a1: 20, step: 1, sect, M, nS: 16 });
  return { CLmax: sw.CLmax, alphaCLmax: sw.alphaCLmax, firstStall: sw.firstStall };
}

// ---------- the aircraft as the performance and stability solvers describe it ----------
// performance.js AIRCRAFT entry (an electric motor is modelled with the solver's propeller model: shaft power with
// the Gagg–Ferrar density lapse, which is within 1–4% of constant power at survey altitudes)
export function perfAircraft(id, { S, b, e, CD0, CLa, CLmax, mass, power, propEff, vne = 40 }) {
  return {
    id, name: id, short: id, engine: 'piston', screen: 15, S, b, e, CD0, CLa, CLmax, CLmaxNeg: -0.6 * CLmax,
    to: null, land: null, mass: { empty: mass * 0.6, max: mass, def: mass, fuel: 0, payload: 0 },
    P0: power, eta: propEff, Vstar: 9, bsfc: 0.45,
    limits: { nPos: 3.8, nNeg: -1.5, VC: 0.8 * vne, VD: 1.125 * vne, VNE: vne }, mcrit: 0.6, plot: { Mmax: 0.15, zMax: 4000 },
  };
}

// Put an aircraft into the solver tables under its own id, replacing any older entry with that id.
// (stability.js and performance.js look aircraft up by id in their exported tables.)
export function registerAircraft(ac, geom) {
  const i = Perf.AIRCRAFT.findIndex(a => a.id === ac.id);
  if (i >= 0) Perf.AIRCRAFT[i] = ac; else Perf.AIRCRAFT.push(ac);
  St.GEOMETRY[ac.id] = geom;
}

// Stability analysis of a registered aircraft; returns the solver's full result
export function stabilityOf(id, { mass, z, dT = 0, V, cg }) {
  return St.analyze({ id, mass, z, dT, V, cg });
}

export { Wing, St, Perf, atmosphere };
