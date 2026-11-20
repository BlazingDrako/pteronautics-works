// Sailplanes: the glide polar, MacCready's speed to fly, and the Tern graph end to end.
import { CouplingGraph } from '../../src/engine/graph.js';
import { glidePolar, sailplaneNodes } from '../../src/analyses/sailplane.js';
import { analysisNodes, hasGraph } from '../../src/analyses/classes.js';
import { metricsFor, runStudy } from '../../src/analyses/trade.js';
import { seeds } from '../../src/model/seeds.js';
import { clone, applyEdit, validate } from '../../src/model/vehicle.js';

export async function sailplaneTests(log) {
  const ok = (name, cond, detail = '') => log('sailplane: ' + name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${tol})`);

  // the polar against closed forms
  const P = { S: 10, AR: 25, e: 0.85, CD0: 0.012, CLmax: 1.8, W: 4000, rho: 1.1 };
  const pol = glidePolar(P), k = 1 / (Math.PI * P.e * P.AR);
  rel('best glide = 1 / (2√(CD0·k))', pol.LDmax, 1 / (2 * Math.sqrt(P.CD0 * k)), 1e-12);
  rel('…and the sink at the best-glide speed gives that ratio', pol.Vmd / pol.sink(pol.Vmd), pol.LDmax, 1e-9);
  ok('minimum sink is below the sink at best glide, at a slower speed', pol.minSink < pol.sink(pol.Vmd) && pol.Vms < pol.Vmd);
  rel('minimum sink sits at CL = √(3·CD0/k)', 2 * P.W / (P.rho * pol.Vms ** 2 * P.S), Math.sqrt(3 * P.CD0 / k), 1e-9);
  const capped = glidePolar({ ...P, CLmax: 1.3 });
  rel('…unless that is past CL,max: then just below it', 2 * P.W / (P.rho * capped.Vms ** 2 * P.S), 1.3 * 0.98, 1e-9);
  ok('no speed on the polar sinks less than the minimum', pol.curve.every(c => c.sink >= pol.minSink - 1e-12));
  const x2 = pol.speedToFly(2);
  ok('MacCready: the speed to fly maximises V·Wc/(Wc + w)', [0.97, 1.03].every(f => { const V = x2.V * f; return V * 2 / (2 + pol.sink(V)) <= x2.Vxc + 1e-9; }), `${(x2.V * 3.6).toFixed(1)} km/h`);
  rel('MacCready: at the speed to fly, the tangent from (0, Wc) touches the polar', (x2.sink + 2) / x2.V, (pol.sink(x2.V * 1.0001) - pol.sink(x2.V * 0.9999)) / (x2.V * 0.0002), 1e-3);
  const xs = [0.5, 1, 2, 4].map(w => pol.speedToFly(w));
  ok('MacCready: stronger thermals, faster speed to fly and faster cross-country', xs.every((x, i) => !i || (x.V > xs[i - 1].V && x.Vxc > xs[i - 1].Vxc)));
  const heavy = glidePolar({ ...P, W: P.W * 1.44 });
  rel('ballast: 44% more weight leaves the best glide unchanged', heavy.LDmax, pol.LDmax, 1e-12);
  rel('…and moves the polar to 1.2× the speed', heavy.Vmd / pol.Vmd, 1.2, 1e-9);

  // Tern end to end
  const tern = seeds().find(v => v.id === 'tern');
  ok('Tern is a valid live sailplane', validate(tern).length === 0 && hasGraph(tern) && tern.status === 'active', validate(tern).join('; '));
  const g = new CouplingGraph(analysisNodes(tern)); g.runSync(tern);
  ok('every node of the Tern graph is current', g.isCurrent(), g.order.map(id => `${id}:${g.state.get(id).state} ${g.state.get(id).error || ''}`).join(', '));
  ok('the sailplane graph has no motor, battery or mission nodes', !g.nodes.has('performance') && !g.nodes.has('mission') && g.nodes.has('glide'));
  const gl = g.outputs('glide'), ae = g.outputs('aero'), geo = g.outputs('geometry'), m = g.outputs('mass');
  ok('Tern: aspect ratio about 28.6, 18 m span', Math.abs(geo.AR - 28.6) < 0.1 && geo.span === 18, geo.AR.toFixed(2));
  rel('Tern: the glide node uses the aero node\'s polar', gl.LDmax, 1 / (2 * Math.sqrt(ae.CD0 / (Math.PI * ae.e * geo.AR))), 1e-12);
  ok('Tern: statically stable with a sensible margin', g.outputs('stability').SM > 5 && g.outputs('stability').SM < 25, g.outputs('stability').SM.toFixed(1));
  ok('Tern: requirements read the glide outputs', g.outputs('requirements').list.every(r => isFinite(r.value)), g.outputs('requirements').list.map(r => `${r.id} ${r.status}`).join(', '));
  const d = clone(tern); applyEdit(d, 'pilot.mass', 115);
  const g2 = new CouplingGraph(analysisNodes(d)); g2.runSync(d);
  ok('Tern: a heavier pilot raises the wing loading and the cross-country speed', g2.outputs('glide').wingLoading > gl.wingLoading && g2.outputs('glide').xcSpeed > gl.xcSpeed);
  const r = clone(tern); r.mission.climbRate = 3; const g3 = new CouplingGraph(analysisNodes(r)); g3.runSync(r);
  ok('Tern: a stronger day only reruns the glide and requirements', (() => { const h = new CouplingGraph(analysisNodes(tern)); h.runSync(tern); return h.invalidate('mission.climbRate').sort().join() === 'glide,requirements'; })());
  ok('Tern: 3 m/s climbs give a faster cross-country speed', g3.outputs('glide').xcSpeed > gl.xcSpeed * 1.3);

  // trade studies on a sailplane
  const mt = metricsFor(tern).map(x => x.metric);
  ok('trade: a sailplane offers glide metrics and no endurance or mission ones', mt.includes('glide.xcSpeed') && !mt.includes('performance.endurance') && !mt.includes('mission.margin'));
  const sw = await runStudy({ doc: tern, nodes: sailplaneNodes(), axes: [{ path: 'wing.span', values: [15, 18, 21] }] });
  const ld = sw.samples.map(s => s.outputs['glide.LDmax']);
  ok('trade: more span, better glide', ld[0] < ld[1] && ld[1] < ld[2], ld.map(v => v.toFixed(1)).join(' '));
  ok('trade: the 18 m class rule fails past 18 m', sw.samples[2].reqs.find(q => q.id === 'R-08').status === 'fail');
}
