// Potential flow and exact viscous flows for the Fluid Flow Sandbox's theory tabs (no DOM): 2-D potential flow from
// elementary singularities or a typed complex potential, with ground images, stagnation points and Blasius forces;
// and exact solutions of the Navier–Stokes equations (Couette–Poiseuille, pipe flow, start-up Couette, Stokes'
// problems).
import { C, compileComplex } from '../lib/expr.js';

const PI = Math.PI, TAU = 2 * PI;

// =====================================================================================================
// Potential flow
// =====================================================================================================
// Elements (strengths per unit depth, counter-clockwise Γ positive):
//   uniform { U, alpha }           F = U e^{−iα} z
//   source  { x, y, m }            F = m/(2π) ln(z − z0)        (m < 0: sink)
//   vortex  { x, y, G }            F = −iΓ/(2π) ln(z − z0)
//   doublet { x, y, k, beta }      F = κ e^{iβ} / (2π (z − z0))  (β = 0: the doublet of uniform flow past a cylinder)
// The image system for a ground plane y = 0 is F_img(z) = conj(F(conj z)), for every element except the uniform stream.

function elF(e, z) {
  const d = [z[0] - (e.x || 0), z[1] - (e.y || 0)];
  switch (e.type) {
    case 'uniform': { const c = Math.cos(e.alpha || 0), s = Math.sin(e.alpha || 0); return C.mul([e.U * c, -e.U * s], z); }
    case 'source': { const L = C.log(d); return [e.m / TAU * L[0], e.m / TAU * L[1]]; }
    case 'vortex': { const L = C.log(d); return [e.G / TAU * L[1], -e.G / TAU * L[0]]; }
    case 'doublet': { const q = C.div([Math.cos(e.beta || 0), Math.sin(e.beta || 0)], d); return [e.k / TAU * q[0], e.k / TAU * q[1]]; }
  }
  return [0, 0];
}
// dF/dz = u − i v
function elW(e, z) {
  const d = [z[0] - (e.x || 0), z[1] - (e.y || 0)];
  switch (e.type) {
    case 'uniform': return [e.U * Math.cos(e.alpha || 0), -e.U * Math.sin(e.alpha || 0)];
    case 'source': { const q = C.div([1, 0], d); return [e.m / TAU * q[0], e.m / TAU * q[1]]; }
    case 'vortex': { const q = C.div([1, 0], d); return [e.G / TAU * q[1], -e.G / TAU * q[0]]; }
    case 'doublet': { const q = C.div([Math.cos(e.beta || 0), Math.sin(e.beta || 0)], C.mul(d, d)); return [-e.k / TAU * q[0], -e.k / TAU * q[1]]; }
  }
  return [0, 0];
}

// A flow: { elements, ground, expr, params } → evaluator with F(z), W(z) = dF/dz, velocity, Cp.
export function potentialFlow({ elements = [], ground = false, expr = null, params = {}, uref: uref0 } = {}) {
  let fx = null;
  if (expr) {
    const names = Object.keys(params);
    const g = compileComplex(expr, names), vals = names.map(n => params[n]);
    fx = z => g(z, ...vals);
    fx([0.37, 0.21]); // throws now on bad input
  }
  const hasImg = ground && elements.some(e => e.type !== 'uniform');
  const F = z => {
    let r = [0, 0];
    for (const e of elements) {
      const a = elF(e, z); r[0] += a[0]; r[1] += a[1];
      if (hasImg && e.type !== 'uniform') { const b = elF(e, [z[0], -z[1]]); r[0] += b[0]; r[1] -= b[1]; }
    }
    if (fx) { const a = fx(z); r[0] += a[0]; r[1] += a[1]; }
    return r;
  };
  const W = z => {
    let r = [0, 0];
    for (const e of elements) {
      const a = elW(e, z); r[0] += a[0]; r[1] += a[1];
      if (hasImg && e.type !== 'uniform') { const b = elW(e, [z[0], -z[1]]); r[0] += b[0]; r[1] -= b[1]; }
    }
    if (fx) { // analytic, so a central difference along x is the complex derivative
      const hh = 1e-5 * Math.max(1, Math.hypot(z[0], z[1]));
      const a = fx([z[0] + hh, z[1]]), b = fx([z[0] - hh, z[1]]);
      r[0] += (a[0] - b[0]) / (2 * hh); r[1] += (a[1] - b[1]) / (2 * hh);
    }
    return r;
  };
  const Uinf = elements.filter(e => e.type === 'uniform').reduce((s, e) => s + e.U, 0);
  const uref = uref0 > 0 ? uref0 : Uinf > 0 ? Uinf : 1;
  const vel = (x, y) => { const w = W([x, y]); return [w[0], -w[1]]; };
  const cp = (x, y) => { const w = W([x, y]); return 1 - (w[0] * w[0] + w[1] * w[1]) / (uref * uref); };
  // net circulation and source strength of the real singularities (images excluded)
  const Gam = elements.filter(e => e.type === 'vortex').reduce((s, e) => s + e.G, 0);
  const Msrc = elements.filter(e => e.type === 'source').reduce((s, e) => s + e.m, 0);
  return { F, W, vel, cp, Uinf, uref, Gam, Msrc, ground, elements };
}

// ψ, φ, Cp and speed on a grid over the box [x0,x1]×[y0,y1] (j = 0 at y0). NaN inside the ground and near singularities.
export function sampleGrid(flow, box, nx, ny) {
  const n = nx * ny, psi = new Float64Array(n), phi = new Float64Array(n), cp = new Float64Array(n), spd = new Float64Array(n);
  const sing = flow.elements.filter(e => e.type !== 'uniform').map(e => [e.x || 0, e.y || 0]);
  if (flow.ground) for (const [x, y] of sing.slice()) sing.push([x, -y]);
  const dx = (box.x1 - box.x0) / (nx - 1), dy = (box.y1 - box.y0) / (ny - 1), r2 = (0.6 * Math.max(dx, dy)) ** 2;
  for (let j = 0; j < ny; j++) {
    const y = box.y0 + j * dy;
    for (let i = 0; i < nx; i++) {
      const x = box.x0 + i * dx, k = j * nx + i;
      let bad = flow.ground && y < -1e-9;
      if (!bad) for (const s of sing) if ((x - s[0]) ** 2 + (y - s[1]) ** 2 < r2) { bad = true; break; }
      if (bad) { psi[k] = phi[k] = cp[k] = spd[k] = NaN; continue; }
      const f = flow.F([x, y]), w = flow.W([x, y]);
      psi[k] = f[1]; phi[k] = f[0];
      const q2 = w[0] * w[0] + w[1] * w[1];
      spd[k] = Math.sqrt(q2); cp[k] = 1 - q2 / (flow.uref * flow.uref);
    }
  }
  return { psi, phi, cp, spd, nx, ny, box };
}

// Stagnation points (W = 0): scan the grid for local minima of |W|, then Newton on the analytic W.
export function stagnationPoints(flow, box, { n = 60 } = {}) {
  const out = [];
  const dW = z => { const hh = 1e-6 * Math.max(1, Math.hypot(z[0], z[1])); const a = flow.W([z[0] + hh, z[1]]), b = flow.W([z[0] - hh, z[1]]); return [(a[0] - b[0]) / (2 * hh), (a[1] - b[1]) / (2 * hh)]; };
  const nx = n, ny = Math.max(8, Math.round(n * (box.y1 - box.y0) / (box.x1 - box.x0)));
  const M = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = box.x0 + (i + 0.5) * (box.x1 - box.x0) / nx, y = box.y0 + (j + 0.5) * (box.y1 - box.y0) / ny;
    const w = flow.W([x, y]); M[j * nx + i] = Math.hypot(w[0], w[1]);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = M[j * nx + i]; if (!isFinite(v)) continue;
    let isMin = true;
    for (let dj = -1; dj <= 1 && isMin; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      if (M[jj * nx + ii] < v) { isMin = false; break; }
    }
    if (!isMin) continue;
    let z = [box.x0 + (i + 0.5) * (box.x1 - box.x0) / nx, box.y0 + (j + 0.5) * (box.y1 - box.y0) / ny], ok = false;
    for (let it = 0; it < 40; it++) {
      const w = flow.W(z), d = dW(z);
      if (!isFinite(w[0]) || !isFinite(d[0])) break;
      const st = C.div(w, d); z = [z[0] - st[0], z[1] - st[1]];
      if (Math.hypot(st[0], st[1]) < 1e-11 * Math.max(1, Math.hypot(z[0], z[1]))) { ok = true; break; }
    }
    if (!ok) continue;
    const w = flow.W(z);
    if (Math.hypot(w[0], w[1]) > 1e-7 * flow.uref) continue;
    if (z[0] < box.x0 || z[0] > box.x1 || z[1] < box.y0 || z[1] > box.y1) continue;
    if (flow.ground && z[1] < -1e-9) continue;
    if (out.some(p => Math.hypot(p.x - z[0], p.y - z[1]) < 1e-5)) continue;
    out.push({ x: z[0], y: Math.abs(z[1]) < 1e-12 ? 0 : z[1], psi: flow.F(z)[1] });
  }
  // on a ground plane v = 0, so stagnation points there are sign changes of u along y = 0
  if (flow.ground) {
    const N = 600, u = x => flow.W([x, 0])[0];
    let xa = box.x0, ua = u(xa);
    for (let k = 1; k <= N; k++) {
      const xb = box.x0 + (box.x1 - box.x0) * k / N, ub = u(xb);
      if (isFinite(ub) && Math.abs(ub) < 1e-12 * flow.uref) { if (!out.some(p => Math.hypot(p.x - xb, p.y) < 1e-5)) out.push({ x: xb, y: 0, psi: flow.F([xb, 0])[1] }); }
      else if (isFinite(ua) && isFinite(ub) && ua * ub < 0 && Math.abs(ua - ub) < 4 * flow.uref) {
        let lo = xa, hi = xb, fl = ua;
        for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi), fm = u(m); if (fm * fl > 0) { lo = m; fl = fm; } else hi = m; }
        const x = 0.5 * (lo + hi);
        if (!out.some(p => Math.hypot(p.x - x, p.y) < 1e-5)) out.push({ x, y: 0, psi: flow.F([x, 0])[1] });
      }
      xa = xb; ua = ub;
    }
  }
  return out;
}

// Cp around a circle (x0, y0, R) at angles θ (from the +x axis), and along the ground y = 0
export function cpOnCircle(flow, x0, y0, R, n = 181, th0 = 0, th1 = TAU) {
  const th = [], cp = [];
  for (let k = 0; k < n; k++) { const t = th0 + (th1 - th0) * k / (n - 1); th.push(t); cp.push(flow.cp(x0 + R * Math.cos(t), y0 + R * Math.sin(t))); }
  return { th, cp };
}
export function cpAlongLine(flow, x0, x1, y, n = 241) {
  const x = [], cp = [];
  for (let k = 0; k < n; k++) { const xx = x0 + (x1 - x0) * k / (n - 1); x.push(xx); cp.push(flow.cp(xx, y)); }
  return { x, cp };
}

// Force per unit depth on whatever lies inside a circle (center c, radius r) by Blasius' theorem:
//   X − iY = (iρ/2) ∮ W² dz.
// For a closed body in a uniform stream this gives the Kutta–Joukowski lift −ρU∞Γ normal to the stream and zero
// drag (d'Alembert). The circle must not cut through any singularity or image.
export function blasiusForce(flow, cx, cy, r, rho = 1, n = 720) {
  let sr = 0, si = 0;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) * TAU / n, e = [Math.cos(t), Math.sin(t)];
    const w = flow.W([cx + r * e[0], cy + r * e[1]]), w2 = C.mul(w, w);
    const dz = [-r * e[1] * TAU / n, r * e[0] * TAU / n];
    const q = C.mul(w2, dz); sr += q[0]; si += q[1];
  }
  // (iρ/2)(sr + i si) = (ρ/2)(−si + i sr) = X − iY
  return { Fx: -rho / 2 * si, Fy: -rho / 2 * sr };
}
// A contour that encloses every real singularity but no image: center and radius, or null when none exists
export function forceContour(flow) {
  const S = flow.elements.filter(e => e.type !== 'uniform').map(e => [e.x || 0, e.y || 0]);
  if (!S.length) return null;
  const cx = S.reduce((a, p) => a + p[0], 0) / S.length, cy = S.reduce((a, p) => a + p[1], 0) / S.length;
  const ext = Math.max(...S.map(p => Math.hypot(p[0] - cx, p[1] - cy)));
  let r = ext + 0.6;
  if (flow.ground) {
    const dImg = Math.min(...S.map(p => Math.hypot(p[0] - cx, -p[1] - cy)));
    if (dImg <= ext * 1.05 + 1e-9) return null;
    r = Math.min(r, ext + 0.85 * (dImg - ext));
  }
  return { x: cx, y: cy, r };
}

// Presets for the Potential flow tab. Lengths in body radii, speeds in U∞.
export const POT_PRESETS = [
  { id: 'cylinder', label: 'Cylinder (uniform + doublet)', group: 'Bodies', note: 'A doublet of strength κ = 2πU∞R² in a uniform stream: the dividing streamline is a circle of radius R. Cp = 1 − 4 sin²θ on the surface; no lift and no drag (d\'Alembert\'s paradox).',
    elements: [{ type: 'uniform', U: 1, alpha: 0 }, { type: 'doublet', x: 0, y: 0, k: TAU, beta: 0 }], circle: { x: 0, y: 0, R: 1 } },
  { id: 'spinning', label: 'Lifting cylinder (+ vortex)', group: 'Bodies', note: 'Add a clockwise vortex: the stagnation points slide down the cylinder and it lifts L′ = ρU∞Γ (Kutta–Joukowski). When |Γ| > 4πU∞R they leave the surface and merge into one point in the flow.',
    elements: [{ type: 'uniform', U: 1, alpha: 0 }, { type: 'doublet', x: 0, y: 0, k: TAU, beta: 0 }, { type: 'vortex', x: 0, y: 0, G: -2 * PI }], circle: { x: 0, y: 0, R: 1 } },
  { id: 'rankine', label: 'Rankine oval (source + sink)', group: 'Bodies', note: 'A source upstream and an equal sink downstream in a uniform stream. Their net strength is zero, so the dividing streamline closes into an oval body.',
    elements: [{ type: 'uniform', U: 1, alpha: 0 }, { type: 'source', x: -1, y: 0, m: 2 * PI }, { type: 'source', x: 1, y: 0, m: -2 * PI }] },
  { id: 'halfbody', label: 'Rankine half-body (source)', group: 'Bodies', note: 'A single source in a stream: an open body whose width far downstream is m/U∞, the width needed to carry the source\'s outflow.',
    elements: [{ type: 'uniform', U: 1, alpha: 0 }, { type: 'source', x: 0, y: 0, m: 2 * PI }] },
  { id: 'hangar', label: 'Hangar on the ground', group: 'With the ground', note: 'A semicircular hangar on flat ground: a doublet on the ground with its image. The roof sees Cp = 1 − 4 sin²θ, so on a windy day the suction lifts it while the inside stays at the outside pressure.',
    elements: [{ type: 'uniform', U: 1, alpha: 0 }, { type: 'doublet', x: 0, y: 0, k: PI, beta: 0 }], ground: true, circle: { x: 0, y: 0, R: 1, half: true } },
  { id: 'gvortex', label: 'Vortex near the ground', group: 'With the ground', note: 'An airfoil flying low, modeled as one clockwise vortex Γ = πhU∞ at height h with its image below the ground. The ground under it sees suction (Cp < 0). The image vortex slows the air at the airfoil to U∞(1 − Γ/(4πhU∞)), so this simple model loses lift near the ground (0.75 ρU∞Γ here); real wings gain lift in ground effect because the image also cancels their downwash.',
    elements: [{ type: 'uniform', U: 1, alpha: 0 }, { type: 'vortex', x: 0, y: 1, G: -PI }], ground: true, groundCp: true },
  { id: 'gsource', label: 'Source near a wall', group: 'With the ground', note: 'A source above a wall with an image source of the same sign: the wall becomes a streamline and the flow along it peaks below the source.',
    elements: [{ type: 'source', x: 0, y: 1, m: TAU }], ground: true, groundCp: true },
  { id: 'tornado', label: 'Tornado / drain (sink + vortex)', group: 'Without a stream', note: 'A sink plus a vortex: fluid spirals in along logarithmic spirals. The speed grows as 1/r, so the pressure falls as 1/r² toward the center.',
    elements: [{ type: 'source', x: 0, y: 0, m: -TAU }, { type: 'vortex', x: 0, y: 0, G: 2 * TAU }] },
  { id: 'pair', label: 'Vortex pair', group: 'Without a stream', note: 'Two opposite vortices, like a wing\'s tip vortices seen from behind. Each moves with the velocity the other induces, so the pair drifts down together at Γ/(2πd).',
    elements: [{ type: 'vortex', x: -1, y: 0, G: TAU }, { type: 'vortex', x: 1, y: 0, G: -TAU }] },
  { id: 'sourcesink', label: 'Source–sink pair', group: 'Without a stream', note: 'Streamlines are circles through both points; bringing them together with m·d fixed gives the doublet.',
    elements: [{ type: 'source', x: -1, y: 0, m: TAU }, { type: 'source', x: 1, y: 0, m: -TAU }] },
];

export const EXPR_PRESETS = [
  { id: 'cyl', label: 'Cylinder: U(z + R²/z)', expr: 'U*(z + R^2/z)', params: { U: 1, R: 1 } },
  { id: 'spin', label: 'Lifting cylinder', expr: 'U*(z + R^2/z) + i*G/(2*pi)*log(z)', params: { U: 1, R: 1, G: 6 } },
  { id: 'corner', label: 'Flow into a 90° corner: z²', expr: 'U*z^2', params: { U: 0.5 } },
  { id: 'wedge', label: 'Flow round a wedge: z^n', expr: 'U*z^n', params: { U: 1, n: 1.5 } },
  { id: 'edge', label: 'Round a sharp edge: z^(1/2)', expr: 'U*sqrt(z)', params: { U: 1 } },
  { id: 'row', label: 'Row of vortices (shear layer)', expr: '-i*G/(2*pi)*log(sin(pi*z/a))', params: { G: 1, a: 1.5 } },
  { id: 'ellipse', label: 'Uniform flow at an angle', expr: 'U*exp(-i*al)*z', params: { U: 1, al: 0.3 } },
];

// =====================================================================================================
// Exact viscous solutions
// =====================================================================================================
// Couette–Poiseuille channel: lower wall at rest, upper wall moving at U, gap h, G = −dp/dx
export function couette({ U = 1, h = 0.01, G = 0, mu = 1e-3 } = {}, n = 101) {
  const y = [], u = [];
  for (let k = 0; k < n; k++) { const yy = h * k / (n - 1); y.push(yy); u.push(U * yy / h + G / (2 * mu) * yy * (h - yy)); }
  const Q = U * h / 2 + G * h ** 3 / (12 * mu);
  const tau0 = mu * U / h + G * h / 2, tauh = mu * U / h - G * h / 2;
  const P = G * h * h / (2 * mu * (U || 1e-30));         // Schlichting's P = −(h²/2μU) dp/dx; backflow below −1
  const ymax = G !== 0 ? h / 2 + mu * U / (G * h) : NaN;  // where du/dy = 0
  return { y, u, Q, ubar: Q / h, tau0, tauh, P, ymax: ymax > 0 && ymax < h ? ymax : NaN, backflow: Math.min(...u) < -1e-12 * Math.abs(U || 1) };
}
// Hagen–Poiseuille pipe flow, radius R, G = −dp/dx
export function pipe({ R = 0.01, G = 100, mu = 1e-3, rho = 1000 } = {}, n = 101) {
  const r = [], u = [];
  for (let k = 0; k < n; k++) { const rr = -R + 2 * R * k / (n - 1); r.push(rr); u.push(G / (4 * mu) * (R * R - rr * rr)); }
  const umax = G * R * R / (4 * mu), Q = PI * G * R ** 4 / (8 * mu), ubar = umax / 2, tauw = G * R / 2;
  const Re = rho * ubar * 2 * R / mu, f = 8 * tauw / (rho * ubar * ubar);
  return { r, u, umax, Q, ubar, tauw, Re, f, laminar: Re < 2300 };
}
// erf (Abramowitz & Stegun 7.1.26 refined by a series near zero), |error| < 1e-7
export function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  if (x < 0.5) { let sum = 0, term = x, k = 0; while (Math.abs(term) > 1e-16 && k < 60) { sum += term / (2 * k + 1); k++; term *= -x * x / k; } return s * 2 / Math.sqrt(PI) * sum; }
  const t = 1 / (1 + 0.5 * x);
  const y = 1 - t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return s * y;
}
// start-up Couette: the lower wall jumps to U at t = 0, upper wall (y = h) at rest
export function startupCouette({ U = 1, h = 1, nu = 1, t = 0.05 } = {}, n = 101, terms = 200) {
  const y = [], u = [];
  for (let k = 0; k < n; k++) {
    const eta = k / (n - 1); let s = 0;
    for (let m = 1; m <= terms; m++) s += Math.sin(m * PI * eta) / m * Math.exp(-m * m * PI * PI * nu * t / (h * h));
    y.push(eta * h); u.push(t <= 0 ? (k === 0 ? U : 0) : U * (1 - eta) - 2 * U / PI * s);
  }
  return { y, u, tau: nu * t / (h * h) };
}
// Stokes' first problem (impulsively started plate) and second problem (oscillating plate)
export const stokes1 = (y, t, U, nu) => t <= 0 ? 0 : U * (1 - erf(y / (2 * Math.sqrt(nu * t))));
export const stokes2 = (y, t, U, nu, w) => { const k = Math.sqrt(w / (2 * nu)); return U * Math.exp(-k * y) * Math.cos(w * t - k * y); };
