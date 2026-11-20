// The vehicle document: schema, validation, paths, JSON round trip, seeds and storage.
import * as V from '../../src/model/vehicle.js';
import { seeds, kestrel } from '../../src/model/seeds.js';
import * as Store from '../../src/model/store.js';

export function modelTests(log) {
  const ok = (name, cond, detail = '') => log('model: ' + name, !!cond, detail);
  const throws = (name, fn, match) => { try { fn(); ok(name, false, 'did not throw'); } catch (e) { ok(name, !match || match.test(e.message), e.message); } };

  // ---- seeds ----
  for (const v of seeds()) { const e = V.validate(v); ok(`seed "${v.id}" (${v.class}) is a valid document`, e.length === 0, e.join('; ')); }
  const classes = new Set(seeds().map(v => v.class));
  ok('seeds cover all six vehicle classes', Object.keys(V.VEHICLE_CLASSES).every(c => classes.has(c)), [...classes].join(', '));
  const k = kestrel(), w = V.firstOf(k, 'wing');
  ok('Kestrel is fixed-wing with a 3.2 m NACA 4415 wing', k.class === 'fixed-wing' && w.span === 3.2 && w.rootAirfoil === '4415', `${k.class}, b ${w.span}, ${w.rootAirfoil}`);
  const S = w.span * w.rootChord * (1 + w.taper) / 2, m = V.pointMass(k) + w.arealMass * S;
  ok('Kestrel takeoff mass is about 22.5 kg', Math.abs(m - 22.5) < 0.5, `${m.toFixed(2)} kg`);
  ok('fixed-wing, sailplanes and eVTOL are marked implemented, the rest not', Object.entries(V.VEHICLE_CLASSES).every(([c, d]) => d.implemented === ['fixed-wing', 'sailplane', 'rotorcraft'].includes(c)));
  ok('every class lists only known component types', Object.values(V.VEHICLE_CLASSES).every(c => c.types.every(t => V.COMPONENT_TYPES[t])));

  // ---- components ----
  const c = V.makeComponent('wing', 'w1');
  ok('makeComponent fills every parameter with its default', V.COMPONENT_TYPES.wing.params.every(p => c[p.key] === p.def) && c.type === 'wing' && c.id === 'w1');
  throws('makeComponent refuses an unknown type', () => V.makeComponent('warpDrive', 'x'), /Unknown component type/);
  ok('every default lies inside its own range', Object.values(V.COMPONENT_TYPES).every(T => T.params.every(p => p.kind !== 'number' || (p.def >= p.min && p.def <= p.max))));

  // ---- validation ----
  const bad = (name, mut, re) => { const d = V.clone(k); mut(d); const e = V.validate(d); ok('validate: ' + name, e.some(x => re.test(x)), e.join('; ') || 'no errors'); };
  bad('unknown class', d => { d.class = 'zeppelin'; }, /unknown class/);
  bad('duplicate component id', d => { d.components.push(V.clone(d.components[0])); }, /duplicate component id/);
  bad('parameter out of range', d => { V.firstOf(d, 'wing').taper = 3; }, /taper = 3 is outside/);
  bad('non-numeric parameter', d => { V.firstOf(d, 'wing').span = '3.2'; }, /span must be a number/);
  bad('missing parameter', d => { delete V.firstOf(d, 'battery').energy; }, /missing energy/);
  bad('component type not allowed in the class', d => { d.components.push(V.makeComponent('stage', 's1')); }, /not allowed in class/);
  bad('bad choice', d => { V.firstOf(d, 'wing').position = 'sideways'; }, /must be one of/);
  bad('requirement with a bad operator', d => { d.requirements[0].op = '=='; }, /op must be/);
  bad('wrong schema', d => { d.schema = 'x'; }, /schema must be/);
  ok('validate: a non-object is invalid', V.validate(null).length > 0);

  // ---- paths ----
  const d = V.clone(k);
  ok('getPath reads a component parameter', V.getPath(d, 'wing.span') === 3.2);
  ok('getPath reads the mission', V.getPath(d, 'mission.cruiseSpeed') === 22);
  V.setPath(d, 'wing.span', 3.0); V.setPath(d, 'mission.altitude', 1000);
  ok('setPath writes a component parameter and the mission', V.firstOf(d, 'wing').span === 3.0 && d.mission.altitude === 1000);
  throws('setPath on an unknown component throws', () => V.setPath(d, 'nacelle.mass', 1), /No component/);
  throws('a path without a dot is refused', () => V.getPath(d, 'wing'), /Bad path/);

  // ---- edits that carry other parts ----
  const e = V.clone(k), ht0 = V.firstOf(e, 'htail').x, vt0 = V.firstOf(e, 'vtail').x, bat0 = V.firstOf(e, 'battery').x;
  const ch = V.applyEdit(e, 'fuselage.length', 1.45);
  ok('shortening the fuselage moves the tail surfaces with its end', Math.abs(V.firstOf(e, 'htail').x - (ht0 - 0.2)) < 1e-12 && Math.abs(V.firstOf(e, 'vtail').x - (vt0 - 0.2)) < 1e-12, `htail ${ht0} → ${V.firstOf(e, 'htail').x}`);
  ok('…and leaves the other parts where they are', V.firstOf(e, 'battery').x === bat0 && V.firstOf(e, 'fuselage').length === 1.45);
  ok('…and reports every path it changed', ['fuselage.length', 'htail.x', 'vtail.x'].every(p => ch.includes(p)), ch.join(', '));
  ok('a plain edit changes only its own path', V.applyEdit(V.clone(k), 'wing.span', 3).join() === 'wing.span');

  // ---- JSON ----
  const text = V.toJSON(k), back = V.fromJSON(text);
  ok('JSON round trip gives the same document', JSON.stringify(back) === JSON.stringify(k));
  ok('every seed survives a JSON round trip', seeds().every(s => JSON.stringify(V.fromJSON(V.toJSON(s))) === JSON.stringify(s)));
  throws('fromJSON refuses text that is not JSON', () => V.fromJSON('{nope'), /Not valid JSON/);
  throws('fromJSON refuses a JSON object that is not a vehicle', () => V.fromJSON('{"name":"x"}'), /Not a valid vehicle document/);

  // ---- storage ----
  try {
    const t = V.clone(k); t.id = '__test-vehicle'; t.name = 'Test'; V.firstOf(t, 'wing').span = 2.75;
    Store.saveVehicle(t);
    const r = Store.loadVehicle('__test-vehicle');
    ok('a saved vehicle loads back from localStorage', r && V.firstOf(r, 'wing').span === 2.75);
    ok('a saved custom vehicle joins the hangar list', Store.allVehicles().some(v => v.id === '__test-vehicle'));
    ok('uniqueId avoids ids already taken', Store.uniqueId('Kestrel') === 'kestrel-2' && Store.uniqueId('__test vehicle') !== '__test-vehicle');
    ok('an unknown id loads as null', Store.loadVehicle('__nothing-here') === null);
  } finally {
    localStorage.removeItem('works-vehicle:__test-vehicle');
    localStorage.setItem('works-vehicles', JSON.stringify(Store.customIds().filter(x => x !== '__test-vehicle')));
  }
}
