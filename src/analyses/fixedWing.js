// The fixed-wing analysis graph: atmosphere, geometry → aero, mass & balance → stability, performance, mission → requirements.
// Each node declares what it reads from the vehicle document and which nodes' outputs it needs.
import { firstOf } from '../model/vehicle.js';
import { evaluateRequirements } from './requirements.js';
import * as A from '../adapters/aircraft.js';
import { reBin, NPANEL } from '../adapters/airfoil.js';
import { AirfoilWorker } from '../workers/client.js';
import { flyMission } from './mission.js';
import { wingMass } from './structures.js';

const DEG = Math.PI / 180;
// never-exceed speed (EAS) for the performance solver: 40 m/s for small aircraft, else 1.25 × the cruise speed
export const vneOf = doc => Math.max(40, 1.25 * (doc.mission?.cruiseSpeed ?? 0));

export const AERO_LEVELS = [
  { id: 'llt', label: 'LLT', note: 'Glauert lifting line: straight wings, quick' },
  { id: 'vlm', label: 'VLM', note: 'Vortex lattice, 24 × 6 panels per side' },
  { id: 'vlm-stall', label: 'VLM + stall', note: 'Adds the nonlinear strip loop for CL,max and where the stall starts' },
];

export const STRUCTURE_LEVELS = [
  { id: 'areal', label: 'areal mass', note: 'Wing mass = structural areal mass × area' },
  { id: 'beam', label: 'beam', note: 'Wing spar sized for bending and shear at 1.5 × the limit load factor, plus skin, ribs and controls per m²' },
];

export const SECTION_LEVELS = [
  { id: 'thin', label: 'thin airfoil', note: 'Thin-airfoil zero lift and moment, handbook cℓ,max, fully turbulent wing skin friction' },
  { id: 'viscous', label: 'viscous', note: 'mfoil viscous panel polars at the wing\'s Reynolds number: cℓ,max and the wing\'s profile drag (free transition, Ncrit 9)' },
];

// one worker for the graph's polars, shared by every workspace (it caches sweeps)
let sharedWorker = null;
const graphWorker = () => (sharedWorker = sharedWorker || new AirfoilWorker());

export function fixedWingNodes({ airfoil = null } = {}) {
  return [
    {
      id: 'atmosphere', label: 'Atmosphere', detail: 'ISA 1976',
      reads: ['mission.altitude', 'mission.dT'], outputs: ['cruise', 'sea'],
      run({ doc }) {
        const z = doc.mission.altitude, dT = doc.mission.dT ?? 0;
        return { cruise: A.atmosphere(z, dT), sea: A.atmosphere(0, dT), z, dT };
      },
    },
    {
      id: 'geometry', label: 'Geometry', detail: 'planform',
      reads: ['wing.*', 'htail.*', 'vtail.*', 'fuselage.*', 'propulsor.diameter', 'propulsor.x'],
      outputs: ['W', 'P', 'span', 'S', 'AR', 'mac', 'xMacLE', 'ht', 'vt', 'fus'],
      run({ doc }) {
        const w = firstOf(doc, 'wing'), ht = firstOf(doc, 'htail'), vt = firstOf(doc, 'vtail'), f = firstOf(doc, 'fuselage');
        if (!w) throw new Error('the vehicle has no wing');
        const W = A.wingOf(w), P = A.Wing.planform(W);
        return {
          W, P, wing: w, span: P.b, S: W.S, AR: W.AR, mac: P.mac, cr: P.cr, ct: P.ct, xLE: w.x, xMacLE: w.x + P.xMac, yMac: P.yMac,
          sweepLE: P.sweepLE, ht: ht && { ...A.surfaceOf(ht.area, ht.aspect), x: ht.x, comp: ht }, vt: vt && { ...A.surfaceOf(vt.area, vt.aspect, 0.5), x: vt.x, comp: vt },
          fus: f ? { L: f.length, d: f.width, lam: f.laminar || 0 } : { L: 0, d: 0, lam: 0 }, prop: firstOf(doc, 'propulsor'),
          root: A.sectionOf(w.rootAirfoil), tip: A.sectionOf(w.tipAirfoil),
        };
      },
    },
    {
      // Section data for the wing's root and tip airfoils. 'thin': thin-airfoil theory and a handbook cℓ,max (instant).
      // 'viscous': an mfoil polar per airfoil at the Reynolds number of the mean chord, run in the airfoil worker.
      id: 'sections', label: 'Sections', after: ['geometry', 'atmosphere'], reads: ['mission.cruiseSpeed'],
      fidelity: { levels: SECTION_LEVELS, value: 'thin' },
      outputs: ['method', 'root', 'tip', 'viscous'],
      run({ doc, inputs, fidelity }) {
        const g = inputs.geometry, atm = inputs.atmosphere.cruise, V = doc.mission.cruiseSpeed;
        if (fidelity !== 'viscous') return { method: 'thin airfoil', viscous: false, root: g.root, tip: g.tip };
        const Re = reBin(atm.rho * V * g.mac / atm.mu), Ma = Math.round(V / atm.a * 100) / 100;
        const codes = [...new Set([g.root.code, g.tip.code])];
        const worker = airfoil || graphWorker();
        return Promise.all(codes.map(code => worker.polar({ code, Re, Ma, ncrit: 9, npanel: NPANEL }))).then(polars => {
          const sec = base => {
            const pol = polars[codes.indexOf(base.code)];
            if (!isFinite(pol.clmax) || !isFinite(pol.cdmin)) throw new Error(`the NACA ${base.code} polar did not converge at Re ${Math.round(Re / 1e3)}k`);
            return { ...base, clmax: pol.clmax, cdmin: pol.cdmin, alpha0Visc: pol.alpha0, polar: pol, Re };
          };
          return { method: 'mfoil viscous', viscous: true, root: sec(g.root), tip: sec(g.tip), Re };
        });
      },
    },
    {
      id: 'aero', label: 'Aero', after: ['geometry', 'atmosphere', 'sections'], reads: ['mission.cruiseSpeed', 'rotor.count', 'rotor.radius'],
      fidelity: { levels: AERO_LEVELS, value: 'vlm' },
      outputs: ['CLa', 'alphaL0', 'eInv', 'e', 'xac', 'xacAbs', 'Cm0', 'CLmax', 'CD0', 'spanLoad'],
      run({ doc, inputs, fidelity }) {
        const g = inputs.geometry, atm = inputs.atmosphere.cruise, V = doc.mission.cruiseSpeed, M = V / atm.a;
        const sec = inputs.sections, visc = sec.viscous;
        const lin = A.wingAero(g.W, { M, method: fidelity === 'llt' ? 'llt' : 'vlm' });
        // CL,max: 0.9·cl,max·cos Λ for the linear levels, the nonlinear strip loop for 'vlm-stall'; the section
        // cl,max is the handbook value or, with viscous sections, the peak of the mfoil polar
        let CLmax = 0.9 * Math.min(sec.root.clmax, sec.tip.clmax) * Math.cos(g.W.sweep * DEG), stall = null;
        let clSource = visc ? 'viscous 0.9·cℓ,max' : 'handbook 0.9·cℓ,max';
        if (fidelity === 'vlm-stall') { stall = A.wingStall(g.W, { M, sections: { root: sec.root, tip: sec.tip } }); CLmax = stall.CLmax; clSource = visc ? 'strips + viscous cℓ,max' : 'nonlinear strips'; }
        // parasite drag
        const rePerM = atm.rho * V / atm.mu, f = g.fus, parts = [];
        const exposed = Math.max(0, 1 - f.d / g.span);
        // the wing: Raymer's turbulent flat plate × form factor, or the viscous sections' minimum drag over the exposed area
        const fixed = [];
        if (visc) fixed.push({ name: 'Wing (viscous section cd,min)', CD: (sec.root.cdmin + sec.tip.cdmin) / 2 * exposed * Math.cos(g.W.sweep * DEG) ** 0.28 });
        else parts.push({ name: 'Wing', Swet: 2 * g.S * exposed * (1 + 0.2 * g.root.tc), len: g.mac, FF: A.wingFF(g.root.tc, g.W.sweep), Q: 1, lam: g.wing.laminar || 0 });
        if (g.ht) parts.push({ name: 'Horizontal tail', Swet: 2.04 * g.ht.S, len: g.ht.mac, FF: A.wingFF(0.10, g.ht.comp.sweep), Q: 1.05, lam: g.ht.comp.laminar || 0 });
        if (g.vt) parts.push({ name: 'Fin', Swet: 2.04 * g.vt.S, len: g.vt.mac, FF: A.wingFF(0.10, g.vt.comp.sweep), Q: 1.05, lam: g.vt.comp.laminar || 0 });
        if (f.L > 0) parts.push({ name: 'Fuselage', Swet: 0.8 * Math.PI * f.d * f.L, len: f.L, FF: A.bodyFF(f.L / f.d), Q: 1, lam: f.lam });
        // stopped lift rotors (eVTOL): blades, hubs and their share of the booms, as a flat-plate area of 0.012·R² + 0.02 m²
        // per rotor (about 0.05 m² for a 1.6 m rotor)
        const lr = firstOf(doc, 'rotor');
        if (lr) fixed.push({ name: `Stopped lift rotors and booms (${lr.count})`, CD: Math.round(lr.count) * (0.012 * lr.radius ** 2 + 0.02) / g.S });
        const drag = A.zeroLiftDrag({ S: g.S, parts, rePerM, M, fixed });
        return {
          method: lin.method, CLa: lin.CLa, alphaL0: lin.alphaL0, eInv: lin.e, e: A.oswald(lin.e, g.AR, drag.CD0),
          xac: lin.xac, xacAbs: g.xMacLE + lin.xac * g.mac, Cm0: lin.Cm0, CLmax, clSource, stall,
          CD0: drag.CD0, drag: drag.items, Re: rePerM * g.mac, M, spanLoad: lin.spanLoad,
        };
      },
    },
    {
      id: 'mass', label: 'Mass & balance', detail: 'build-up', after: ['geometry'],
      reads: ['*.mass', '*.x', 'wing.arealMass', 'mission.ballast'], outputs: ['total', 'xcg', 'h', 'items', 'I'],
      fidelity: { levels: STRUCTURE_LEVELS, value: 'areal' },
      run({ doc, inputs, fidelity }) {
        const g = inputs.geometry, items = [];
        const others = doc.components.reduce((s, c) => s + (c.type !== 'wing' && typeof c.mass === 'number' ? c.mass : 0), 0) + (doc.mission?.ballast > 0 ? doc.mission.ballast : 0);
        let structure = null;
        for (const c of doc.components) {
          if (c.type === 'wing') { const wm = wingMass({ wing: c, g, others, level: fidelity }); structure = wm; items.push({ id: c.id, name: c.name, mass: wm.mass, x: g.xMacLE + 0.4 * g.mac, derived: true }); }
          else if (typeof c.mass === 'number') items.push({ id: c.id, name: c.name, mass: c.mass, x: c.x ?? 0 });
        }
        // water ballast (sailplanes) in wing tanks, at the wing's own CG
        if (doc.mission?.ballast > 0) items.push({ id: 'ballast', name: 'Water ballast', mass: doc.mission.ballast, x: g.xMacLE + 0.4 * g.mac, derived: true });
        const total = items.reduce((s, i) => s + i.mass, 0);
        if (!(total > 0)) throw new Error('total mass is zero');
        const xcg = items.reduce((s, i) => s + i.mass * i.x, 0) / total;
        // inertias from Raymer's nondimensional radii of gyration (single-engine propeller aircraft)
        const b = g.span, L = g.fus.L || b / 2;
        const I = [total * (b * 0.25) ** 2 / 4, total * (L * 0.38) ** 2 / 4, total * ((b + L) / 2 * 0.39) ** 2 / 4];
        return { total, xcg, h: (xcg - g.xMacLE) / g.mac, items, I, structure, method: fidelity === 'beam' ? 'beam' : 'areal' };
      },
    },
    {
      id: 'stability', label: 'Stability', detail: 'modes', after: ['geometry', 'aero', 'mass', 'atmosphere'], reads: ['mission.cruiseSpeed'],
      outputs: ['SM', 'xnp', 'hn', 'trim', 'sp', 'ph', 'dr', 'roll', 'spiral', 'hq', 'spZeta', 'drZeta'],
      run({ doc, inputs }) {
        const g = inputs.geometry, ae = inputs.aero, m = inputs.mass, atm = inputs.atmosphere;
        if (!g.ht || !g.vt) throw new Error('needs a horizontal tail and a fin');
        const id = 'works:' + doc.id;
        const ac = A.perfAircraft(id, { S: g.S, b: g.span, e: ae.e, CD0: ae.CD0, CLa: ae.CLa, CLmax: ae.CLmax, mass: m.total, power: g.prop ? g.prop.power : 0, propEff: g.prop ? g.prop.propEff : 0.8, vne: vneOf(doc) });
        const geom = {
          c: g.mac, sweep: g.W.sweep, taper: g.W.taper, dihedral: g.W.dihedral, wing: g.wing.position, L: g.fus.L, wf: g.fus.d, xw: g.fus.L ? (g.xLE + g.cr / 4) / g.fus.L : 0.3,
          ht: { S: g.ht.S, AR: g.ht.AR, l: g.ht.x - ae.xacAbs, eta: g.ht.comp.efficiency, tau: g.ht.comp.tau, sweep: g.ht.comp.sweep },
          vt: { S: g.vt.S, AR: g.vt.AR, l: g.vt.x - m.xcg, z: g.vt.comp.height, sweep: g.vt.comp.sweep },
          ail: [0.5, 0.92, 0.42], rud: 0.5, CL0: ae.CLa * (-ae.alphaL0 * DEG), Cmac: ae.Cm0, cg: [0.10, 0.40, 0.25], mI: m.total, I: [...m.I, 0],
        };
        A.registerAircraft(ac, geom);
        const r = A.stabilityOf(id, { mass: m.total, z: atm.z, dT: atm.dT, V: doc.mission.cruiseSpeed, cg: m.h });
        const d = r.d, L = r.L, Lt = r.Lt;
        return {
          SM: (d.hn - d.h) * 100, hn: d.hn, xnp: g.xMacLE + d.hn * g.mac, CLtrim: d.CLtrim,
          trim: { alpha: r.trim.alpha / DEG, de: r.trim.de / DEG }, it: r.it / DEG,
          sp: L.sp, ph: L.ph, dr: Lt.dr, roll: Lt.roll, spiral: Lt.spiral, hq: r.hq,
          spZeta: L.sp.real ? NaN : L.sp.zeta, drZeta: Lt.dr ? Lt.dr.zeta : NaN,
          roots: { lon: L.roots, lat: Lt.roots }, VH: d.VH, VV: d.VV, deriv: d,
          // for Pilot: the solver id the aircraft is registered under, and the full analysis (state matrices)
          solverId: id, an: r, z: atm.z, dT: atm.dT, mass: m.total, cg: m.h,
        };
      },
    },
    {
      id: 'performance', label: 'Performance', detail: 'endurance', after: ['geometry', 'aero', 'mass', 'atmosphere'],
      reads: ['mission.cruiseSpeed', 'propulsor.*', 'battery.*'],
      outputs: ['Vs', 'LDmax', 'RoC', 'endurance', 'range', 'cruise', 'curve'],
      run({ doc, inputs }) {
        const g = inputs.geometry, ae = inputs.aero, m = inputs.mass, atm = inputs.atmosphere.cruise;
        const prop = firstOf(doc, 'propulsor'), bat = firstOf(doc, 'battery');
        if (!prop || !bat) throw new Error('needs a motor and a battery');
        const ac = A.perfAircraft('works:' + doc.id, { S: g.S, b: g.span, e: ae.e, CD0: ae.CD0, CLa: ae.CLa, CLmax: ae.CLmax, mass: m.total, power: prop.power, propEff: prop.propEff, vne: vneOf(doc) });
        const W = m.total * A.G0, sp = A.Perf.speeds(ac, atm, W, 'max');
        const st = V => A.Perf.state(ac, atm, V, W, 'max');
        const etaProp = V => prop.propEff * Math.tanh(Math.max(V, 1e-3) / ac.Vstar);
        const Pel = V => st(V).Preq / (etaProp(V) * prop.motorEff);
        const E = bat.energy * bat.usable * 3600;             // J
        const Vmin = 1.2 * sp.Vs, Vtop = isFinite(sp.Vmax) ? Math.max(sp.Vmax, Vmin * 1.05) : Vmin * 2.5;
        let best = { P: Infinity }, far = { r: 0 };
        for (let i = 0; i <= 300; i++) {
          const V = Vmin + (Vtop - Vmin) * i / 300, P = Pel(V);
          if (P < best.P) best = { V, P };
          if (V / P > far.r) far = { V, P, r: V / P };
        }
        const Vc = doc.mission.cruiseSpeed, sc = st(Vc), Pc = Pel(Vc);
        const curve = [];
        for (let i = 0; i <= 60; i++) { const V = sp.Vs * 0.98 + (Vtop * 1.08 - sp.Vs * 0.98) * i / 60, s = st(V); curve.push({ V, Preq: s.Preq, Pav: s.Pav, Pel: Pel(V) }); }
        return {
          Vs: sp.Vs, Vmd: sp.Vmd, Vmp: sp.Vmp, Vy: sp.Vy, Vmax: sp.Vmax, LDmax: sp.LDmax, RoC: sp.RoCmax,
          Vend: best.V, Pend: best.P, endurance: E / best.P / 60, Vrange: far.V, range: E * far.r / 1000,
          cruise: { V: Vc, CL: sc.CL, LD: sc.LD, P: Pc, endurance: E / Pc / 60, range: E / Pc * Vc / 1000, stalled: sc.stalled, alpha: sc.CL / ae.CLa / DEG + ae.alphaL0 },
          curve, E: E / 3600, Vmin,
        };
      },
    },
    {
      // The mission profile (doc.mission.segments) flown segment by segment: time, distance and battery energy
      id: 'mission', label: 'Mission', detail: 'profile', after: ['geometry', 'aero', 'mass', 'atmosphere'],
      reads: ['mission.segments', 'mission.dT', 'mission.fieldElevation', 'mission.hotelPower', 'propulsor.*', 'battery.*', 'rotor.*'],
      outputs: ['segments', 'track', 'energy', 'usable', 'margin', 'duration', 'distance', 'feasible'],
      run({ doc, inputs, rotorFM }) {
        const g = inputs.geometry, ae = inputs.aero, m = inputs.mass;
        const prop = firstOf(doc, 'propulsor'), bat = firstOf(doc, 'battery');
        if (!prop || !bat) throw new Error('needs a motor and a battery');
        const lift = firstOf(doc, 'rotor'), rotor = lift ? { ...lift, figureOfMerit: rotorFM ?? lift.figureOfMerit } : null;
        const ac = A.perfAircraft('works:' + doc.id, { S: g.S, b: g.span, e: ae.e, CD0: ae.CD0, CLa: ae.CLa, CLmax: ae.CLmax, mass: m.total, power: prop.power, propEff: prop.propEff, vne: vneOf(doc) });
        return flyMission({ segments: doc.mission.segments || [], ac, W: m.total * A.G0, motorEff: prop.motorEff, usable: bat.energy * bat.usable, dT: doc.mission.dT ?? 0,
          field: doc.mission.fieldElevation ?? 0, hotel: doc.mission.hotelPower ?? 0, pack: { voltage: bat.voltage, resistance: bat.resistance }, rotor });
      },
    },
    {
      id: 'requirements', label: 'Requirements', after: ['geometry', 'aero', 'mass', 'stability', 'performance', 'mission'], reads: ['requirements.*'],
      outputs: ['list', 'met', 'total'],
      run({ doc, inputs }) {
        const list = evaluateRequirements(doc.requirements || [], inputs);
        return { list, met: list.filter(r => r.status === 'met').length, marginal: list.filter(r => r.status === 'marginal').length, failing: list.filter(r => r.status === 'fail').length, total: list.length };
      },
    },
  ];
}
