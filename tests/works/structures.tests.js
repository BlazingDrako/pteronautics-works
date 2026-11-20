// Wing structure at beam level: the spar against closed forms, and the coupling into mass.
import { CouplingGraph } from '../../src/engine/graph.js';
import { analysisNodes } from '../../src/analyses/classes.js';
import { wingBeam, SPAR_MATERIALS } from '../../src/analyses/structures.js';
import { runStudy } from '../../src/analyses/trade.js';
import { kestrel, seeds } from '../../src/model/seeds.js';
import { clone, applyEdit } from '../../src/model/vehicle.js';

const solve = (d, level = 'beam') => { const g = new CouplingGraph(analysisNodes(d)); g.setFidelity('mass', level); g.runSync(d); const o = {}; for (const id of g.order) o[id] = g.outputs(id); return o; };

export async function structuresTests(log) {
  const ok = (name, cond, detail = '') => log('structures: ' + name, !!cond, detail);
  const rel = (name, v, ref, tol) => ok(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${tol})`);
  const base = { span: 10, chord: () => 1, tc: () => 0.12, W: 10000, n: 4, material: 'aluminium', skin: 0, S: 10, N: 400 };
  const b = wingBeam(base), s = 5, L = 1.5 * 4 * 10000 / 2;
  rel('root shear is the half-wing lift at the ultimate load', b.rootShear, L, 1e-4);
  rel('root moment of an elliptic load is L·4s/(3π)', b.rootMoment, L * 4 * s / (3 * Math.PI), 1e-3);
  rel('cap area at the root is M / (σ·h)', b.rootCap, b.rootMoment / (SPAR_MATERIALS.aluminium.sigma * 0.9 * 0.12), 1e-12);
  ok('moment and shear fall to zero at the tip', b.stations.at(-1).M === 0 && b.stations.at(-1).V === 0);
  const twice = wingBeam({ ...base, W: 20000 });
  rel('caps and web scale with the load', twice.caps / b.caps, 2, 1e-9);
  const deep = wingBeam({ ...base, tc: () => 0.24 });
  rel('a twice-deep spar needs half the caps and the same web', deep.caps / b.caps, 0.5, 1e-9);
  ok('…and the web is unchanged', Math.abs(deep.web / b.web - 1) < 1e-12);
  const carbon = wingBeam({ ...base, material: 'carbon' });
  ok('carbon caps are lighter than aluminium', carbon.caps < b.caps, `${carbon.caps.toFixed(1)} vs ${b.caps.toFixed(1)} kg`);
  const long = wingBeam({ ...base, span: 15, S: 15 });
  ok('more span, much more spar (moment grows with span)', long.caps / b.caps > 1.5 * 1.4);

  // the mass node
  const k = kestrel(), areal = solve(k, 'areal'), beam = solve(k, 'beam');
  ok('Kestrel\'s seed is calibrated: beam wing ≈ areal wing (±2%)', Math.abs(beam.mass.structure.mass / areal.mass.structure.mass - 1) < 0.02, `${beam.mass.structure.mass.toFixed(2)} vs ${areal.mass.structure.mass.toFixed(2)} kg`);
  for (const v of seeds().filter(x => ['tern', 'halcyon'].includes(x.id))) {
    const a = solve(v, 'areal').mass.structure.mass, m = solve(v, 'beam').mass.structure.mass;
    ok(`${v.name}'s seed is calibrated (±2%)`, Math.abs(m / a - 1) < 0.02, `${m.toFixed(1)} vs ${a.toFixed(1)} kg`);
  }
  const bw = beam.mass.structure;
  rel('the wing load includes the wing itself (iterated)', bw.beam.rootShear, 1.5 * 3.8 * beam.mass.total * 9.80665 / 2, 1e-6);
  const heavy = clone(k); applyEdit(heavy, 'payload.mass', 8);
  ok('beam: more payload, a heavier spar; areal: the same wing', solve(heavy).mass.structure.beam.caps > bw.beam.caps && solve(heavy, 'areal').mass.structure.mass === areal.mass.structure.mass);
  const tern = seeds().find(v => v.id === 'tern');
  const sw = await runStudy({ doc: tern, nodes: analysisNodes(tern), fidelity: { mass: 'beam' }, axes: [{ path: 'wing.span', values: [15, 18, 21] }] });
  const wm = sw.samples.map(x => x.outputs['mass.total']);
  ok('a span sweep at beam level: the wing gets heavier faster than its area', (wm[2] - wm[1]) > (wm[1] - wm[0]), wm.map(x => x.toFixed(1)).join(' '));
}
