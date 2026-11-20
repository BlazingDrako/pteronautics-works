// The sailplane analysis graph: the fixed-wing airframe nodes (atmosphere, geometry, sections, aero, mass, stability)
// without the motor and battery, and a Glide node in place of Performance and Mission.
//
// Glide: the parabolic drag polar CD = CD0 + CL²/(π e AR) flown at weight W and density ρ gives the sink rate at each
// airspeed, w(V) = V·CD/CL with CL = 2W / (ρV²S). From it come the best glide (L/D max at CL = √(CD0 π e AR)), the
// minimum sink, and MacCready's speed to fly: between thermals that climb at Wc, the average cross-country speed is
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

// { S, AR, e, CD0, CLmax, W (N), rho } → the polar and its speeds
export function glidePolar({ S, AR, e, CD0, CLmax, W, rho }) {
  const k = 1 / (Math.PI * e * AR);
  const CLof = V => 2 * W / (rho * V * V * S);
  const sink = V => { const CL = CLof(V); return V * (CD0 + k * CL * CL) / CL; };
  const Vs = Math.sqrt(2 * W / (rho * S * CLmax));
  const CLmd = Math.sqrt(CD0 / k), Vmd = Math.sqrt(2 * W / (rho * S * CLmd)), LDmax = 1 / (2 * Math.sqrt(CD0 * k));
  // minimum sink on the parabolic polar is at CL = √(3·CD0/k), unless that is beyond CL,max
  const CLms = Math.min(Math.sqrt(3 * CD0 / k), CLmax * 0.98), Vms = Math.sqrt(2 * W / (rho * S * CLms));
  const lo = Math.max(Vs * 1.02, 1), hi = Vs * 4;
  const curve = Array.from({ length: 121 }, (_, i) => { const V = lo + (hi - lo) * i / 120; return { V, sink: sink(V) }; });
  // MacCready: the speed between thermals that gives the best average speed for a climb rate Wc
  const speedToFly = Wc => {
    const V = golden(v => v * Wc / (Wc + sink(v)), Math.max(lo, Vmd * 0.9), hi);
    return { Wc, V, sink: sink(V), Vxc: V * Wc / (Wc + sink(V)) };
  };
  return { k, sink, Vs, Vmd, LDmax, Vms, minSink: sink(Vms), curve, speedToFly, wingLoading: W / G0 / S };
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
        const pol = glidePolar({ S: g.S, AR: g.AR, e: ae.e, CD0: ae.CD0, CLmax: ae.CLmax, W: m.total * G0, rho: atm.rho });
        const Wc = doc.mission.climbRate ?? 1.5;
        if (!(Wc > 0)) throw new Error('the average thermal climb must be above zero');
        const xc = pol.speedToFly(Wc);
        // a MacCready table for a range of climb rates
        const mc = [0.5, 1, 1.5, 2, 2.5, 3, 4].map(w => pol.speedToFly(w));
        const { sink, speedToFly, ...rest } = pol;
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
