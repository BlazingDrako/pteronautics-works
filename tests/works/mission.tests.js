// Linked sizing (battery and motor mass with their rating) and the mission profile, on Kestrel.
import { CouplingGraph } from '../../src/engine/graph.js';
import { fixedWingNodes } from '../../src/analyses/fixedWing.js';
import { kestrel } from '../../src/model/seeds.js';
import { clone, applyEdit, firstOf, validate, fromJSON, upgrade, LINKS } from '../../src/model/vehicle.js';
import { validateSegments, makeSegment, defaultSegments, newSegmentId } from '../../src/model/segments.js';
import { Perf } from '../../src/adapters/aircraft.js';
import { packDraw } from '../../src/analyses/mission.js';
import { runStudy, tradeVariables } from '../../src/analyses/trade.js';
import { getPath } from '../../src/model/vehicle.js';

function solve(doc) {
  const g = new CouplingGraph(fixedWingNodes()); g.runSync(doc);
  const o = {}; for (const id of g.order) o[id] = g.outputs(id);
  return { g, o };
}

export async function missionTests(log) {
  const ok = (name, cond, detail = '') => log(name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${tol})`);
  const bat = d => firstOf(d, 'battery'), mot = d => firstOf(d, 'propulsor');

  // ---------- linked sizing ----------
  const base = kestrel();
  rel('sizing: Kestrel\'s battery specific energy is its energy over its mass', bat(base).specificEnergy, 888 / 4.9, 1e-12);
  ok('sizing: battery and motor are linked by default', bat(base).sizing === 'linked' && mot(base).sizing === 'linked');
  let d = clone(base), ch = applyEdit(d, 'battery.energy', 888 * 1.1);
  rel('sizing: linked, +10% energy is +10% pack mass', bat(d).mass, 4.9 * 1.1, 1e-12);
  ok('sizing: …and the edit reports the mass as changed', ch.includes('battery.mass'), ch.join());
  d = clone(base); bat(d).sizing = 'fixed'; applyEdit(d, 'battery.energy', 1000);
  ok('sizing: fixed, more energy keeps the mass and raises the specific energy', bat(d).mass === 4.9 && Math.abs(bat(d).specificEnergy - 1000 / 4.9) < 1e-9);
  d = clone(base); applyEdit(d, 'battery.mass', 6);
  rel('sizing: linked, a heavier pack holds more energy', bat(d).energy, 6 * 888 / 4.9, 1e-12);
  d = clone(base); applyEdit(d, 'battery.specificEnergy', 250);
  ok('sizing: linked, better cells give the same energy in a lighter pack', bat(d).energy === 888 && Math.abs(bat(d).mass - 888 / 250) < 1e-12);
  d = clone(base); bat(d).sizing = 'fixed'; applyEdit(d, 'battery.specificEnergy', 250);
  ok('sizing: fixed, better cells give more energy in the same pack', bat(d).mass === 4.9 && Math.abs(bat(d).energy - 250 * 4.9) < 1e-9);
  d = clone(base); applyEdit(d, 'battery.energy', 1e6);
  ok('sizing: a mass beyond its range is clamped, and a = k·b still holds', bat(d).mass === 5000 && Math.abs(bat(d).specificEnergy * bat(d).mass - bat(d).energy) < 1e-6, `${bat(d).mass} kg, ${bat(d).specificEnergy.toFixed(1)} Wh/kg`);
  d = clone(base); applyEdit(d, 'propulsor.power', 3000);
  rel('sizing: linked, twice the motor power is twice the motor mass', mot(d).mass, 3.2, 1e-12);
  ok('sizing: every link is a = k·b in Kestrel', Object.entries(LINKS).every(([type, L]) => { const c = firstOf(base, type); return Math.abs(c[L.k] * c[L.b] / c[L.a] - 1) < 1e-12; }));
  const lin = solve(clone(base)).o; d = clone(base); applyEdit(d, 'battery.energy', 888 * 1.2); const big = solve(d).o;
  ok('sizing: a bigger linked pack raises the takeoff mass by its own extra mass', Math.abs(big.mass.total - lin.mass.total - 4.9 * 0.2) < 1e-9, `${(big.mass.total - lin.mass.total).toFixed(3)} kg`);

  // ---------- older documents ----------
  const old = clone(base);
  for (const c of old.components) { delete c.specificEnergy; delete c.specificPower; delete c.sizing; }
  delete old.mission.segments; old.requirements = old.requirements.filter(r => r.id !== 'R-11');
  const up = fromJSON(JSON.stringify(old));
  ok('upgrade: a document from before sizing and missions loads', validate(up).length === 0, validate(up).join('; '));
  ok('upgrade: it gets linked sizing from its own numbers', bat(up).sizing === 'linked' && Math.abs(bat(up).specificEnergy - 888 / 4.9) < 1e-12 && bat(up).mass === 4.9);
  ok('upgrade: and a default mission built from its flight condition', up.mission.segments.length === 6 && up.mission.segments[0].to === 400 && up.mission.segments[1].speed === 22);
  rel('upgrade: its analyses are unchanged (endurance)', solve(up).o.performance.endurance, lin.performance.endurance, 1e-12);
  ok('upgrade: running it twice changes nothing', JSON.stringify(upgrade(clone(up))) === JSON.stringify(up));

  // ---------- segments ----------
  ok('segments: the default profile validates', validateSegments(defaultSegments({ altitude: 300, cruiseSpeed: 20 })).length === 0);
  ok('segments: an unknown kind, a value out of range and a duplicate id are caught',
    validateSegments([{ id: 'a', kind: 'teleport' }]).length === 1 && validateSegments([makeSegment('cruise', 'a', { speed: 1 })]).length === 1 && validateSegments([makeSegment('climb', 'a'), makeSegment('reserve', 'a')]).length === 1);
  ok('segments: new ids do not collide', newSegmentId([{ id: 's1' }, { id: 's3' }]) === 's2' && newSegmentId([{ id: 's1' }, { id: 's2' }]) === 's3');
  ok('segments: a document with a bad segment is refused', (() => { try { const x = clone(base); x.mission.segments[1].speed = -5; fromJSON(JSON.stringify(x)); return false; } catch { return true; } })());

  // ---------- the mission profile ----------
  const { o } = solve(clone(base)), m = o.mission, seg = id => m.segments.find(x => x.id === id);
  ok('mission: Kestrel\'s survey mission flies, every segment without an error', m.feasible && m.segments.every(x => !x.error), m.segments.map(x => x.error).filter(Boolean).join('; '));
  const hotel = base.mission.hotelPower, pack = { voltage: bat(base).voltage, resistance: bat(base).resistance };
  rel('mission: cruise power is the Performance node\'s at the same speed and height, plus the hotel load', seg('s2').P, o.performance.cruise.P + hotel, 1e-9);
  rel('mission: a cruise leg takes distance / (airspeed − headwind)', (seg('s2').t1 - seg('s2').t0), 18000 / (22 - 4), 1e-12);
  rel('mission: …and a tailwind shortens it', (seg('s4').t1 - seg('s4').t0), 18000 / 26, 1e-12);
  rel('mission: a loiter\'s energy is what the cells give at its power, × time', seg('s3').E, packDraw(seg('s3').P, pack).cell * 48 / 60, 1e-12);
  const ac = Perf.AIRCRAFT.find(a => a.id === 'works:kestrel'), W = o.mass.total * 9.80665;
  rel('mission: climb time agrees with the core\'s time to climb', (seg('s1').t1 - seg('s1').t0), Perf.timeToClimb(ac, 0, W, 'max', 400, 0).t ?? Perf.timeToClimb(ac, 0, W, 'max', 400, 0), 0.03);
  rel('mission: the glide covers the height × the best L/D', seg('s5').x1 - seg('s5').x0, 0.4 * o.performance.LDmax, 0.02);
  rel('mission: the glide draws only the hotel load', seg('s5').E, packDraw(hotel, pack).cell * (seg('s5').t1 - seg('s5').t0) / 3600, 1e-9);
  ok('mission: …and ends on the ground', Math.abs(seg('s5').z1) < 1e-9);
  const sum = m.segments.reduce((s, x) => s + x.E, 0);
  rel('mission: the energy used is the sum of the segments, reserve included', m.energy, sum, 1e-12);
  rel('mission: margin = (usable − used) / usable', m.margin, (bat(base).energy * bat(base).usable - sum) / (bat(base).energy * bat(base).usable) * 100, 1e-12);
  const r11 = o.requirements.list.find(r => r.id === 'R-11');
  ok('mission: R-11 reads the margin', r11 && r11.value === m.margin, r11 && `${r11.value.toFixed(2)}% (${r11.status})`);

  const res = clone(base); res.mission.segments = [makeSegment('climb', 's1', { to: 400 }), makeSegment('reserve', 's2', { time: 10 })];
  const ro = solve(res).o;
  rel('mission: the reserve is held at the best-endurance power, plus the hotel load', ro.mission.segments[1].P, ro.performance.Pend + hotel, 0.005);

  // the pack and the hotel load
  const pd = packDraw(1000, { voltage: 20, resistance: 0.02 });
  rel('pack: the cells give the terminal power plus I²R', pd.cell, 1000 + pd.loss, 1e-12);
  rel('pack: …with I from V₀·I − I²R = P', 20 * pd.I - pd.I * pd.I * 0.02, 1000, 1e-12);
  ok('pack: no resistance, no loss', packDraw(500, { voltage: 20, resistance: 0 }).cell === 500);
  ok('pack: beyond V₀²/4R the pack cannot deliver', !!packDraw(6000, { voltage: 20, resistance: 0.02 }).error);
  ok('pack: the climb loses the most per minute (loss grows with current²)', seg('s1').loss / (seg('s1').t1 - seg('s1').t0) > seg('s3').loss / (seg('s3').t1 - seg('s3').t0), `${seg('s1').loss.toFixed(2)} Wh in the climb`);
  const ideal = clone(base); bat(ideal).resistance = 0; ideal.mission.hotelPower = 0;
  const io = solve(ideal).o.mission;
  ok('pack: with no resistance and no hotel load, the losses are zero and the margin is higher', io.loss === 0 && io.margin > m.margin, `${io.margin.toFixed(2)}% vs ${m.margin.toFixed(2)}%`);
  const hot = clone(ideal); hot.mission.hotelPower = 50;
  rel('hotel: 50 W costs 50 W × the time flown, plus the reserve\'s share', solve(hot).o.mission.energy - io.energy, 50 * (io.duration / 60 + 10 / 60), 1e-6);

  // field elevation
  const hi = clone(base); hi.mission.fieldElevation = 1500;
  const hm = solve(hi).o.mission;
  ok('field: from a 1500 m field, the climb is slower and the cruise takes more power', (hm.segments[0].t1 - hm.segments[0].t0) > (seg('s1').t1 - seg('s1').t0) && hm.segments[1].P > seg('s2').P);
  ok('field: heights stay above the field', hm.segments[0].z1 === 400 && hm.field === 1500);

  // segment values as design variables
  ok('paths: a segment value reads and writes by mission.segments.<id>.<key>', getPath(base, 'mission.segments.s3.time') === 48 && (() => { const c = clone(base); const ch = applyEdit(c, 'mission.segments.s3.time', 60); return c.mission.segments[2].time === 60 && ch.includes('mission.segments'); })());
  ok('trade: segment values and mission settings are trade variables', tradeVariables(base).some(v => v.path === 'mission.segments.s3.time' && v.group === 'Mission · Survey grid') && tradeVariables(base).some(v => v.path === 'mission.hotelPower'));

  const slow = clone(base); slow.mission.segments[2].speed = 15;
  const so = solve(slow).o;
  ok('mission: a survey below 1.1 × stall is an error, with no margin, and R-11 fails', !so.mission.feasible && /stall/.test(so.mission.segments[2].error) && isNaN(so.mission.margin) && so.requirements.list.find(r => r.id === 'R-11').status === 'fail', so.mission.segments[2].error);
  const high = clone(base); firstOf(high, 'propulsor').power = 500; high.mission.segments[0].to = 3000;
  const ho = solve(high).o;
  ok('mission: a climb above the ceiling is an error', /cannot climb/.test(ho.mission.segments[0].error || ''), ho.mission.segments[0].error);
  const fast = clone(base); fast.mission.segments[1].speed = 60;
  ok('mission: a speed beyond the motor is an error', /shaft power/.test(solve(fast).o.mission.segments[1].error || ''), solve(fast).o.mission.segments[1].error);
  const down = clone(base); down.mission.segments[4].to = 500;
  ok('mission: a descent to above the current altitude is an error', /below its target/.test(solve(down).o.mission.segments[4].error || ''));

  // coupling: the mission sees the mass and the edits
  const heavy = clone(base); applyEdit(heavy, 'payload.mass', 6.5);
  ok('mission: 2 kg more payload costs energy margin', solve(heavy).o.mission.margin < m.margin);
  const g = solve(clone(base)).g;
  ok('mission: a segment edit reruns only the mission and the requirements', g.invalidate('mission.segments').sort().join() === 'mission,requirements');

  const sw = await runStudy({ doc: base, nodes: fixedWingNodes(), axes: [{ path: 'mission.segments.s3.time', values: [40, 50, 60, 70] }] });
  const mg = sw.samples.map(x => x.outputs['mission.margin']);
  ok('trade: sweeping the survey time lowers the margin in equal steps', mg.every((v, i) => !i || v < mg[i - 1]) && Math.abs((mg[0] - mg[1]) - (mg[2] - mg[3])) < 1e-6, mg.map(v => v.toFixed(2)).join(' '));
}
