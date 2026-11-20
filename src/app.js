// Pteronautics Works: routing between the hangar and the vehicle workspaces.
//   #/            hangar
//   #/v/<id>      workspace for vehicle <id> (fixed-wing: live; Vireo-2: launcher preview)
//   #/v/<id>/trade  trade studies on vehicle <id> (fixed-wing)
//   #/v/<id>/mission  the mission profile of vehicle <id> (fixed-wing)
//   #/v/<id>/requirements  the requirements of vehicle <id>, editable, with their history
//   #/v/<id>/report  a printable design report of vehicle <id>
//   #/v/<id>/compare  two designs of vehicle <id> side by side (current, seed, snapshots)
//   #/v/<id>/optimize  optimise vehicle <id> over chosen variables, with its requirements as constraints
//   #/library/<tab>?v=<id>  part libraries (airfoils, motors, cells, materials), applied to vehicle <id>
import { initTheme, h } from './ui/dom.js';
import { renderHangar, opensWorkspace } from './ui/hangar.js';
import { renderWorkspace } from './ui/workspace.js';
import { renderLauncher } from './ui/launcher.js';
import { renderTrade } from './ui/trade.js';
import { renderMission } from './ui/mission.js';
import { renderRequirements } from './ui/requirements.js';
import { renderReport } from './ui/report.js';
import { renderCompare } from './ui/compare.js';
import { renderLibrary } from './ui/library.js';
import { renderOptimize } from './ui/optimize.js';
import { loadVehicle } from './model/store.js';
import { VEHICLE_CLASSES } from './model/vehicle.js';

initTheme();
const root = document.getElementById('app');

function route() {
  const m = location.hash.match(/^#\/v\/([a-z0-9-]+)(\/trade|\/mission|\/requirements|\/report|\/compare|\/optimize)?/);
  window.scrollTo(0, 0);
  const lib = location.hash.match(/^#\/library(?:\/([a-z]+))?(?:\?v=([a-z0-9-]+))?/);
  if (lib) { document.title = 'Libraries · Pteronautics Works'; return renderLibrary(root, lib[1], lib[2]); }
  if (!m) { document.title = 'Pteronautics Works'; return renderHangar(root); }
  const doc = loadVehicle(m[1]);
  if (!doc || !opensWorkspace(doc)) {
    document.title = 'Pteronautics Works';
    root.replaceChildren(h('div', { class: 'hangar' }, h('h1', {}, doc ? `${doc.name} is a concept` : 'No such vehicle'),
      h('p', { class: 'dim' }, doc ? `${VEHICLE_CLASSES[doc.class]?.label} vehicles are not analysed in this build yet.` : 'It may have been removed from this browser.'), h('a', { href: '#/' }, 'Back to the hangar')));
    return;
  }
  const live = VEHICLE_CLASSES[doc.class].implemented;
  if (m[2] === '/trade' && live) { document.title = `${doc.name} trade study · Pteronautics Works`; return renderTrade(root, doc); }
  if (m[2] === '/optimize' && live) { document.title = `${doc.name} optimise · Pteronautics Works`; return renderOptimize(root, doc); }
  if (m[2] === '/compare' && live) { document.title = `${doc.name} compare · Pteronautics Works`; return renderCompare(root, doc); }
  if (m[2] === '/report' && live) { document.title = `${doc.name} report · Pteronautics Works`; return renderReport(root, doc); }
  if (m[2] === '/requirements' && live) { document.title = `${doc.name} requirements · Pteronautics Works`; return renderRequirements(root, doc); }
  if (m[2] === '/mission' && (doc.class === 'fixed-wing' || doc.class === 'rotorcraft')) { document.title = `${doc.name} mission · Pteronautics Works`; return renderMission(root, doc); }
  document.title = `${doc.name} · Pteronautics Works`;
  if (doc.class === 'launch-vehicle') renderLauncher(root, doc);
  else renderWorkspace(root, doc);
}

addEventListener('hashchange', route);
route();
