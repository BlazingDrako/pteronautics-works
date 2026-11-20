// Pteronautics Works: routing between the hangar and the vehicle workspaces.
//   #/            hangar
//   #/v/<id>      workspace for vehicle <id> (fixed-wing: live; Vireo-2: launcher preview)
import { initTheme, h } from './ui/dom.js';
import { renderHangar, opensWorkspace } from './ui/hangar.js';
import { renderWorkspace } from './ui/workspace.js';
import { renderLauncher } from './ui/launcher.js';
import { loadVehicle } from './model/store.js';
import { VEHICLE_CLASSES } from './model/vehicle.js';

initTheme();
const root = document.getElementById('app');

function route() {
  const m = location.hash.match(/^#\/v\/([a-z0-9-]+)/);
  window.scrollTo(0, 0);
  if (!m) { document.title = 'Pteronautics Works'; return renderHangar(root); }
  const doc = loadVehicle(m[1]);
  if (!doc || !opensWorkspace(doc)) {
    document.title = 'Pteronautics Works';
    root.replaceChildren(h('div', { class: 'hangar' }, h('h1', {}, doc ? `${doc.name} is a concept` : 'No such vehicle'),
      h('p', { class: 'dim' }, doc ? `${VEHICLE_CLASSES[doc.class]?.label} vehicles are not analysed in this build yet.` : 'It may have been removed from this browser.'), h('a', { href: '#/' }, 'Back to the hangar')));
    return;
  }
  document.title = `${doc.name} · Pteronautics Works`;
  if (VEHICLE_CLASSES[doc.class].implemented) renderWorkspace(root, doc);
  else renderLauncher(root, doc);
}

addEventListener('hashchange', route);
route();
