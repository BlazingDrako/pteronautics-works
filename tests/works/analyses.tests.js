// The fixed-wing graph on Kestrel, end to end through the core solvers: values, couplings and trends.
import { CouplingGraph } from '../../src/engine/graph.js';
import { fixedWingNodes } from '../../src/analyses/fixedWing.js';
import { evaluate, readMetric } from '../../src/analyses/requirements.js';
import { kestrel } from '../../src/model/seeds.js';
import { clone, setPath, firstOf, pointMass } from '../../src/model/vehicle.js';
import { liftSlope } from '../../core/solvers/stability.js';
import { cmQuarter, sectionOf, oswald } from '../../src/adapters/aircraft.js';

function solve(doc, fid = 'vlm') {
  const g = new CouplingGraph(fixedWingNodes());
  g.setFidelity('aero', fid); g.runSync(doc);
  const o = {}; for (const id of g.order) o[id] = g.outputs(id);
  return { g, o };
}

export function analysesTests(log) {
  const ok = (name, cond, detail = '') => log('fixed-wing: ' + name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(5)}, expected ${(+ref).toPrecision(5)} (±${(tol * 100).toFixed(0)}%)`);
  const doc = kestrel(), { g, o } = solve(doc);

  ok('every node of the Kestrel graph is current', g.isCurrent(), g.order.map(id => `${id}:${g.state.get(id).state}${g.state.get(id).error ? ' ' + g.state.get(id).error : ''}`).join(', '));
  ok('the order runs geometry before aero, aero and mass before stability and performance',
    ['geometry', 'aero', 'stability'].every((id, i, a) => !i || g.order.indexOf(a[i - 1]) < g.order.indexOf(id)) && g.order.indexOf('mass') < g.order.indexOf('performance'));

  // geometry and mass
  const w = firstOf(doc, 'wing'), S = w.span * w.rootChord * (1 + w.taper) / 2;
  rel('wing area from span, root chord and taper', o.geometry.S, S, 1e-12);
  rel('mass build-up = parts + wing areal mass × area', o.mass.total, pointMass(doc) + w.arealMass * S, 1e-12);
  ok('Kestrel takes off at about 22.5 kg', Math.abs(o.mass.total - 22.5) < 0.5, `${o.mass.total.toFixed(2)} kg`);

  // aero against independent estimates
  rel('VLM lift slope against the DATCOM/Helmbold estimate (core stability.liftSlope)', o.aero.CLa, liftSlope(o.geometry.AR, 0, o.aero.M), 0.05);
  const llt = solve(doc, 'llt').o.aero;
  rel('lifting-line and vortex-lattice lift slopes agree', llt.CLa, o.aero.CLa, 0.05);
  rel('both give the same zero-lift angle', llt.alphaL0, o.aero.alphaL0, 0.03);
  ok('span efficiency of a tapered, washed-out wing is 0.9–1', o.aero.eInv > 0.9 && o.aero.eInv <= 1.0001, o.aero.eInv.toFixed(4));
  rel('Oswald e from Kroo\'s viscous correction', o.aero.e, oswald(o.aero.eInv, o.geometry.AR, o.aero.CD0), 1e-12);
  ok('zero-lift drag of a clean small UAS is 0.015–0.035', o.aero.CD0 > 0.015 && o.aero.CD0 < 0.035, o.aero.CD0.toFixed(4));
  ok('NACA 4415 thin-airfoil cm,c/4 ≈ −0.106 (π/4·(A2 − A1))', Math.abs(cmQuarter('4415') + 0.106) < 0.002 && cmQuarter('0012') === 0, cmQuarter('4415').toFixed(4));
  ok('thin-airfoil zero-lift angle: NACA 2412 ≈ −2.08°, and 4415 twice that (linear in camber)', Math.abs(sectionOf('2412').alpha0 + 2.077) < 0.01 && Math.abs(sectionOf('4415').alpha0 - 2 * sectionOf('2412').alpha0) < 1e-9, `${sectionOf('2412').alpha0.toFixed(3)}°, ${sectionOf('4415').alpha0.toFixed(3)}°`);
  const span = o.aero.spanLoad(0.8);
  // trapezoids between strip centres, plus the root piece (flat) and the tip piece (load falls to zero)
  let lift = span[0].ccl * span[0].eta + 0.5 * span[span.length - 1].ccl * (1 - span[span.length - 1].eta);
  for (let i = 1; i < span.length; i++) lift += 0.5 * (span[i].ccl + span[i - 1].ccl) * (span[i].eta - span[i - 1].eta);
  rel('the span load integrates back to the wing CL (∫ c·cℓ/c̄ dη · c̄/(S/b) = CL)', lift * o.geometry.mac * o.geometry.span / o.geometry.S, 0.8, 0.03);
  const nl = solve(doc, 'vlm-stall').o.aero;
  rel('nonlinear strip CL,max is near the handbook 0.9·cℓ,max', nl.CLmax, o.aero.CLmax, 0.15);
  ok('the nonlinear loop finds where the stall starts', nl.stall && nl.stall.firstStall && nl.stall.firstStall.eta >= 0 && nl.stall.firstStall.eta <= 1, JSON.stringify(nl.stall?.firstStall));

  // stability and performance consistency
  rel('static margin = (x_NP − x_CG)/MAC', o.stability.SM, (o.stability.xnp - o.mass.xcg) / o.geometry.mac * 100, 1e-9);
  ok('Kestrel is statically stable with a 5–20% margin', o.stability.SM > 5 && o.stability.SM < 20, o.stability.SM.toFixed(2) + '%');
  ok('Dutch roll and short period are damped', o.stability.drZeta > 0 && o.stability.spZeta > 0, `ζdr ${o.stability.drZeta.toFixed(3)}, ζsp ${o.stability.spZeta.toFixed(3)}`);
  const atm = o.atmosphere.cruise;
  rel('stall speed = √(2W / ρ S CL,max)', o.performance.Vs, Math.sqrt(2 * o.mass.total * 9.80665 / (atm.rho * o.geometry.S * o.aero.CLmax)), 1e-6);
  rel('max L/D = ½√(πAe/CD0)', o.performance.LDmax, 0.5 * Math.sqrt(Math.PI * o.geometry.AR * o.aero.e / o.aero.CD0), 0.01);
  rel('endurance = usable energy / minimum battery power', o.performance.endurance, o.performance.E * 60 / o.performance.Pend, 1e-9);
  ok('Kestrel flies 80–150 min', o.performance.endurance > 80 && o.performance.endurance < 150, o.performance.endurance.toFixed(1) + ' min');

  // couplings: what an edit marks stale, and trends
  const g2 = solve(doc).g;
  const st = g2.invalidate('wing.span').sort();
  ok('a span edit marks geometry and everything after it stale, not the atmosphere', st.join() === 'aero,geometry,mass,performance,requirements,sections,stability' && g2.state.get('atmosphere').state === 'current', st.join());
  ok('a battery-position edit skips geometry and aero', g2.invalidate('battery.x').sort().join() === 'aero,geometry,mass,performance,requirements,stability'.split(',').filter(x => x !== 'geometry' && x !== 'aero').join());
  ok('a requirement target edit reruns only the requirements', (() => { const h2 = solve(doc).g; return h2.invalidate('requirements.R-01').join() === 'requirements'; })());

  const d2 = clone(doc); setPath(d2, 'wing.span', 3.6);
  const o2 = solve(d2).o;
  ok('more span: more wing mass, higher L/D, lower stall speed, more endurance',
    o2.mass.total > o.mass.total && o2.performance.LDmax > o.performance.LDmax && o2.performance.Vs < o.performance.Vs && o2.performance.endurance > o.performance.endurance,
    `m ${o2.mass.total.toFixed(2)}, L/D ${o2.performance.LDmax.toFixed(2)}, Vs ${o2.performance.Vs.toFixed(2)}, ${o2.performance.endurance.toFixed(1)} min`);
  const bat = firstOf(doc, 'battery'), d3 = clone(doc); setPath(d3, 'battery.x', bat.x + 0.1);
  const o3 = solve(d3).o;
  rel('moving the battery 0.1 m aft moves the CG by m_b·0.1/M', o3.mass.xcg - o.mass.xcg, bat.mass * 0.1 / o.mass.total, 1e-9);
  ok('…and reduces the static margin', o3.stability.SM < o.stability.SM, `${o.stability.SM.toFixed(2)} → ${o3.stability.SM.toFixed(2)}%`);
  const d4 = clone(doc); setPath(d4, 'mission.altitude', 3000);
  ok('higher altitude: higher true stall speed', solve(d4).o.performance.Vs > o.performance.Vs);
  const d5 = clone(doc); setPath(d5, 'htail.area', 0.24);
  ok('a bigger tail moves the neutral point aft', solve(d5).o.stability.xnp > o.stability.xnp);

  // requirements
  ok('requirement: comfortably met', evaluate({ op: '>=', target: 90 }, 100).status === 'met');
  ok('requirement: within 5% is marginal', evaluate({ op: '>=', target: 90 }, 92).status === 'marginal' && evaluate({ op: '<=', target: 18 }, 17.5).status === 'marginal');
  ok('requirement: missed is failing, with a negative margin', (() => { const r = evaluate({ op: '<=', target: 25 }, 26); return r.status === 'fail' && r.margin < 0; })());
  ok('requirement: no value is failing', evaluate({ op: '>=', target: 1 }, NaN).status === 'fail');
  ok('requirement metrics read nested outputs', readMetric({ a: { b: { c: 3 } } }, 'a.b.c') === 3 && isNaN(readMetric({}, 'x.y')));
  ok('Kestrel requirements are all evaluated', o.requirements.total === doc.requirements.length && o.requirements.list.every(r => isFinite(r.value)), `${o.requirements.met}/${o.requirements.total} met`);

  // a broken input fails cleanly instead of throwing out of the graph
  const d6 = clone(doc); d6.components = d6.components.filter(c => c.type !== 'htail');
  const o6 = solve(d6);
  ok('without a tail, stability fails with a reason and the rest still runs', o6.g.state.get('stability').state === 'failed' && /tail/.test(o6.g.state.get('stability').error) && o6.g.state.get('performance').state === 'current');
}
