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
  try { ls.setItem(KEY + doc.id, JSON.stringify(doc)); return true; } catch { return false; }
}

export function resetVehicle(id) {
  const ls = storage(); if (ls) try { ls.removeItem(KEY + id); } catch { }
  return loadVehicle(id);
}

export const isModified = id => { const ls = storage(); try { return !!(ls && ls.getItem(KEY + id)); } catch { return false; } };

export const allVehicles = () => seeds().map(s => loadVehicle(s.id) || s);

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
