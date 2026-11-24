// Pilot: flight dynamics and controls on a Works fixed-wing vehicle. DOM-free.
// The vehicle's own coupling graph gives the derivatives at its design condition; Pilot then re-runs the linear
// stability analysis at any speed and altitude (tail incidence held at its design value, as built), gives the
// modes and handling qualities, linear responses to control inputs, and single-loop controller design.
import { CouplingGraph } from '../engine/graph.js';
import { analysisNodes, hasGraph } from './classes.js';
import { clone } from '../model/vehicle.js';
import * as St from '../../core/solvers/stability.js';
import * as C from '../../core/solvers/control.js';

const DEG = Math.PI / 180;

// Vehicles Pilot can fly: those whose analysis graph has a stability node (fixed-wing, sailplane, eVTOL cruise)
export const flies = v => { try { return hasGraph(v) && analysisNodes(v).some(n => n.id === 'stability'); } catch { return false; } };

// Run the vehicle's graph once; returns the node outputs, or throws with the failing node's message
export function solveVehicle(doc) {
  const g = new CouplingGraph(analysisNodes(doc));
  g.runSync(clone(doc));
  const out = {}; for (const id of g.order) out[id] = g.outputs(id);
  if (!out.stability) {
    const bad = g.order.map(id => g.state.get(id)).find(s => s.state === 'failed');
    throw new Error(bad ? bad.error : 'stability did not run');
  }
  return out;
}

// The linear analysis at a flight condition { V, z } with the design tail incidence
export function analyzeAt(base, { V, z }) {
  const st = base.stability;
  return St.analyze({ id: st.solverId, mass: st.mass, z, dT: st.dT, V, cg: st.cg, it: st.an.it });
}

// The classical modes as rows for a table; HQ levels from MIL-F-8785C Category B
export function modeRows(an) {
  const { L, Lt, hq } = an, rows = [];
  const osc = (name, m, level, axis) => m && !m.real
    ? { name, axis, kind: 'oscillatory', wn: m.wn, zeta: m.zeta, period: m.period, thalf: m.thalf, t2: m.t2, level, re: m.re, im: m.im }
    : { name, axis, kind: 'real pair', wn: NaN, zeta: NaN, period: NaN, thalf: m?.thalf ?? NaN, t2: m?.t2 ?? NaN, level, re: m?.re };
  rows.push(osc('Short period', L.sp, hq.sp, 'lon'), osc('Phugoid', L.ph, hq.ph, 'lon'), osc('Dutch roll', Lt.dr, hq.dr, 'lat'));
  const real = (name, m, level) => m && { name, axis: 'lat', kind: 'real', wn: NaN, zeta: NaN, period: NaN, tau: m.tau, thalf: m.thalf, t2: m.t2, level, re: m.re };
  if (Lt.roll) rows.push(real('Roll subsidence', Lt.roll, hq.roll));
  if (Lt.spiral) rows.push(real('Spiral', Lt.spiral, hq.spiral));
  return rows;
}

// Roots across a speed range, for the "roots against speed" plot
export function speedSweep(base, { z, V0, V1, n = 14 }) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const V = V0 + (V1 - V0) * k / n;
    try { const an = analyzeAt(base, { V, z }); out.push({ V, lon: an.L.roots, lat: an.Lt.roots }); } catch { /* skip */ }
  }
  return out;
}

// ---------- open-loop responses to a control input ----------
export const INPUTS = [
  { id: 'elevator', label: 'Elevator', axis: 'lon' },
  { id: 'aileron', label: 'Aileron', axis: 'lat' },
  { id: 'rudder', label: 'Rudder', axis: 'lat' },
];
export const SHAPES = [
  { id: 'doublet', label: 'Doublet' }, { id: 'pulse', label: 'Pulse' }, { id: 'step', label: 'Step' },
];
// u(t) in degrees: a doublet is +A for `width`, then −A for `width`; a pulse is +A for `width`; starts at t = 1 s
export function inputSignal(shape, amp, width, t0 = 1) {
  if (shape === 'step') return t => (t >= t0 ? amp : 0);
  if (shape === 'pulse') return t => (t >= t0 && t < t0 + width ? amp : 0);
  return t => (t >= t0 && t < t0 + width ? amp : t >= t0 + width && t < t0 + 2 * width ? -amp : 0);
}
// Simulate the linear model; returns time and the states in display units
// lon: u (m/s), α (deg), q (deg/s), θ (deg), plus the climb rate ḣ (m/s); lat: β, p, r, φ (deg, deg/s)
export function respond(an, { input, shape, amp, width, T }) {
  const sig = inputSignal(shape, amp, width), u = t => sig(t) * DEG;
  if (input === 'elevator') {
    const r = St.simulate(an.lon.A, an.lon.B, [0, 0, 0, 0], u, T), U = an.d.V;
    return {
      axis: 'lon', t: r.t, u: r.t.map(sig),
      series: [
        { id: 'u', label: 'Speed change u', unit: 'm/s', y: r.x.map(x => x[0]) },
        { id: 'alpha', label: 'Angle of attack α', unit: 'deg', y: r.x.map(x => Math.atan2(x[1], U) / DEG) },
        { id: 'q', label: 'Pitch rate q', unit: 'deg/s', y: r.x.map(x => x[2] / DEG) },
        { id: 'theta', label: 'Pitch attitude θ', unit: 'deg', y: r.x.map(x => x[3] / DEG) },
      ],
      diverged: r.t.length && r.t[r.t.length - 1] < T - 0.05,
    };
  }
  const B = input === 'aileron' ? an.lat.Ba : an.lat.Br;
  const r = St.simulate(an.lat.A, B, [0, 0, 0, 0], u, T);
  return {
    axis: 'lat', t: r.t, u: r.t.map(sig),
    series: [
      { id: 'beta', label: 'Sideslip β', unit: 'deg', y: r.x.map(x => x[0] / DEG) },
      { id: 'p', label: 'Roll rate p', unit: 'deg/s', y: r.x.map(x => x[1] / DEG) },
      { id: 'r', label: 'Yaw rate r', unit: 'deg/s', y: r.x.map(x => x[2] / DEG) },
      { id: 'phi', label: 'Bank angle φ', unit: 'deg', y: r.x.map(x => x[3] / DEG) },
    ],
    diverged: r.t.length && r.t[r.t.length - 1] < T - 0.05,
  };
}

// ---------- single-loop design ----------
// L(s) = K · actuator(s) · G(s); returns the plant, loop, margins, closed-loop poles, root locus and step response
export const LOOPS = C.LOOPS;
export function loopDesign(an, { loop, K, wa, T = 10 }) {
  const P = C.aircraftPlant(an, loop);
  const G = wa > 0 ? C.tfMul(C.actuator(wa), P.G) : P.G;
  const L = C.tfScale(G, K);
  const m = C.margins(L);
  const cl = C.clPoles(L);
  const locus = C.rootLocus(G, Math.max(1e-4, K * 1e-3), K * 1e3, 90);
  const Tcl = C.feedback(L);
  const stable = cl.every(z => z[0] < 1e-6);
  const stepR = C.step(Tcl, T);
  const info = stable ? C.stepInfo(stepR, C.dcGain(Tcl)) : null;
  const openStep = C.step(P.G, T);
  return { P, G, L, margins: m, cl, locus, Tcl, stable, step: stepR, info, openStep, olPoles: C.poles(P.G), olZeros: C.zeros(P.G), bode: C.bode(L) };
}
// A starting gain: the one that puts the gain crossover near a target bandwidth (rad/s)
export function suggestGain(an, loop, wa, wc = 3) {
  const P = C.aircraftPlant(an, loop), G = wa > 0 ? C.tfMul(C.actuator(wa), P.G) : P.G;
  const [re, im] = C.freqResp(G, wc), mag = Math.hypot(re, im);
  return mag > 0 && isFinite(mag) ? 1 / mag : 1;
}
