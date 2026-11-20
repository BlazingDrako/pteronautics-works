// Part libraries: airfoil sections, motor classes, battery cells and wing construction, to pick into a vehicle
// instead of typing numbers. The values are typical figures for each kind of part (pack-level, not cell-level, for
// batteries), not data for any one product; they are a starting point to refine.
//
// Each entry turns into edits on a vehicle (apply → [[path, value]]), applied through applyEdit like any other edit,
// so linked sizing and the requirement history follow.
import { firstOf } from './vehicle.js';

export const AIRFOILS = [
  { code: '0009', use: 'Tails, fins', note: 'Thin symmetric section; low drag, gentle stall at low Reynolds numbers.' },
  { code: '0012', use: 'Tails, aerobatic wings', note: 'The classic symmetric section; no pitching moment.' },
  { code: '0015', use: 'Thick tails, struts', note: 'Symmetric, thick enough for a structure; higher drag.' },
  { code: '2410', use: 'Sailplane tips', note: 'Light camber, thin; low drag at moderate lift.' },
  { code: '2412', use: 'General aviation, sailplanes', note: 'Mild camber; a well-proven all-round section.' },
  { code: '2415', use: 'Trainers, utility', note: 'As 2412 with room for a deeper spar.' },
  { code: '4412', use: 'Slow, high-lift wings', note: 'More camber for lift at low speed; a nose-down pitching moment.' },
  { code: '4415', use: 'Survey UAS, eVTOL wings', note: 'High lift and a deep spar; Kestrel\'s section.' },
  { code: '4418', use: 'Thick roots, high lift', note: 'Thick and cambered; good for a deep root, draggier.' },
  { code: '6409', use: 'Very slow flight', note: 'Strong camber and thin; high lift, strong pitching moment.' },
];

export const MOTORS = [
  { id: 'outrunner-small', name: 'Outrunner, small UAS', range: '0.2–3 kW', specificPower: 2500, motorEff: 0.85, note: 'Hobby-class brushless outrunner with its controller.' },
  { id: 'outrunner-high', name: 'High-efficiency outrunner', range: '1–10 kW', specificPower: 3500, motorEff: 0.9, note: 'Larger-diameter, low-kV motors; best for long endurance.' },
  { id: 'industrial-pmsm', name: 'Industrial PMSM with gearbox', range: '5–50 kW', specificPower: 2000, motorEff: 0.88, note: 'Robust and heavier; the gearbox costs a few percent.' },
  { id: 'aviation-pmsm', name: 'Aviation PMSM, direct drive', range: '50–300 kW', specificPower: 5000, motorEff: 0.94, note: 'Certified-class electric aircraft motors with inverters.' },
  { id: 'axial-flux', name: 'Axial-flux, high specific power', range: '50–500 kW', specificPower: 8000, motorEff: 0.95, note: 'State of the art for eVTOL and electric aircraft.' },
];

export const CELLS = [
  { id: 'lipo', name: 'LiPo, hobby pouch', chemistry: 'LiPo', specificEnergy: 150, usable: 0.8, cellVoltage: 3.7, note: 'High power, short life; usual for small multirotors.' },
  { id: 'li-ion-18650', name: 'Li-ion 18650 pack', chemistry: 'Li-ion 18650', specificEnergy: 180, usable: 0.85, cellVoltage: 3.6, note: 'Kestrel-class packs; good energy, moderate power.' },
  { id: 'li-ion-21700', name: 'Li-ion 21700 pack', chemistry: 'Li-ion 21700', specificEnergy: 200, usable: 0.85, cellVoltage: 3.6, note: 'Larger cells, a little better at pack level.' },
  { id: 'nmc-aviation', name: 'Li-ion NMC, aviation pack', chemistry: 'Li-ion NMC', specificEnergy: 177, usable: 0.9, cellVoltage: 3.65, note: 'With crash-worthy casing and thermal management (eVTOL).' },
  { id: 'li-s', name: 'Lithium-sulphur (emerging)', chemistry: 'Li-S', specificEnergy: 300, usable: 0.8, cellVoltage: 2.1, note: 'High energy, low power and short life; a projection.' },
  { id: 'solid-state', name: 'Solid-state (projected)', chemistry: 'Solid-state Li', specificEnergy: 330, usable: 0.9, cellVoltage: 3.7, note: 'Projected pack-level figure; not yet flying.' },
];

export const MATERIALS = [
  { id: 'foam-glass', name: 'Foam core, glass skin', arealMass: 2.8, scale: 'UAS, 1–4 m span', note: 'Cheap and tough; Kestrel-class wings.' },
  { id: 'carbon-sandwich', name: 'Carbon sandwich', arealMass: 2.2, scale: 'UAS, 2–6 m span', note: 'Stiffer and lighter than glass for the same span.' },
  { id: 'balsa-built', name: 'Built-up balsa and film', arealMass: 1.2, scale: 'small UAS, gliders', note: 'Very light; fragile in handling.' },
  { id: 'composite-sailplane', name: 'Glass/carbon sailplane wing', arealMass: 17, scale: '15–25 m span', note: 'Moulded composite with a carbon spar, as in Tern.' },
  { id: 'composite-ga', name: 'Composite light-aircraft wing', arealMass: 9, scale: '8–14 m span', note: 'Carbon spar and skins; eVTOL and light aircraft.' },
  { id: 'aluminium', name: 'Riveted aluminium', arealMass: 12, scale: '8–14 m span', note: 'Conventional light-aircraft construction.' },
];

// what an entry needs on the vehicle, and the edits it makes
export const TARGETS = {
  airfoil: { need: 'wing', label: 'wing' },
  motor: { need: 'propulsor', label: 'motor' },
  cell: { need: 'battery', label: 'battery' },
  material: { need: 'wing', label: 'wing' },
};

// edits for an entry on a vehicle. where: 'root' | 'tip' | 'both' (airfoils), else ignored
export function applyEntry(doc, kind, entry, where = 'both') {
  const c = firstOf(doc, TARGETS[kind].need);
  if (!c) throw new Error(`${doc.name} has no ${TARGETS[kind].label}`);
  const p = k => `${c.id}.${k}`;
  if (kind === 'airfoil') return [...(where !== 'tip' ? [[p('rootAirfoil'), entry.code]] : []), ...(where !== 'root' ? [[p('tipAirfoil'), entry.code]] : [])];
  if (kind === 'motor') return [[p('motorEff'), entry.motorEff], [p('specificPower'), entry.specificPower]];
  if (kind === 'cell') {
    // keep the series count the pack has (its voltage over the old cell voltage), at the new cell voltage
    const old = CELLS.find(x => x.chemistry === c.chemistry)?.cellVoltage ?? 3.6, series = Math.max(1, Math.round((c.voltage ?? 22.2) / old));
    return [[p('chemistry'), entry.chemistry], [p('usable'), entry.usable], [p('specificEnergy'), entry.specificEnergy], [p('voltage'), +(series * entry.cellVoltage).toFixed(1)]];
  }
  if (kind === 'material') return [[p('arealMass'), entry.arealMass]];
  throw new Error(`unknown library "${kind}"`);
}
