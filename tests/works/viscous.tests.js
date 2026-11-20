// Asynchronous nodes in the coupling engine, the mfoil polar sweep, the viscous sections node coupled into aero,
// and the 3D mesh builder.
import { CouplingGraph } from '../../src/engine/graph.js';
import { fixedWingNodes } from '../../src/analyses/fixedWing.js';
import { AirfoilSession, sweepPolar, polarSummary, cdAt, reBin } from '../../src/adapters/airfoil.js';
import { kestrel } from '../../src/model/seeds.js';
import { clone, setPath } from '../../src/model/vehicle.js';
import { buildMesh } from '../../src/ui/view3d.js';

const tick = ms => new Promise(r => setTimeout(r, ms));

export async function viscousTests(log) {
  const ok = (name, cond, detail = '') => log('viscous & 3D: ' + name, !!cond, detail);

  // ---------- async nodes ----------
  let release = null, runs = 0;
  const g = new CouplingGraph([
    { id: 'a', reads: ['x'], outputs: ['v'], run: ({ doc }) => ({ v: doc.x }) },
    { id: 'slow', after: ['a'], outputs: ['v'], run: ({ inputs }) => { runs++; return new Promise(r => { release = () => r({ v: inputs.a.v * 2 }); }); } },
    { id: 'c', after: ['slow'], outputs: ['v'], run: ({ inputs }) => ({ v: inputs.slow.v + 1 }) },
  ]);
  const doc = { x: 3 };
  const p = g.run(doc, { yield: () => Promise.resolve() });
  await tick(5);
  ok('an async node shows as running while its promise is pending', g.state.get('slow').state === 'running' && g.state.get('c').state === 'stale');
  release(); await p;
  ok('…and its result feeds the nodes after it', g.isCurrent() && g.outputs('c').v === 7, JSON.stringify(g.outputs('c')));
  // an edit while the async node runs: the old result is dropped and the node runs again
  g.invalidate('x'); doc.x = 5;
  const p2 = g.run(doc, { yield: () => Promise.resolve() });
  await tick(5); const first = release; g.invalidate('x'); doc.x = 10; g.run(doc); first();
  await tick(5); release(); await p2; await tick(5);
  ok('an edit during an async run discards the stale result and reruns', g.isCurrent() && g.outputs('c').v === 21 && runs === 3, `c = ${g.outputs('c').v}, slow ran ${runs}×`);
  const g2 = new CouplingGraph([{ id: 's', outputs: ['v'], run: () => Promise.resolve({ v: 1 }) }]);
  g2.runSync({});
  ok('runSync marks an async node failed instead of waiting', g2.state.get('s').state === 'failed' && /asynchronous/.test(g2.state.get('s').error));
  const g3 = new CouplingGraph([{ id: 's', outputs: ['v'], run: () => Promise.reject(new Error('no convergence')) }, { id: 't', after: ['s'], outputs: ['v'], run: () => ({ v: 1 }) }]);
  await g3.run({}, { yield: () => Promise.resolve() });
  ok('a rejected async node fails with its message, and so do its dependants', g3.state.get('s').error === 'no convergence' && g3.state.get('t').state === 'failed');

  // ---------- polars ----------
  const syn = [-2, 0, 2, 4, 6, 8, 10, 12].map(a => ({ alpha: a, cl: 0.1 * a + 0.2 - (a > 9 ? 0.05 * (a - 9) ** 2 : 0), cd: 0.008 + 0.0004 * a * a, conv: true }));
  const sm = polarSummary(syn);
  ok('polar summary: zero-lift angle and slope from the linear range', Math.abs(sm.alpha0 + 2) < 1e-9 && Math.abs(sm.cla - 0.1 * 180 / Math.PI) < 1e-9, `α0 ${sm.alpha0}, a ${sm.cla}`);
  ok('polar summary: cl,max, cd,min and best cl/cd', sm.clmax === syn.reduce((m, p) => Math.max(m, p.cl), -1) && sm.cdmin === 0.008 && sm.LDmax > 30);
  ok('cd at a given cl interpolates along the polar', Math.abs(cdAt({ points: syn, alphaClmax: sm.alphaClmax }, 0.3) - (0.008 + 0.0096) / 2) < 1e-12);
  ok('Reynolds bins are about 4% wide and stable', reBin(431000) === reBin(432500) && reBin(431000) !== reBin(460000) && Math.abs(reBin(431000) / 431000 - 1) < 0.03, `${reBin(431000)}`);

  const t0 = performance.now();
  const P = sweepPolar(new AirfoilSession(), { code: '0012', Re: 1e6, amin: -2, amax: 18 });
  const ms = performance.now() - t0;
  ok('NACA 0012 at Re 1 M: symmetric, zero lift at 0°', Math.abs(P.alpha0) < 0.15, `α0 ${P.alpha0.toFixed(3)}°`);
  ok('…lift slope a little under 2π per radian', P.cla > 5.6 && P.cla < 6.9, `${P.cla.toFixed(3)} /rad`);
  ok('…cd,min ≈ 0.0055 (XFOIL, free transition ≈ 0.0054)', P.cdmin > 0.0045 && P.cdmin < 0.0065, P.cdmin.toFixed(5));
  ok('…cl,max between 1.3 and 1.65 (Abbott & von Doenhoff ≈ 1.5–1.6 at Re 3–6 M)', P.clmax > 1.3 && P.clmax < 1.65, `${P.clmax.toFixed(3)} at ${P.alphaClmax}°  (${ms.toFixed(0)} ms, ${P.points.length} points)`);
  ok('…transition moves forward on the upper surface as α rises', (() => { const a = P.points.find(p => p.alpha === 0), b = P.points.find(p => p.alpha === 8); return a && b && b.xtrU < a.xtrU; })());

  // ---------- viscous sections coupled into the graph ----------
  const solveAsync = async (d, sections) => {
    const gg = new CouplingGraph(fixedWingNodes()); gg.setFidelity('sections', sections);
    await gg.run(d, { yield: () => Promise.resolve() });
    const o = {}; for (const id of gg.order) o[id] = gg.outputs(id);
    return { gg, o };
  };
  const k = kestrel();
  const thin = await solveAsync(k, 'thin'), visc = await solveAsync(k, 'viscous');
  ok('viscous sections: every node current', visc.gg.isCurrent(), visc.gg.order.map(id => `${id}:${visc.gg.state.get(id).state} ${visc.gg.state.get(id).error || ''}`).join(', '));
  const vs = visc.o.sections;
  ok('the sections node reports the polar at the mean chord\'s Reynolds number', vs.viscous && Math.abs(vs.Re / (visc.o.atmosphere.cruise.rho * k.mission.cruiseSpeed * visc.o.geometry.mac / visc.o.atmosphere.cruise.mu) - 1) < 0.03, `Re ${vs.Re}`);
  ok('aero takes CL,max from the viscous cl,max', Math.abs(visc.o.aero.CLmax - 0.9 * Math.min(vs.root.clmax, vs.tip.clmax)) < 1e-9 && /viscous/.test(visc.o.aero.clSource));
  ok('laminar runs on the NACA 4415 cut the wing\'s profile drag against fully turbulent Raymer', visc.o.aero.CD0 < thin.o.aero.CD0 && visc.o.aero.drag.some(d => /viscous/.test(d.name)),
    `CD0 ${thin.o.aero.CD0.toFixed(4)} → ${visc.o.aero.CD0.toFixed(4)}`);
  ok('…which raises L/D and endurance downstream', visc.o.performance.LDmax > thin.o.performance.LDmax && visc.o.performance.endurance > thin.o.performance.endurance,
    `L/D ${thin.o.performance.LDmax.toFixed(2)} → ${visc.o.performance.LDmax.toFixed(2)}`);
  ok('changing the root airfoil marks sections and aero stale', visc.gg.invalidate('wing.rootAirfoil').includes('sections') && visc.gg.state.get('aero').state === 'stale');

  // ---------- 3D mesh ----------
  const m = buildMesh(k, thin.o);
  const allFinite = m.faces.every(f => f.p.length >= 3 && f.p.every(q => q.every(Number.isFinite)));
  ok('3D mesh: thousands of faces, all finite', m.faces.length > 1500 && allFinite, `${m.faces.length} faces`);
  ok('3D mesh: spans the wing and reaches from the propeller to the fin', Math.abs(m.bounds.hi[1] - 1.6) < 0.02 && Math.abs(m.bounds.lo[1] + 1.6) < 0.02 && m.bounds.lo[0] < 0 && m.bounds.hi[0] > 1.6,
    `y ${m.bounds.lo[1].toFixed(3)}…${m.bounds.hi[1].toFixed(3)}, x ${m.bounds.lo[0].toFixed(3)}…${m.bounds.hi[0].toFixed(3)}`);
  ok('3D mesh: dihedral lifts the tips above the root', m.anchors.wingLE(1)[2] - m.anchors.wingLE(0)[2] > 1.6 * Math.tan(3 * Math.PI / 180) * 0.99);
  const k2 = clone(k); setPath(k2, 'wing.span', 4);
  ok('3D mesh follows the document (span 4 m)', Math.abs(buildMesh(k2).bounds.hi[1] - 2) < 0.02);
  const strips = thin.o.aero.spanLoad(thin.o.stability.CLtrim);
  ok('3D mesh: lift colouring paints the wing faces only', buildMesh(k, thin.o, { clMap: { strips, clmax: 1.4 } }).faces.every(f => (f.part === 'wing') === !!f.color));
}
