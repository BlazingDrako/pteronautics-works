// Boundary-layer theory (no DOM): Falkner–Skan similarity profiles (Blasius at β = 0) by shooting, the momentum-
// integral method with assumed profiles, Thwaites' method on any edge velocity ue(x), turbulent profiles (1/7 power
// law, Spalding's law of the wall), flat-plate skin friction with transition, and the drag of a streamlined body by
// the flat-plate analogy.

// ---------------- Falkner–Skan ----------------
// f''' + f f'' + β(1 − f'²) = 0, f(0) = f'(0) = 0, f'(∞) = 1, with η = y √((m + 1) Ue / (2νx)), β = 2m/(m + 1).
// Returns the profile and the thicknesses scaled by √(νx/Ue): δ*·√(Ue/νx), θ·√(Ue/νx), and cf·√Re_x.
function fsIntegrate(beta, s, etaMax = 10, n = 2000) {
  // also reports, as soon as it is clear, whether s is too high (f' overshoots 1) or too low (f' turns back below 1)
  const h = etaMax / n, Y = [0, 0, s], out = [[0, 0, 0, s]];
  const f = y => [y[1], y[2], -y[0] * y[2] - beta * (1 - y[1] * y[1])];
  for (let k = 0; k < n; k++) {
    const k1 = f(Y), y2 = Y.map((v, i) => v + 0.5 * h * k1[i]), k2 = f(y2), y3 = Y.map((v, i) => v + 0.5 * h * k2[i]), k3 = f(y3), y4 = Y.map((v, i) => v + h * k3[i]), k4 = f(y4);
    for (let i = 0; i < 3; i++) Y[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    out.push([(k + 1) * h, Y[0], Y[1], Y[2]]);
    if (!isFinite(Y[1]) || Y[1] > 1 + 1e-7) return { fp: 2, out };            // overshoot: s too high
    if (Y[2] < 0 && Y[1] < 1 - 1e-7) return { fp: Y[1] - 1 > -1e-3 ? Y[1] : 0, out }; // turned back early: s too low
  }
  return { fp: Y[1], out };
}
export function falknerSkan(beta = 0, { etaMax = 10, n = 2000 } = {}) {
  beta = Math.max(-0.19883, Math.min(1.9, beta));
  let lo = 0, hi = 3;
  const res = s => fsIntegrate(beta, s, etaMax, n).fp - 1;
  // the attached branch: bisection between a wall shear that is too low (f' turns back) and one that overshoots
  for (let it = 0; it < 80; it++) { const mid = 0.5 * (lo + hi); if (res(mid) > 0) hi = mid; else lo = mid; }
  const s = 0.5 * (lo + hi), r = fsIntegrate(beta, s, etaMax, n).out;
  const m = beta / (2 - beta), sc = Math.sqrt(2 / (m + 1)); // converts η to y·√(Ue/νx)
  let dstar = 0, theta = 0, d99 = NaN;
  for (let k = 1; k < r.length; k++) {
    const a = r[k - 1][2], b = r[k][2], dh = r[k][0] - r[k - 1][0];
    dstar += 0.5 * ((1 - a) + (1 - b)) * dh; theta += 0.5 * (a * (1 - a) + b * (1 - b)) * dh;
    if (isNaN(d99) && b >= 0.99 && a < 0.99) d99 = r[k - 1][0] + (0.99 - a) / (b - a) * dh;
  }
  return {
    beta, m, fpp0: s, eta: r.map(p => p[0]), f: r.map(p => p[1]), fp: r.map(p => p[2]), fpp: r.map(p => p[3]),
    ySc: sc, dstar: dstar * sc, theta: theta * sc, H: dstar / theta, d99: d99 * sc, cfRe: 2 * s / sc,
  };
}

// ---------------- momentum integral with assumed profiles (zero pressure gradient) ----------------
export const PROFILES = [
  { id: 'linear', label: 'Linear: u/U = η', F: e => e },
  { id: 'parabolic', label: 'Parabolic: 2η − η²', F: e => 2 * e - e * e },
  { id: 'cubic', label: 'Cubic: (3η − η³)/2', F: e => 1.5 * e - 0.5 * e ** 3 },
  { id: 'quartic', label: 'Quartic (Pohlhausen): 2η − 2η³ + η⁴', F: e => 2 * e - 2 * e ** 3 + e ** 4 },
  { id: 'sine', label: 'Sine: sin(πη/2)', F: e => Math.sin(Math.PI * e / 2) },
];
// for a profile F(η), η = y/δ: θ/δ = ∫F(1 − F), δ*/δ = ∫(1 − F), F'(0); then δ/x, cf√Re, H from the momentum integral
export function assumedProfile(F, n = 2000) {
  let a = 0, b = 0;
  for (let k = 0; k < n; k++) { const e = (k + 0.5) / n, v = F(e); a += v * (1 - v) / n; b += (1 - v) / n; }
  const d = 1e-6, Fp0 = (F(d) - F(0)) / d;
  const dRe = Math.sqrt(2 * Fp0 / a);           // δ/x · √Re_x
  return { thetaDelta: a, dstarDelta: b, Fp0, delta: dRe, theta: a * dRe, dstar: b * dRe, H: b / a, cfRe: Math.sqrt(2 * a * Fp0) };
}

// ---------------- Thwaites' method ----------------
// ue(x) (any units, consistent with ν), on x0…x1. θ² ue⁶ = 0.45 ν ∫ ue⁵ dx, λ = θ²/ν · due/dx, H(λ), ℓ(λ) by the
// Cebeci–Bradshaw fits; cf = 2νℓ/(ue θ). Laminar separation where λ falls below −0.09.
export const thwH = l => l >= 0 ? 2.61 - 3.75 * l + 5.24 * l * l : 2.088 + 0.0731 / (l + 0.14);
export const thwL = l => l >= 0 ? 0.22 + 1.57 * l - 1.8 * l * l : 0.22 + 1.402 * l + 0.018 * l / (l + 0.107);
export function thwaites(ue, x0, x1, nu, n = 2000) {
  const xs = [], U = [];
  for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n; xs.push(x); U.push(ue(x)); }
  const out = { x: [], ue: [], theta: [], dstar: [], H: [], cf: [], lambda: [], sep: null };
  let I = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) I += 0.5 * (U[k] ** 5 + U[k - 1] ** 5) * (xs[k] - xs[k - 1]);
    const u = U[k]; if (!(u > 1e-12)) continue;
    const th2 = 0.45 * nu * I / u ** 6, th = Math.sqrt(Math.max(0, th2));
    const dud = k === 0 ? (U[1] - U[0]) / (xs[1] - xs[0]) : k === n ? (U[n] - U[n - 1]) / (xs[n] - xs[n - 1]) : (U[k + 1] - U[k - 1]) / (xs[k + 1] - xs[k - 1]);
    const lam = th2 / nu * dud;
    if (lam < -0.09 && out.sep === null && k > 2) { out.sep = xs[k]; }
    if (out.sep !== null) break;
    const l = Math.max(-0.09, Math.min(0.25, lam));
    out.x.push(xs[k]); out.ue.push(u); out.theta.push(th); out.H.push(thwH(l)); out.dstar.push(thwH(l) * th);
    out.cf.push(th > 0 ? 2 * nu * thwL(l) / (u * th) : NaN); out.lambda.push(lam);
  }
  return out;
}
export const UE_CASES = [
  { id: 'plate', label: 'Flat plate: ue = U', ue: 'U', x0: 0, x1: 1, note: 'Zero pressure gradient. Thwaites gives θ = 0.671 √(νx/U), within 1% of Blasius (0.664).' },
  { id: 'stag', label: 'Stagnation point: ue = a·x', ue: 'a*x', x0: 0, x1: 1, note: 'Hiemenz flow: the boundary layer has constant thickness, θ = 0.275 √(ν/a), because the accelerating flow thins it as fast as viscosity thickens it.' },
  { id: 'howarth', label: 'Linear deceleration: ue = U(1 − x/L)', ue: 'U*(1 - x/L)', x0: 0, x1: 0.3, note: 'Howarth\'s classic test of an adverse pressure gradient. The exact solution separates at x/L = 0.120; Thwaites predicts 0.123.' },
  { id: 'cyl', label: 'Cylinder: ue = 2U sin(x/R)', ue: '2*U*sin(x/R)', x0: 0, x1: 2.5, note: 'The potential-flow speed round a cylinder, x measured along the surface from the front stagnation point. Thwaites predicts laminar separation near 104°; the real flow separates earlier (≈ 82°) because separation changes the pressure field itself.' },
  { id: 'accel', label: 'Converging channel: ue = U/(1 − x/L)', ue: 'U/(1 - x/L)', x0: 0, x1: 0.8, note: 'A strongly favorable pressure gradient keeps the layer thin and far from separating.' },
];

// ---------------- turbulent boundary layers ----------------
// 1/7-power-law flat plate (Prandtl): δ/x = 0.37 Re_x^−1/5, cf = 0.0592 Re_x^−1/5, θ = 7δ/72, δ* = δ/8
export function powerLawPlate(Rex) {
  const d = 0.37 * Rex ** -0.2;
  return { delta: d, theta: 7 / 72 * d, dstar: d / 8, H: 9 / 7, cf: 0.0592 * Rex ** -0.2 };
}
// Spalding's single formula for the law of the wall, y⁺(u⁺); returns u⁺ for given y⁺ by Newton
export function spalding(yplus, kappa = 0.41, B = 5.0) {
  let u = Math.min(yplus, Math.log(Math.max(yplus, 1)) / kappa + B);
  for (let it = 0; it < 50; it++) {
    const ku = kappa * u, E = Math.exp(-kappa * B);
    const f = u + E * (Math.exp(ku) - 1 - ku - ku * ku / 2 - ku ** 3 / 6) - yplus;
    const df = 1 + E * kappa * (Math.exp(ku) - 1 - ku - ku * ku / 2);
    const du = f / df; u -= du; if (Math.abs(du) < 1e-12) break;
  }
  return u;
}
// flat-plate average skin friction for a plate of length Reynolds number ReL with transition at Re_tr
export function plateCf(ReL, Retr = 5e5, law = 'prandtl') {
  const turb = R => law === 'schlichting' ? 0.455 / Math.log10(R) ** 2.58 : 0.074 * R ** -0.2;
  const lam = R => 1.328 / Math.sqrt(R);
  if (ReL <= Retr) return { Cf: lam(ReL), lam: lam(ReL), turb: turb(ReL), regime: 'laminar' };
  const A = Retr * (turb(Retr) - lam(Retr));      // the correction term (≈ 1700 for Re_tr = 5×10⁵, Prandtl)
  return { Cf: turb(ReL) - A / ReL, lam: lam(ReL), turb: turb(ReL), A, regime: 'mixed' };
}
// fuselage-like body by the flat-plate analogy: wetted area of a cylinder with ogive ends, Raymer's form factor
export function bodyDrag({ L = 38, d = 3.76, V = 230, rho = 0.38, mu = 1.43e-5, Retr = 5e5 } = {}) {
  const f = L / d, Swet = Math.PI * d * L * Math.pow(1 - 2 / f, 2 / 3) * (1 + 1 / (f * f)); // Torenbeek-style estimate
  const ReL = rho * V * L / mu, cf = plateCf(ReL, Retr).Cf, FF = 1 + 60 / f ** 3 + f / 400, q = 0.5 * rho * V * V;
  return { f, Swet, ReL, Cf: cf, FF, q, D: q * Swet * cf * FF, DoverQ: Swet * cf * FF };
}
