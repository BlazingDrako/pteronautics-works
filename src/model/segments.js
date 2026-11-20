// Mission segments: a fixed-wing vehicle's flight, in order, as doc.mission.segments.
//
//   { id, kind, name?, ...the kind's parameters }
//
//   climb    to an altitude at full power and the best-climb speed
//   cruise   a distance at an airspeed, against a headwind (negative: a tailwind)
//   loiter   a time at an airspeed (a survey pattern, a hold)
//   descent  to an altitude, gliding at the best lift-to-drag speed with the motor off
//   reserve  a time at the best-endurance speed, kept in the battery at landing
//
// Heights are in m above the field (the flight starts on it; the air is ISA at field elevation + height), distances
// in km, times in min, speeds in m/s.

const n = (key, label, unit, def, min, max, step) => ({ key, label, unit, def, min, max, step });

export const SEGMENT_KINDS = {
  climb: { label: 'Climb', note: 'full power at the best-climb speed', params: [n('to', 'To height', 'm', 400, 0, 8000, 10)] },
  cruise: { label: 'Cruise', note: 'a distance at an airspeed', params: [n('distance', 'Distance', 'km', 20, 0.1, 5000, 0.1), n('speed', 'Airspeed', 'm/s', 22, 3, 300, 0.5), n('wind', 'Headwind', 'm/s', 0, -40, 40, 0.5)] },
  loiter: { label: 'Loiter', note: 'a time at an airspeed', params: [n('time', 'Time', 'min', 45, 0.5, 6000, 0.5), n('speed', 'Airspeed', 'm/s', 20, 3, 300, 0.5)] },
  descent: { label: 'Descent', note: 'glide at the best L/D speed, motor off', params: [n('to', 'To height', 'm', 0, 0, 8000, 10)] },
  reserve: { label: 'Reserve', note: 'held at landing, sized at the best-endurance speed', params: [n('time', 'Time', 'min', 10, 0, 600, 0.5)] },
};

export function makeSegment(kind, id, overrides = {}) {
  const K = SEGMENT_KINDS[kind];
  if (!K) throw new Error(`Unknown segment kind "${kind}"`);
  const o = { id, kind };
  for (const p of K.params) o[p.key] = p.def;
  return Object.assign(o, overrides);
}

// The lowest segment id not used yet in the list: s1, s2, …
export function newSegmentId(segs) {
  const used = new Set(segs.map(x => x.id));
  let k = 1; while (used.has('s' + k)) k++;
  return 's' + k;
}

// A profile for a vehicle that has none: climb to its cruise altitude, two transit legs and a survey at its cruise
// speed, descend, and keep a 10-minute reserve
export function defaultSegments(mission = {}) {
  const z = Math.round(mission.altitude ?? 400), V = mission.cruiseSpeed ?? 22;
  return [
    makeSegment('climb', 's1', { name: 'Climb out', to: z }),
    makeSegment('cruise', 's2', { name: 'Transit out', distance: 20, speed: V }),
    makeSegment('loiter', 's3', { name: 'Survey', time: 45, speed: V }),
    makeSegment('cruise', 's4', { name: 'Transit back', distance: 20, speed: V }),
    makeSegment('descent', 's5', { name: 'Descent', to: 0 }),
    makeSegment('reserve', 's6', { name: 'Reserve', time: 10 }),
  ];
}

export function validateSegments(segs) {
  if (!Array.isArray(segs)) return ['mission.segments must be a list'];
  const err = [], ids = new Set();
  for (const sg of segs) {
    const K = sg && SEGMENT_KINDS[sg.kind];
    if (!K) { err.push(`segment "${sg && sg.id}": unknown kind "${sg && sg.kind}"`); continue; }
    if (!sg.id || typeof sg.id !== 'string') err.push('a segment has no id');
    else if (ids.has(sg.id)) err.push(`duplicate segment id "${sg.id}"`);
    ids.add(sg.id);
    for (const p of K.params) {
      const v = sg[p.key];
      if (typeof v !== 'number' || !isFinite(v)) err.push(`segment "${sg.id}": ${p.key} must be a number`);
      else if (v < p.min || v > p.max) err.push(`segment "${sg.id}": ${p.key} = ${v} is outside ${p.min}…${p.max}`);
    }
  }
  return err;
}
