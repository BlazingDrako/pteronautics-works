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
    outputs: ['P', 'Pel', 'diskLoading', 'vh', 'tipMach'],
    run({ doc, inputs }) {
      const rotor = firstOf(doc, 'rotor');
      if (!rotor) throw new Error('needs lift rotors');
      const atm = atmosphere(doc.mission.fieldElevation ?? 0, doc.mission.dT ?? 0);
      const W = inputs.mass.total * 9.80665;
      const h = hoverPower({ rotor, W, rho: atm.rho, a: atm.a });
      return { ...h, kW: h.Pel / 1000, diskLoadingKg: h.diskLoading / 9.80665, rho: atm.rho };
    },
  };
}
