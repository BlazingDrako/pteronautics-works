// Requirement history: which design change made a requirement pass or fail.
//
// Each page that edits a vehicle notes what it changed (noteEdit), and after each analysis run it hands over the
// requirements' statuses (recordStatuses). A status that differs from the last one recorded is logged with the
// change that caused it. Kept per vehicle in this browser (localStorage), newest first, at most LIMIT entries.
import { COMPONENT_TYPES, component } from './vehicle.js';

const KEY = 'works-history:', LIMIT = 80;
const ls = () => { try { return window.localStorage; } catch { return null; } };
const read = (k, d) => { try { const v = JSON.parse(ls()?.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { ls()?.setItem(k, JSON.stringify(v)); } catch { } };

// What an edit to a path means, in words: "Battery 6S · Energy → 1000 Wh"
export function describeEdit(doc, path, value) {
  const i = path.indexOf('.'), head = path.slice(0, i), key = path.slice(i + 1);
  const sm = head === 'mission' && /^segments\.([^.]+)\.([^.]+)$/.exec(key);
  if (sm) { const sg = doc.mission?.segments?.find(s => s.id === sm[1]); return `Mission · ${sg?.name || sm[1]} · ${sm[2]} → ${value}`; }
  if (head === 'mission') return key === 'segments' ? 'Mission profile edited' : `Mission · ${key} → ${value}`;
  const c = component(doc, head), p = c && COMPONENT_TYPES[c.type]?.params.find(x => x.key === key);
  if (!c || !p) return `${path} → ${value}`;
  const v = typeof value === 'number' ? +value.toPrecision(5) : value;
  return `${c.name} · ${p.label} → ${v}${p.unit ? ' ' + p.unit : ''}`;
}

export function noteEdit(docId, cause) { write(KEY + 'cause:' + docId, { cause, t: new Date().toISOString() }); }

// list: evaluated requirements [{ id, title, status, value, unit }]. Returns the entries added.
export function recordStatuses(docId, list) {
  const snapKey = KEY + 'snap:' + docId, logKey = KEY + 'log:' + docId;
  const snap = read(snapKey, null), cause = read(KEY + 'cause:' + docId, null);
  const now = {}; for (const r of list) now[r.id] = r.status;
  const added = [];
  if (snap) for (const r of list) {
    if (snap[r.id] && snap[r.id] !== r.status)
      added.push({ t: new Date().toISOString(), id: r.id, title: r.title, from: snap[r.id], to: r.status, value: r.value, unit: r.unit || '', cause: cause?.cause || 'a change made elsewhere' });
  }
  write(snapKey, now);
  if (added.length) write(logKey, [...added.reverse(), ...read(logKey, [])].slice(0, LIMIT));
  return added;
}

export const history = docId => read(KEY + 'log:' + docId, []);
export function clearHistory(docId) { try { ls()?.removeItem(KEY + 'log:' + docId); } catch { } }
