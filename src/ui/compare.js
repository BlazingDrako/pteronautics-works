// The compare page (#/v/<id>/compare): two designs of a vehicle side by side (the current design, its seed, or a
// saved snapshot), with what was changed, what that did to every analysis output, and which requirements moved.
// Snapshots are saved, renamed, deleted and restored here.
import { h, icon, brand, themeButton, fx, fsig, pct, minus, ago, toast } from './dom.js';
import { saveVehicle } from '../model/store.js';
import { seeds } from '../model/seeds.js';
import { clone, VEHICLE_CLASSES } from '../model/vehicle.js';
import { snapshots, saveSnapshot, deleteSnapshot, renameSnapshot, diffDocs, compareOutputs, compareRequirements } from '../model/compare.js';
import { noteEdit } from '../model/history.js';
import { CouplingGraph } from '../engine/graph.js';
import { analysisNodes } from '../analyses/classes.js';
import { metricsFor } from '../analyses/trade.js';
import { readMetric } from '../analyses/requirements.js';
import { vehicleView } from './planform.js';

const LABEL = { met: 'met', marginal: 'marginal', fail: 'failing' };

export function renderCompare(root, doc) {
  const seed = seeds().find(v => v.id === doc.id);
  let pickA = seed ? 'seed' : null, pickB = 'current';
  if (!seed) { const s = snapshots(doc.id)[0]; pickA = s ? s.id : 'current'; }
  const head = h('div', { class: 'pnl pnl-pad cmp-head' }), body = h('div', { class: 'cmp-body' });
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'),
        h('a', { class: 'vtab', href: '#/v/' + doc.id }, h('span', { class: 'dot' }), doc.name),
        h('span', { class: 'vtab on', 'aria-current': 'page' }, icon('grid'), 'Compare')),
      h('span', { class: 'grow' }), themeButton('btn small')),
    h('div', { class: 'page-main' }, head, body)));

  // the designs on offer
  const options = () => [
    { id: 'current', name: 'Current design', sub: `rev ${doc.revision} · edited ${ago(doc.updated)}`, doc },
    ...(seed ? [{ id: 'seed', name: 'Seed design', sub: `as shipped, rev ${seed.revision}`, doc: seed }] : []),
    ...snapshots(doc.id).map(s => ({ id: s.id, name: s.name, sub: `snapshot · ${ago(s.t)}`, doc: s.doc, snap: s })),
  ];
  const find = id => options().find(o => o.id === id) || options()[0];

  function solve(d) {
    try {
      const g = new CouplingGraph(analysisNodes(d)); g.runSync(d);
      const o = {}; for (const id of g.order) o[id] = g.outputs(id);
      return o;
    } catch (e) { return { error: e.message }; }
  }

  function paint() {
    const opts = options(), A = find(pickA), B = find(pickB);
    const sel = (value, set, label) => h('label', { class: 'cmp-pick' }, h('span', { class: 'sec' }, label),
      h('select', { class: 'txt tr-sel', 'aria-label': `Design ${label}`, onchange: e => { set(e.target.value); paint(); } }, opts.map(o => h('option', { value: o.id, selected: o.id === value }, `${o.name} — ${o.sub}`))));
    const snaps = snapshots(doc.id);
    head.replaceChildren(
      h('div', { class: 'cmp-picks' }, sel(pickA, v => (pickA = v), 'A'), h('span', { class: 'cmp-vs' }, 'vs'), sel(pickB, v => (pickB = v), 'B'),
        h('button', { class: 'btn small', type: 'button', title: 'Swap A and B', onclick: () => { [pickA, pickB] = [pickB, pickA]; paint(); } }, '⇄ Swap'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small primary', type: 'button', onclick: snap }, icon('plus'), 'Save a snapshot of the current design')),
      snaps.length ? h('div', { class: 'cmp-snaps' }, h('span', { class: 'sec' }, `Snapshots · ${snaps.length}`), ...snaps.map(s => h('span', { class: 'cmp-snap' },
        h('span', {}, s.name), h('span', { class: 'muted' }, ago(s.t)),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => { const n = prompt('Name of this snapshot:', s.name); if (n && n.trim()) { renameSnapshot(doc.id, s.id, n.trim()); paint(); } } }, 'rename'),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => restore(s) }, 'restore'),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => { if (confirm(`Delete the snapshot "${s.name}"?`)) { deleteSnapshot(doc.id, s.id); if (pickA === s.id) pickA = 'current'; if (pickB === s.id) pickB = 'current'; paint(); } } }, 'delete'))))
        : h('p', { class: 'note', style: { margin: '10px 0 0' } }, 'Save a snapshot before a round of changes, then compare it with where the design ends up. Snapshots are kept in this browser.'));
    paintBody(A, B);
  }

  function paintBody(A, B) {
    if (A.doc.class !== B.doc.class) { body.replaceChildren(h('div', { class: 'placeholder' }, `These designs are of different classes (${VEHICLE_CLASSES[A.doc.class]?.label} and ${VEHICLE_CLASSES[B.doc.class]?.label}).`)); return; }
    const oa = solve(A.doc), ob = solve(B.doc);
    const changes = diffDocs(A.doc, B.doc).filter(r => !/\.(name|description)$/.test(r.path));
    const outs = compareOutputs(oa, ob, metricsFor(B.doc), readMetric).filter(r => isFinite(r.a) || isFinite(r.b));
    const reqs = compareRequirements(oa.requirements?.list || [], ob.requirements?.list || []);
    const better = outs.filter(r => r.verdict === 'better').length, worse = outs.filter(r => r.verdict === 'worse').length;
    const up = reqs.filter(r => r.moved === 'up'), down = reqs.filter(r => r.moved === 'down');

    const view = (o, title, d) => h('div', { class: 'plot-card cmp-view' }, h('h4', {}, title, h('span', { class: 'sub' }, o.mass ? `${fx(o.mass.total, o.mass.total > 100 ? 0 : 2)} kg · ${o.requirements ? `${o.requirements.met}/${o.requirements.total} req` : ''}` : o.error || '')),
      (() => { try { return vehicleView(d, o, { clmap: true, load: false, mac: false, cg: true, items: false }, { w: 520, h: 330 }).svg; } catch { return h('p', { class: 'note' }, 'No top view.'); } })());

    const verdictCls = { better: 'good', worse: 'bad', changed: 'warn', same: 'muted' };
    const fmtV = (v, d) => (typeof v === 'number' ? minus(fsig(v, 5)) : v === undefined ? '—' : String(v));
    body.replaceChildren(
      h('div', { class: 'pnl pnl-pad tr-head' },
        h('h3', {}, changes.length ? `B changes ${changes.length} value${changes.length === 1 ? '' : 's'} from A` : 'A and B are the same design',
          changes.length ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${better} outputs better, ${worse} worse`) : null),
        h('p', { class: 'note' }, up.length || down.length ? [
          up.length ? `Now passing better: ${up.map(r => `${r.id} (${LABEL[r.a.status]} → ${LABEL[r.b.status]})`).join(', ')}. ` : '',
          down.length ? `Now worse: ${down.map(r => `${r.id} (${LABEL[r.a.status]} → ${LABEL[r.b.status]})`).join(', ')}.` : ''].join('') : 'No requirement changes status between them.')),
      h('div', { class: 'cmp-views' }, view(oa, `A · ${A.name}`, A.doc), view(ob, `B · ${B.name}`, B.doc)),
      h('div', { class: 'cmp-grid' },
        h('div', { class: 'pnl' }, h('div', { class: 'sec-row', style: { padding: '14px 16px 0' } }, h('span', { class: 'sec' }, 'What changed'), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${changes.length}`)),
          h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' }, h('thead', {}, h('tr', {}, ['Part', 'Value', 'A', 'B', 'Change'].map(t => h('th', {}, t)))),
            h('tbody', {}, changes.length ? changes.map(r => h('tr', {}, h('td', {}, r.group), h('td', { style: { color: 'var(--text)' } }, r.label),
              h('td', { class: 'num-c' }, fmtV(r.a)), h('td', { class: 'num-c' }, fmtV(r.b) + (r.unit && typeof r.b === 'number' ? ' ' + r.unit : '')),
              h('td', { class: 'num-c' }, r.kind === 'changed' ? (isFinite(r.rel) ? pct(r.rel) : 'changed') : r.kind))) : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Nothing.')))))),
        h('div', { class: 'pnl' }, h('div', { class: 'sec-row', style: { padding: '14px 16px 0' } }, h('span', { class: 'sec' }, 'Requirements'), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${up.length} up · ${down.length} down`)),
          h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' }, h('thead', {}, h('tr', {}, ['ID', 'Requirement', 'A', 'B'].map(t => h('th', {}, t)))),
            h('tbody', {}, reqs.map(r => h('tr', { class: r.moved === 'down' ? 'ms-bad' : '' }, h('td', { class: 'mono' }, r.id), h('td', { style: { color: 'var(--text)', whiteSpace: 'normal' } }, r.title),
              h('td', {}, r.a ? h('span', { class: 'status ' + r.a.status }, LABEL[r.a.status]) : '—'),
              h('td', {}, r.b ? h('span', { class: 'status ' + r.b.status }, LABEL[r.b.status]) : '—', r.moved === 'up' ? h('span', { class: 'good', style: { marginLeft: '6px' } }, '↑') : r.moved === 'down' ? h('span', { class: 'bad', style: { marginLeft: '6px' } }, '↓') : null)))))))),
      h('div', { class: 'pnl' }, h('div', { class: 'sec-row', style: { padding: '14px 16px 0' } }, h('span', { class: 'sec' }, 'Analysis outputs'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'green: better for B, red: worse, amber: changed with no better direction')),
        h('div', { class: 'mx-wrap' }, h('table', { class: 'rq' }, h('thead', {}, h('tr', {}, ['Output', 'A', 'B', 'Change', ''].map(t => h('th', {}, t)))),
          h('tbody', {}, outs.map(r => h('tr', {}, h('td', { style: { color: 'var(--text)' } }, r.label),
            h('td', { class: 'num-c' }, `${minus(fx(r.a, r.d))} ${r.unit}`), h('td', { class: 'num-c' }, `${minus(fx(r.b, r.d))} ${r.unit}`),
            h('td', { class: 'num-c ' + verdictCls[r.verdict] }, r.verdict === 'same' ? '—' : `${r.delta > 0 ? '+' : '−'}${fx(Math.abs(r.delta), r.d)}${isFinite(r.rel) ? ` (${pct(r.rel)})` : ''}`),
            h('td', {}, r.verdict === 'same' ? '' : h('span', { class: verdictCls[r.verdict], style: { fontSize: '12px' } }, r.verdict)))))))));
  }

  function snap() {
    const name = prompt('Name this snapshot (for example "before the battery change"):', `rev ${doc.revision}`);
    if (name === null) return;
    const s = saveSnapshot(doc, name);
    pickA = s.id; pickB = 'current';
    toast(`Saved the snapshot "${s.name}".`); paint();
  }
  function restore(s) {
    if (!confirm(`Replace the current design of ${doc.name} with the snapshot "${s.name}"? Save a snapshot of the current design first if you may want it back.`)) return;
    const keep = { revision: doc.revision, branch: doc.branch };
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, clone(s.doc), { updated: new Date().toISOString() }, keep);
    noteEdit(doc.id, `Restored the snapshot "${s.name}"`);
    saveVehicle(doc); toast(`${doc.name} is now the snapshot "${s.name}".`); paint();
  }

  paint();
  window.__compare = { doc };
}
