// The vehicles the hangar starts with. Kestrel (fixed-wing) is the one this build can analyse; the others are
// concept documents that show every class fits the same document shape.
import { SCHEMA, VERSION, makeComponent as C } from './vehicle.js';
import { makeSegment as G } from './segments.js';

const base = (o) => ({ schema: SCHEMA, version: VERSION, status: 'concept', revision: 1, branch: 'main', updated: '2026-11-19T12:00:00Z', mission: {}, requirements: [], ...o });
const R = (id, title, metric, op, target, unit, group) => ({ id, title, metric, op, target, unit, group });

export function kestrel() {
  return base({
    id: 'kestrel', name: 'Kestrel', class: 'fixed-wing', role: 'Electric survey UAS', status: 'active', revision: 14, branch: 'endurance-push',
    mission: {
      altitude: 400, dT: 0, cruiseSpeed: 22,
      segments: [
        G('climb', 's1', { name: 'Climb out', to: 400 }),
        G('cruise', 's2', { name: 'Transit to site', distance: 18, speed: 22, wind: 4 }),
        G('loiter', 's3', { name: 'Survey grid', time: 55, speed: 21 }),
        G('cruise', 's4', { name: 'Transit home', distance: 18, speed: 22, wind: -4 }),
        G('descent', 's5', { name: 'Descent', to: 0 }),
        G('reserve', 's6', { name: 'Reserve', time: 10 }),
      ],
    },
    components: [
      C('fuselage', 'fuselage', { name: 'Fuselage', length: 1.65, width: 0.16, mass: 4.2, x: 0.78 }),
      C('wing', 'wing', { name: 'Wing', span: 3.2, rootChord: 0.36, taper: 0.6, sweep: 0, twist: -2, dihedral: 3, rootAirfoil: '4415', tipAirfoil: '4415', x: 0.52, position: 'high', arealMass: 3.4 }),
      C('htail', 'htail', { name: 'Horizontal tail', area: 0.16, aspect: 4.5, sweep: 5, x: 1.55, efficiency: 0.9, tau: 0.5, mass: 0.55 }),
      C('vtail', 'vtail', { name: 'Fin & rudder', area: 0.1, aspect: 1.6, sweep: 25, x: 1.58, height: 0.2, mass: 0.35 }),
      C('propulsor', 'propulsor', { name: 'Motor & 18×10 prop', power: 1500, propEff: 0.78, motorEff: 0.88, diameter: 0.457, mass: 1.6, x: 0.06 }),
      C('battery', 'battery', { name: 'Battery 6S', energy: 888, usable: 0.85, chemistry: 'Li-ion 6S', mass: 4.9, x: 0.62 }),
      C('payload', 'payload', { name: 'Survey camera & LiDAR', description: 'Gimballed RGB camera and LiDAR', mass: 4.5, x: 0.55 }),
      C('avionics', 'avionics', { name: 'Avionics', mass: 1.4, x: 0.45 }),
      C('systems', 'systems', { name: 'Servos, wiring, gear', description: 'Servos, wiring harness, landing skids', mass: 1.8, x: 0.8 }),
    ],
    requirements: [
      R('R-01', 'Endurance at best-endurance speed', 'performance.endurance', '>=', 90, 'min', 'Mission'),
      R('R-02', 'Range at best-range speed', 'performance.range', '>=', 150, 'km', 'Mission'),
      R('R-03', 'Clean stall speed, 1 g', 'performance.Vs', '<=', 18, 'm/s', 'Field'),
      R('R-04', 'Best rate of climb', 'performance.RoC', '>=', 2.5, 'm/s', 'Field'),
      R('R-05', 'Maximum lift-to-drag ratio', 'performance.LDmax', '>=', 16, '', 'Aero'),
      R('R-06', 'Static margin, minimum', 'stability.SM', '>=', 5, '% MAC', 'Stability'),
      R('R-07', 'Static margin, maximum', 'stability.SM', '<=', 20, '% MAC', 'Stability'),
      R('R-08', 'Dutch roll damping ζ (MIL-F-8785C level 1)', 'stability.drZeta', '>=', 0.08, '', 'Stability'),
      R('R-09', 'Takeoff mass (regulatory class)', 'mass.total', '<=', 25, 'kg', 'Mass'),
      R('R-10', 'Wingspan (transport case)', 'geometry.span', '<=', 3.4, 'm', 'Geometry'),
      R('R-11', 'Survey mission energy left after reserve', 'mission.margin', '>=', 5, '% usable', 'Mission'),
    ],
  });
}

export function concepts() {
  return [
    base({
      id: 'arrow-x', name: 'Arrow-X', class: 'high-speed', role: 'Supersonic demonstrator', revision: 31, branch: 'supercruise-wing', mission: { mach: 1.6, altitude: 12000 },
      tags: ['delta 58°', 'turbofan + AB', '2-ramp inlet'], badge: 'M 1.8',
      components: [C('fuselage', 'fuselage', { length: 14.2, width: 1.4, mass: 2600, x: 7.5 }), C('wing', 'wing', { span: 8.6, rootChord: 7.4, taper: 0.1, sweep: 52, twist: 0, dihedral: 0, rootAirfoil: '0004', tipAirfoil: '0004', x: 4.2, position: 'mid', arealMass: 28 }),
        C('inlet', 'inlet', { mass: 180, x: 4 }), C('turbofan', 'turbofan', { mass: 1500, x: 10.5 })],
    }),
    base({
      id: 'halcyon', name: 'Halcyon', class: 'rotorcraft', role: 'Lift + cruise eVTOL', revision: 9, mission: { cruiseSpeed: 67, hoverTime: 90 },
      tags: ['BEM rotors', 'transition', 'Li-ion 92 kWh'], badge: '4 lift + 1 cruise',
      components: [C('fuselage', 'fuselage', { length: 8.2, width: 1.5, mass: 420, x: 4 }), C('wing', 'wing', { span: 12, rootChord: 1.3, taper: 0.8, twist: -2, dihedral: 2, x: 3.4, arealMass: 9 }),
        C('rotor', 'rotor', { count: 4, radius: 1.2, mass: 160, x: 3.8 }), C('battery', 'battery', { energy: 92000, chemistry: 'Li-ion', mass: 520, x: 3.6 })],
    }),
    base({
      id: 'vireo-2', name: 'Vireo-2', class: 'launch-vehicle', role: 'Two-stage small launcher', revision: 52, mission: { orbit: '500 km SSO', inclination: 97.4, payload: 300 },
      tags: ['LOX / RP-1', 'gas generator', '9 + 1 engines'], badge: '300 kg → 500 km SSO', preview: true,
      components: [C('fairing', 'fairing', { diameter: 1.2, mass: 90, x: 1 }), C('stage', 'stage2', { name: 'Stage 2', dry: 420, propellant: 2480, diameter: 1.2, length: 4.8, x: 3.5 }),
        C('rocketEngine', 'engine2', { name: 'Stage 2 engine', count: 1, thrustSL: 0, isp: 342, mass: 60, x: 8 }),
        C('stage', 'stage1', { name: 'Stage 1', dry: 1950, propellant: 19450, diameter: 1.8, length: 15, x: 9 }),
        C('rocketEngine', 'engine1', { name: 'Stage 1 engines', count: 9, thrustSL: 37.6e3, isp: 311, mass: 85, x: 23.5 })],
    }),
    base({
      id: 'tern', name: 'Tern', class: 'sailplane', role: '18 m open-class sailplane', revision: 6, mission: { thermalSink: 1.5 },
      tags: ['laminar sections', 'aeroelastic', 'flaperons'], badge: 'AR 32 · L/D 52',
      components: [C('fuselage', 'fuselage', { length: 6.8, width: 0.62, mass: 120, x: 2.8 }), C('wing', 'wing', { span: 18, rootChord: 0.78, taper: 0.4, twist: -1.5, dihedral: 3, rootAirfoil: '2412', tipAirfoil: '2410', x: 2.2, position: 'mid', arealMass: 18 }),
        C('htail', 'htail', { area: 0.95, aspect: 6.5, x: 6.2, mass: 6 }), C('vtail', 'vtail', { area: 0.95, aspect: 1.4, x: 6.3, mass: 6 })],
    }),
    base({
      id: 'petrel', name: 'Petrel', class: 'spacecraft', role: '6U Earth-observation CubeSat', revision: 4, mission: { altitude: 550e3, inclination: 97.6 },
      tags: ['J2 drift', 'thermal', 'rides on Vireo-2'], badge: '6U · 550 km',
      components: [C('bus', 'bus', { form: '6U', power: 30, mass: 8.4, x: 0.15 }), C('solarArray', 'solarArray', { area: 0.25, mass: 0.8, x: 0.15 }),
        C('thruster', 'thruster', { kind: 'cold gas', isp: 70, mass: 0.6, x: 0.2 }), C('payload', 'payload', { description: 'Multispectral imager', mass: 2.1, x: 0.1 })],
    }),
  ];
}

export const seeds = () => [kestrel(), ...concepts()];
