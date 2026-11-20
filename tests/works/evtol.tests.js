// Lift + cruise eVTOL: hover by momentum theory, hover segments, stopped-rotor drag, and Halcyon end to end.
import { CouplingGraph } from '../../src/engine/graph.js';
import { analysisNodes } from '../../src/analyses/classes.js';
import { hoverPower, rotorLayout } from '../../src/analyses/rotors.js';
import { metricsFor } from '../../src/analyses/trade.js';
import { seeds, kestrel } from '../../src/model/seeds.js';
import { clone, applyEdit, validate, firstOf } from '../../src/model/vehicle.js';
import { kindsFor, defaultSegments, validateSegments } from '../../src/model/segments.js';
import { atmosphere } from '../../src/adapters/aircraft.js';

const solve = doc => { const g = new CouplingGraph(analysisNodes(doc)); g.runSync(doc); const o = {}; for (const id of g.order) o[id] = g.outputs(id); return { g, o }; };

export function evtolTests(log) {
  const ok = (name, cond, detail = '') => log('eVTOL: ' + name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${tol})`);

  // momentum theory
  const rotor = { count: 4, radius: 1.5, figureOfMerit: 0.75, motorEff: 0.9, tipSpeed: 170 }, W = 15000, rho = 1.225;
  const A = 4 * Math.PI * 1.5 ** 2, h0 = hoverPower({ rotor, W, rho });
  rel('ideal hover power is W·√(W / 2ρA)', h0.Pideal, W * Math.sqrt(W / (2 * rho * A)), 1e-12);
  rel('actual power is ideal / figure of merit, electrical / motor efficiency', h0.Pel, h0.Pideal / 0.75 / 0.9, 1e-12);
  rel('disk loading is W / A', h0.diskLoading, W / A, 1e-12);
  const hc = hoverPower({ rotor, W, rho, climb: 4 });
  ok('a vertical climb takes more power, by about W·Vc/2 at low climb rates', hc.P > h0.P && Math.abs((hc.P - h0.P) * 0.75 - W * 2) / (W * 2) < 0.15, `${((hc.P - h0.P) / 1000).toFixed(1)} kW`);
  const hiAlt = hoverPower({ rotor, W, rho: atmosphere(2000).rho });
  rel('hover power goes as 1/√ρ', hiAlt.P / h0.P, Math.sqrt(rho / atmosphere(2000).rho), 1e-9);
  const big = hoverPower({ rotor: { ...rotor, radius: 3 }, W, rho });
  rel('doubling the radius halves the induced power', big.P / h0.P, 0.5, 1e-9);

  // layout
  const hal = seeds().find(v => v.id === 'halcyon');
  const lay = rotorLayout(hal);
  ok('layout: four rotors, two each side, one ahead of the wing and one behind', lay.length === 4 && lay.filter(r => r.y < 0).length === 2 && lay.some(r => r.x < firstOf(hal, 'wing').x) && lay.some(r => r.x > firstOf(hal, 'wing').x + firstOf(hal, 'wing').rootChord));
  ok('layout: rotors clear the fuselage', lay.every(r => Math.abs(r.y) - r.R > firstOf(hal, 'fuselage').width / 2));

  // segments
  ok('segments: only eVTOLs can hover', kindsFor('rotorcraft').includes('hover') && !kindsFor('fixed-wing').includes('hover') && !kindsFor('sailplane').includes('hover'));
  ok('segments: the default eVTOL profile hovers out and in', defaultSegments({ altitude: 300, cruiseSpeed: 55 }, 'rotorcraft').filter(s => s.kind === 'hover').length === 2 && validateSegments(defaultSegments({}, 'rotorcraft')).length === 0);

  // Halcyon end to end
  ok('Halcyon is a valid live eVTOL', validate(hal).length === 0 && hal.status === 'active', validate(hal).join('; '));
  const { g, o } = solve(hal);
  ok('every node of the Halcyon graph is current, with a Hover node', g.isCurrent() && g.nodes.has('hover') && g.nodes.has('mission'), g.order.map(id => `${id}:${g.state.get(id).state} ${g.state.get(id).error || ''}`).join(', '));
  rel('the Hover node is momentum theory at the takeoff weight', o.hover.Pel, hoverPower({ rotor: firstOf(hal, 'rotor'), W: o.mass.total * 9.80665, rho: atmosphere(0).rho }).Pel, 1e-12);
  const hs = o.mission.segments.find(s => s.kind === 'hover');
  rel('a hover segment draws the climbing hover power plus the hotel load', hs.P, hoverPower({ rotor: firstOf(hal, 'rotor'), W: o.mass.total * 9.80665, rho: atmosphere(25).rho, climb: 50 / 60 }).Pel + hal.mission.hotelPower, 1e-9);
  ok('hover is the most power-hungry part of the flight', o.mission.segments.filter(s => s.kind !== 'hover').every(s => !(s.P > hs.P)));
  ok('Halcyon flies its mission with energy to spare and is statically stable', o.mission.feasible && o.mission.margin > 5 && o.stability.SM > 5 && o.stability.SM < 25, `margin ${o.mission.margin.toFixed(1)}%, SM ${o.stability.SM.toFixed(1)}%`);
  ok('a hover in a fixed-wing mission is an error', (() => { const k = kestrel(); k.mission.segments.unshift({ id: 'h', kind: 'hover', duration: 30, climb: 10 }); return /lift rotors/.test(solve(k).o.mission.segments[0].error || ''); })());

  // stopped rotors
  const item = o.aero.drag.find(d => /Stopped lift rotors/.test(d.name));
  ok('cruise drag includes the stopped lift rotors', item && item.CD > 0.005, item && `${(item.CD * 1e4).toFixed(0)} counts`);
  const more = clone(hal); applyEdit(more, 'rotor.count', 8);
  const om = solve(more).o;
  ok('eight rotors: less hover power, more cruise drag', om.hover.Pel < o.hover.Pel && om.aero.CD0 > o.aero.CD0, `${o.hover.kW.toFixed(0)} → ${om.hover.kW.toFixed(0)} kW`);
  const g2 = solve(hal).g;
  ok('a rotor edit reruns aero, hover, the mission and what follows, not the geometry', (() => { const st = g2.invalidate('rotor.radius'); return st.includes('hover') && st.includes('aero') && st.includes('mission') && !st.includes('geometry'); })());

  // speed limit
  ok('Kestrel\'s top speed is unchanged by the vehicle speed limit', Math.abs(solve(kestrel()).o.performance.Vmax - 40.8) < 0.1, solve(kestrel()).o.performance.Vmax.toFixed(2));
  ok('Halcyon\'s top speed is set by its power, above the old 40 m/s cap', o.performance.Vmax > 60 && o.performance.Vmax < 1.25 * hal.mission.cruiseSpeed / Math.sqrt(atmosphere(450).sigma ?? atmosphere(450).rho / 1.225) - 1, o.performance.Vmax.toFixed(1));
  ok('trade: hover metrics for an eVTOL, not for Kestrel', metricsFor(hal).some(m => m.metric === 'hover.kW') && !metricsFor(kestrel()).some(m => m.metric === 'hover.kW'));
}
