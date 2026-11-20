// Lift rotors (lift + cruise eVTOL): where they sit, and the power to hover and climb on them.
//
// Layout: the rotors are split evenly left and right, two to a boom, one ahead of the wing and one behind it; booms
// are spaced outward from the fuselage by a little more than a rotor diameter.
//
// Hover by momentum theory on the total disc area A = n·πR²: the induced velocity in hover is v_h = √(W / 2ρA),
// and in a vertical climb at V_c the shaft power is
//   P = W · (V_c/2 + √((V_c/2)² + v_h²)) / FM
// with FM the figure of merit (ideal induced power over actual power: profile losses, tip losses, swirl). A descent
// is taken at hover power (conservative: it stays clear of the vortex-ring state). The motors and controllers lose a
// further η_motor.
import { firstOf } from '../model/vehicle.js';
import { atmosphere } from '../adapters/aircraft.js';
import { bladeGeometry, bemt } from '../../core/solvers/rotors.js';

const DEG = Math.PI / 180;
export const HOVER_LEVELS = [
  { id: 'momentum', label: 'momentum', note: 'Momentum theory on the disc area with a fixed figure of merit' },
  { id: 'bem', label: 'blade element', note: 'Blade element momentum theory (core rotors.bemt, Prandtl tip loss): constant-chord blades from the solidity and linear twist, collective trimmed so each rotor lifts its share' },
];

// Hover by blade element momentum theory: the collective is trimmed (bisection) until each rotor's thrust carries its
// share of W (+ nothing for the climb: the climb enters as the axial inflow V_c). Blades: constant chord
// c = σπR/B, linear twist, root cut-out 15%, and the core's default rotor section. Same fields as hoverPower, plus
// the figure of merit it implies, the collective, the blade loading C_T/σ and the stalled fraction of the blade.
export function hoverBEM({ rotor, W, rho, a = 340, climb = 0 }) {
  const n = Math.max(1, Math.round(rotor.count)), R = rotor.radius, B = Math.round(rotor.blades), c = rotor.solidity * Math.PI * R / B;
  const T = W / n, rpm = rotor.tipSpeed / R * 30 / Math.PI, Vc = Math.max(0, climb);
  const solve = coll => bemt(bladeGeometry({ D: 2 * R, B, c75: c, taper: 1, twist: rotor.twist * DEG, collective: coll, hub: 0.15 }, 30), { V: Vc, rpm, rho });
  // thrust rises with collective until the blade stalls: scan for the most thrust, then bisect below it
  let best = { c: 0, T: -Infinity }, res;
  for (let c = 0; c <= 30; c += 2) { const r = solve(c * DEG); if (r.T > best.T) best = { c, T: r.T }; }
  if (best.T < T) throw new Error(`the rotors cannot lift ${Math.round(T)} N each at ${rotor.tipSpeed} m/s tip speed (at most ${Math.round(best.T)} N): more solidity, radius or tip speed`);
  let lo = -5 * DEG, hi = best.c * DEG;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; res = solve(m); if (res.T < T) lo = m; else hi = m; }
  res = solve(hi);
  const A = n * Math.PI * R * R, vh = Math.sqrt(W / (2 * rho * A)), P = n * res.P, Pideal = W * (Vc / 2 + Math.sqrt((Vc / 2) ** 2 + vh * vh));
  return { n, A, vh, Vc, diskLoading: W / A, Pideal, P, Pel: P / rotor.motorEff, perRotor: res.P, thrustPerRotor: T, tipMach: rotor.tipSpeed / a, powerLoading: W / P,
    FM: Pideal / P, collective: hi / DEG, CTsigma: T / (rho * Math.PI * R * R * rotor.tipSpeed ** 2) / rotor.solidity,
    stalled: res.span.filter(s => s.stalled).length / res.span.length, span: res.span, method: 'bem' };
}

export function rotorLayout(doc) {
  const r = firstOf(doc, 'rotor'), w = firstOf(doc, 'wing'), f = firstOf(doc, 'fuselage');
  if (!r || !w) return [];
  const n = Math.max(1, Math.round(r.count)), R = r.radius, half = (f ? f.width : 0) / 2;
  const out = [], perSide = Math.ceil(n / 2);
  for (const side of [-1, 1]) for (let j = 0; j < perSide && out.length < n; j++) {
    const boom = Math.floor(j / 2), fore = j % 2 === 0;
    const y = side * (half + 1.15 * R + boom * 2.3 * R);
    out.push({ x: fore ? w.x - 1.1 * R : w.x + w.rootChord + 1.1 * R, y, R, boom, side });
  }
  return out;
}

// Hover numbers for a vehicle of weight W (N) at density rho: { A, vh, diskLoading, P (shaft), Pel, tipMach, ... }
export function hoverPower({ rotor, W, rho, a = 340, climb = 0 }) {
  const n = Math.max(1, Math.round(rotor.count)), A = n * Math.PI * rotor.radius ** 2;
  const vh = Math.sqrt(W / (2 * rho * A)), Vc = Math.max(0, climb);
  const Pideal = W * (Vc / 2 + Math.sqrt((Vc / 2) ** 2 + vh * vh));
  const P = Pideal / rotor.figureOfMerit, Pel = P / rotor.motorEff;
  return { n, A, vh, Vc, diskLoading: W / A, Pideal, P, Pel, perRotor: P / n, thrustPerRotor: W / n, tipMach: rotor.tipSpeed / a, powerLoading: W / P };
}

// The Hover node: hover at the field, on the vehicle's lift rotors
export function hoverNode() {
  return {
    id: 'hover', label: 'Hover', detail: 'momentum · FM', after: ['mass', 'atmosphere'], reads: ['rotor.*', 'mission.fieldElevation', 'mission.dT'],
    outputs: ['P', 'Pel', 'diskLoading', 'vh', 'tipMach', 'FM'],
    fidelity: { levels: HOVER_LEVELS, value: 'momentum' },
    run({ doc, inputs, fidelity }) {
      const rotor = firstOf(doc, 'rotor');
      if (!rotor) throw new Error('needs lift rotors');
      const atm = atmosphere(doc.mission.fieldElevation ?? 0, doc.mission.dT ?? 0);
      const W = inputs.mass.total * 9.80665;
      const h = fidelity === 'bem' ? hoverBEM({ rotor, W, rho: atm.rho, a: atm.a }) : { ...hoverPower({ rotor, W, rho: atm.rho, a: atm.a }), FM: rotor.figureOfMerit, method: 'momentum' };
      return { ...h, kW: h.Pel / 1000, diskLoadingKg: h.diskLoading / 9.80665, rho: atm.rho, CTsigma: h.CTsigma ?? (h.thrustPerRotor / (atm.rho * Math.PI * rotor.radius ** 2 * rotor.tipSpeed ** 2) / rotor.solidity) };
    },
  };
}
