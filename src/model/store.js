// Keeps vehicle documents in localStorage, and saves or loads them as .json files.
import { seeds } from './seeds.js';
import { toJSON, fromJSON, clone } from './vehicle.js';

const KEY = 'works-vehicle:';

function storage() { try { return window.localStorage; } catch { return null; } }

// The stored copy of a vehicle, or its seed when none is stored (or the stored copy no longer parses)
export function loadVehicle(id) {
  const ls = storage();
  if (ls) {
    try {
      const text = ls.getItem(KEY + id);
      if (text) return fromJSON(text);
    } catch { /* fall back to the seed */ }
  }
  const s = seeds().find(v => v.id === id);
  return s ? clone(s) : null;
}

export function saveVehicle(doc) {
  const ls = storage(); if (!ls) return false;
  try {
    ls.setItem(KEY + doc.id, JSON.stringify(doc));
    if (!seeds().some(v => v.id === doc.id)) { const ids = customIds(); if (!ids.includes(doc.id)) ls.setItem(INDEX, JSON.stringify([...ids, doc.id])); }
    return true;
  } catch { return false; }
}

// ids of vehicles the user added (imported or new), in the order they were added
const INDEX = 'works-vehicles';
export function customIds() {
  const ls = storage();
  try { const v = JSON.parse(ls && ls.getItem(INDEX) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
}
export function uniqueId(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle';
  const taken = new Set([...seeds().map(v => v.id), ...customIds()]);
  let id = base, k = 2; while (taken.has(id)) id = `${base}-${k++}`;
  return id;
}

export function resetVehicle(id) {
  const ls = storage(); if (ls) try { ls.removeItem(KEY + id); } catch { }
  return loadVehicle(id);
}

export const isModified = id => { const ls = storage(); try { return !!(ls && ls.getItem(KEY + id)); } catch { return false; } };

export const allVehicles = () => [...seeds().map(s => loadVehicle(s.id) || s), ...customIds().map(loadVehicle).filter(Boolean)];

// Download the document as <id>.json
export function downloadVehicle(doc) {
  const blob = new Blob([toJSON(doc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.id}-rev${doc.revision}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Ask for a .json file and parse it (rejects with a readable message if it is not a vehicle document)
export function pickVehicleFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return reject(new Error('No file chosen'));
      try { resolve(fromJSON(await f.text())); } catch (e) { reject(e); }
    };
    input.click();
  });
}
