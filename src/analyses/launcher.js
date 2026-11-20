// The launch-vehicle analysis graph: stack → staging (ideal Δv), ascent (losses, loads), orbit (Δv budget, payload).
//
//   stack     stages ordered top to bottom by position; each rocket engine belongs to the stage whose length holds
//             its x. A stage's mass is its dry mass, its engines and its propellant; the fairing rides on the top stage
//             and is dropped at stage separation.
//   staging   the rocket equation per stage, bottom first: Δv = Isp·g0·ln(m0/mf). Booster stages fly at an average
//             of their sea-level and vacuum Isp (Isp_SL = Isp·F_SL/F_vac), upper stages at vacuum Isp. Engines carry a vacuum thrust (or, if it is zero, sea-level thrust / 0.88).
//   ascent    a point mass over a spherical, non-rotating Earth (core ISA atmosphere to 86 km): vertical rise to
//             50 m/s, a pitch kick, then a gravity turn with thrust along the velocity, through every stage (once the
//             path is horizontal it is held there). The kick is solved so that the first stage burns out at a chosen
//             flight-path angle (22° by default), which keeps the ascent sensible whatever the thrust-to-weight; thrust rises from
//             its sea-level to its vacuum value as the ambient pressure falls; drag with a transonic rise in C_D.
//             Integrated: gravity loss ∫g·sinγ dt, drag loss ∫D/m dt, Max-Q, peak acceleration, staging states.
//   orbit     Δv required = the speed at burnout altitude for a transfer to the target circular orbit, plus its
//             circularisation, + gravity loss + drag loss − the eastward speed of the Earth's surface along the launch
//             azimuth (negative for retrograde orbits such as sun-synchronous); Δv margin = ideal − required; payload
//             capacity = the payload at which the margin is zero, reflown until the losses agree with that payload.
import { atmosphere, G0 } from '../adapters/aircraft.js';
import { evaluateRequirements } from './requirements.js';

const RE = 6371e3, MU = 3.986004418e14, OMEGA = 7.2921159e-5, DEG = Math.PI / 180;
export const ISP_SL_FRACTION = 0.88;          // F_SL / F_vac when only the sea-level thrust is given

// stages with their engines, top stage first
export function stackOf(doc) {
  const stages = doc.components.filter(c => c.type === 'stage').slice().sort((a, b) => a.x - b.x);
  const engines = doc.components.filter(c => c.type === 'rocketEngine');
  const fairing = doc.components.find(c => c.type === 'fairing');
  if (!stages.length) throw new Error('the vehicle has no stages');
  const out = stages.map(s => ({ id: s.id, name: s.name, stage: s, engines: engines.filter(e => e.x >= s.x - 1e-9 && e.x <= s.x + s.length + 1e-9) }));
  for (const e of engines) if (!out.some(s => s.engines.includes(e))) throw new Error(`${e.name} is not inside any stage (x ${e.x} m)`);
  for (const s of out) if (!s.engines.length) throw new Error(`${s.name} has no engine`);
  return { stages: out, fairing };
}

export function stackNode() {
  return {
    id: 'stack', label: 'Stack', detail: 'stages · masses', reads: ['*.dry', '*.propellant', '*.mass', '*.count', '*.thrustSL', '*.thrustVac', '*.isp', '*.x', '*.length', '*.diameter', 'mission.payload'],
    outputs: ['stages', 'liftoff', 'TW', 'length'],
    run({ doc }) {
      const { stages, fairing } = stackOf(doc), payload = doc.mission.payload ?? 0;
      // top stage first; the bottom stage is the booster that lights at sea level
      const rows = stages.map((s, i) => {
        const booster = i === stages.length - 1, eng = s.engines.reduce((a, e) => a + e.mass * e.count, 0);
        const vac = e => (e.thrustVac > 0 ? e.thrustVac : e.thrustSL / ISP_SL_FRACTION);
        const Fvac = s.engines.reduce((a, e) => a + e.count * vac(e), 0), FSL = booster ? s.engines.reduce((a, e) => a + e.count * e.thrustSL, 0) : 0;
        const isp = s.engines.reduce((a, e) => a + e.count * vac(e) * e.isp, 0) / Fvac;
        return { id: s.id, name: s.name, dry: s.stage.dry + eng, engines: eng, prop: s.stage.propellant, isp, FSL, Fvac, booster, diameter: s.stage.diameter };
      });
      if (rows.at(-1).FSL <= 0) throw new Error(`${rows.at(-1).name} has no sea-level thrust`);
      let above = payload + (fairing ? fairing.mass : 0);      // the fairing is carried to the top stage's burnout (conservative)
      for (const r of rows) { r.above = above; r.m0 = above + r.dry + r.prop; above = r.m0; }
      const bottom = rows.at(-1), top = stages[0].stage, last = stages.at(-1).stage;
      return { stages: rows.slice().reverse(), liftoff: bottom.m0, TW: bottom.FSL / (bottom.m0 * G0), length: last.x + last.length - Math.min(0, top.x),
        payload, fairing: fairing ? fairing.mass : 0, diameter: bottom.diameter, upperTW: rows.length > 1 ? rows.at(-2).Fvac / (rows.at(-2).m0 * G0) : NaN };
    },
  };
}

export function stagingNode() {
  return {
    id: 'staging', label: 'Staging', detail: 'rocket equation', after: ['stack'], outputs: ['dv', 'stages'],
    run({ inputs }) {
      const rows = inputs.stack.stages.map(s => {
        const ispEff = s.booster ? s.isp * (1 + ISP_SL_FRACTION) / 2 : s.isp, mf = s.m0 - s.prop;
        return { ...s, ispEff, mf, MR: s.m0 / mf, dv: ispEff * G0 * Math.log(s.m0 / mf), TW0: (s.booster ? s.FSL : s.Fvac) / (s.m0 * G0) };
      });
      return { stages: rows, dv: rows.reduce((a, s) => a + s.dv, 0) };
    },
  };
}

// drag coefficient with a transonic rise, on the bottom stage's cross-section
export const cdOf = M => 0.25 + 0.3 * Math.exp(-(((M - 1.15) / 0.4) ** 2)) + (M > 1.15 ? 0.05 * Math.exp(-(M - 1.15) / 2) : 0);

export function ascent({ stages, diameter, kickSpeed = 50, kickAngle = 2, dt = 0.25, stopAfter = Infinity }) {
  const A = Math.PI * diameter * diameter / 4, p0 = atmosphere(0).p;
  let t = 0, h = 0, v = 0.1, gam = 90 * DEG, x = 0, gl = 0, dl = 0, qmax = 0, tq = 0, hq = 0, gmax = 0, kicked = false;
  const track = [], events = [];
  for (let k = 0; k < stages.length; k++) {
    const s = stages[k], mdotVac = s.Fvac / (s.isp * G0);
    let m = s.m0, burn = s.prop / mdotVac;            // propellant flow is set by the vacuum rating
    events.push({ t, h, v, x, name: k ? `${s.name} ignition` : 'Liftoff' });
    for (let tb = 0; tb < burn - 1e-9;) {
      const step = Math.min(dt, burn - tb);
      const atm = h < 86e3 ? atmosphere(h) : { rho: 0, p: 0, a: 295 };
      const F = s.Fvac - (s.Fvac - (s.booster ? s.FSL : s.Fvac)) * (atm.p / p0);
      const M = v / atm.a, q = 0.5 * atm.rho * v * v, D = q * cdOf(M) * A;
      const g = G0 * (RE / (RE + h)) ** 2, r = RE + h;
      if (!kicked && v >= kickSpeed) { gam = (90 - kickAngle) * DEG; kicked = true; }
      const acc = (F - D) / m;
      const dv = acc - g * Math.sin(gam);
      const dg = kicked ? -(g / Math.max(v, 1) - v / r) * Math.cos(gam) : 0;
      if (q > qmax) { qmax = q; tq = t; hq = h; }
      gmax = Math.max(gmax, F / m / G0);
      gl += g * Math.sin(gam) * step; dl += D / m * step;
      v = Math.max(0.1, v + dv * step); gam = Math.max(0, gam + dg * step);
      h += v * Math.sin(gam) * step; x += v * Math.cos(gam) * RE / r * step;
      m -= mdotVac * step; t += step; tb += step;
      if (track.length === 0 || t - track[track.length - 1].t >= 2 - 1e-9) track.push({ t, h, v, x, q, gam: gam / DEG, acc: F / m / G0 });
      if (h < -1) throw new Error(`${s.name} cannot lift the vehicle off (thrust-to-weight below 1)`);
    }
    events.push({ t, h, v, x, gam: gam / DEG, name: k === stages.length - 1 ? 'Burnout' : `${s.name} burnout · separation` });
    if (k + 1 >= stopAfter) return { stage1: { t, h, v, gam: gam / DEG } };
  }
  track.push({ t, h, v, x, q: 0, gam: gam / DEG, acc: 0 });
  return { track, events, gravityLoss: gl, dragLoss: dl, qmax, tq, hq, gmax, burnout: { t, h, v, gam: gam / DEG, x }, kickAngle };
}

// The pitch kick that makes the first stage burn out at the flight-path angle gammaTarget (°): bisection on the
// kick angle, which steepens the turn monotonically. Then the full ascent with that kick.
export function ascentTo({ stages, diameter, gammaTarget = 22, kickSpeed = 50 }) {
  const g1 = kick => ascent({ stages, diameter, kickSpeed, kickAngle: kick, stopAfter: 1 }).stage1.gam;
  let lo = 0.02, hi = 15;
  if (g1(lo) < gammaTarget) lo = 0.02;
  else if (g1(hi) > gammaTarget) hi = 15;
  for (let i = 0; i < 30; i++) { const m = Math.sqrt(lo * hi); if (g1(m) > gammaTarget) lo = m; else hi = m; }
  return ascent({ stages, diameter, kickSpeed, kickAngle: Math.sqrt(lo * hi) });
}

export function ascentNode() {
  return {
    id: 'ascent', label: 'Ascent', detail: 'gravity turn', after: ['stack'], reads: ['mission.stage1Angle'],
    outputs: ['track', 'gravityLoss', 'dragLoss', 'qmax', 'gmax', 'burnout'],
    run({ doc, inputs }) {
      const st = inputs.stack;
      const a = ascentTo({ stages: st.stages, diameter: st.diameter, gammaTarget: doc.mission.stage1Angle ?? 22 });
      return { ...a, qmaxKPa: a.qmax / 1000 };
    },
  };
}

// The eastward speed of the launch site's surface along the launch azimuth for an orbit of inclination i
export function rotationGain(latDeg, incDeg) {
  const lat = latDeg * DEG, inc = incDeg * DEG;
  const sinAz = Math.max(-1, Math.min(1, Math.cos(inc) / Math.cos(lat)));
  return OMEGA * RE * Math.cos(lat) * sinAz;
}

// Δv still needed at burnout altitude rb to end on a circular orbit at rt: a transfer ellipse from rb to rt (its speed
// at rb), then circularisation at rt. Equal to the circular speed when rb = rt.
export function transferDv(rb, rt) {
  const vp = Math.sqrt(MU * (2 / rb - 2 / (rb + rt))), va = Math.sqrt(MU * (2 / rt - 2 / (rb + rt)));
  return vp + Math.abs(Math.sqrt(MU / rt) - va);
}

export function orbitNode() {
  return {
    id: 'orbit', label: 'Orbit', detail: 'Δv budget · payload', after: ['stack', 'staging', 'ascent'], reads: ['mission.orbitAltitude', 'mission.inclination', 'mission.latitude', 'mission.payload', 'mission.stage1Angle'],
    outputs: ['vCirc', 'dvRequired', 'dvMargin', 'payloadCapacity', 'payloadMargin'],
    run({ doc, inputs }) {
      const alt = (doc.mission.orbitAltitude ?? 500) * 1000, rt = RE + alt, vCirc = Math.sqrt(MU / rt);
      const rot = rotationGain(doc.mission.latitude ?? 0, doc.mission.inclination ?? 0), st = inputs.stack, nominal = st.payload;
      const need = asc => transferDv(RE + asc.burnout.h, rt) + asc.gravityLoss + asc.dragLoss - rot;
      const ispOf = s => (s.booster ? s.isp * (1 + ISP_SL_FRACTION) / 2 : s.isp);
      const dvAt = pl => st.stages.reduce((acc, s) => { const m0 = s.m0 - nominal + pl; return acc + ispOf(s) * G0 * Math.log(m0 / (m0 - s.prop)); }, 0);
      // the payload whose ideal Δv equals the requirement, for given losses
      const capacityFor = req => {
        if (dvAt(0) < req) return NaN;
        let lo = 0, hi = Math.max(1, nominal * 4 + 100);
        while (dvAt(hi) > req) hi *= 2;
        for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (dvAt(m) > req) lo = m; else hi = m; }
        return (lo + hi) / 2;
      };
      const asc = inputs.ascent, dvRequired = need(asc), dvIdeal = inputs.staging.dv;
      // capacity, self-consistent: a heavier payload flies a lossier ascent, so refly at the capacity until it settles
      let cap = capacityFor(dvRequired), iters = 0;
      for (; iters < 6 && isFinite(cap) && Math.abs(cap - nominal) > 0.5; iters++) {
        const stages = st.stages.map(s => ({ ...s, m0: s.m0 - nominal + cap }));
        const next = capacityFor(need(ascentTo({ stages, diameter: st.diameter, gammaTarget: doc.mission.stage1Angle ?? 22 })));
        if (!isFinite(next) || Math.abs(next - cap) < 0.5) { cap = next; break; }
        cap = next;
      }
      return { altitude: alt / 1000, vCirc, rotation: rot, transfer: transferDv(RE + asc.burnout.h, rt), dvIdeal, dvRequired, dvMargin: dvIdeal - dvRequired,
        payloadCapacity: cap, payloadMargin: nominal > 0 ? (cap - nominal) / nominal * 100 : NaN, inclination: doc.mission.inclination, iterations: iters };
    },
  };
}

export function launcherNodes() {
  return [stackNode(), stagingNode(), ascentNode(), orbitNode(), {
    id: 'requirements', label: 'Requirements', after: ['stack', 'staging', 'ascent', 'orbit'], reads: ['requirements.*'], outputs: ['list', 'met', 'total'],
    run({ doc, inputs }) {
      const list = evaluateRequirements(doc.requirements || [], inputs);
      return { list, met: list.filter(r => r.status === 'met').length, marginal: list.filter(r => r.status === 'marginal').length, failing: list.filter(r => r.status === 'fail').length, total: list.length };
    },
  }];
}
