// The Orbit and Pilot tabs' analyses against textbook values and the seeded vehicles.
import { elementsOf, describe, transfer, launcherAt, launchNeed, spacecraftBudget, missionOrbit } from '../../src/analyses/orbit.js';
import { CouplingGraph } from '../../src/engine/graph.js';
import { analysisNodes } from '../../src/analyses/classes.js';
import { solveVehicle, analyzeAt, modeRows, respond, loopDesign, suggestGain } from '../../src/analyses/pilot.js';
import { kestrel, concepts } from '../../src/model/seeds.js';

export function tabsTests(log) {
  const ok = (name, cond, detail = '') => log(name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(5)}, expected ${(+ref).toPrecision(5)} (±${(tol * 100).toFixed(1)}%)`);

  // ---------- Orbit ----------
  const iss = describe(elementsOf({ body: 'earth', hp: 418e3, ha: 422e3, i: 51.64 }));
  rel('orbit: ISS period is about 92.8 min', iss.T / 60, 92.8, 0.01);
  rel('orbit: ISS node regresses about 5.0°/day', -iss.raanDot, 5.0, 0.03);
  const leo = elementsOf({ body: 'earth', hp: 300e3, ha: 300e3, i: 28.5 });
  rel('orbit: Hohmann 300 km → GEO is about 3.89 km/s (Curtis)', transfer(leo, { hTarget: 35786e3 }).hohmann.dv, 3893, 0.01);
  const sso = describe(elementsOf({ body: 'earth', hp: 705e3, ha: 705e3, i: 98.2 }));
  ok('orbit: 705 km at 98.2° is sun-synchronous', sso.isSSO, `SSO i ${sso.ssoI.toFixed(2)}°`);
  ok('orbit: a perigee inside the atmosphere is flagged', describe(elementsOf({ body: 'earth', hp: 80e3, ha: 400e3, i: 0 })).reentry);

  const vireo = concepts().find(v => v.id === 'vireo-2'), petrel = concepts().find(v => v.id === 'petrel');
  const vEl = elementsOf({ body: 'earth', ...missionOrbit(vireo) });
  const need = launchNeed(vEl, { lat: 34.7, losses: 1500 });
  ok('orbit: Vireo-2 mission orbit is 500 km at 97.4°', Math.abs(vEl.a - 6878137) < 1 && Math.abs(vEl.i * 180 / Math.PI - 97.4) < 1e-9);
  ok('orbit: launch to SSO from Vandenberg needs 9.0–9.4 km/s with 1.5 km/s losses', need.dv > 9000 && need.dv < 9400, `${need.dv.toFixed(0)} m/s`);
  const m = vireo.mission, at = launcherAt(vireo, { altKm: m.orbitAltitude, inc: m.inclination, lat: m.latitude, payload: m.payload });
  const g = new CouplingGraph(analysisNodes(vireo)); g.runSync(vireo);
  rel('orbit: Vireo-2 flown to its mission orbit gives the same payload as its workspace', at.capacity, g.outputs('orbit').payloadCapacity, 1e-9);
  ok('orbit: Vireo-2 stages listed bottom first', at.rows.length === 2 && at.rows[0].id === 'stage1', at.rows.map(r => r.id).join(', '));
  const high = launcherAt(vireo, { altKm: 800, inc: m.inclination, lat: m.latitude, payload: m.payload });
  ok('orbit: a higher orbit takes less payload', high.capacity < at.capacity, `${at.capacity.toFixed(0)} → ${high.capacity.toFixed(0)} kg`);
  const east = launcherAt(vireo, { altKm: 500, inc: 28.5, lat: 28.5, payload: m.payload });
  ok('orbit: launching due east from the Cape lifts more than to SSO', east.capacity > at.capacity, `${at.capacity.toFixed(0)} → ${east.capacity.toFixed(0)} kg`);
  const b = spacecraftBudget(petrel, 50);
  rel('orbit: Petrel propellant for 50 m/s = m (e^(Δv/ve) − 1)', b.prop, b.dry * (Math.exp(50 / (70 * 9.80665)) - 1), 1e-12);

  // ---------- Pilot ----------
  const base = solveVehicle(kestrel()), an = analyzeAt(base, { V: 22, z: 400 });
  rel('pilot: at cruise the Pilot analysis matches the workspace graph (short period ωn)', an.L.sp.wn, base.stability.sp.wn, 1e-9);
  const rows = modeRows(an);
  ok('pilot: five classical modes', rows.length === 5 && rows.map(r => r.name).join() === 'Short period,Phugoid,Dutch roll,Roll subsidence,Spiral', rows.map(r => r.name).join(', '));
  const fast = analyzeAt(base, { V: 32, z: 400 });
  ok('pilot: the short period gets faster with speed', fast.L.sp.wn > an.L.sp.wn, `${an.L.sp.wn.toFixed(2)} → ${fast.L.sp.wn.toFixed(2)} rad/s`);
  ok('pilot: the phugoid period grows with speed (≈ π√2 V/g)', fast.L.ph.period > an.L.ph.period, `${an.L.ph.period.toFixed(1)} → ${fast.L.ph.period.toFixed(1)} s`);
  const r = respond(an, { input: 'elevator', shape: 'doublet', amp: 2, width: 0.5, T: 20 });
  const q = r.series.find(x => x.id === 'q').y;
  ok('pilot: a nose-down elevator doublet pitches the nose down first', Math.min(...q.slice(0, 40)) < 0 && Math.abs(Math.min(...q.slice(0, 40))) > Math.max(...q.slice(0, 40)) * 0.5, `q min ${Math.min(...q).toFixed(2)}, max ${Math.max(...q).toFixed(2)}`);
  ok('pilot: an elevator doublet settles (stable airframe)', !r.diverged);
  const K = suggestGain(an, 'q', 20, 3), L = loopDesign(an, { loop: 'q', K, wa: 20 });
  ok('pilot: the suggested pitch damper gain gives a stable loop with ≥ 45° phase margin', L.stable && L.margins.pm && L.margins.pm.pmDeg >= 45, `K ${K.toFixed(3)}, PM ${L.margins.pm?.pmDeg.toFixed(1)}°`);
  ok('pilot: the suggested gain puts a gain crossover at 3 rad/s', L.margins.gc.some(c => Math.abs(c.w / 3 - 1) < 0.01), L.margins.gc.map(c => c.w.toFixed(2)).join(', ') + ' rad/s');
  const spBoost = L.cl.filter(z => z[1] > 0).map(z => -z[0] / Math.hypot(...z));
  ok('pilot: the pitch damper raises short-period damping', Math.max(...spBoost) > an.L.sp.zeta, `ζ ${an.L.sp.zeta.toFixed(2)} → ${Math.max(...spBoost).toFixed(2)}`);
}
