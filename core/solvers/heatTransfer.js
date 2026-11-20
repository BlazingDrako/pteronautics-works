// Heat transfer (no DOM): steady conduction through layered plane, cylindrical and spherical walls with convection
// and radiation at the surfaces, forced-convection correlations (flat plate, cylinder and sphere in cross-flow,
// pipe flow) with fluid properties, the Reynolds analogy, and thermal radiation: Planck's law, band fractions,
// two-surface enclosures, radiation shields and view factors.
export const SIGMA = 5.670374419e-8;
const C2 = 1.438777e-2; // m·K
export const WIEN = 2.897771955e-3; // m·K

export const MATERIALS = {
  copper: { label: 'Copper', k: 372 }, aluminum: { label: 'Aluminum', k: 205 }, steel: { label: 'Carbon steel', k: 50 },
  stainless: { label: 'Stainless steel', k: 16 }, inconel: { label: 'Inconel 718', k: 15 }, titanium: { label: 'Titanium alloy', k: 7 },
  niobium: { label: 'Niobium C-103', k: 44 }, graphite: { label: 'Graphite', k: 100 }, brick: { label: 'Fire brick', k: 1.0 },
  glass: { label: 'Glass', k: 1.0 }, zirconia: { label: 'Zirconia thermal-barrier coating', k: 1.5 }, ablator: { label: 'Phenolic ablator (Avcoat-like)', k: 0.4 },
  wood: { label: 'Wood', k: 0.12 }, cork: { label: 'Cork', k: 0.045 }, fiberglass: { label: 'Glass-fiber insulation', k: 0.04 },
  tile: { label: 'Silica tile (Shuttle LI-900)', k: 0.05 }, aerogel: { label: 'Aerogel', k: 0.015 },
};

// Steady conduction. geom 'plane' (per m², radii unused), 'cyl' (per m of length), 'sph' (whole sphere).
// layers: [{ k, t }] from inside (r0) outward. Boundary conditions: inner { T } or { Tinf, h }, outer likewise,
// outer may also radiate: { eps, Tsur }. Returns heat rate, interface temperatures and a profile.
export function conduction({ geom = 'plane', r0 = 0.05, layers, inner, outer }) {
  const radii = [r0]; for (const l of layers) radii.push(radii[radii.length - 1] + l.t);
  const area = r => geom === 'plane' ? 1 : geom === 'cyl' ? 2 * Math.PI * r : 4 * Math.PI * r * r;
  const Rl = layers.map((l, i) => {
    const a = radii[i], b = radii[i + 1];
    return geom === 'plane' ? l.t / l.k : geom === 'cyl' ? Math.log(b / a) / (2 * Math.PI * l.k) : (1 / a - 1 / b) / (4 * Math.PI * l.k);
  });
  const Ain = area(radii[0]), Aout = area(radii[radii.length - 1]);
  const Rin = inner.h ? 1 / (inner.h * Ain) : 0, Tin = inner.h ? inner.Tinf : inner.T;
  const Rcond = Rl.reduce((a, b) => a + b, 0);
  const solveWith = Rout => (Tin - outer.Tinf) / (Rin + Rcond + Rout);
  let Q, hr = 0, Ts;
  if (outer.T !== undefined && !outer.h) { Q = (Tin - outer.T) / (Rin + Rcond); Ts = outer.T; }
  else {
    // convection plus linearized radiation to Tsur (iterated); with radiation the far "ambient" is a weighted mix
    let Tsurf = (Tin + outer.Tinf) / 2;
    for (let it = 0; it < 200; it++) {
      hr = outer.eps ? outer.eps * SIGMA * (Tsurf * Tsurf + outer.Tsur ** 2) * (Tsurf + outer.Tsur) : 0;
      const hc = outer.h || 0, htot = hc + hr;
      const Tinf = htot > 0 ? (hc * outer.Tinf + hr * (outer.Tsur ?? outer.Tinf)) / htot : outer.Tinf;
      const Rout = 1 / (htot * Aout);
      Q = (Tin - Tinf) / (Rin + Rcond + Rout);
      const nT = Tinf + Q * Rout;
      if (Math.abs(nT - Tsurf) < 1e-9) { Tsurf = nT; break; }
      Tsurf = 0.5 * Tsurf + 0.5 * nT;
    }
    Ts = Tsurf;
    void solveWith;
  }
  // interface temperatures
  const T = [Tin - Q * Rin]; for (const R of Rl) T.push(T[T.length - 1] - Q * R);
  // profile within each layer
  const prof = [];
  layers.forEach((l, i) => {
    const a = radii[i], b = radii[i + 1];
    for (let j = 0; j <= 20; j++) {
      const r = a + (b - a) * j / 20;
      const f = geom === 'plane' ? (r - a) / (b - a) : geom === 'cyl' ? Math.log(r / a) / Math.log(b / a) : (1 / a - 1 / r) / (1 / a - 1 / b);
      prof.push({ r, T: T[i] + (T[i + 1] - T[i]) * f, layer: i });
    }
  });
  return { Q, q_in: Q / Ain, q_out: Q / Aout, T, Ts, radii, Rl, Rin, Rout: outer.h || outer.eps ? (T[T.length - 1] - (outer.Tinf)) / Q : 0, Rcond, prof, hr, Ain, Aout,
    rCrit: geom === 'cyl' && outer.h ? layers[layers.length - 1].k / outer.h : geom === 'sph' && outer.h ? 2 * layers[layers.length - 1].k / outer.h : NaN };
}

// ---------------- fluids ----------------
// Air at 1 atm (ideal gas, Sutherland viscosity, conductivity fit); water from a short table.
const lerp = (tab, T, k) => { if (T <= tab[0][0]) return tab[0][k]; for (let i = 1; i < tab.length; i++) if (T <= tab[i][0]) { const f = (T - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]); return tab[i - 1][k] + f * (tab[i][k] - tab[i - 1][k]); } return tab[tab.length - 1][k]; };
// T K, ρ kg/m³, cp J/kgK, μ Pa·s, k W/mK
const WATER = [[275, 999.9, 4211, 1.652e-3, 0.574], [300, 996.5, 4179, 0.855e-3, 0.613], [325, 987.1, 4182, 0.528e-3, 0.645], [350, 973.5, 4195, 0.365e-3, 0.668], [373, 958.4, 4217, 0.279e-3, 0.680]];
const OIL = [[273, 899, 1796, 3.85, 0.147], [300, 884, 1909, 0.486, 0.145], [350, 853, 2118, 0.0356, 0.138], [400, 825, 2337, 0.00874, 0.134]];
export const FLUIDS = {
  air: { label: 'Air (1 atm)', props: (T, p = 101325) => { const mu = 1.458e-6 * T ** 1.5 / (T + 110.4), cp = 1003 + (T > 300 ? 0.12 * (T - 300) : 0); return { rho: p / (287.05 * T), mu, cp, k: 2.64638e-3 * T ** 1.5 / (T + 245.4 * 10 ** (-12 / T)) }; } },
  water: { label: 'Water (liquid)', props: T => ({ rho: lerp(WATER, T, 1), cp: lerp(WATER, T, 2), mu: lerp(WATER, T, 3), k: lerp(WATER, T, 4) }) },
  oil: { label: 'Engine oil', props: T => ({ rho: lerp(OIL, T, 1), cp: lerp(OIL, T, 2), mu: lerp(OIL, T, 3), k: lerp(OIL, T, 4) }) },
  hydrogen: { label: 'Hydrogen gas (1 atm)', props: (T, p = 101325) => ({ rho: p / (4124 * T), mu: 8.9e-6 * (T / 300) ** 0.68, cp: 14310, k: 0.183 * (T / 300) ** 0.8 }) },
};
export function fluidProps(id, T, p) { const f = FLUIDS[id].props(T, p); return { ...f, nu: f.mu / f.rho, Pr: f.mu * f.cp / f.k, alpha: f.k / (f.rho * f.cp) }; }

// ---------------- forced convection correlations ----------------
// geometry: 'plate' (average over length L, transition at Re 5e5), 'cylinder' (Churchill–Bernstein), 'sphere'
// (Whitaker), 'pipe' (fully developed: laminar 3.66 / 4.36, turbulent Gnielinski).
export function nusselt(geom, Re, Pr, { bc = 'T', mu_s = null, mu = null, Rex_tr = 5e5 } = {}) {
  if (geom === 'plate') {
    if (Re <= Rex_tr) return { Nu: 0.664 * Re ** 0.5 * Pr ** (1 / 3), regime: 'laminar', Cf: 1.328 / Math.sqrt(Re) };
    const A = 0.037 * Rex_tr ** 0.8 - 0.664 * Rex_tr ** 0.5;
    return { Nu: (0.037 * Re ** 0.8 - A) * Pr ** (1 / 3), regime: 'mixed laminar/turbulent', Cf: 0.074 / Re ** 0.2 - 1742 / Re };
  }
  if (geom === 'cylinder') {
    const Nu = 0.3 + 0.62 * Re ** 0.5 * Pr ** (1 / 3) / (1 + (0.4 / Pr) ** (2 / 3)) ** 0.25 * (1 + (Re / 282000) ** 0.625) ** 0.8;
    return { Nu, regime: Re < 2e5 ? 'laminar boundary layer' : 'turbulent boundary layer' };
  }
  if (geom === 'sphere') {
    const r = mu_s && mu ? (mu / mu_s) ** 0.25 : 1;
    return { Nu: 2 + (0.4 * Re ** 0.5 + 0.06 * Re ** (2 / 3)) * Pr ** 0.4 * r, regime: 'Whitaker' };
  }
  // pipe
  if (Re < 2300) return { Nu: bc === 'q' ? 4.36 : 3.66, regime: 'laminar, fully developed', f: 64 / Re };
  const f = (0.790 * Math.log(Re) - 1.64) ** -2;
  const NuG = (f / 8) * (Re - 1000) * Pr / (1 + 12.7 * Math.sqrt(f / 8) * (Pr ** (2 / 3) - 1));
  return { Nu: NuG, regime: Re < 1e4 ? 'transitional (Gnielinski)' : 'turbulent (Gnielinski)', f, NuDB: 0.023 * Re ** 0.8 * Pr ** 0.4 };
}
export function convection({ geom = 'cylinder', fluid = 'air', V = 10, L = 0.05, Tinf = 300, Ts = 350, p = 101325, bc = 'T' }) {
  const Tf = (Tinf + Ts) / 2, P = fluidProps(fluid, Tf, p);
  const Re = P.rho * V * L / P.mu;
  const N = nusselt(geom, Re, P.Pr, { bc, mu: P.mu, mu_s: fluidProps(fluid, Ts, p).mu });
  const hc = N.Nu * P.k / L;
  const area = geom === 'plate' ? L : geom === 'cylinder' ? Math.PI * L : geom === 'sphere' ? Math.PI * L * L : Math.PI * L; // per m width/length, or whole sphere
  const q = hc * (Ts - Tinf);
  const St = hc / (P.rho * V * P.cp);
  return { ...N, Re, Pr: P.Pr, P, Tf, h: hc, q, Q: q * area, St, areaNote: geom === 'plate' ? 'per m of width' : geom === 'sphere' ? 'whole sphere' : 'per m of length', analogy: N.Cf ? N.Cf / 2 : null, colburn: St * P.Pr ** (2 / 3) };
}

// ---------------- radiation ----------------
// spectral blackbody emissive power E_bλ (W/m²·m)
export const planck = (lam, T) => 2 * Math.PI * 6.62607015e-34 * 299792458 ** 2 / (lam ** 5 * (Math.exp(C2 / (lam * T)) - 1));
// fraction of blackbody emission between 0 and λ (series of Chang & Rhee)
export function bandFraction(lam, T) {
  const z = C2 / (lam * T);
  let s = 0;
  for (let n = 1; n <= 40; n++) s += Math.exp(-n * z) / n * (z ** 3 + 3 * z * z / n + 6 * z / n / n + 6 / n ** 3);
  return Math.max(0, Math.min(1, 15 / Math.PI ** 4 * s));
}
export const EMISSIVITY = [
  ['Polished aluminum', 0.05], ['Polished gold (spacecraft MLI)', 0.03], ['Oxidized steel', 0.8], ['Oxidized Inconel', 0.7], ['Oxidized niobium', 0.8],
  ['White paint', 0.9], ['Black paint', 0.95], ['Shuttle black tile (RCG coating)', 0.85], ['Carbon–carbon', 0.85], ['Human skin', 0.95], ['Water', 0.96],
];
// Two diffuse-gray surfaces exchanging radiation. config 'plates' (per m²), 'cylinders' or 'spheres' (inner area A1,
// r1 < r2). n shields of emissivity epsS between them.
export function enclosure({ config = 'plates', T1, T2, eps1, eps2, r1 = 1, r2 = 2, nShields = 0, epsS = 0.05 }) {
  const ratio = config === 'plates' ? 1 : config === 'cylinders' ? r1 / r2 : (r1 / r2) ** 2;
  let Rsum = (1 - eps1) / eps1 + 1 + ratio * (1 - eps2) / eps2;
  // shields placed as concentric/parallel surfaces at geometric mean positions (each adds 2(1−ε)/ε + 1, area-weighted ≈ plane)
  for (let i = 0; i < nShields; i++) Rsum += 2 * (1 - epsS) / epsS + 1;
  const q = SIGMA * (T1 ** 4 - T2 ** 4) / Rsum;
  return { q, Rsum, ratio, q0: SIGMA * (T1 ** 4 - T2 ** 4) / ((1 - eps1) / eps1 + 1 + ratio * (1 - eps2) / eps2) };
}
// Radiative equilibrium of a surface absorbing q_in (W/m²) and radiating with emissivity eps to Tsur
export const radiativeEquilibrium = (qin, eps, Tsur = 0) => (qin / (eps * SIGMA) + Tsur ** 4) ** 0.25;

// View factors (Lienhard, Incropera)
export const VIEW_FACTORS = {
  disks: { label: 'Coaxial parallel disks', params: ['r1', 'r2', 'L'], F: ({ r1, r2, L }) => { const R1 = r1 / L, R2 = r2 / L, X = 1 + (1 + R2 * R2) / (R1 * R1); return 0.5 * (X - Math.sqrt(X * X - 4 * (R2 / R1) ** 2)); } },
  plates: { label: 'Aligned parallel rectangles', params: ['a', 'b', 'L'], F: ({ a, b, L }) => { const X = a / L, Y = b / L, X2 = X * X, Y2 = Y * Y; return 2 / (Math.PI * X * Y) * (Math.log(Math.sqrt((1 + X2) * (1 + Y2) / (1 + X2 + Y2))) + X * Math.sqrt(1 + Y2) * Math.atan(X / Math.sqrt(1 + Y2)) + Y * Math.sqrt(1 + X2) * Math.atan(Y / Math.sqrt(1 + X2)) - X * Math.atan(X) - Y * Math.atan(Y)); } },
  perp: { label: 'Perpendicular rectangles, common edge', params: ['a', 'b', 'L'], F: ({ a, b, L }) => { // a: common edge, b: width of 1, L: width of 2
    const H = L / a, W = b / a, H2 = H * H, W2 = W * W;
    return 1 / (Math.PI * W) * (W * Math.atan(1 / W) + H * Math.atan(1 / H) - Math.sqrt(H2 + W2) * Math.atan(1 / Math.sqrt(H2 + W2))
      + 0.25 * Math.log((1 + W2) * (1 + H2) / (1 + W2 + H2) * (W2 * (1 + W2 + H2) / ((1 + W2) * (W2 + H2))) ** W2 * (H2 * (1 + H2 + W2) / ((1 + H2) * (H2 + W2))) ** H2)); } },
  sphereDisk: { label: 'Sphere to a coaxial disk', params: ['r1', 'r2', 'L'], F: ({ r2, L }) => 0.5 * (1 - 1 / Math.sqrt(1 + (r2 / L) ** 2)) },
};
