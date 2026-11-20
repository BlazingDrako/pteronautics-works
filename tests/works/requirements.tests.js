// Requirements: new ids, editing, and the history of which change made one pass or fail.
import { CouplingGraph } from '../../src/engine/graph.js';
import { fixedWingNodes } from '../../src/analyses/fixedWing.js';
import { nextRequirementId, evaluate } from '../../src/analyses/requirements.js';
import { kestrel } from '../../src/model/seeds.js';
import { clone, applyEdit, fromJSON, toJSON } from '../../src/model/vehicle.js';
import { noteEdit, recordStatuses, history, clearHistory, describeEdit } from '../../src/model/history.js';

export function requirementsTests(log) {
  const ok = (name, cond, detail = '') => log('requirements: ' + name, !!cond, detail);
  ok('the next id follows the highest', nextRequirementId([{ id: 'R-01' }, { id: 'R-07' }, { id: 'X' }]) === 'R-08' && nextRequirementId([]) === 'R-01');
  ok('at least: 10% over the target is met, 2% over is marginal, under is failing',
    evaluate({ op: '>=', target: 100 }, 110).status === 'met' && evaluate({ op: '>=', target: 100 }, 102).status === 'marginal' && evaluate({ op: '>=', target: 100 }, 99).status === 'fail');
  ok('at most mirrors it', evaluate({ op: '<=', target: 100 }, 90).status === 'met' && evaluate({ op: '<=', target: 100 }, 101).status === 'fail');

  const doc = kestrel(), g = new CouplingGraph(fixedWingNodes());
  g.runSync(doc);
  doc.requirements.push({ id: 'R-12', title: 'Cruise power', metric: 'performance.cruise.P', op: '<=', target: 500, unit: 'W', group: 'Power' });
  g.invalidate('requirements.R-12'); g.runSync(doc);
  const r12 = g.outputs('requirements').list.find(r => r.id === 'R-12');
  ok('a new requirement on any output is evaluated', r12 && isFinite(r12.value) && r12.status === 'met', r12 && `${r12.value.toFixed(0)} W`);
  ok('a document with an added requirement round-trips', fromJSON(toJSON(doc)).requirements.length === doc.requirements.length);

  // history
  const id = '__hist-test';
  clearHistory(id);
  ok('describeEdit names the part, the parameter and the unit', describeEdit(doc, 'battery.energy', 1000) === 'Battery 6S · Energy → 1000 Wh', describeEdit(doc, 'battery.energy', 1000));
  ok('the first record only takes a snapshot', recordStatuses(id, g.outputs('requirements').list).length === 0 && history(id).length === 0);
  const d2 = clone(doc); noteEdit(id, describeEdit(d2, 'payload.mass', 7)); applyEdit(d2, 'payload.mass', 7);
  const g2 = new CouplingGraph(fixedWingNodes()); g2.runSync(d2);
  const added = recordStatuses(id, g2.outputs('requirements').list);
  ok('a change that flips a status is logged with its cause', added.length > 0 && added.every(e => e.cause === 'Survey camera & LiDAR · Mass → 7 kg') && history(id).length === added.length, added.map(e => `${e.id} ${e.from}→${e.to}`).join(', '));
  ok('recording the same statuses again adds nothing', recordStatuses(id, g2.outputs('requirements').list).length === 0);
  clearHistory(id);
  ok('the history can be cleared', history(id).length === 0);
}
