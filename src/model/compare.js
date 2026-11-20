// Snapshots and design comparison.
//
// A snapshot is a named, frozen copy of a vehicle document, kept per vehicle in this browser (localStorage). Two
// designs (the current one, the seed, or any snapshot) are compared by what was changed in them (diffDocs) and by
// what that did to the analyses and requirements (compareOutputs).
import { COMPONENT_TYPES, clone } from './vehicle.js';
import { SEGMENT_KINDS } from './segments.js';

const KEY = 'works-snapshots:', LIMIT = 40;
const ls = () => { try { return window.localStorage; } catch { return null; } };

export function snapshots(docId) {
  try { const v = JSON.parse(ls()?.getItem(KEY + docId) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(docId, list) { try { ls()?.setItem(KEY + docId, JSON.stringify(list.slice(0, LIMIT))); return true; } catch { return false; } }

export function saveSnapshot(doc, name) {
  const list = snapshots(doc.id);
  const snap = { id: 'snap-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: (name || '').trim() || `rev ${doc.revision} · ${new Date().toLocaleString()}`, t: new Date().toISOString(), doc: clone(doc) };
  write(doc.id, [snap, ...list]);
  return snap;
}
export function deleteSnapshot(docId, snapId) { write(docId, snapshots(docId).filter(s => s.id !== snapId)); }
export function renameSnapshot(docId, snapId, name) { write(docId, snapshots(docId).map(s => (s.id === snapId ? { ...s, name } : s))); }

// Every value a designer sets, flattened: { path → { label, group, value, unit } }
export function flatten(doc) {
  const out = new Map();
  for (const c of doc.components || []) {
    const T = COMPONENT_TYPES[c.type]; if (!T) continue;
    for (const p of T.params) out.set(`${c.id}.${p.key}`, { label: p.label, group: c.name, value: c[p.key], unit: p.unit || '' });
  }
  for (const [k, v] of Object.entries(doc.mission || {})) if (k !== 'segments' && (typeof v === 'number' || typeof v === 'string')) out.set(`mission.${k}`, { label: k, group: 'Mission', value: v, unit: '' });
  for (const sg of doc.mission?.segments || []) {
    const K = SEGMENT_KINDS[sg.kind]; if (!K) continue;
    out.set(`mission.segments.${sg.id}.kind`, { label: 'Kind', group: `Mission · ${sg.name || K.label}`, value: K.label, unit: '' });
    for (const p of K.params) out.set(`mission.segments.${sg.id}.${p.key}`, { label: p.label, group: `Mission · ${sg.name || K.label}`, value: sg[p.key], unit: p.unit });
  }
  for (const r of doc.requirements || []) out.set(`requirements.${r.id}`, { label: r.title, group: 'Requirements', value: `${r.op === '>=' ? '≥' : '≤'} ${r.target} ${r.unit || ''}`.trim(), unit: '' });
  return out;
}

// What differs between two documents: [{ path, label, group, a, b, unit, kind: 'changed' | 'added' | 'removed', rel }]
export function diffDocs(a, b) {
  const fa = flatten(a), fb = flatten(b), rows = [];
  for (const [path, x] of fa) {
    const y = fb.get(path);
    if (!y) { rows.push({ path, ...x, a: x.value, b: undefined, kind: 'removed' }); continue; }
    if (!same(x.value, y.value)) rows.push({ path, label: y.label, group: y.group, unit: y.unit, a: x.value, b: y.value, kind: 'changed', rel: typeof x.value === 'number' && typeof y.value === 'number' && x.value !== 0 ? (y.value - x.value) / Math.abs(x.value) : NaN });
  }
  for (const [path, y] of fb) if (!fa.has(path)) rows.push({ path, ...y, a: undefined, b: y.value, kind: 'added' });
  return rows;
}
const same = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y)) : x === y);

// Analysis outputs side by side. metrics: [{ metric, label, unit, d, better }]; oa, ob: { nodeId: outputs }.
// Each row: { metric, label, a, b, delta, rel, verdict: 'better' | 'worse' | 'same' | 'changed' }
export function compareOutputs(oa, ob, metrics, read) {
  return metrics.map(m => {
    const a = read(oa, m.metric), b = read(ob, m.metric), delta = b - a, rel = isFinite(a) && a !== 0 ? delta / Math.abs(a) : NaN;
    // a change too small to show at the metric's display precision counts as the same
    const shown = typeof m.d === 'number' ? 0.5 * 10 ** -m.d : 0;
    const tiny = !isFinite(delta) || Math.abs(delta) <= Math.max(1e-9 * Math.max(1, Math.abs(a)), shown);
    const verdict = !isFinite(a) || !isFinite(b) ? (isFinite(a) === isFinite(b) ? 'same' : 'changed') : tiny ? 'same' : m.better ? (Math.sign(delta) === m.better ? 'better' : 'worse') : 'changed';
    return { ...m, a, b, delta, rel, verdict };
  });
}

// Requirement statuses side by side, with the ones that moved: [{ id, title, a, b, moved }]
export function compareRequirements(la, lb) {
  const ids = [...new Set([...la.map(r => r.id), ...lb.map(r => r.id)])];
  const rank = { met: 2, marginal: 1, fail: 0 };
  return ids.map(id => {
    const x = la.find(r => r.id === id), y = lb.find(r => r.id === id);
    const moved = x && y ? (rank[y.status] > rank[x.status] ? 'up' : rank[y.status] < rank[x.status] ? 'down' : null) : x ? 'removed' : 'added';
    return { id, title: (y || x).title, a: x, b: y, moved };
  });
}
