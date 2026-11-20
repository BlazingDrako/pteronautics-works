// The coupling engine: a dependency graph of analysis nodes.
//
// A node: {
//   id, label, detail?,
//   reads: ['wing.*', 'mission.cruiseSpeed', '*.mass'],   // document paths it reads (glob: * matches one segment)
//   after: ['geometry', 'atmosphere'],                     // nodes whose outputs it takes
//   outputs: ['CLa', 'e', ...],                            // the names it promises (checked after each run)
//   fidelity?: { levels: [{ id, label, note? }], value },  // optional selectable model level
//   run({ doc, inputs, fidelity }) → outputs object         // inputs[afterId] = that node's outputs
// }                                                          // (or a promise of one: run() awaits it)
//
// Each node has a state: 'stale' (needs a run), 'running', 'current', or 'failed' (its run threw, or a node it
// depends on failed). Editing a document path marks every node that reads it stale, and everything downstream.
// run() recomputes the stale nodes in dependency order, yielding between nodes so a UI can paint; an edit during
// a run makes the run start over from the new state.

export function globMatch(pattern, path) {
  const p = pattern.split('.'), s = path.split('.');
  if (p.length !== s.length) return false;
  return p.every((seg, i) => seg === '*' || seg === s[i]);
}

export class CouplingGraph {
  constructor(nodes) {
    this.nodes = new Map();
    for (const nd of nodes) {
      if (this.nodes.has(nd.id)) throw new Error(`Duplicate node "${nd.id}"`);
      this.nodes.set(nd.id, { reads: [], after: [], outputs: [], ...nd, fidelity: nd.fidelity ? { ...nd.fidelity } : null });
    }
    for (const nd of this.nodes.values())
      for (const a of nd.after) if (!this.nodes.has(a)) throw new Error(`Node "${nd.id}" depends on unknown node "${a}"`);
    this.order = topoSort([...this.nodes.values()]);
    this.state = new Map(this.order.map(id => [id, { state: 'stale', ms: null, error: null, outputs: null, runs: 0 }]));
    this.generation = 0;
    this.listeners = new Set();
  }

  // ids of nodes downstream of `id` (not including it)
  downstream(id) {
    const out = new Set(), stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const nd of this.nodes.values()) if (nd.after.includes(cur) && !out.has(nd.id)) { out.add(nd.id); stack.push(nd.id); }
    }
    return out;
  }

  // nodes that read a document path
  readers(path) { return [...this.nodes.values()].filter(nd => nd.reads.some(p => globMatch(p, path))).map(nd => nd.id); }

  markStale(ids) {
    const all = new Set();
    for (const id of ids) { all.add(id); for (const d of this.downstream(id)) all.add(d); }
    for (const id of all) { const s = this.state.get(id); s.state = 'stale'; }
    if (all.size) { this.generation++; this.emit(); }
    return [...all];
  }

  // A document edit: returns the ids now stale
  invalidate(paths) { return this.markStale([].concat(paths).flatMap(p => this.readers(p))); }
  invalidateAll() { return this.markStale(this.order); }

  setFidelity(id, value) {
    const nd = this.nodes.get(id);
    if (!nd || !nd.fidelity) throw new Error(`Node "${id}" has no fidelity levels`);
    if (!nd.fidelity.levels.some(l => l.id === value)) throw new Error(`Unknown fidelity "${value}" for "${id}"`);
    nd.fidelity.value = value;
    return this.markStale([id]);
  }

  outputs(id) { return this.state.get(id)?.outputs ?? null; }
  get busy() { return this.running === true; }
  isCurrent() { return [...this.state.values()].every(s => s.state === 'current'); }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev = {}) { for (const fn of this.listeners) fn(ev, this); }

  // Recompute stale nodes. options.yield: an async function awaited between nodes (default: a macrotask), so the
  // UI can show 'running'. Returns { ran: [ids], ms } of the completed pass.
  async run(doc, { yield: yieldFn = defaultYield, clock = now } = {}) {
    if (this.running) { this.again = doc; return this.pending; }
    this.running = true;
    this.pending = (async () => {
      let result;
      try {
        for (;;) {
          this.again = null;
          const gen = this.generation;
          result = await this._pass(doc, gen, yieldFn, clock);
          if (this.again) { doc = this.again; continue; }
          if (result.restart) continue;
          break;
        }
      } finally { this.running = false; }
      this.emit({ done: true, result });
      return result;
    })();
    return this.pending;
  }

  // synchronous variant (tests, batch use). A node whose run returns a promise is marked failed here.
  runSync(doc, { clock = now } = {}) {
    const ran = [], t0 = clock();
    for (const id of this.order) {
      const s = this.state.get(id);
      if (s.state === 'current') continue;
      const p = this._runNode(doc, id, clock, true); ran.push(id);
      if (p) p.catch(() => {});
    }
    return { ran, ms: clock() - t0 };
  }

  async _pass(doc, gen, yieldFn, clock) {
    const ran = [], t0 = clock();
    for (const id of this.order) {
      const s = this.state.get(id);
      if (s.state === 'current') continue;
      s.state = 'running'; this.emit({ node: id });
      await yieldFn();
      if (this.generation !== gen) { return { ran, ms: clock() - t0, restart: true }; }
      await this._runNode(doc, id, clock); ran.push(id);
      this.emit({ node: id });
      if (this.generation !== gen) { return { ran, ms: clock() - t0, restart: true }; }
    }
    return { ran, ms: clock() - t0 };
  }

  // Runs one node. Returns a promise when the node's run is asynchronous (and sync is false), else nothing.
  // An async result is kept only if nothing marked the node stale while it ran.
  _runNode(doc, id, clock, sync = false) {
    const nd = this.nodes.get(id), s = this.state.get(id);
    const failedDep = nd.after.find(a => this.state.get(a).state === 'failed');
    if (failedDep) { Object.assign(s, { state: 'failed', error: `needs "${failedDep}", which failed`, outputs: null, ms: 0 }); return; }
    const inputs = {}; for (const a of nd.after) inputs[a] = this.state.get(a).outputs;
    const t = clock();
    s.state = 'running';
    const done = out => {
      if (!out || typeof out !== 'object') throw new Error('returned no outputs');
      const missing = nd.outputs.filter(k => !(k in out));
      if (missing.length) throw new Error('missing outputs: ' + missing.join(', '));
      Object.assign(s, { state: 'current', error: null, outputs: out, ms: clock() - t, runs: s.runs + 1 });
    };
    const fail = e => Object.assign(s, { state: 'failed', error: e && e.message ? e.message : String(e), outputs: null, ms: clock() - t, runs: s.runs + 1 });
    let out;
    try { out = nd.run({ doc, inputs, fidelity: nd.fidelity ? nd.fidelity.value : null }); } catch (e) { fail(e); return; }
    if (out && typeof out.then === 'function') {
      if (sync) { fail(new Error('asynchronous node: use run(), not runSync()')); return out; }
      return out.then(o => { if (s.state !== 'running') return; try { done(o); } catch (e) { fail(e); } },
        e => { if (s.state === 'running') fail(e); });
    }
    try { done(out); } catch (e) { fail(e); }
  }

  // levels for drawing: each node one below its deepest dependency
  levels() {
    const lv = new Map();
    for (const id of this.order) { const nd = this.nodes.get(id); lv.set(id, nd.after.length ? Math.max(...nd.after.map(a => lv.get(a))) + 1 : 0); }
    return lv;
  }
}

function topoSort(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n])), mark = new Map(), out = [];
  const visit = (id, path) => {
    const m = mark.get(id);
    if (m === 'done') return;
    if (m === 'active') throw new Error('Dependency cycle: ' + [...path, id].join(' → '));
    mark.set(id, 'active');
    for (const a of byId.get(id).after) visit(a, [...path, id]);
    mark.set(id, 'done'); out.push(id);
  };
  for (const n of nodes) visit(n.id, []);
  return out;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const defaultYield = () => new Promise(r => setTimeout(r, 0));
