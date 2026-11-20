// The requirements page (#/v/<id>/requirements): every requirement of the vehicle with its live value, margin and
// status, editable in place (title, group, metric, at least / at most, target); new ones on any analysis output,
// including the mission's; and the history of which design change made each one pass or fail.
import { h, icon, brand, themeButton, fsig, pct, ago, toast } from './dom.js';
import { saveVehicle } from '../model/store.js';
import { CouplingGraph } from '../engine/graph.js';
import { metricsFor, metricInfo } from '../analyses/trade.js';
import { nextRequirementId } from '../analyses/requirements.js';
import { noteEdit, recordStatuses, history, clearHistory } from '../model/history.js';
import { graphSummary } from './graphView.js';
import { analysisNodes } from '../analyses/classes.js';

const LABEL = { met: 'met', marginal: 'marginal', fail: 'failing' };

export function renderRequirements(root, doc) {
  doc.requirements = doc.requirements || [];
  const graph = new CouplingGraph(analysisNodes(doc));
  let saveTimer = 0, filter = 'all';
  const status = h('span', { class: 'pill' });
  const head = h('div', { class: 'pnl pnl-pad tr-head' });
  const tableBox = h('div', { class: 'pnl rq-page' });
  const hist = h('div', { class: 'pnl pnl-pad' });
  root.replaceChildren(h('div', { class: 'ws' },
    h('header', { class: 'topbar' },
      brand({ compact: true }), h('span', { class: 'vsep' }),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'),
        h('a', { class: 'vtab', href: '#/v/' + doc.id }, h('span', { class: 'dot' }), doc.name),
        h('span', { class: 'vtab on', 'aria-current': 'page' }, icon('list'), 'Requirements')),
      h('span', { class: 'grow' }), status, themeButton('btn small')),
    h('div', { class: 'page-main' }, head, tableBox, hist)));

  graph.on(ev => {
    const sm = graphSummary(graph); status.className = 'pill ' + sm.cls; status.textContent = 'Analyses ' + sm.text;
    if (ev.done) { const rq = graph.outputs('requirements'); if (rq) recordStatuses(doc.id, rq.list); paintAll(); }
  });

  function commit(cause, id) {
    doc.updated = new Date().toISOString();
    noteEdit(doc.id, cause);
    graph.invalidate('requirements.' + (id || '_'));
    graph.run(doc);
    clearTimeout(saveTimer); saveTimer = setTimeout(() => saveVehicle(doc), 200);
  }

  function paintAll() { paintHead(); paintTable(); paintHistory(); }
  function paintHead() {
    const rq = graph.outputs('requirements');
    const groups = [...new Set(doc.requirements.map(r => r.group || 'Other'))];
    const chip = (id, label, n) => h('button', { class: 'chip' + (filter === id ? ' on' : ''), type: 'button', 'aria-pressed': filter === id ? 'true' : 'false', onclick: () => { filter = id; paintTable(); paintHead(); } }, label, h('span', { class: 'count' }, n));
    const count = st => (rq ? rq.list.filter(r => r.status === st).length : 0);
    head.replaceChildren(
      h('h3', {}, rq ? `${rq.met} of ${rq.total} requirements met` : 'Evaluating…', rq && rq.failing ? h('span', { class: 'bad' }, ` · ${rq.failing} failing`) : null, rq && rq.marginal ? h('span', { class: 'warn' }, ` · ${rq.marginal} marginal`) : null),
      h('p', { class: 'note' }, 'Each requirement is a target on one analysis output. Margin is how far the value is on the good side of the target, as a fraction of it; under 5% is marginal. Edits here are saved with the vehicle.'),
      h('div', { class: 'row', role: 'group', 'aria-label': 'Filter', style: { gap: '6px', marginTop: '10px' } },
        chip('all', 'All', doc.requirements.length), chip('fail', 'Failing', count('fail')), chip('marginal', 'Marginal', count('marginal')),
        ...groups.map(g => chip('g:' + g, g, doc.requirements.filter(r => (r.group || 'Other') === g).length))));
  }

  function paintTable() {
    const rq = graph.outputs('requirements'), metrics = metricsFor(doc);
    const evals = new Map((rq ? rq.list : []).map(r => [r.id, r]));
    const shown = doc.requirements.filter(r => filter === 'all' || (filter.startsWith('g:') ? (r.group || 'Other') === filter.slice(2) : evals.get(r.id)?.status === filter));
    const row = r => {
      const e = evals.get(r.id);
      const txt = (key, w, ph) => { const inp = h('input', { class: 'txt rq-txt', type: 'text', value: r[key] || '', placeholder: ph, style: { width: w }, 'aria-label': `${key} of ${r.id}` }); inp.addEventListener('change', () => { r[key] = inp.value.trim(); commit(`${r.id} ${key} → ${r[key]}`, r.id); }); return inp; };
      const metric = h('select', { class: 'txt rq-metric', 'aria-label': `Metric of ${r.id}` }, metrics.map(m => h('option', { value: m.metric, selected: m.metric === r.metric }, m.label)));
      metric.addEventListener('change', () => { r.metric = metric.value; r.unit = metricInfo(doc, r.metric).unit; commit(`${r.id} now reads ${metricInfo(doc, r.metric).label}`, r.id); paintTable(); });
      const op = h('select', { class: 'txt rq-op', 'aria-label': `Direction of ${r.id}` }, [['>=', '≥ at least'], ['<=', '≤ at most']].map(([v, t]) => h('option', { value: v, selected: v === r.op }, t)));
      op.addEventListener('change', () => { r.op = op.value; commit(`${r.id} is now ${r.op === '>=' ? 'at least' : 'at most'} ${r.target}`, r.id); });
      const tgt = h('input', { class: 'num', type: 'number', step: 'any', value: r.target, 'aria-label': `Target of ${r.id}` });
      tgt.addEventListener('change', () => { const v = +tgt.value; if (tgt.value === '' || !isFinite(v)) { tgt.classList.add('invalid'); return; } tgt.classList.remove('invalid'); r.target = v; commit(`${r.id} target → ${v} ${r.unit || ''}`.trim(), r.id); });
      const del = h('button', { class: 'ms-btn', type: 'button', title: `Delete ${r.id}`, 'aria-label': `Delete ${r.id}`, onclick: () => {
        if (!confirm(`Delete ${r.id} "${r.title}"?`)) return;
        doc.requirements = doc.requirements.filter(x => x !== r); commit(`${r.id} deleted`); paintTable();
      } }, '×');
      return h('tr', {},
        h('td', { class: 'mono' }, r.id), h('td', {}, txt('title', '100%', 'What it asks for')), h('td', {}, txt('group', '96px', 'Group')),
        h('td', {}, metric), h('td', {}, op),
        h('td', {}, h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, tgt, h('span', { class: 'unit' }, r.unit || ''))),
        h('td', { class: 'num-c' }, e ? fsig(e.value, 4) : '—'), h('td', { class: 'num-c' }, e ? pct(e.margin) : '—'),
        h('td', {}, e ? h('span', { class: 'status ' + e.status }, LABEL[e.status]) : ''), h('td', {}, del));
    };
    tableBox.replaceChildren(
      h('div', { class: 'mx-wrap' }, h('table', { class: 'rq rq-edit' },
        h('thead', {}, h('tr', {}, ['ID', 'Requirement', 'Group', 'Metric', 'Direction', 'Target', 'Value', 'Margin', 'Status', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, shown.length ? shown.map(row) : h('tr', {}, h('td', { colspan: 10, class: 'muted' }, 'No requirements match this filter.'))))),
      h('div', { class: 'rq-add' }, h('button', { class: 'btn small primary', type: 'button', onclick: add }, icon('plus'), 'Add a requirement')));
  }
  function add() {
    const id = nextRequirementId(doc.requirements), m = metricsFor(doc)[0];
    const r = { id, title: 'New requirement', metric: m.metric, op: m.better < 0 ? '<=' : '>=', target: 0, unit: m.unit, group: 'Other' };
    // start the target 10% on the safe side of the current value, so a new requirement begins as met
    const o = {}; for (const k of graph.order) o[k] = graph.outputs(k);
    const parts = r.metric.split('.'); let v = o[parts[0]]; for (const k of parts.slice(1)) v = v?.[k];
    if (typeof v === 'number' && isFinite(v)) r.target = +(v + (r.op === '>=' ? -1 : 1) * 0.1 * Math.abs(v)).toPrecision(3);
    doc.requirements.push(r); filter = 'all';
    commit(`${id} added`, id); paintTable();
    toast(`Added ${id}. Pick its metric and target.`);
  }

  function paintHistory() {
    const log = history(doc.id);
    hist.replaceChildren(
      h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'History'), log.length ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { clearHistory(doc.id); paintHistory(); } }, 'Clear') : null),
      log.length ? h('ol', { class: 'rq-log' }, log.map(e => h('li', {},
        h('span', { class: 'status ' + e.to }, LABEL[e.to]), ' ', h('b', { class: 'mono' }, e.id), ` ${e.title || ''} went from ${LABEL[e.from]} to ${LABEL[e.to]}`,
        isFinite(e.value) ? ` (${fsig(e.value, 4)}${e.unit ? ' ' + e.unit : ''})` : '', h('div', { class: 'note' }, `after: ${e.cause} · ${ago(e.t)}`))))
        : h('p', { class: 'note' }, 'No changes yet. When an edit here, in the workspace, the mission planner or a trade study makes a requirement pass or fail, it is listed here with the change that did it.'));
  }

  paintAll();
  graph.run(doc);
  window.__reqs = { doc, graph };
}
