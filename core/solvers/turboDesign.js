// Turbomachinery design (no DOM): velocity triangles from hub to tip under a vortex law (free vortex or constant
// reaction), turbine work against degree of reaction, total-to-static vs total-to-total efficiency, turbine blade
// cooling and centrifugal stress against material limits, and compressor–turbine matching of a single-spool
// turbojet with a choked turbine and nozzle (the running line on the compressor map).
const DEG = Math.PI / 180;

// ---------- spanwise velocity triangles ----------
// kind 'comp': stations 1 (rotor in), 2 (rotor out); angles from axial; Cθ in the direction of rotation.
// kind 'turb': stations 2 (nozzle out / rotor in), 3 (rotor out); Cθ3 positive against rotation.
// law: 'free' (r·Cθ = const) or 'const' (constant reaction, Cθ = a·r ± b/r). Axial velocity uniform.
export function spanTriangles({ kind = 'comp', phi = 0.5, psi = 0.4, R = 0.5, Um = 300, hubTip = 0.6, law = 'free' }) {
  const Cx = phi * Um, rh = 2 * hubTip / (1 + hubTip), rt = 2 / (1 + hubTip); // radius / mean radius
  const at = x => {
    const U = Um * x;
    let c1, c2;
    if (kind === 'comp') {
      const m1 = Um * (1 - R - psi / 2), m2 = Um * (1 - R + psi / 2);
      if (law === 'free') { c1 = m1 / x; c2 = m2 / x; } else { const a = Um * (1 - R), b = Um * psi / 2; c1 = a * x - b / x; c2 = a * x + b / x; }
      const b1 = Math.atan((U - c1) / Cx), b2 = Math.atan((U - c2) / Cx), a1 = Math.atan(c1 / Cx), a2 = Math.atan(c2 / Cx);
      const W1 = Cx / Math.cos(b1), W2 = Cx / Math.cos(b2);
      return { x, U, Ct1: c1, Ct2: c2, a1, a2, b1, b2, W1, W2, C1: Cx / Math.cos(a1), C2: Cx / Math.cos(a2), R: 1 - (c1 + c2) / (2 * U), work: U * (c2 - c1), deHaller: W2 / W1, turn: b1 - b2 };
    }
    const m2 = Um * (psi / 2 - R + 1), m3 = Um * (psi / 2 + R - 1);
    if (law === 'free') { c1 = m2 / x; c2 = m3 / x; } else { const a = Um * (1 - R), b = Um * psi / 2; c1 = a * x + b / x; c2 = -a * x + b / x; }
    const a2 = Math.atan(c1 / Cx), a3 = Math.atan(c2 / Cx), b2 = Math.atan((c1 - U) / Cx), b3 = Math.atan((c2 + U) / Cx);
    return { x, U, Ct2: c1, Ct3: c2, a2, a3, b2, b3, W2: Cx / Math.cos(b2), W3: Cx / Math.cos(b3), C2: Cx / Math.cos(a2), C3: Cx / Math.cos(a3), R: 1 - (c1 - c2) / (2 * U), work: U * (c1 + c2), turn: b2 + b3 };
  };
  const xs = []; for (let i = 0; i <= 40; i++) xs.push(rh + (rt - rh) * i / 40);
  const span = xs.map(at);
  return { Cx, rh, rt, hub: at(rh), mean: at(1), tip: at(rt), span };
}

// Turbine stage with zero exit swirl: work coefficient ψ = 2(1 − R); nozzle exit angle tan α2 = 2(1 − R)/φ... (mean line)
export const zeroSwirlPsi = R => 2 * (1 - R);
export const zeroSwirlAlpha2 = (R, phi) => Math.atan(2 * (1 - R) / phi);
// total-to-static efficiency from total-to-total and the exit kinetic energy (per unit work)
export const etaTS = (etaTT, dh0, C3) => 1 / (1 / etaTT + C3 * C3 / 2 / dh0);

// ---------- turbine blade cooling and stress ----------
// Holland–Thake: coolant fraction m_c/m_g = K·ε/(1 − ε), ε = (Tg − Tm)/(Tg − Tc)
export const COOLING = {
  none: { label: 'Uncooled', K: Infinity },
  conv: { label: 'Internal convection', K: 0.05 },
  film: { label: 'Convection + film cooling', K: 0.025 },
  trans: { label: 'Transpiration', K: 0.012 },
};
export function coolingFlow(method, Tg, Tm, Tc) {
  const eps = (Tg - Tm) / (Tg - Tc);
  if (eps <= 0) return { eps, frac: 0 };
  if (method === 'none' || eps >= 1) return { eps, frac: Infinity };
  return { eps, frac: COOLING[method].K * eps / (1 - eps) };
}
// approximate 1000-hour creep-rupture strength (MPa) vs metal temperature (K), and density (kg/m³)
export const BLADE_MATERIALS = {
  ti: { label: 'Titanium Ti-6Al-4V (fan, cold compressor)', rho: 4430, pts: [[300, 900], [600, 600], [700, 450], [800, 150]] },
  in718: { label: 'Inconel 718 (wrought)', rho: 8190, pts: [[300, 1100], [800, 850], [900, 600], [1000, 280], [1100, 90]] },
  ds: { label: 'Directionally solidified Ni (Mar-M 247 DS)', rho: 8540, pts: [[300, 1000], [900, 750], [1050, 450], [1150, 260], [1250, 110]] },
  sx: { label: 'Single-crystal Ni (CMSX-4)', rho: 8700, pts: [[300, 1000], [1000, 680], [1100, 480], [1200, 290], [1300, 140], [1370, 70]] },
  cmc: { label: 'SiC/SiC ceramic-matrix composite', rho: 2800, pts: [[300, 300], [1300, 260], [1500, 200], [1600, 140], [1700, 60]] },
};
export function strength(mat, T) {
  const p = BLADE_MATERIALS[mat].pts;
  if (T <= p[0][0]) return p[0][1] * 1e6;
  for (let i = 1; i < p.length; i++) if (T <= p[i][0]) { const [x0, y0] = p[i - 1], [x1, y1] = p[i]; return (y0 + (y1 - y0) * (T - x0) / (x1 - x0)) * 1e6; }
  return Math.max(0, p[p.length - 1][1] * (1 - (T - p[p.length - 1][0]) / 100)) * 1e6;
}
// centrifugal root stress of a blade: σ/ρ = k·ω²(rt² − rh²)/2 (k = 1 untapered, ≈ 2/3 tapered)
export const bladeStress = ({ rpm, rt, rh, rho, taper = 2 / 3 }) => { const w = rpm * Math.PI / 30; const s = taper * w * w * (rt * rt - rh * rh) / 2; return { sOverRho: s, sigma: s * rho, Ut: w * rt }; };

// ---------- compressor map (continuous speed) and matching ----------
export function mapModel(piD, kind = 'axial') {
  const ms = n => (kind === 'axial' ? 0.80 : 0.70) * n ** 1.2;
  const mc = n => 1.04 * n ** (kind === 'axial' ? 0.75 : 0.9);
  const ps = n => 1 + (piD - 1) * 1.2 * n ** 2.1;
  const pc = n => 1 + (ps(n) - 1) * (kind === 'axial' ? 0.55 : 0.4);
  const k = Math.log((ps(1) - piD) / (ps(1) - pc(1))) / Math.log((1 - ms(1)) / (mc(1) - ms(1)));
  const pOn = (n, m) => { const t = Math.max(0, Math.min(1, (m - ms(n)) / (mc(n) - ms(n)))); return ps(n) - (ps(n) - pc(n)) * t ** k; };
  const line = n => { const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40, m = ms(n) + t * (mc(n) - ms(n)); pts.push([m, ps(n) - (ps(n) - pc(n)) * t ** k]); } return pts; };
  // corrected speed through a point (m, p) on the map
  const speedAt = (m, p) => { let lo = 0.3, hi = 1.25; for (let i = 0; i < 60; i++) { const n = (lo + hi) / 2; const pp = m < ms(n) ? Infinity : m > mc(n) ? -Infinity : pOn(n, m); if (pp < p) lo = n; else hi = n; } return (lo + hi) / 2; };
  const surgeP = m => { let lo = 0.3, hi = 1.4; for (let i = 0; i < 60; i++) { const n = (lo + hi) / 2; if (ms(n) < m) lo = n; else hi = n; } return ps((lo + hi) / 2); };
  const eff = (m, p, etaD = 0.86) => { const n = speedAt(m, p), mid = ms(n) + 0.6 * (mc(n) - ms(n)), span = mc(n) - ms(n); return etaD - 0.35 * (n - 0.95) ** 2 - 0.18 * ((m - mid) / span) ** 2; };
  return { ms, mc, ps, pc, k, line, speedAt, surgeP, eff, pOn };
}

// Single-spool turbojet, choked turbine nozzle guide vanes and choked propelling nozzle.
// θ = T04/T01. Turbine pressure ratio is fixed by the nozzle/NGV area ratio, so the turbine's ΔT0/T04 = k is fixed;
// work balance then gives θ as a function of π, and NGV choking gives the corrected flow ∝ π/√θ.
export function matching({ piD = 8, thetaD = 4.5, etaT = 0.88, etaCD = 0.86, gc = 1.4, gt = 1.33, cpc = 1005, cpt = 1148, pb = 0.95, nozzle = 1, kind = 'axial', useMapEff = true }) {
  const M = mapModel(piD, kind), kc = (gc - 1) / gc, kt = (gt - 1) / gt;
  const tauC = (pi, eta) => 1 + (pi ** kc - 1) / eta;
  const etaD = useMapEff ? M.eff(1, piD, etaCD) : etaCD;
  const kD = cpc * (tauC(piD, etaD) - 1) / (cpt * thetaD); // design turbine ΔT0/T04
  const PRtD = (1 - kD / etaT) ** (-1 / kt);
  // nozzle area change: choked NGV and nozzle → PRt = (A5/A4)/√(1−k)·... solve with the design ratio scaled
  const ratioD = PRtD * Math.sqrt(1 - kD);
  let PRt = PRtD, k = kD;
  for (let i = 0; i < 100; i++) { const next = ratioD * nozzle / Math.sqrt(1 - k); PRt = 0.5 * PRt + 0.5 * next; k = etaT * (1 - PRt ** -kt); }
  const thetaOf = (pi, eta) => cpc * (tauC(pi, eta) - 1) / (cpt * k);
  const mOf = (pi, theta) => (pi / piD) * Math.sqrt(thetaD / theta);
  const line = [];
  for (let pi = 1.05; pi <= piD * 1.25; pi *= 1.01) {
    let eta = etaCD, th = thetaOf(pi, eta), m = mOf(pi, th);
    if (useMapEff) for (let it = 0; it < 15; it++) { eta = Math.max(0.5, M.eff(m, pi, etaCD)); th = thetaOf(pi, eta); m = mOf(pi, th); }
    const n = M.speedAt(m, pi);
    // surge margin at constant corrected speed
    line.push({ pi, theta: th, m, n, eta, SM: M.ps(n) / pi - 1 });
  }
  const at = theta => { // operating point for a fuel setting θ
    let best = line[0];
    for (let i = 1; i < line.length; i++) { const a = line[i - 1], b = line[i]; if ((a.theta - theta) * (b.theta - theta) <= 0) { const f = (theta - a.theta) / (b.theta - a.theta); const o = {}; for (const key in a) o[key] = a[key] + (b[key] - a[key]) * f; return o; } if (Math.abs(line[i].theta - theta) < Math.abs(best.theta - theta)) best = line[i]; }
    return best;
  };
  return { map: M, line, at, k, PRt, PRtD, kD, design: at(thetaD) };
}
export { DEG };
