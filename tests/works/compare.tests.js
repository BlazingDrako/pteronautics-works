// Comparing designs: snapshots, what changed, and what it did.
import { CouplingGraph } from '../../src/engine/graph.js';
import { analysisNodes } from '../../src/analyses/classes.js';
import { metricsFor } from '../../src/analyses/trade.js';
import { readMetric } from '../../src/analyses/requirements.js';
import { kestrel } from '../../src/model/seeds.js';
import { clone, applyEdit } from '../../src/model/vehicle.js';
import { snapshots, saveSnapshot, deleteSnapshot, renameSnapshot, diffDocs, compareOutputs, compareRequirements, flatten } from '../../src/model/compare.js';

const solve = d => { const g = new CouplingGraph(analysisNodes(d)); g.runSync(d); const o = {}; for (const id of g.order) o[id] = g.outputs(id); return o; };

export function compareTests(log) {
  const ok = (name, cond, detail = '') => log('compare: ' + name, !!cond, detail);
  const a = kestrel(), b = clone(a);
  ok('a design compared with itself has no changes', diffDocs(a, b).length === 0);
  applyEdit(b, 'battery.energy', 1000);      // linked: the mass moves too
  b.mission.segments[2].time = 40;
  b.requirements[0].target = 95;
  const d = diffDocs(a, b), paths = d.map(r => r.path);
  ok('the diff lists the edit, the linked mass, the segment and the requirement', ['battery.energy', 'battery.mass', 'mission.segments.s3.time', 'requirements.R-01'].every(p => paths.includes(p)) && d.length === 4, paths.join(', '));
  const en = d.find(r => r.path === 'battery.energy');
  ok('a numeric change carries its relative size', Math.abs(en.rel - (1000 - 888) / 888) < 1e-12 && en.a === 888 && en.b === 1000);
  const c = clone(a); c.components = c.components.filter(x => x.type !== 'avionics'); c.components.push({ ...clone(a.components.find(x => x.type === 'systems')), id: 'extra', name: 'Extra' });
  const dc = diffDocs(a, c);
  ok('removed and added parts are marked', dc.some(r => r.kind === 'removed' && r.path.startsWith('avionics.')) && dc.some(r => r.kind === 'added' && r.path.startsWith('extra.')));
  ok('every numeric part parameter is in the flattened design', flatten(a).has('wing.span') && flatten(a).get('wing.span').value === 3.2);

  const oa = solve(a), ob = solve(b), rows = compareOutputs(oa, ob, metricsFor(a), readMetric);
  const end = rows.find(r => r.metric === 'performance.endurance'), m = rows.find(r => r.metric === 'mass.total'), span = rows.find(r => r.metric === 'geometry.span');
  ok('more battery: endurance better, mass worse, span the same', end.verdict === 'better' && m.verdict === 'worse' && span.verdict === 'same', `${end.verdict}, ${m.verdict}, ${span.verdict}`);
  ok('the change is B − A', Math.abs(end.delta - (ob.performance.endurance - oa.performance.endurance)) < 1e-12);
  ok('a change smaller than the display precision is the same', compareOutputs({ x: { v: 83.0 } }, { x: { v: 83.004 } }, [{ metric: 'x.v', d: 0, better: 1 }], (o, k) => o.x.v)[0].verdict === 'same');
  const rq = compareRequirements(oa.requirements.list, ob.requirements.list);
  ok('requirement moves are found (a shorter survey and a bigger pack leave more mission margin)', rq.find(r => r.id === 'R-11').b.value > rq.find(r => r.id === 'R-11').a.value && rq.every(r => r.moved === null || ['up', 'down'].includes(r.moved)));
  ok('a requirement only in one design is added or removed', compareRequirements([{ id: 'X', status: 'met' }], []).at(0).moved === 'removed' && compareRequirements([], [{ id: 'Y', status: 'met' }]).at(0).moved === 'added');

  // snapshots
  const id = '__snap-test';
  for (const s of snapshots(id)) deleteSnapshot(id, s.id);
  const t = { ...clone(a), id };
  const s1 = saveSnapshot(t, 'before'); applyEdit(t, 'wing.span', 3.4); const s2 = saveSnapshot(t, '');
  ok('snapshots are kept newest first, a blank name gets one', snapshots(id).length === 2 && snapshots(id)[0].id === s2.id && /rev/.test(s2.name));
  ok('a snapshot is a frozen copy', snapshots(id).find(s => s.id === s1.id).doc.components.find(x => x.type === 'wing').span === 3.2);
  renameSnapshot(id, s1.id, 'baseline');
  ok('snapshots can be renamed and deleted', snapshots(id).find(s => s.id === s1.id).name === 'baseline' && (deleteSnapshot(id, s1.id), snapshots(id).length === 1));
  deleteSnapshot(id, s2.id);
}
