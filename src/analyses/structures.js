// Wing structure, beam level: the spar sized for bending and shear at the ultimate load factor.
//
// Each half-wing is a cantilever from the root carrying an elliptic lift distribution of n_ult·W/2, with
// n_ult = 1.5 × the limit load factor (no inertia relief from the wing's own weight: conservative). At span station y
//   bending moment M(y) = ∫_y^s L'(η)(η − y) dη,   shear V(y) = ∫_y^s L'(η) dη
// The spar is an I-beam whose depth is 90% of the section thickness, h = 0.9·(t/c)·c(y). Two caps carry the bending:
//   cap area A(y) = M(y) / (σ·h(y)),   cap mass = 2ρ∫A dy
// and a web the shear: web area V/τ, so web mass = ρ∫V/τ dy (independent of depth). Skin, ribs and controls are an
// areal mass on top. Half-wings are integrated over N stations and doubled.

export const SPAR_MATERIALS = {
  carbon: { label: 'Carbon fibre (UD caps)', rho: 1600, sigma: 550e6, tau: 80e6 },
  glass: { label: 'Glass fibre (UD caps)', rho: 1900, sigma: 350e6, tau: 60e6 },
  aluminium: { label: 'Aluminium 2024-T3', rho: 2780, sigma: 290e6, tau: 170e6 },
  spruce: { label: 'Spruce', rho: 450, sigma: 45e6, tau: 6e6 },
};

// span: m, chord(eta) (m, eta = 2y/b in 0..1), tc(eta), W: N, n: limit load factor, material key, skin: kg/m², S: m²
export function wingBeam({ span, chord, tc, W, n, material = 'carbon', skin, S, N = 60 }) {
  const mat = SPAR_MATERIALS[material];
  if (!mat) throw new Error(`unknown spar material "${material}"`);
  const s = span / 2, nUlt = 1.5 * n, L = nUlt * W / 2;          // lift on one half-wing
  const peak = 4 * L / (Math.PI * s);                                // elliptic: L'(y) = peak·√(1 − (y/s)²)
  const ys = Array.from({ length: N + 1 }, (_, i) => s * i / N), dy = s / N;
  // shear in closed form (the moment then by trapezoids inward from the tip): ∫_y^s peak·√(1 − (η/s)²) dη = peak·s/2·(π/2 − asin u − u√(1 − u²)), u = y/s
  const V = ys.map(y => { const u = Math.min(1, y / s); return peak * s / 2 * (Math.PI / 2 - Math.asin(u) - u * Math.sqrt(1 - u * u)); });
  const M = new Array(N + 1).fill(0);
  for (let i = N - 1; i >= 0; i--) M[i] = M[i + 1] + (V[i] + V[i + 1]) / 2 * dy;
  const h = ys.map(y => 0.9 * tc(y / s) * chord(y / s));
  const A = ys.map((_, i) => M[i] / (mat.sigma * h[i]));
  const trap = f => f.reduce((acc, v, i) => (i ? acc + (v + f[i - 1]) / 2 * dy : 0), 0);
  const caps = 2 * 2 * mat.rho * trap(A);                         // two caps, two half-wings
  const web = 2 * mat.rho * trap(V.map(v => v / mat.tau));
  const skinMass = skin * S;
  return {
    material: mat.label, nUlt, rootMoment: M[0], rootShear: V[0], rootDepth: h[0], rootCap: A[0],
    caps, web, skin: skinMass, total: caps + web + skinMass,
    stations: ys.map((y, i) => ({ eta: y / s, y, M: M[i], V: V[i], h: h[i], A: A[i] })),
  };
}

// Wing mass for the mass node. level 'areal': areal mass × area. level 'beam': the beam above, iterated with the
// takeoff weight (which includes the wing), starting from the areal estimate.
export function wingMass({ wing, g, others, level }) {
  if (level !== 'beam') return { mass: wing.arealMass * g.S, level: 'areal' };
  const chord = e => g.P.chord(e), tc = e => g.root.tc + (g.tip.tc - g.root.tc) * e;
  let m = wing.arealMass * g.S, beam = null;
  for (let k = 0; k < 30; k++) {
    beam = wingBeam({ span: g.span, chord, tc, W: (others + m) * 9.80665, n: wing.loadFactor, material: wing.spar, skin: wing.skinMass, S: g.S });
    if (Math.abs(beam.total - m) < 1e-9 * Math.max(1, m)) { m = beam.total; break; }
    m = beam.total;
  }
  return { mass: m, level: 'beam', beam };
}
