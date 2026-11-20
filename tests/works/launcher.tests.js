// Launch vehicles: the stack, the rocket equation, the ascent and the Δv budget, on Vireo-2.
import { CouplingGraph } from '../../src/engine/graph.js';
import { analysisNodes } from '../../src/analyses/classes.js';
import { ascent, rotationGain, stackOf, cdOf } from '../../src/analyses/launcher.js';
import { metricsFor, runStudy } from '../../src/analyses/trade.js';
import { seeds } from '../../src/model/seeds.js';
import { clone, applyEdit, validate, fromJSON } from '../../src/model/vehicle.js';
import { stackDv } from '../../core/solvers/rocketSystems.js';

const G0 = 9.80665;
const solve = d => { const g = new CouplingGraph(analysisNodes(d)); g.runSync(d); const o = {}; for (const id of g.order) o[id] = g.outputs(id); return { g, o }; };

export async function launcherTests(log) {
  const ok = (name, cond, detail = '') => log('launcher: ' + name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${tol})`);
  const vireo = seeds().find(v => v.id === 'vireo-2');
  ok('Vireo-2 is a valid live launcher', validate(vireo).length === 0 && vireo.status === 'active');
  const { g, o } = solve(vireo);
  ok('every node of the Vireo-2 graph is current', g.isCurrent(), g.order.map(id => `${id}:${g.state.get(id).state} ${g.state.get(id).error || ''}`).join(', '));
  ok('engines go to the stage that holds them', stackOf(vireo).stages.every(s => s.engines.length === 1) && stackOf(vireo).stages[1].engines[0].count === 9);
  const parts = vireo.components.reduce((a, c) => a + (c.type === 'stage' ? c.dry + c.propellant : c.type === 'rocketEngine' ? c.mass * c.count : c.type === 'fairing' ? c.mass : 0), 0);
  rel('liftoff mass is every part plus the payload', o.stack.liftoff, parts + vireo.mission.payload, 1e-12);
  // against the core's stackDv with the same Isp per stage
  const core = stackDv(o.staging.stages.map(s => ({ Isp: s.ispEff, ms: s.dry, mp: s.prop })), vireo.mission.payload + o.stack.fairing);
  rel('ideal Δv matches the core rocket equation (rocketSystems.stackDv)', o.staging.dv, core.dv, 1e-9);
  const e1 = vireo.components.find(c => c.id === 'engine1');
  rel('liftoff T/W is sea-level thrust over weight', o.stack.TW, e1.count * e1.thrustSL / (o.stack.liftoff * G0), 1e-12);

  // ascent
  const a = o.ascent, ev = a.events;
  ok('the ascent is sensible: separation at 50–100 km, burnout above 120 km and near orbital speed', ev[1].h > 50e3 && ev[1].h < 100e3 && a.burnout.h > 120e3 && a.burnout.v > 7000, `sep ${(ev[1].h / 1000).toFixed(0)} km, burnout ${(a.burnout.h / 1000).toFixed(0)} km at ${a.burnout.v.toFixed(0)} m/s`);
  ok('stage 1 burns out at the chosen flight-path angle (±0.5°)', Math.abs(ev[1].gam - vireo.mission.stage1Angle) < 0.5, ev[1].gam.toFixed(2));
  ok('losses are a small launcher\'s: gravity 1–2 km/s, drag under 300 m/s', a.gravityLoss > 1000 && a.gravityLoss < 2000 && a.dragLoss < 300, `${a.gravityLoss.toFixed(0)} + ${a.dragLoss.toFixed(0)} m/s`);
  ok('Max-Q comes in the low atmosphere, 8–15 km', a.hq > 8e3 && a.hq < 15e3 && a.qmax > 15e3 && a.qmax < 60e3, `${(a.qmax / 1000).toFixed(1)} kPa at ${(a.hq / 1000).toFixed(1)} km`);
  ok('C_D peaks through Mach 1', cdOf(1.15) > cdOf(0.5) && cdOf(1.15) > cdOf(3));
  const vac = ascent({ stages: [{ name: 'S', m0: 1000, prop: 600, isp: 300, Fvac: 30000, FSL: 30000, booster: true }], diameter: 0.01, kickSpeed: 1e9 });
  rel('a vertical, drag-free burn loses about g·t_burn to gravity', vac.gravityLoss, G0 * 600 / (30000 / (300 * G0)), 0.01);
  rel('…and reaches the rocket-equation speed less that loss', vac.burnout.v, 300 * G0 * Math.log(1000 / 400) - vac.gravityLoss - vac.dragLoss, 0.005);

  // orbit
  rel('circular speed at 500 km is √(μ/r)', o.orbit.vCirc, Math.sqrt(3.986004418e14 / (6371e3 + 500e3)), 1e-12);
  const { transferDv } = await import('../../src/analyses/launcher.js');
  rel('a transfer from the target altitude itself costs the circular speed', transferDv(6871e3, 6871e3), Math.sqrt(3.986004418e14 / 6871e3), 1e-12);
  ok('an equatorial eastward launch gains the full 465 m/s; a sun-synchronous one pays', Math.abs(rotationGain(0, 0) - 464.6) < 0.2 && rotationGain(34.7, 97.4) < 0, rotationGain(34.7, 97.4).toFixed(1));
  rel('Δv margin = ideal − required', o.orbit.dvMargin, o.staging.dv - o.orbit.dvRequired, 1e-12);
  const atCap = clone(vireo); atCap.mission.payload = o.orbit.payloadCapacity;
  rel('the capacity is self-consistent: flown at that payload, the margin is zero', solve(atCap).o.orbit.dvMargin + 1000, 1000, 0.005);
  ok('Vireo-2 lifts its 300 kg with margin', o.orbit.payloadCapacity > 300, o.orbit.payloadCapacity.toFixed(0));
  const east = clone(vireo); east.mission.inclination = 35;
  ok('a lower inclination from the same site carries more', solve(east).o.orbit.payloadCapacity > o.orbit.payloadCapacity + 30);

  // edits and trades
  const more = clone(vireo); applyEdit(more, 'stage2.propellant', vireo.components.find(c => c.id === 'stage2').propellant + 300);
  ok('more upper-stage propellant, more payload (up to a point)', solve(more).o.orbit.payloadCapacity > o.orbit.payloadCapacity);
  ok('an engine outside every stage is an error', (() => { const d = clone(vireo); d.components.find(c => c.id === 'engine2').x = 40; return solve(d).g.state.get('stack').state === 'failed'; })());
  ok('trade metrics for a launcher: payload, Δv, Max-Q; no wing ones', metricsFor(vireo).some(m => m.metric === 'orbit.payloadCapacity') && !metricsFor(vireo).some(m => m.metric === 'aero.CD0'));
  const sw = await runStudy({ doc: vireo, nodes: analysisNodes(vireo), axes: [{ path: 'mission.orbitAltitude', values: [300, 500, 800] }] });
  const cap = sw.samples.map(x => x.outputs['orbit.payloadCapacity']);
  ok('higher orbits, less payload', cap[0] > cap[1] && cap[1] > cap[2], cap.map(x => x.toFixed(0)).join(' '));
  const old = clone(vireo); delete old.mission.stage1Angle; delete old.mission.orbitAltitude;
  ok('an older launcher document gets the launch defaults', fromJSON(JSON.stringify(old)).mission.stage1Angle === 22 && fromJSON(JSON.stringify(old)).mission.orbitAltitude === 500);
}
