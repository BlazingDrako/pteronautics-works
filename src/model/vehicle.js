// The vehicle document: one JSON-serialisable object per vehicle, whatever its class.
//
//   {
//     schema: 'pteronautics-works/vehicle', version: 1,
//     id, name, class, role, status: 'active' | 'concept', revision, branch, updated (ISO time),
//     mission: { ...class-specific flight condition / mission numbers; fixed-wing: segments (see segments.js) },
//     components: [ { id, type, name, ...parameters } ],   // typed parts; `type` keys COMPONENT_TYPES
//     requirements: [ { id, title, metric, op: '>=' | '<=', target, unit, group } ],
//   }
//
// Every class uses the same document shape; classes differ only in which component types they allow and which
// analysis graph runs on them. Lengths in m, masses in kg, angles in deg, powers in W, energies in Wh.
// Positions x are measured aft from the nose (or from the top of the stack for launch vehicles).

import { validateSegments, defaultSegments } from './segments.js';

export const SCHEMA = 'pteronautics-works/vehicle';
export const VERSION = 1;

// A parameter: { key, label, unit, def, min, max, step, kind: 'number' | 'text' | 'choice', options }
const n = (key, label, unit, def, min, max, step) => ({ key, label, unit, def, min, max, step, kind: 'number' });
const t = (key, label, def) => ({ key, label, def, kind: 'text' });
const c = (key, label, def, options) => ({ key, label, def, kind: 'choice', options });

// Mass and position, shared by most parts
const massX = (m, x) => [n('mass', 'Mass', 'kg', m, 0, 5000, 0.05), n('x', 'Position x (CG)', 'm', x, -50, 200, 0.01)];

export const COMPONENT_TYPES = {
  // ---------- aircraft ----------
  fuselage: { label: 'Fuselage', params: [n('length', 'Length', 'm', 1.6, 0.1, 80, 0.01), n('width', 'Max width', 'm', 0.16, 0.02, 8, 0.005), ...massX(4, 0.75)] },
  wing: {
    label: 'Wing',
    params: [
      n('span', 'Span', 'm', 3.2, 0.3, 80, 0.01), n('rootChord', 'Root chord', 'm', 0.36, 0.03, 15, 0.005),
      n('taper', 'Taper ratio', '', 0.6, 0.1, 1, 0.01), n('sweep', 'Sweep (c/4)', '°', 0, -30, 60, 0.5),
      n('twist', 'Twist (tip)', '°', -2, -8, 4, 0.1), n('dihedral', 'Dihedral', '°', 3, -10, 15, 0.1),
      t('rootAirfoil', 'Root airfoil (NACA)', '4415'), t('tipAirfoil', 'Tip airfoil (NACA)', '4415'),
      n('x', 'Root LE position x', 'm', 0.52, -10, 100, 0.005), c('position', 'Vertical position', 'high', ['high', 'mid', 'low']),
      n('arealMass', 'Structural areal mass', 'kg/m²', 3.4, 0.5, 80, 0.05),
    ],
  },
  htail: {
    label: 'Horizontal tail',
    params: [n('area', 'Area', 'm²', 0.16, 0.005, 100, 0.002), n('aspect', 'Aspect ratio', '', 4.5, 1, 10, 0.1), n('sweep', 'Sweep', '°', 5, 0, 60, 1),
      n('x', 'Aerodynamic center x', 'm', 1.55, 0, 100, 0.005), n('efficiency', 'Tail efficiency η', '', 0.9, 0.5, 1, 0.01),
      n('tau', 'Elevator effectiveness τ', '', 0.5, 0.1, 1, 0.01), n('mass', 'Mass', 'kg', 0.55, 0, 5000, 0.01)],
  },
  vtail: {
    label: 'Fin & rudder',
    params: [n('area', 'Area', 'm²', 0.1, 0.005, 100, 0.002), n('aspect', 'Aspect ratio', '', 1.6, 0.5, 5, 0.1), n('sweep', 'Sweep', '°', 25, 0, 60, 1),
      n('x', 'Aerodynamic center x', 'm', 1.58, 0, 100, 0.005), n('height', 'Center height above CG', 'm', 0.2, 0, 20, 0.005), n('mass', 'Mass', 'kg', 0.35, 0, 5000, 0.01)],
  },
  propulsor: {
    label: 'Motor & propeller',
    params: [c('kind', 'Kind', 'electric', ['electric']), n('power', 'Max shaft power', 'W', 1500, 10, 5e6, 10), n('propEff', 'Peak prop efficiency', '', 0.78, 0.4, 0.92, 0.01),
      n('motorEff', 'Motor + ESC efficiency', '', 0.88, 0.5, 0.99, 0.01), n('diameter', 'Prop diameter', 'm', 0.457, 0.05, 6, 0.001), ...massX(1.6, 0.06),
      n('specificPower', 'Specific power', 'W/kg', 940, 20, 20000, 1), c('sizing', 'Mass with power', 'linked', ['linked', 'fixed'])],
  },
  battery: {
    label: 'Battery',
    params: [n('energy', 'Energy', 'Wh', 888, 1, 1e6, 1), n('usable', 'Usable fraction', '', 0.85, 0.5, 1, 0.01), t('chemistry', 'Chemistry', 'Li-ion 6S'), ...massX(4.9, 0.5),
      n('specificEnergy', 'Specific energy', 'Wh/kg', 180, 10, 1000, 1), c('sizing', 'Mass with energy', 'linked', ['linked', 'fixed']),
      n('voltage', 'Nominal voltage', 'V', 22.2, 1, 1000, 0.1), n('resistance', 'Internal resistance', 'Ω', 0.012, 0, 2, 0.001)],
  },
  payload: { label: 'Payload', params: [t('description', 'Description', ''), ...massX(4.5, 0.4)] },
  avionics: { label: 'Avionics', params: [...massX(1.4, 0.35)] },
  systems: { label: 'Systems', params: [t('description', 'Description', ''), ...massX(1.8, 0.7)] },
  // ---------- rotorcraft & eVTOL ----------
  rotor: { label: 'Rotor', params: [n('count', 'Count', '', 4, 1, 16, 1), n('radius', 'Radius', 'm', 1, 0.05, 20, 0.01), n('blades', 'Blades', '', 3, 2, 8, 1), n('tipSpeed', 'Tip speed', 'm/s', 180, 50, 250, 1), ...massX(20, 1)] },
  // ---------- high-speed ----------
  inlet: { label: 'Inlet', params: [c('kind', 'Kind', '2-ramp', ['pitot', '2-ramp', '3-ramp', 'axisymmetric']), n('designMach', 'Design Mach', '', 1.6, 0.5, 4, 0.05), ...massX(120, 5)] },
  turbofan: { label: 'Turbofan', params: [n('thrust', 'Max thrust (dry)', 'N', 60e3, 100, 5e5, 100), n('bypass', 'Bypass ratio', '', 0.6, 0, 12, 0.1), c('afterburner', 'Afterburner', 'yes', ['yes', 'no']), ...massX(1400, 10)] },
  // ---------- launch vehicles ----------
  stage: { label: 'Stage', params: [n('dry', 'Dry mass', 'kg', 2000, 1, 1e6, 1), n('propellant', 'Propellant mass', 'kg', 20000, 0, 1e7, 1), n('diameter', 'Diameter', 'm', 1.8, 0.1, 15, 0.01), n('length', 'Length', 'm', 15, 0.5, 120, 0.1), n('x', 'Top of stage x', 'm', 0, 0, 200, 0.1)] },
  rocketEngine: { label: 'Rocket engine', params: [n('count', 'Count', '', 1, 1, 40, 1), c('cycle', 'Cycle', 'gas generator', ['pressure-fed', 'gas generator', 'expander', 'staged combustion']), t('propellants', 'Propellants', 'LOX / RP-1'), n('thrustSL', 'Thrust (sea level, each)', 'N', 37.6e3, 0, 1e7, 100), n('isp', 'Isp (vacuum)', 's', 320, 100, 480, 1), ...massX(80, 14)] },
  fairing: { label: 'Fairing', params: [n('diameter', 'Diameter', 'm', 1.2, 0.2, 10, 0.01), ...massX(90, 1)] },
  // ---------- spacecraft ----------
  bus: { label: 'Bus', params: [t('form', 'Form factor', '6U'), n('power', 'Average power', 'W', 30, 0, 1e5, 1), ...massX(10, 0.15)] },
  solarArray: { label: 'Solar array', params: [n('area', 'Area', 'm²', 0.25, 0.01, 500, 0.01), n('efficiency', 'Cell efficiency', '', 0.29, 0.05, 0.5, 0.01), ...massX(0.8, 0.15)] },
  thruster: { label: 'Thruster', params: [c('kind', 'Kind', 'cold gas', ['cold gas', 'monoprop', 'electric']), n('isp', 'Isp', 's', 70, 20, 4000, 1), ...massX(0.6, 0.2)] },
};

// Classes: which component types each may hold, and whether this build can analyse it
export const VEHICLE_CLASSES = {
  'fixed-wing': { label: 'Fixed-wing', implemented: true, types: ['fuselage', 'wing', 'htail', 'vtail', 'propulsor', 'battery', 'payload', 'avionics', 'systems'] },
  rotorcraft: { label: 'Rotorcraft & eVTOL', implemented: false, types: ['fuselage', 'wing', 'htail', 'vtail', 'rotor', 'propulsor', 'battery', 'payload', 'avionics', 'systems'] },
  'high-speed': { label: 'High-speed', implemented: false, types: ['fuselage', 'wing', 'htail', 'vtail', 'inlet', 'turbofan', 'payload', 'avionics', 'systems'] },
  'launch-vehicle': { label: 'Launch vehicles', implemented: false, types: ['stage', 'rocketEngine', 'fairing', 'payload', 'avionics', 'systems'] },
  spacecraft: { label: 'Spacecraft', implemented: false, types: ['bus', 'solarArray', 'thruster', 'battery', 'payload', 'avionics'] },
  sailplane: { label: 'Sailplanes', implemented: true, types: ['fuselage', 'wing', 'htail', 'vtail', 'payload', 'avionics', 'systems'] },
};

export const REQUIREMENT_OPS = ['>=', '<='];

// Mission settings a fixed-wing document carries besides its segments: field elevation (m, ISA) and the hotel load
// (W drawn all flight by the avionics and payload)
export const MISSION_DEFAULTS = { fieldElevation: 0, hotelPower: 0 };
export const MISSION_SETTINGS = [
  { key: 'fieldElevation', label: 'Field elevation', unit: 'm', min: 0, max: 5000, step: 10 },
  { key: 'hotelPower', label: 'Hotel load', unit: 'W', min: 0, max: 1e5, step: 1 },
];

// Linked sizing: parts whose mass scales with what they deliver, a = k·b (energy = specific energy × mass).
// With sizing 'linked' the pack or motor grows with its rating; with 'fixed' its mass stays and k follows.
//   edit a (energy):  linked → b (mass) moves;   fixed → k moves
//   edit b (mass):    linked → a moves;          fixed → k moves
//   edit k:           linked → b moves (same energy, lighter cells);  fixed → a moves (better cells, same mass)
export const LINKS = {
  battery: { a: 'energy', b: 'mass', k: 'specificEnergy' },
  propulsor: { a: 'power', b: 'mass', k: 'specificPower' },
};

// A component with every parameter of its type filled in from the defaults (a linked part's k from its a and b)
export function makeComponent(type, id, overrides = {}) {
  const T = COMPONENT_TYPES[type];
  if (!T) throw new Error(`Unknown component type "${type}"`);
  const o = { id, type, name: overrides.name ?? T.label };
  for (const p of T.params) o[p.key] = p.def;
  Object.assign(o, overrides);
  const L = LINKS[type];
  if (L && overrides[L.k] === undefined && o[L.b] > 0) o[L.k] = o[L.a] / o[L.b];
  return o;
}

// Bring an older document up to this schema: parameters added since get their defaults (a linked part's k from
// its own numbers, so nothing it computes changes), and a fixed-wing vehicle without a mission profile gets one
// built from its flight condition. Returns the same object.
export function upgrade(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.components)) return doc;
  for (const c of doc.components) {
    const T = COMPONENT_TYPES[c && c.type]; if (!T) continue;
    const L = LINKS[c.type];
    if (L && c[L.k] === undefined && c[L.b] > 0 && typeof c[L.a] === 'number') c[L.k] = c[L.a] / c[L.b];
    for (const p of T.params) if (c[p.key] === undefined) c[p.key] = p.def;
  }
  if (doc.class === 'fixed-wing' && doc.mission) {
    if (!Array.isArray(doc.mission.segments)) doc.mission.segments = defaultSegments(doc.mission);
    for (const [k, v] of Object.entries(MISSION_DEFAULTS)) if (doc.mission[k] === undefined) doc.mission[k] = v;
  }
  return doc;
}

export function paramSpec(type, key) {
  const T = COMPONENT_TYPES[type];
  return T && T.params.find(p => p.key === key);
}

// Problems with a document, as a list of strings (empty = valid)
export function validate(doc) {
  const err = [];
  if (!doc || typeof doc !== 'object') return ['not an object'];
  if (doc.schema !== SCHEMA) err.push(`schema must be "${SCHEMA}"`);
  if (doc.version !== VERSION) err.push(`version must be ${VERSION}`);
  if (!doc.id || typeof doc.id !== 'string') err.push('id is required');
  if (!doc.name || typeof doc.name !== 'string') err.push('name is required');
  const cls = VEHICLE_CLASSES[doc.class];
  if (!cls) err.push(`unknown class "${doc.class}"`);
  if (!Array.isArray(doc.components)) { err.push('components must be a list'); return err; }
  const ids = new Set();
  for (const comp of doc.components) {
    const where = `component "${comp && comp.id}"`;
    if (!comp || !comp.id) { err.push('a component has no id'); continue; }
    if (ids.has(comp.id)) err.push(`duplicate component id "${comp.id}"`);
    ids.add(comp.id);
    const T = COMPONENT_TYPES[comp.type];
    if (!T) { err.push(`${where}: unknown type "${comp.type}"`); continue; }
    if (cls && !cls.types.includes(comp.type)) err.push(`${where}: type "${comp.type}" is not allowed in class "${doc.class}"`);
    for (const p of T.params) {
      const v = comp[p.key];
      if (v === undefined) { err.push(`${where}: missing ${p.key}`); continue; }
      if (p.kind === 'number') {
        if (typeof v !== 'number' || !isFinite(v)) err.push(`${where}: ${p.key} must be a number`);
        else if (v < p.min || v > p.max) err.push(`${where}: ${p.key} = ${v} is outside ${p.min}…${p.max}`);
      } else if (p.kind === 'choice' && !p.options.includes(v)) err.push(`${where}: ${p.key} must be one of ${p.options.join(', ')}`);
      else if (p.kind === 'text' && typeof v !== 'string') err.push(`${where}: ${p.key} must be text`);
    }
  }
  if (doc.mission && doc.mission.segments !== undefined) err.push(...validateSegments(doc.mission.segments));
  for (const s of MISSION_SETTINGS) { const v = doc.mission?.[s.key]; if (v !== undefined && (typeof v !== 'number' || !(v >= s.min && v <= s.max))) err.push(`mission.${s.key} must be a number in ${s.min}…${s.max}`); }
  if (doc.requirements !== undefined) {
    if (!Array.isArray(doc.requirements)) err.push('requirements must be a list');
    else for (const r of doc.requirements) {
      if (!r.id || !r.metric) err.push('a requirement needs an id and a metric');
      if (!REQUIREMENT_OPS.includes(r.op)) err.push(`requirement "${r.id}": op must be >= or <=`);
      if (typeof r.target !== 'number' || !isFinite(r.target)) err.push(`requirement "${r.id}": target must be a number`);
    }
  }
  return err;
}

export const component = (doc, id) => doc.components.find(x => x.id === id);
export const componentsOf = (doc, type) => doc.components.filter(x => x.type === type);
export const firstOf = (doc, type) => doc.components.find(x => x.type === type);

// Read and write a value by path: "mission.altitude", "<componentId>.<param>", or a segment's value
// "mission.segments.<segmentId>.<param>"
const SEG = /^segments\.([^.]+)\.([^.]+)$/;
export function getPath(doc, path) {
  const [head, key] = splitPath(path);
  const sm = head === 'mission' && SEG.exec(key);
  if (sm) return doc.mission?.segments?.find(s => s.id === sm[1])?.[sm[2]];
  if (head === 'mission') return doc.mission?.[key];
  const comp = component(doc, head);
  return comp ? comp[key] : undefined;
}
export function setPath(doc, path, value) {
  const [head, key] = splitPath(path);
  const sm = head === 'mission' && SEG.exec(key);
  if (sm) { const sg = doc.mission?.segments?.find(s => s.id === sm[1]); if (!sg) throw new Error(`No segment "${sm[1]}"`); sg[sm[2]] = value; return doc; }
  if (head === 'mission') { doc.mission = doc.mission || {}; doc.mission[key] = value; return doc; }
  const comp = component(doc, head);
  if (!comp) throw new Error(`No component "${head}"`);
  comp[key] = value;
  return doc;
}
// An edit as the designer means it: some parameters carry other parts with them. Returns every path changed.
//   fuselage.length: the tail surfaces stay mounted on the tail cone, so they move with the fuselage's end
//   (which also changes the tail arm).
export const TAIL_TYPES = ['htail', 'vtail'];
export function applyEdit(doc, path, value) {
  const [head, key] = splitPath(path);
  // a segment's value changes the mission profile as a whole
  if (head === 'mission' && SEG.test(key)) { setPath(doc, path, value); return [path, 'mission.segments']; }
  const changed = [path];
  const comp = head === 'mission' ? null : component(doc, head);
  if (comp && comp.type === 'fuselage' && key === 'length' && typeof comp.length === 'number') {
    const dL = value - comp.length;
    for (const c of doc.components) {
      if (!TAIL_TYPES.includes(c.type) || typeof c.x !== 'number') continue;
      const spec = paramSpec(c.type, 'x');
      c.x = Math.min(spec.max, Math.max(spec.min, c.x + dL));
      changed.push(`${c.id}.x`);
    }
  }
  setPath(doc, path, value);
  const L = comp && LINKS[comp.type];
  if (L && [L.a, L.b, L.k].includes(key) && typeof value === 'number') {
    const linked = comp.sizing !== 'fixed';
    const move = key === L.k ? (linked ? L.b : L.a) : linked ? (key === L.a ? L.b : L.a) : L.k;
    const want = move === L.a ? comp[L.k] * comp[L.b] : move === L.b ? comp[L.a] / comp[L.k] : comp[L.a] / comp[L.b];
    const spec = paramSpec(comp.type, move);
    if (isFinite(want)) {
      comp[move] = Math.min(spec.max, Math.max(spec.min, want));
      changed.push(`${comp.id}.${move}`);
      // a clamped value leaves k to keep a = k·b
      if (comp[move] !== want && move !== L.k) { comp[L.k] = comp[L.a] / comp[L.b]; changed.push(`${comp.id}.${L.k}`); }
    }
  }
  return changed;
}

function splitPath(path) {
  const i = path.indexOf('.');
  if (i < 0) throw new Error(`Bad path "${path}"`);
  return [path.slice(0, i), path.slice(i + 1)];
}

// Serialisation: stable JSON text, and parsing that refuses invalid documents
export const clone = doc => JSON.parse(JSON.stringify(doc));
export function toJSON(doc) { return JSON.stringify(doc, null, 2) + '\n'; }
export function fromJSON(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
  upgrade(doc);
  const err = validate(doc);
  if (err.length) throw new Error('Not a valid vehicle document: ' + err.slice(0, 4).join('; '));
  return doc;
}

// Total mass of the listed components (wing mass comes from its area, so it is left to the mass analysis)
export function pointMass(doc) { return doc.components.reduce((s, x) => s + (typeof x.mass === 'number' ? x.mass : 0), 0); }
