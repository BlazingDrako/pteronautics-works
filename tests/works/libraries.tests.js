// Part libraries: every entry fits the parameter ranges, and applying one is an ordinary (linked) edit.
import { AIRFOILS, MOTORS, CELLS, MATERIALS, applyEntry } from '../../src/model/libraries.js';
import { kestrel, seeds } from '../../src/model/seeds.js';
import { clone, applyEdit, validate, paramSpec, firstOf } from '../../src/model/vehicle.js';
import { sectionOf } from '../../src/adapters/aircraft.js';

export function librariesTests(log) {
  const ok = (name, cond, detail = '') => log('libraries: ' + name, !!cond, detail);
  const inRange = (type, key, v) => { const p = paramSpec(type, key); return v >= p.min && v <= p.max; };
  ok('every airfoil is a NACA 4-digit code the solvers read', AIRFOILS.every(a => /^\d{4}$/.test(a.code) && isFinite(sectionOf(a.code).clmax)));
  ok('every motor fits the motor parameters', MOTORS.every(m => inRange('propulsor', 'motorEff', m.motorEff) && inRange('propulsor', 'specificPower', m.specificPower)));
  ok('every cell fits the battery parameters', CELLS.every(c => inRange('battery', 'specificEnergy', c.specificEnergy) && inRange('battery', 'usable', c.usable)));
  ok('every material fits the wing parameters', MATERIALS.every(m => inRange('wing', 'arealMass', m.arealMass)));
  ok('ids are unique', [MOTORS, CELLS, MATERIALS].every(l => new Set(l.map(x => x.id)).size === l.length) && new Set(AIRFOILS.map(a => a.code)).size === AIRFOILS.length);

  const k = kestrel();
  const run = (doc, kind, e, where) => { const d = clone(doc); for (const [p, v] of applyEntry(d, kind, e, where)) applyEdit(d, p, v); return d; };
  const tip = run(k, 'airfoil', AIRFOILS.find(a => a.code === '2412'), 'tip');
  ok('an airfoil can go on the tip only', firstOf(tip, 'wing').tipAirfoil === '2412' && firstOf(tip, 'wing').rootAirfoil === '4415');
  const ss = CELLS.find(c => c.id === 'solid-state'), d = run(k, 'cell', ss);
  ok('better cells on a linked pack: same energy, lighter pack', firstOf(d, 'battery').energy === 888 && Math.abs(firstOf(d, 'battery').mass - 888 / ss.specificEnergy) < 1e-9, `${firstOf(d, 'battery').mass.toFixed(2)} kg`);
  ok('…the series count is kept (6S at the new cell voltage)', Math.abs(firstOf(d, 'battery').voltage - 6 * ss.cellVoltage) < 1e-9);
  const fixed = clone(k); firstOf(fixed, 'battery').sizing = 'fixed';
  const df = run(fixed, 'cell', ss);
  ok('better cells on a fixed pack: same mass, more energy', firstOf(df, 'battery').mass === 4.9 && Math.abs(firstOf(df, 'battery').energy - ss.specificEnergy * 4.9) < 1e-9);
  const mt = run(k, 'motor', MOTORS.find(m => m.id === 'axial-flux'));
  ok('a lighter motor class on a linked motor makes it lighter', firstOf(mt, 'propulsor').mass < firstOf(k, 'propulsor').mass && firstOf(mt, 'propulsor').motorEff === 0.95);
  const mat = run(k, 'material', MATERIALS.find(m => m.id === 'carbon-sandwich'));
  ok('a construction sets the wing areal mass', firstOf(mat, 'wing').arealMass === 2.2);
  ok('every library entry leaves every live vehicle valid', seeds().filter(v => ['fixed-wing', 'sailplane', 'rotorcraft'].includes(v.class)).every(v =>
    [['airfoil', AIRFOILS], ['material', MATERIALS], ['cell', CELLS], ['motor', MOTORS]].every(([kind, list]) => list.every(e => { try { return validate(run(v, kind, e)).length === 0; } catch (err) { return /has no/.test(err.message); } }))));
  ok('a part the vehicle lacks is refused', (() => { try { applyEntry(seeds().find(v => v.id === 'tern'), 'cell', ss); return false; } catch (e) { return /has no battery/.test(e.message); } })());
}
