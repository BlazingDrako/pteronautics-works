// Flying a mission profile: each segment's time, distance and battery energy from the point-mass performance model
// (core performance.js), with the same propeller and motor losses as the Performance node.
//
//   level flight   battery power = P_req / (η_prop(V) · η_motor), η_prop = η_peak · tanh(V / V*)
//   climb          full shaft power at the best-climb speed; rate of climb = excess specific power P_s, by altitude
//                  steps (the shaft power lapses with density)
//   descent        a glide at the best lift-to-drag speed with the motor off: sink = V / (L/D)
//   reserve        battery power at the best-endurance speed for the reserve time, left in the pack at landing
//
// A segment that cannot be flown (too slow for the wing, more power than the motor gives, a climb the aircraft cannot
// make) is marked with an error and the mission has no energy margin.
import { Perf, atmosphere } from '../adapters/aircraft.js';
import { SEGMENT_KINDS } from '../model/segments.js';

const STEP = 25;     // m of altitude per climb or descent step

// ac: a performance-solver aircraft (perfAircraft); W: weight in N; motorEff: motor + ESC efficiency; usable: Wh
export function flyMission({ segments, ac, W, motorEff, usable, dT = 0, z0 = 0 }) {
  let t = 0, x = 0, z = z0, used = 0;
  const track = [{ t: 0, x: 0, z, E: 0 }], out = [];
  const pel = (atm, V) => { const s = Perf.state(ac, atm, V, W, 'max'); return { s, P: s.Preq / (s.eta * motorEff) }; };
  // the speed of least battery power at this altitude, kept above 1.2 × stall
  const bestEndurance = atm => {
    const sp = Perf.speeds(ac, atm, W, 'max'), lo = 1.2 * sp.Vs, hi = Math.max(lo * 1.05, isFinite(sp.Vmax) ? sp.Vmax : lo * 2.5);
    let best = { V: lo, P: Infinity };
    for (let i = 0; i <= 200; i++) { const V = lo + (hi - lo) * i / 200, P = pel(atm, V).P; if (P < best.P) best = { V, P }; }
    return best;
  };
  // checks for level flight at V: not stalled, below the stall margin, and within the motor's power
  const levelCheck = (atm, V) => {
    const { s, P } = pel(atm, V), Vs = Perf.speeds(ac, atm, W, 'max').Vs;
    if (s.stalled || V < 1.1 * Vs) return { P, error: `${V.toFixed(1)} m/s is below 1.1 × stall (${(1.1 * Vs).toFixed(1)} m/s) at ${Math.round(atm.z ?? z)} m` };
    if (s.Preq > s.Pav * 1.0001) return { P, error: `needs ${Math.round(s.Preq / s.eta)} W of shaft power at ${V.toFixed(1)} m/s; the motor gives ${Math.round(s.P)} W` };
    return { P };
  };

  for (const sg of segments) {
    const K = SEGMENT_KINDS[sg.kind], E0 = used, r = { id: sg.id, kind: sg.kind, name: sg.name || K?.label || sg.kind, t0: t, x0: x, z0: z, E: 0, V: NaN, P: NaN, error: null };
    if (!K) { r.error = `unknown segment kind "${sg.kind}"`; }
    else if (sg.kind === 'climb' || sg.kind === 'descent') {
      const up = sg.kind === 'climb', dz = sg.to - z;
      if (up ? dz < 0 : dz > 0) r.error = up ? `starts at ${Math.round(z)} m, above its target ${sg.to} m` : `starts at ${Math.round(z)} m, below its target ${sg.to} m`;
      const steps = Math.max(1, Math.ceil(Math.abs(dz) / STEP)), h = dz / steps;
      let Vsum = 0;
      for (let i = 0; i < steps && !r.error && dz !== 0; i++) {
        const zm = z + h / 2, atm = atmosphere(zm, dT), sp = Perf.speeds(ac, atm, W, 'max');
        let V, rate, P;
        if (up) {
          V = sp.Vy; const s = Perf.state(ac, atm, V, W, 'max'); rate = s.Ps; P = s.P / motorEff;
          if (!(rate > 0.05)) { r.error = `cannot climb above ${Math.round(z)} m (rate of climb ${Math.max(0, rate).toFixed(2)} m/s)`; break; }
        } else {
          V = sp.Vmd; const s = Perf.state(ac, atm, V, W, 'max'); rate = V / s.LD; P = 0;
        }
        const dt = Math.abs(h) / rate;
        t += dt; x += V * dt / 1000; z += h; used += P * dt / 3600; Vsum += V * dt;
        track.push({ t, x, z, E: used });
      }
      if (t > r.t0) r.V = Vsum / (t - r.t0);
    } else if (sg.kind === 'cruise' || sg.kind === 'loiter') {
      const atm = atmosphere(z, dT), V = sg.speed, chk = levelCheck({ ...atm, z }, V);
      r.error = chk.error; r.V = V; r.P = chk.P;
      const gs = sg.kind === 'cruise' ? V - (sg.wind || 0) : V;
      if (!r.error && sg.kind === 'cruise' && gs <= 0.5) r.error = `the headwind ${sg.wind} m/s leaves no ground speed`;
      if (!r.error) {
        const dt = sg.kind === 'cruise' ? sg.distance * 1000 / gs : sg.time * 60;
        t += dt; x += (sg.kind === 'cruise' ? sg.distance : V * dt / 1000); used += chk.P * dt / 3600;
        track.push({ t, x, z, E: used });
      }
    } else if (sg.kind === 'reserve') {
      const b = bestEndurance(atmosphere(z, dT));
      r.V = b.V; r.P = b.P; r.reserve = true;
      r.E = b.P * sg.time * 60 / 3600;          // held, not flown: no time or distance on the track
    }
    if (sg.kind !== 'reserve') r.E = used - E0;
    if ((sg.kind === 'climb' || sg.kind === 'descent') && t > r.t0) r.P = r.E * 3600 / (t - r.t0);
    Object.assign(r, { t1: t, x1: x, z1: z });
    out.push(r);
  }
  const flown = out.filter(r => !r.reserve).reduce((s, r) => s + r.E, 0);
  const reserve = out.filter(r => r.reserve).reduce((s, r) => s + r.E, 0);
  const errors = out.filter(r => r.error);
  const energy = flown + reserve;
  const ok = !errors.length;
  return {
    segments: out, track, errors: errors.map(r => `${r.name}: ${r.error}`), feasible: ok && energy <= usable,
    flown, reserve, energy: ok ? energy : NaN, usable, left: ok ? usable - energy : NaN,
    margin: ok ? (usable - energy) / usable * 100 : NaN,
    duration: t / 60, distance: x, endAltitude: z, maxPower: Math.max(0, ...out.filter(r => isFinite(r.P)).map(r => r.P)),
  };
}
