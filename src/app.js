// Pteronautics Works: routing between the hangar and the vehicle workspaces.
//   #/            hangar
//   #/v/<id>      workspace for vehicle <id> (fixed-wing: live; Vireo-2: launcher preview)
//   #/v/<id>/trade  trade studies on vehicle <id> (fixed-wing)
import { initTheme, h } from './ui/dom.js';
import { renderHangar, opensWorkspace } from './ui/hangar.js';
import { renderWorkspace } from './ui/workspace.js';
import { renderLauncher } from './ui/launcher.js';
import { renderTrade } from './ui/trade.js';
import { loadVehicle } from './model/store.js';
import { VEHICLE_CLASSES } from './model/vehicle.js';

initTheme();
const root = document.getElementById('app');

function route() {
  const m = location.hash.match(/^#\/v\/([a-z0-9-]+)(\/trade)?/);
  window.scrollTo(0, 0);
  if (!m) { document.title = 'Pteronautics Works'; return renderHangar(root); }
  const doc = loadVehicle(m[1]);
  if (!doc || !opensWorkspace(doc)) {
    document.title = 'Pteronautics Works';
    root.replaceChildren(h('div', { class: 'hangar' }, h('h1', {}, doc ? `${doc.name} is a concept` : 'No such vehicle'),
      h('p', { class: 'dim' }, doc ? `${VEHICLE_CLASSES[doc.class]?.label} vehicles are not analysed in this build yet.` : 'It may have been removed from this browser.'), h('a', { href: '#/' }, 'Back to the hangar')));
    return;
  }
  const live = VEHICLE_CLASSES[doc.class].implemented;
  if (m[2] && live) { document.title = `${doc.name} trade study · Pteronautics Works`; return renderTrade(root, doc); }
  document.title = `${doc.name} · Pteronautics Works`;
  if (live) renderWorkspace(root, doc);
  else renderLauncher(root, doc);
}

addEventListener('hashchange', route);
route();
