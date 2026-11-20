// Propellers and rotors (no DOM): actuator-disk momentum theory and propulsive efficiency, blade element momentum
// theory with Prandtl tip loss for propellers and hovering or climbing rotors, helicopter power in hover and forward
// flight with autorotation, and multirotor hover endurance.
export const G0 = 9.80665;

// ---------- momentum theory ----------
export function actuatorDisk({ T, D, V = 0, rho = 1.225 }) {
  const A = Math.PI * D * D / 4;
  const vi = -V / 2 + Math.sqrt(V * V / 4 + T / (2 * rho * A));
  const P = T * (V + vi);
  return { A, vi, ue: V + 2 * vi, P, eta: V > 0 ? V / (V + vi) : 0, diskLoading: T / A, Rcontract: Math.sqrt((V + vi) / (V + 2 * vi)), FMideal: 1, Phover: T ** 1.5 / Math.sqrt(2 * rho * A) };
}
// propulsive efficiency for a jet of exit speed ue at flight speed u (lecture 1/4): ηp = 2/(1 + ue/u)
export const propulsiveEff = ratio => 2 / (1 + ratio);
// thrust per unit (mass flow·flight speed) and per unit jet power for ue/u = ν
export const thrustRatio = nu => nu - 1;

// ---------- blade element momentum theory ----------
// airfoil: Cl = a0(α − α0) up to Clmax, then a soft post-stall plateau; Cd = Cd0 + k(Cl − ClCd)²
export function airfoil(alpha, { a0 = 2 * Math.PI * 0.9, alpha0 = -2 * Math.PI / 180, Clmax = 1.3, Cd0 = 0.010, k = 0.012, ClCd = 0.2 } = {}) {
  let Cl = a0 * (alpha - alpha0), stalled = false;
  if (Cl > Clmax) { stalled = true; Cl = Clmax - 0.6 * (Cl - Clmax) / a0 * 2; Cl = Math.max(0.6 * Clmax, Cl); }
  if (Cl < -Clmax * 0.8) { stalled = true; Cl = -Clmax * 0.8; }
  let Cd = Cd0 + k * (Cl - ClCd) ** 2;
  if (stalled) Cd += 1.2 * Math.sin(Math.min(Math.abs(alpha - alpha0), Math.PI / 2)) ** 2;
  return { Cl, Cd, stalled };
}
// Rotor geometry: R tip radius, hub ratio, B blades, chord c(x) = c75·(taper law), pitch β(x) from a geometric pitch
// p (helix: tan β = p/(2πr)) plus an optional collective offset, or linear twist for rotors.
export function bladeGeometry({ D = 1.8, B = 2, c75 = 0.12, taper = 0.6, pitch = 1.4, twist = null, collective = 0, hub = 0.15 }, N = 40) {
  const R = D / 2, out = [];
  for (let i = 0; i < N; i++) {
    const x = hub + (1 - hub) * (i + 0.5) / N, r = x * R, dr = R * (1 - hub) / N;
    const beta = twist !== null ? collective + twist * (x - 0.75) : Math.atan(pitch / (2 * Math.PI * r)) + collective;
    // chord linear in radius through c75 at x = 0.75, with tip chord = taper·c75
    out.push({ x, r, dr, c: Math.max(0.2 * c75, c75 * (1 + (taper - 1) * (x - 0.75) / 0.25)), beta });
  }
  return { R, B, els: out };
}
// Solve every element: induced axial velocity vi from dT(blade) = dT(momentum, with tip loss F),
// swirl ut from the torque balance. V axial flight speed (0 for hover), rpm, ρ.
export function bemt(geo, { V = 0, rpm = 2400, rho = 1.225, af = {}, tolFrac = 1e-4, maxOuter = 20 }) {
  const { R, B, els } = geo, W = rpm * Math.PI / 30, n = rpm / 60, D = 2 * R;
  let T = 0, Q = 0;
  const span = [];
  for (const e of els) {
    const { r, dr, c, beta } = e;
    let ut = 0, vi = 0, res = null;
    const elem = vi_ => {
      const ua = V + vi_, ttan = W * r - ut / 2;
      const phi = Math.atan2(ua, ttan), Wr2 = ua * ua + ttan * ttan;
      const al = beta - phi, a = airfoil(al, af);
      const Cn = a.Cl * Math.cos(phi) - a.Cd * Math.sin(phi), Ct = a.Cl * Math.sin(phi) + a.Cd * Math.cos(phi);
      const f = B / 2 * (R - r) / (r * Math.max(Math.sin(Math.abs(phi)), 1e-3));
      const F = Math.max(0.02, 2 / Math.PI * Math.acos(Math.min(1, Math.exp(-f))));
      const dTb = 0.5 * rho * Wr2 * c * Cn * B * dr, dQb = 0.5 * rho * Wr2 * c * Ct * B * r * dr;
      const dTm = 4 * Math.PI * r * rho * Math.abs(ua) * vi_ * F * dr;
      return { phi, al, a, Cn, Ct, F, dTb, dQb, dTm, Wr2, ua };
    };
    const tol = tolFrac * W * r + 1e-9;
    for (let outer = 0; outer < maxOuter; outer++) {
      // bisection on vi so that blade thrust = momentum thrust (stops at a fixed fraction of the blade speed)
      let lo = -Math.max(0, V) * 0.49 - 1e-6, hi = Math.max(5, W * R * 0.5);
      if (elem(0).dTb <= 0) { lo = Math.min(-0.49 * V, -1e-3); hi = 0; }
      while (hi - lo > tol) { const m = (lo + hi) / 2, s = elem(m); if (s.dTb - s.dTm > 0) lo = m; else hi = m; }
      vi = (lo + hi) / 2; res = elem(vi);
      const nut = res.dQb / (4 * Math.PI * r * r * rho * Math.max(Math.abs(res.ua), 1e-3) * res.F * dr) * 2;
      const done = Math.abs(nut - ut) < 10 * tol;
      ut = outer < 2 ? nut : 0.5 * ut + 0.5 * nut;
      if (done) break;
    }
    T += res.dTb; Q += res.dQb;
    span.push({ x: e.x, r, c, beta, vi, ut, alpha: res.al, Cl: res.a.Cl, Cd: res.a.Cd, stalled: res.a.stalled, F: res.F, dTdr: res.dTb / dr, dQdr: res.dQb / dr, phi: res.phi });
  }
  const P = Q * W, A = Math.PI * R * R;
  const CT = T / (rho * n * n * D ** 4), CP = P / (rho * n ** 3 * D ** 5), CQ = Q / (rho * n * n * D ** 5);
  const J = V / (n * D), eta = P > 0 && T > 0 ? T * V / P : NaN;
  const FM = T > 0 && P > 0 ? T ** 1.5 / Math.sqrt(2 * rho * A) / P : NaN;
  return { T, Q, P, CT, CP, CQ, J, eta, FM, span, A, tipSpeed: W * R, tipMach: W * R / 340.3 };
}

// ---------- helicopters ----------
export const HELIS = [
  { id: 'r22', label: 'Robinson R22', m: 622, R: 3.84, B: 2, c: 0.18, Vt: 205, f: 0.75, Cd0: 0.010, kappa: 1.15, Pinst: 108e3 },
  { id: 'uh60', label: 'Sikorsky UH-60 Black Hawk', m: 9185, R: 8.18, B: 4, c: 0.53, Vt: 221, f: 2.6, Cd0: 0.010, kappa: 1.15, Pinst: 2 * 1410e3 },
  { id: 'ch53', label: 'CH-53E Super Stallion', m: 33300, R: 12.04, B: 7, c: 0.76, Vt: 223, f: 5.5, Cd0: 0.011, kappa: 1.15, Pinst: 3 * 3270e3 },
  { id: 'ingenuity', label: 'Ingenuity (Mars, one rotor equivalent)', m: 1.8, R: 0.6 * Math.SQRT2, B: 2, c: 0.07, Vt: 160, f: 0.02, Cd0: 0.035, kappa: 1.3, Pinst: 350, rho: 0.0145, g: 3.71 },
];
export function helicopter({ m, R, B, c, Vt, f, Cd0 = 0.01, kappa = 1.15, rho = 1.225, g = G0 }, V = 0) {
  const W = m * g, A = Math.PI * R * R, sigma = B * c / (Math.PI * R), vh = Math.sqrt(W / (2 * rho * A));
  const mu = V / Vt;
  const vi = Math.sqrt(-V * V / 2 + Math.sqrt(V ** 4 / 4 + vh ** 4));
  const Pi = kappa * W * vi, P0 = sigma * Cd0 / 8 * rho * A * Vt ** 3 * (1 + 4.65 * mu * mu), Pp = 0.5 * rho * V ** 3 * f;
  const CT = W / (rho * A * Vt * Vt);
  return { W, A, sigma, vh, vi, Pi, P0, Pp, P: Pi + P0 + Pp, CT, CTs: CT / sigma, mu, DL: W / A, FM: W * vh / (kappa * W * vh + P0) };
}
export function heliSweep(h, Vmax = 90) {
  const pts = []; for (let V = 0; V <= Vmax; V += 0.5) pts.push({ V, ...helicopter(h, V) });
  let iMin = 0; pts.forEach((p, i) => { if (p.P < pts[iMin].P) iMin = i; });
  let iR = 1; pts.forEach((p, i) => { if (i > 0 && p.P / p.V < pts[iR].P / pts[iR].V) iR = i; });
  const H = pts[0];
  return { pts, minP: pts[iMin], bestRange: pts[iR], hover: H, autoVertical: 1.7 * H.vh, autoForward: pts[iMin].P / H.W };
}
// multirotor hover
export function multirotor({ mass = 1.5, n = 4, D = 0.254, FM = 0.65, etaE = 0.8, Wh = 77, usable = 0.8, rho = 1.225, g = G0 }) {
  const T = mass * g / n, A = Math.PI * D * D / 4;
  const Pideal = T ** 1.5 / Math.sqrt(2 * rho * A), P = n * Pideal / FM / etaE;
  return { T, A, DL: T / A, Pideal: n * Pideal, P, endurance: Wh * 3600 * usable / P, vh: Math.sqrt(T / (2 * rho * A)), PL: mass * g / P };
}
