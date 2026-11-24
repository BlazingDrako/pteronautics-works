// Orbit: mission and trajectory design on the core orbital-mechanics solver. DOM-free.
// Elements, derived quantities and J2 drift; transfers between circular orbits (Hohmann, bi-elliptic, with a
// plane change); the launch Δv from a site; and Δv budgets coupled to a Works vehicle (a spacecraft's thruster or a
// launch vehicle's stages).
import * as O from '../../core/solvers/orbits.js';
import { firstOf, clone } from '../model/vehicle.js';
import { CouplingGraph } from '../engine/graph.js';
import { analysisNodes } from './classes.js';

const D = Math.PI / 180;
export { O };

// Elements from apsis altitudes (m) and angles (deg), the way people usually state an orbit
export function elementsOf({ body = 'earth', hp, ha, i, raan = 0, argp = 0, nu = 0 }) {
  const B = O.body(body), rp = B.R + hp, ra = B.R + Math.max(hp, ha);
  return { body, a: (rp + ra) / 2, e: (ra - rp) / (ra + rp), i: i * D, raan: raan * D, argp: argp * D, nu: nu * D };
}
// and back: { hp, ha } in m from elements
export function apsesOf(el) {
  const B = O.body(el.body);
  return { hp: el.a * (1 - el.e) - B.R, ha: el.a * (1 + el.e) - B.R };
}

// Everything the Orbit tab shows for one orbit
export function describe(el) {
  const B = O.body(el.body), P = O.props(el, B.mu), J = O.j2Rates(el, B), sh = O.trackShift(el, B);
  const ssoI = O.sunSyncInclination(el.a, el.e, B);
  const day = 86400;
  return {
    B, P, hp: P.rp - B.R, ha: P.ra - B.R, T: P.T, vp: P.vp, va: P.va, energy: P.energy,
    raanDot: J.raanDot / D * day, argpDot: J.argpDot / D * day, revsPerDay: day / sh.Tn, shift: sh.shift / D, Tn: sh.Tn,
    ssoI: ssoI / D, isSSO: isFinite(ssoI) && Math.abs(el.i - ssoI) < 0.15 * D,
    critical: Math.abs(el.i - O.CRITICAL_INC) < 0.3 * D || Math.abs(el.i - (Math.PI - O.CRITICAL_INC)) < 0.3 * D,
    reentry: P.rp < B.R + (B.id === 'earth' ? 120e3 : B.id === 'mars' ? 80e3 : B.id === 'venus' ? 150e3 : 0),
    coverage: O.coverageAngle(Math.max(1, P.rp - B.R), B.R, 10 * D) / D,
  };
}

// Transfer from the current orbit's periapsis radius (treated as circular) to a circular target
export function transfer(el, { hTarget, di = 0, rbFactor = 2, method = 'hohmann' }) {
  const B = O.body(el.body), r1 = el.a * (1 - el.e), r2 = B.R + hTarget;
  const H = di ? O.hohmannPlane(r1, r2, di * D, B.mu, 'split') : { ...O.hohmann(r1, r2, B.mu), frac: 0 };
  const rb = Math.max(r1, r2) * rbFactor, Be = O.biElliptic(r1, r2, rb, B.mu);
  const vSlow = Math.min(Math.sqrt(B.mu / r1), Math.sqrt(B.mu / r2));
  const bePlane = di ? Be.dv + O.planeChange(Math.sqrt(B.mu / rb) * Math.sqrt(2 * Math.min(r1, r2) / (rb + Math.min(r1, r2))), di * D) : Be.dv;
  const curve = [];
  for (let k = 0; k <= 80; k++) {
    const q = 1.05 * (60 / 1.05) ** (k / 80), rr = r1 * q, h = O.hohmann(r1, rr, B.mu), b = O.biElliptic(r1, rr, rr * rbFactor, B.mu);
    curve.push({ q, h: h.dv / Math.sqrt(B.mu / r1), b: b.dv / Math.sqrt(B.mu / r1) });
  }
  return {
    B, r1, r2, rb, method,
    hohmann: H, biElliptic: { ...Be, dvPlane: bePlane },
    chosen: method === 'bi-elliptic' ? { dv: bePlane, tof: Be.tof, burns: [Be.dv1, Be.dv2, Be.dv3] } : { dv: H.dv, tof: H.tof, burns: [H.dv1, H.dv2] },
    planeOnly: di ? O.planeChange(vSlow, di * D) : 0, curve,
    rendezvous: O.rendezvous(r1, r2, B.mu),
  };
}

// ---------- vehicles ----------
// Which Works vehicles Orbit can couple to, and the orbit their mission states
export const orbitVehicle = v => v && (v.class === 'spacecraft' || v.class === 'launch-vehicle');
export function missionOrbit(v) {
  const m = v.mission || {};
  if (v.class === 'spacecraft') return { hp: m.altitude ?? 550e3, ha: m.altitude ?? 550e3, i: m.inclination ?? 97.6 };
  if (m.orbitAltitude) return { hp: m.orbitAltitude * 1e3, ha: m.orbitAltitude * 1e3, i: m.inclination ?? 97.4 };
  const h = typeof m.orbit === 'string' && /(\d+)\s*km/.exec(m.orbit) ? +/(\d+)\s*km/.exec(m.orbit)[1] * 1e3 : 500e3;
  return { hp: h, ha: h, i: m.inclination ?? 97.4 };
}

// A spacecraft's propulsion budget: wet mass from its parts, propellant to give Δv with its thruster
export function spacecraftBudget(v, dv) {
  const th = firstOf(v, 'thruster'); if (!th) return null;
  const dry = v.components.reduce((s, c) => s + (typeof c.mass === 'number' ? c.mass : 0), 0);
  const MR = O.massRatio(dv, th.isp);
  return { isp: th.isp, thruster: th.kind, dry, dv, MR, prop: dry * (MR - 1), propFraction: 1 - 1 / MR, ve: th.isp * O.G0 };
}

// A launch vehicle flown to any circular orbit by its own graph (stack, staging, gravity-turn ascent, Δv budget):
// the same numbers as its workspace, with the target orbit, inclination and launch latitude set from Orbit.
export function launcherAt(v, { altKm, inc, lat, payload }) {
  const d = clone(v);
  Object.assign(d.mission, { orbitAltitude: altKm, inclination: inc, latitude: lat, payload });
  const g = new CouplingGraph(analysisNodes(d)); g.runSync(d);
  const st = g.outputs('stack'), sg = g.outputs('staging'), asc = g.outputs('ascent'), orb = g.outputs('orbit');
  if (!st || !sg || !asc || !orb) {
    const bad = g.order.map(id => g.state.get(id)).find(x => x.state === 'failed');
    throw new Error(bad ? bad.error : 'the launcher analysis did not run');
  }
  return {
    rows: sg.stages, dvIdeal: orb.dvIdeal, dvRequired: orb.dvRequired, margin: orb.dvMargin, capacity: orb.payloadCapacity,
    liftoff: st.liftoff, tw: st.TW, gravityLoss: asc.gravityLoss, dragLoss: asc.dragLoss, rotation: orb.rotation, transfer: orb.transfer,
  };
}

// Launch Δv from a site to a circular orbit (losses in m/s)
export function launchNeed(el, { lat, losses }) {
  const B = O.body(el.body), h = el.a * (1 - el.e) - B.R;
  return O.launchDv(h, el.i, lat * D, losses, B);
}
