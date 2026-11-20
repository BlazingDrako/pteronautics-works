// The coupling engine: ordering, staleness, failures, fidelity and asynchronous runs with restarts.
import { CouplingGraph, globMatch } from '../../src/engine/graph.js';

// a toy chain:  a (reads x.*) → b (reads y.v) → c ;  d (reads z.v) independent
function toy(calls, opts = {}) {
  const n = (id, o) => ({ id, label: id, ...o, run: (ctx) => { calls.push(id); return o.run(ctx); } });
  return new CouplingGraph([
    n('c', { after: ['b'], outputs: ['v'], run: ({ inputs }) => ({ v: inputs.b.v * 10 }) }),
    n('a', { reads: ['x.*'], outputs: ['v'], run: ({ doc }) => { if (doc.x.fail) throw new Error('boom'); return { v: doc.x.p + doc.x.q }; } }),
    n('b', { reads: ['y.v'], after: ['a'], outputs: ['v'], fidelity: { levels: [{ id: 'lo' }, { id: 'hi' }], value: 'lo' }, run: ({ doc, inputs, fidelity }) => ({ v: inputs.a.v + doc.y.v + (fidelity === 'hi' ? 0.5 : 0) }) }),
    n('d', { reads: ['z.v'], outputs: ['v'], run: ({ doc }) => ({ v: -doc.z.v }) }),
    ...(opts.extra || []),
  ]);
}

export async function engineTests(log) {
  const ok = (name, cond, detail = '') => log('engine: ' + name, !!cond, detail);
  const throws = (name, fn, re) => { try { fn(); ok(name, false, 'did not throw'); } catch (e) { ok(name, !re || re.test(e.message), e.message); } };

  ok('glob: * matches one segment', globMatch('wing.*', 'wing.span') && globMatch('*.mass', 'battery.mass') && !globMatch('wing.*', 'htail.area') && !globMatch('*.mass', 'wing.span.x'));
  ok('glob: exact paths match only themselves', globMatch('mission.altitude', 'mission.altitude') && !globMatch('mission.altitude', 'mission.dT'));

  let calls = [];
  const g = toy(calls), doc = { x: { p: 1, q: 2 }, y: { v: 3 }, z: { v: 4 } };
  ok('dependencies come before dependants in the order', g.order.indexOf('a') < g.order.indexOf('b') && g.order.indexOf('b') < g.order.indexOf('c'), g.order.join(' → '));
  ok('every node starts stale', [...g.state.values()].every(s => s.state === 'stale'));
  g.runSync(doc);
  ok('a run makes every node current with its outputs', g.isCurrent() && g.outputs('c').v === 60 && g.outputs('d').v === -4, JSON.stringify(g.outputs('c')));
  ok('each node records how long it took', [...g.state.values()].every(s => typeof s.ms === 'number' && s.ms >= 0));
  ok('levels follow the dependency depth', g.levels().get('a') === 0 && g.levels().get('b') === 1 && g.levels().get('c') === 2 && g.levels().get('d') === 0);

  calls.length = 0;
  const st = g.invalidate('y.v');
  ok('editing a path marks its readers and everything downstream stale', st.sort().join() === 'b,c' && g.state.get('a').state === 'current' && g.state.get('d').state === 'current', st.join());
  doc.y.v = 5; g.runSync(doc);
  ok('the rerun recomputes only the stale nodes', calls.join() === 'b,c' && g.outputs('c').v === 80, calls.join());
  ok('a path nobody reads changes nothing', g.invalidate('q.v').length === 0 && g.isCurrent());
  calls.length = 0; g.invalidate(['x.p', 'z.v']); g.runSync(doc);
  ok('several paths at once: the union is recomputed, once each', calls.sort().join() === 'a,b,c,d', calls.join());

  // fidelity
  calls.length = 0; const fs = g.setFidelity('b', 'hi'); g.runSync(doc);
  ok('changing a fidelity level marks the node and its dependants stale', fs.sort().join() === 'b,c' && calls.join() === 'b,c' && g.outputs('c').v === 85);
  throws('an unknown fidelity level is refused', () => g.setFidelity('b', 'ultra'), /Unknown fidelity/);
  throws('a node without levels refuses a fidelity', () => g.setFidelity('a', 'lo'), /no fidelity/);

  // failures
  doc.x.fail = true; g.invalidate('x.p'); g.runSync(doc);
  ok('a node that throws is failed, with its message', g.state.get('a').state === 'failed' && g.state.get('a').error === 'boom', g.state.get('a').error);
  ok('nodes downstream of a failure fail too and say why', g.state.get('b').state === 'failed' && /needs "a"/.test(g.state.get('b').error) && g.state.get('c').state === 'failed' && g.outputs('c') === null);
  ok('an unrelated node stays current', g.state.get('d').state === 'current');
  doc.x.fail = false; g.invalidate('x.p'); g.runSync(doc);
  ok('fixing the input recovers the whole chain', g.isCurrent() && g.outputs('c').v === 85);
  const gm = new CouplingGraph([{ id: 'm', outputs: ['a', 'b'], run: () => ({ a: 1 }) }]); gm.runSync({});
  ok('a node that leaves out a promised output is failed', gm.state.get('m').state === 'failed' && /missing outputs: b/.test(gm.state.get('m').error));

  // structure errors
  throws('a dependency cycle is refused', () => new CouplingGraph([{ id: 'p', after: ['q'], run: () => ({}) }, { id: 'q', after: ['p'], run: () => ({}) }]), /cycle/);
  throws('an unknown dependency is refused', () => new CouplingGraph([{ id: 'p', after: ['nope'], run: () => ({}) }]), /unknown node/);
  throws('duplicate node ids are refused', () => new CouplingGraph([{ id: 'p', run: () => ({}) }, { id: 'p', run: () => ({}) }]), /Duplicate/);

  // asynchronous run: states pass through 'running', and an edit mid-run restarts with the new values
  calls = [];
  const ga = toy(calls), da = { x: { p: 1, q: 2 }, y: { v: 3 }, z: { v: 4 } };
  const seen = new Set();
  ga.on(() => { for (const [id, s] of ga.state) if (s.state === 'running') seen.add(id); });
  let step = 0;
  const yieldFn = async () => {
    step++;
    if (step === 2) { da.x.p = 100; ga.invalidate('x.p'); }   // edit while the first nodes are running
    await null;
  };
  const res = await ga.run(da, { yield: yieldFn });
  ok('an async run shows each node as running before it completes', ['a', 'b', 'c', 'd'].every(id => seen.has(id)), [...seen].join());
  ok('an edit during a run restarts it and the result uses the new value', ga.isCurrent() && ga.outputs('c').v === 1050, `c = ${ga.outputs('c')?.v}`);
  ok('the run reports what it recomputed', Array.isArray(res.ran) && res.ran.includes('c'), JSON.stringify(res.ran));
  let done = 0; ga.on(ev => { if (ev.done) done++; });
  ga.invalidate('z.v'); await ga.run(da);
  ok('listeners hear when a run is done', done === 1);
}
