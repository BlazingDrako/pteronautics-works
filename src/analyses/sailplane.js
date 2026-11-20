// The sailplane analysis graph: the fixed-wing airframe nodes (atmosphere, geometry, sections, aero, mass, stability)
// without the motor and battery, and a Glide node in place of Performance and Mission.
//
// Glide: the drag polar (parabolic, or with camber flaps flattened over the flap range; see glidePolar) flown at
// weight W and density ρ gives the sink rate at each airspeed, w(V) = V·CD/CL with CL = 2W / (ρV²S). From it come the
// best glide, the minimum sink, and MacCready's speed to fly: between thermals that climb at Wc, the average cross-country speed is
//   V_xc(V) = V · Wc / (Wc + w(V)),
// greatest at the speed where the tangent from (0, Wc) touches the polar.
import { fixedWingNodes } from './fixedWing.js';
import { evaluateRequirements } from './requirements.js';
import { G0 } from '../adapters/aircraft.js';

const golden = (f, a, b, it = 60) => {        // maximise f on [a, b]
  const r = (Math.sqrt(5) - 1) / 2; let c = b - r * (b - a), d = a + r * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < it; i++) { if (fc > fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); } }
  return (a + b) / 2;
};
// maximise f on [a, b]: a grid for the bracket, then golden section inside it (safe on flat or kinked curves)
const argmax = (f, a, b, n = 200) => {
  let best = a, bv = -Infinity;
  for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n, v = f(x); if (v > bv) { bv = v; best = x; } }
  const h = (b - a) / n;
  return golden(f, Math.max(a, best - h), Math.min(b, best + h));
};

// Camber flaps: between these lift coefficients the flaps keep the wing on its least-drag section lift, so the
// viscous drag-due-to-lift (the part of 1/e above the inviscid span efficiency) vanishes there; and thermalling flap
// adds to CL,max.
export const FLAP_RANGE = [0.15, 1.1], FLAP_DCLMAX = 0.25;

// { S, AR, e, eInv, CD0, CLmax, W (N), rho, flaps } → the polar and its speeds.
//   CD = CD0 + kp·(CL − CLf)² + CL²/(π·AR·e_inv),  kp = (1/e − 1/e_inv) / (π·AR)
// Without flaps CLf = 0, which is the parabolic polar CD0 + CL²/(π·e·AR). With camber flaps CLf is CL clamped to the
// flap range.
export function glidePolar({ S, AR, e, eInv = e, CD0, CLmax, W, rho, flaps = false }) {
  const kInv = 1 / (Math.PI * eInv * AR), kp = Math.max(0, 1 / (Math.PI * e * AR) - kInv);
  const CLm = CLmax + (flaps ? FLAP_DCLMAX : 0);
  const cd = CL => { const f = flaps ? Math.min(FLAP_RANGE[1], Math.max(FLAP_RANGE[0], CL)) : 0; return CD0 + kp * (CL - f) ** 2 + kInv * CL * CL; };
  const CLof = V => 2 * W / (rho * V * V * S);
  const sink = V => { const CL = CLof(V); return V * cd(CL) / CL; };
  const Vs = Math.sqrt(2 * W / (rho * S * CLm));
  const lo = Math.max(Vs * 1.02, 1), hi = Vs * 4;
  const Vmd = argmax(V => V / sink(V), lo, hi), LDmax = Vmd / sink(Vmd);
  const Vms = argmax(V => -sink(V), lo, Vmd);
  const curve = Array.from({ length: 121 }, (_, i) => { const V = lo + (hi - lo) * i / 120; return { V, sink: sink(V) }; });
  // MacCready: the speed between thermals that gives the best average speed for a climb rate Wc
  const speedToFly = Wc => {
    const V = argmax(v => v * Wc / (Wc + sink(v)), Math.max(lo, Vmd * 0.9), hi);
    return { Wc, V, sink: sink(V), Vxc: V * Wc / (Wc + sink(V)) };
  };
  return { sink, cd, Vs, Vmd, LDmax, Vms, minSink: sink(Vms), curve, speedToFly, wingLoading: W / G0 / S, CLmax: CLm, flaps };
}

export function sailplaneNodes(options) {
  const base = fixedWingNodes(options).filter(n => !['performance', 'mission', 'requirements'].includes(n.id));
  return [
    ...base,
    {
      id: 'glide', label: 'Glide', detail: 'polar · MacCready', after: ['geometry', 'aero', 'mass', 'atmosphere'], reads: ['mission.climbRate'],
      outputs: ['Vs', 'LDmax', 'Vmd', 'minSink', 'Vms', 'curve', 'xc', 'xcSpeed', 'mc'],
      run({ doc, inputs }) {
        const g = inputs.geometry, ae = inputs.aero, m = inputs.mass, atm = inputs.atmosphere.cruise;
        const flaps = g.wing.flaps === 'camber';
        const pol = glidePolar({ S: g.S, AR: g.AR, e: ae.e, eInv: ae.eInv, CD0: ae.CD0, CLmax: ae.CLmax, W: m.total * G0, rho: atm.rho, flaps });
        const Wc = doc.mission.climbRate ?? 1.5;
        if (!(Wc > 0)) throw new Error('the average thermal climb must be above zero');
        const xc = pol.speedToFly(Wc);
        // a MacCready table for a range of climb rates
        const mc = [0.5, 1, 1.5, 2, 2.5, 3, 4].map(w => pol.speedToFly(w));
        const { sink, cd, speedToFly, ...rest } = pol;
        return { ...rest, xc, xcSpeed: xc.Vxc * 3.6, mc, Wc, glideRatioAt: V => V / sink(V) };
      },
    },
    {
      id: 'requirements', label: 'Requirements', after: ['geometry', 'aero', 'mass', 'stability', 'glide'], reads: ['requirements.*'],
      outputs: ['list', 'met', 'total'],
      run({ doc, inputs }) {
        const list = evaluateRequirements(doc.requirements || [], inputs);
        return { list, met: list.filter(r => r.status === 'met').length, marginal: list.filter(r => r.status === 'marginal').length, failing: list.filter(r => r.status === 'fail').length, total: list.length };
      },
    },
  ];
}
