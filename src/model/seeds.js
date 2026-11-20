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
      altitude: 400, dT: 0, cruiseSpeed: 22, fieldElevation: 0, hotelPower: 30,
      segments: [
        G('climb', 's1', { name: 'Climb out', to: 400 }),
        G('cruise', 's2', { name: 'Transit to site', distance: 18, speed: 22, wind: 4 }),
        G('loiter', 's3', { name: 'Survey grid', time: 48, speed: 21 }),
        G('cruise', 's4', { name: 'Transit home', distance: 18, speed: 22, wind: -4 }),
        G('descent', 's5', { name: 'Descent', to: 0 }),
        G('reserve', 's6', { name: 'Reserve', time: 10 }),
      ],
    },
    components: [
      C('fuselage', 'fuselage', { name: 'Fuselage', length: 1.65, width: 0.16, mass: 4.2, x: 0.78 }),
      C('wing', 'wing', { name: 'Wing', span: 3.2, rootChord: 0.36, taper: 0.6, sweep: 0, twist: -2, dihedral: 3, rootAirfoil: '4415', tipAirfoil: '4415', x: 0.52, position: 'high', arealMass: 3.4, skinMass: 3.32 }),
      C('htail', 'htail', { name: 'Horizontal tail', area: 0.16, aspect: 4.5, sweep: 5, x: 1.55, efficiency: 0.9, tau: 0.5, mass: 0.55 }),
      C('vtail', 'vtail', { name: 'Fin & rudder', area: 0.1, aspect: 1.6, sweep: 25, x: 1.58, height: 0.2, mass: 0.35 }),
      C('propulsor', 'propulsor', { name: 'Motor & 18×10 prop', power: 1500, propEff: 0.78, motorEff: 0.88, diameter: 0.457, mass: 1.6, x: 0.06 }),
      C('battery', 'battery', { name: 'Battery 6S', energy: 888, usable: 0.85, chemistry: 'Li-ion 6S', mass: 4.9, x: 0.62, voltage: 21.6, resistance: 0.012 }),
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
      id: 'halcyon', name: 'Halcyon', class: 'rotorcraft', role: 'Lift + cruise eVTOL', status: 'active', revision: 9, branch: 'main',
      mission: {
        altitude: 450, dT: 0, cruiseSpeed: 60, fieldElevation: 0, hotelPower: 1500,
        segments: [
          G('hover', 's1', { name: 'Vertical takeoff and transition', duration: 60, climb: 50 }),
          G('climb', 's2', { name: 'Climb', to: 450 }),
          G('cruise', 's3', { name: 'Cruise', distance: 50, speed: 60 }),
          G('descent', 's4', { name: 'Descent', to: 50 }),
          G('hover', 's5', { name: 'Transition and vertical landing', duration: 75, climb: -50 }),
          G('reserve', 's6', { name: 'Reserve', time: 15 }),
        ],
      },
      components: [
        C('fuselage', 'fuselage', { name: 'Cabin & fuselage', length: 8.2, width: 1.5, mass: 380, x: 3.9 }),
        C('wing', 'wing', { name: 'Wing', span: 12, rootChord: 1.8, taper: 0.7, sweep: 0, twist: -2, dihedral: 2, rootAirfoil: '4415', tipAirfoil: '4412', x: 3.3, position: 'high', arealMass: 9, skinMass: 8.0 }),
        C('htail', 'htail', { name: 'Horizontal tail', area: 3.2, aspect: 4.5, sweep: 10, x: 7.7, efficiency: 0.9, tau: 0.5, mass: 30 }),
        C('vtail', 'vtail', { name: 'Fin & rudder', area: 1.9, aspect: 1.5, sweep: 30, x: 7.8, height: 0.9, mass: 20 }),
        C('rotor', 'rotor', { name: 'Lift rotors & booms', count: 4, radius: 1.6, blades: 3, tipSpeed: 160, figureOfMerit: 0.72, solidity: 0.14, twist: -12, motorEff: 0.92, mass: 190, x: 3.9 }),
        C('propulsor', 'propulsor', { name: 'Cruise motor & pusher prop', power: 160000, propEff: 0.84, motorEff: 0.94, diameter: 2.1, mass: 45, x: 8.1 }),
        C('battery', 'battery', { name: 'Battery 92 kWh', energy: 92000, usable: 0.9, chemistry: 'Li-ion NMC', mass: 520, x: 2.9, voltage: 800, resistance: 0.05 }),
        C('payload', 'payload', { name: 'Pilot & 3 passengers', description: 'Four occupants with baggage', mass: 400, x: 2.9 }),
        C('avionics', 'avionics', { name: 'Avionics & flight control', mass: 40, x: 1.4 }),
        C('systems', 'systems', { name: 'Gear, thermal, wiring', description: 'Skids, battery thermal management, high-voltage wiring', mass: 140, x: 3.4 }),
      ],
      requirements: [
        R('R-01', 'Mission energy left after a 15-min reserve', 'mission.margin', '>=', 5, '% usable', 'Mission'),
        R('R-02', 'Hover power (battery)', 'hover.kW', '<=', 480, 'kW', 'Hover'),
        R('R-03', 'Disk loading', 'hover.diskLoadingKg', '<=', 70, 'kg/m²', 'Hover'),
        R('R-04', 'Wing-borne stall speed (transition)', 'performance.Vs', '<=', 38, 'm/s', 'Transition'),
        R('R-05', 'Maximum level speed', 'performance.Vmax', '>=', 65, 'm/s', 'Cruise'),
        R('R-06', 'Static margin, minimum', 'stability.SM', '>=', 5, '% MAC', 'Stability'),
        R('R-07', 'Static margin, maximum', 'stability.SM', '<=', 25, '% MAC', 'Stability'),
        R('R-08', 'Maximum takeoff mass', 'mass.total', '<=', 2300, 'kg', 'Mass'),
        R('R-09', 'Span (vertiport gate)', 'geometry.span', '<=', 12.5, 'm', 'Geometry'),
      ],
    }),
    base({
      id: 'vireo-2', name: 'Vireo-2', class: 'launch-vehicle', role: 'Two-stage small launcher', status: 'active', revision: 52, branch: 'main',
      mission: { orbit: '500 km SSO', orbitAltitude: 500, inclination: 97.4, latitude: 34.7, payload: 300, stage1Angle: 22 },
      components: [
        C('fairing', 'fairing', { name: 'Payload fairing', diameter: 1.2, mass: 90, x: 1 }),
        C('stage', 'stage2', { name: 'Stage 2', dry: 360, propellant: 3400, diameter: 1.2, length: 4.8, x: 3.5 }),
        C('rocketEngine', 'engine2', { name: 'Stage 2 engine (vacuum)', count: 1, cycle: 'gas generator', propellants: 'LOX / RP-1', thrustSL: 0, thrustVac: 32e3, isp: 348, mass: 60, x: 8 }),
        C('stage', 'stage1', { name: 'Stage 1', dry: 2050, propellant: 22900, diameter: 1.8, length: 15, x: 9 }),
        C('rocketEngine', 'engine1', { name: 'Stage 1 engines', count: 9, cycle: 'gas generator', propellants: 'LOX / RP-1', thrustSL: 43e3, thrustVac: 48.8e3, isp: 311, mass: 85, x: 23.5 }),
      ],
      requirements: [
        R('R-01', 'Payload to 500 km SSO', 'orbit.payloadCapacity', '>=', 300, 'kg', 'Mission'),
        R('R-02', 'Liftoff thrust-to-weight', 'stack.TW', '>=', 1.25, '', 'Propulsion'),
        R('R-03', 'Stage 2 thrust-to-weight at ignition', 'stack.upperTW', '>=', 0.7, '', 'Propulsion'),
        R('R-04', 'Maximum dynamic pressure', 'ascent.qmaxKPa', '<=', 45, 'kPa', 'Loads'),
        R('R-05', 'Peak acceleration', 'ascent.gmax', '<=', 7, 'g', 'Loads'),
        R('R-06', 'Liftoff mass (pad limit)', 'stack.liftoff', '<=', 30000, 'kg', 'Mass'),
      ],
    }),
    base({
      id: 'tern', name: 'Tern', class: 'sailplane', role: '18 m class sailplane', status: 'active', revision: 6, branch: 'main',
      mission: { altitude: 1200, dT: 0, cruiseSpeed: 28, climbRate: 1.5, ballast: 0 },
      components: [
        C('fuselage', 'fuselage', { name: 'Fuselage & cockpit', length: 6.8, width: 0.62, mass: 115, x: 2.65, laminar: 0.3 }),
        C('wing', 'wing', { name: 'Wing', span: 18, rootChord: 0.9, taper: 0.4, sweep: 0, twist: -1.5, dihedral: 3, rootAirfoil: '2412', tipAirfoil: '2410', x: 2.15, position: 'mid', arealMass: 17, laminar: 0.6, flaps: 'camber', loadFactor: 5.3, skinMass: 14.43 }),
        C('htail', 'htail', { name: 'Horizontal tail', area: 0.9, aspect: 6.5, sweep: 5, x: 6.35, efficiency: 0.95, tau: 0.5, mass: 7, laminar: 0.5 }),
        C('vtail', 'vtail', { name: 'Fin & rudder', area: 1.0, aspect: 1.4, sweep: 20, x: 6.4, height: 0.75, mass: 7, laminar: 0.5 }),
        C('payload', 'pilot', { name: 'Pilot & parachute', description: 'Pilot, parachute and oxygen', mass: 95, x: 1.65 }),
        C('avionics', 'avionics', { name: 'Instruments & radio', mass: 6, x: 1.0 }),
        C('systems', 'systems', { name: 'Gear, controls, tow hook', description: 'Retractable gear, control runs, tow hook', mass: 22, x: 2.3 }),
      ],
      requirements: [
        R('R-01', 'Best glide ratio', 'glide.LDmax', '>=', 44, '', 'Performance'),
        R('R-02', 'Minimum sink rate', 'glide.minSink', '<=', 0.6, 'm/s', 'Performance'),
        R('R-03', 'Cross-country speed at 1.5 m/s climbs', 'glide.xcSpeed', '>=', 78, 'km/h', 'Performance'),
        R('R-04', 'Stall speed, 1 g', 'glide.Vs', '<=', 23.5, 'm/s', 'Field'),
        R('R-05', 'Static margin, minimum', 'stability.SM', '>=', 5, '% MAC', 'Stability'),
        R('R-06', 'Static margin, maximum', 'stability.SM', '<=', 25, '% MAC', 'Stability'),
        R('R-07', 'Maximum takeoff mass (18 m class)', 'mass.total', '<=', 600, 'kg', 'Mass'),
        R('R-08', 'Wingspan (18 m class)', 'geometry.span', '<=', 18, 'm', 'Geometry'),
      ],
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
