// Checks for the thermodynamic cycles, rocket systems, turbomachinery design, heat transfer and rotor solvers,
// mostly against worked examples from the Aero 335 propulsion lectures and standard textbook results.
import * as E from '../../core/solvers/heatEngines.js';
import * as X from '../../core/solvers/rocketSystems.js';
import * as T from '../../core/solvers/turboDesign.js';
import * as HT from '../../core/solvers/heatTransfer.js';
import * as RO from '../../core/solvers/rotors.js';
import * as PL from '../../core/solvers/plugNozzle.js';

export function cyclesTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${tol})`);
  // gas properties
  near('γ of a monatomic gas = 5/3', E.dof('He', 300).g, 5 / 3, 1e-12);
  near('γ of N₂ with vibration frozen = 7/5', E.dof('N2', 300, 'frozen').g, 1.4, 1e-12);
  near('γ of N₂ fully excited = 9/7', E.dof('N2', 300, 'classical').g, 9 / 7, 1e-12);
  near('air γ at 300 K ≈ 1.400', E.mixture(E.AIR, { T: 300 }).g, 1.400, 0.002);
  near('air γ at 1500 K ≈ 1.32 (vibration excited)', E.mixture(E.AIR, { T: 1500 }).g, 1.32, 0.01);
  near('lecture 3: 9 mol He + 1 mol N₂, γ = 1.625', E.mixture({ He: 9, N2: 1 }, { mode: 'frozen' }).g, 1.625, 1e-9);
  near('lecture 3: 2 kg He + 1 kg N₂, mole fraction He', E.mixture({ He: 2, N2: 1 }, { by: 'mass', mode: 'frozen' }).X.He, (2 / 4.0026) / (2 / 4.0026 + 1 / 28.0134), 1e-12);
  near('Peng–Robinson: Z → 1 at low pressure', E.pengRobinson('N2', 300, 1e3).Z, 1, 1e-3);
  near('Peng–Robinson: N₂ at 300 K, 20 MPa (NIST 1.03)', E.pengRobinson('N2', 300, 20e6).Z, 1.03, 0.02);
  // piston engines
  const o = E.pistonCycle({ r: 8, T1: 300, q: 1.8e6 });
  near('Otto: cycle efficiency = 1 − r^(1−γ)', o.eta, o.etaFormula, 1e-12);
  near('Otto: imep matches the lecture 5 nondimensional form', o.imepRatio, E.ottoImep(8, o.T3 / 300), 1e-9);
  const d = E.pistonCycle({ kind: 'diesel', r: 18, T1: 300, q: 1.5e6 });
  near('Diesel: cycle efficiency matches the cutoff-ratio formula', d.eta, d.etaFormula, 1e-12);
  const otto18 = E.pistonCycle({ r: 18, T1: 300, q: 1.5e6 });
  log('Diesel less efficient than Otto at the same r', d.eta < otto18.eta, `${d.eta.toFixed(4)} < ${otto18.eta.toFixed(4)}`);
  near('lecture 5: R-1830 air flow at STP, 2700 rpm = 0.82627 kg/s', E.pistonEngine({ rpm: 2700, Vd: 29.978e-3, r: 6.7, T1: 288.15, p1: 101325 }).ma, 0.82627, 0.001);
  const nat = E.boostedEngine({ drive: 'none', r: 8, Vd: 5e-3 }, { p: 50000, T: 250 }), sc = E.boostedEngine({ drive: 'gear', piS: 2, etaS: 0.75, r: 8, Vd: 5e-3 }, { p: 50000, T: 250 });
  log('supercharger raises net power at altitude', sc.Pnet > nat.Pnet, `${(nat.Pnet / 1e3).toFixed(1)} → ${(sc.Pnet / 1e3).toFixed(1)} kW`);
  // Brayton
  const b = E.brayton({ rp: 10, T1: 300, T3: 1400 });
  near('ideal Brayton η = 1 − rp^−(γ−1)/γ', b.eta, b.etaIdeal, 1e-12);
  near('ideal Brayton: back-work ratio = τ·T₁/T₃', b.bwr, 10 ** (0.4 / 1.4) * 300 / 1400, 1e-12);
  near('lecture 7: optimum rp for 1900/300 K', E.brayton({ rp: 10, T1: 300, T3: 1900 }).rpOpt, 25.28, 0.01);
  const opt = E.brayton({ rp: 25.2846, T1: 300, T3: 1900 });
  near('at the optimum, T₂ = T₄', opt.T2 / opt.T4, 1, 1e-4);
  near('at the optimum, w_net/cpT₁ = (√(T₃/T₁) − 1)²', opt.wnetRatio, opt.wmaxRatio, 1e-6);
  const rg = E.brayton({ rp: 4, T1: 300, T3: 1400, eps: 1 });
  near('ideal regenerator: η = 1 − (T₁/T₃)·τ', rg.eta, 1 - 300 / 1400 * 4 ** (0.4 / 1.4), 1e-9);
  const many = E.brayton({ rp: 10, T1: 300, T3: 1400, eps: 1, nC: 60, nT: 60 });
  near('many stages + perfect regenerator approach Ericsson (Carnot)', many.eta, 1 - 300 / 1400, 0.01);
  log('real components lower efficiency', E.brayton({ rp: 10, T1: 300, T3: 1400, etaC: 0.8, etaT: 0.9 }).eta < b.eta, '');
  // Humphrey
  const hm = E.humphrey({ rp: 2, T1: 300, T3: 2194.2 });
  near('lecture 8: Humphrey η = 0.40371', hm.eta, 0.40371, 1e-4);
  near('lecture 8: Humphrey pressure gain p₃/p₂ = 6', hm.p3 / hm.p2, 6, 1e-3);
  near('Humphrey: cycle integration = Heiser–Pratt formula', hm.eta, hm.etaFormula, 1e-12);
  near('lecture 8: Brayton at p₂/p₁ = 2, η = 0.17966', E.brayton({ rp: 2, T1: 300, T3: 2000 }).eta, 0.17966, 1e-4);
}

export function rocketSystemsTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${tol})`);
  const rel = (name, v, ref, tol) => log(name, Math.abs(v / ref - 1) <= tol, `got ${(+v).toPrecision(5)}, reference ${ref} (±${(tol * 100).toFixed(1)}%)`);
  // grain burnback
  const B = X.grainBurnback({ grain: 'tube', D: 0.1, rp: 0.02 });
  rel('tube grain: perimeter 2π(r + y) at mid-web', B.P(0.015), 2 * Math.PI * 0.035, 0.02);
  rel('tube grain: port area π(r + y)² at mid-web', B.Aport(0.015), Math.PI * 0.035 ** 2, 0.02);
  rel('tube grain: web = R − r', B.web, 0.03, 0.03);
  rel('distance transform: area burned reaches the case', B.Aport(B.web), Math.PI * 0.05 ** 2, 1e-9);
  const st = X.grainBurnback({ grain: 'star', D: 0.2, rp: 0.03, ro: 0.07, nPts: 6 });
  log('star grain: initial perimeter longer than a circle of the same port area', st.P(0.001) > 2 * Math.sqrt(Math.PI * st.Aport0), `${st.P(0.001).toFixed(4)} m vs ${(2 * Math.sqrt(Math.PI * st.Aport0)).toFixed(4)} m`);
  // ballistics
  const P = X.SOLID_PROPS.apcp, a = P.rRef / P.pRef ** P.n;
  const M = X.solidMotor({ grain: 'end', D: 0.1, L: 0.5, prop: 'apcp', Dt: 0.01, eps: 5, pa: 0 });
  const Kn = (Math.PI * 0.05 ** 2) / (Math.PI * 0.005 ** 2);
  rel('end burner: Pc = (Kn ρ a c*)^(1/(1−n))', M.Pc[0], (Kn * P.rho * a * P.cstar) ** (1 / (1 - P.n)), 1e-9);
  log('end burner is neutral', M.shape === 'neutral', M.shape);
  rel('end burner: burn time = L / r', M.tb, 0.5 / (a * M.Pc[0] ** P.n), 1e-6);
  rel('impulse = Isp·g₀·propellant mass', M.I, M.Isp * X.G0 * M.mp0, 1e-9);
  near('sonic exit in vacuum: CF = (γ + 1)(2/(γ + 1))^(γ/(γ−1))', X.thrustCoefficient(1.2, 1.0000001, 7e6, 0).CFvac, 2.2 * (2 / 2.2) ** 6, 2e-4);
  const cf = X.thrustCoefficient(1.2, 10, 7e6, 101325);
  near('CF(pa) = CF_vac − ε pa/Pc', cf.CF, cf.CFvac - 10 * 101325 / 7e6, 1e-12);
  // flight and staging
  near('lecture 17: single stage Δv = 4904 m/s', X.stageDv(3048, 2000 / 14000, 1000 / 14000), 4904.9, 1);
  near('stack Δv equals the stage formula', X.stackDv([{ Isp: 3048 / X.G0, ms: 2000, mp: 12000 }], 1000).dv, X.stageDv(3048, 2000 / 14000, 1000 / 14000), 1e-6);
  const sim = X.similarStagesDv(2, 3000, 0.1, 10);
  near('similar stages: payload fraction inverts the Δv formula', X.similarPayloadFraction(2, 3000, 0.1, sim), 0.1, 1e-9);
  const O = X.optimalStaging([{ Isp: 300, eps: 0.1 }, { Isp: 300, eps: 0.1 }], 8000, 1000);
  near('optimal staging: identical stages split Δv equally', O.stages[0].dv - O.stages[1].dv, 0, 1e-6);
  near('optimal staging: payload fraction equals the similar-stage result', O.payloadFrac, X.similarPayloadFraction(2, 300 * X.G0, 0.1, 8000), 1e-9);
  const O2 = X.optimalStaging([{ Isp: 280, eps: 0.08 }, { Isp: 450, eps: 0.12 }], 9000, 1000);
  const perturb = f => { const [a1, b1] = [O2.stages[0].dv * f, 9000 - O2.stages[0].dv * f]; const st1 = { c: 280 * X.G0, e: 0.08 }, st2 = { c: 450 * X.G0, e: 0.12 }; const x = (s, dv) => { const R = Math.exp(dv / s.c); return R * (1 - s.e) / (1 - R * s.e); }; return 1 / (x(st1, a1) * x(st2, b1)); };
  log('optimal staging is a maximum (±2% Δv split is worse)', perturb(1.02) < O2.payloadFrac && perturb(0.98) < O2.payloadFrac, `${O2.payloadFrac.toFixed(5)} vs ${perturb(1.02).toFixed(5)}, ${perturb(0.98).toFixed(5)}`);
  const V = X.verticalFlight({ m0: 1000, mp: 800, F: 30000, Isp: 250, drag: false, varG: false, dt: 0.02 });
  rel('vertical flight: burnout speed = c ln MR − g₀t_b', V.burnout.v, V.closed.vb, 1e-3);
  rel('vertical flight: burnout altitude (closed form)', V.burnout.h, V.closed.hb, 1e-3);
  rel('vertical flight: apogee = h_b + v_b²/2g₀', V.apogee, V.closed.apogee, 1e-3);
  // feed systems
  const fs = { Pc: 100e5, mOx: 200, mFuel: 80, rhoOx: 1141, rhoFuel: 810, fuel: 'RP-1', pTankOx: 3e5, pTankFuel: 3e5 };
  const gg = X.feedSystem({ ...fs, cycle: 'gg' });
  rel('pump power = ṁΔp/(ρη)', gg.Pox, 200 * (120e5 - 3e5) / (1141 * 0.7), 1e-12);
  log('gas generator flow is a few percent', gg.frac > 0.01 && gg.frac < 0.08, `${(gg.frac * 100).toFixed(2)}%`);
  const sc = X.feedSystem({ ...fs, cycle: 'staged' });
  log('staged combustion needs higher pump discharge than a gas generator', sc.ok && sc.Ptot > gg.Ptot, `${(sc.Ptot / 1e6).toFixed(2)} vs ${(gg.Ptot / 1e6).toFixed(2)} MW`);
  const pu = X.pump({ mdot: 200, rho: 1141, dp: 117e5, rpm: 15000, S: 10, pTank: 3.5e5, pVap: 1e5, headM: 10 });
  near('pump head H = Δp/(ρg)', pu.H, 117e5 / (1141 * X.G0), 1e-9);
  near('NPSH available', pu.NPSHa, (3.5e5 + 1141 * X.G0 * 10 - 1e5) / (1141 * X.G0), 1e-9);
  near('impulse turbine: best U/c₀ = cos α/2 gives η = cos²α', X.impulseEta(Math.cos(0.3) / 2, 0.3), Math.cos(0.3) ** 2, 1e-12);
  near('Curtis wheel: best U/c₀ = cos α/4 gives η = cos²α', X.curtisEta(Math.cos(0.3) / 4, 0.3), Math.cos(0.3) ** 2, 1e-12);
}

export function turboDesignTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${tol})`);
  const Z = T.spanTriangles({ kind: 'comp', phi: 0.5, psi: 0.4, R: 0.5, Um: 300, hubTip: 0.6 });
  near('free vortex: same work at hub and tip', Z.hub.work / Z.tip.work, 1, 1e-12);
  near('free vortex: work = ψU²', Z.mean.work, 0.4 * 300 ** 2, 1e-6);
  near('free vortex: R(r) = 1 − (1 − R_m)(r_m/r)²', Z.hub.R, 1 - 0.5 / Z.rh ** 2, 1e-12);
  near('50% reaction: symmetric triangles (α₁ = β₂)', Z.mean.a1, Z.mean.b2, 1e-12);
  const C = T.spanTriangles({ kind: 'comp', phi: 0.5, psi: 0.4, R: 0.5, Um: 300, hubTip: 0.6, law: 'const' });
  near('constant-reaction law keeps R at the hub', C.hub.R, 0.5, 1e-12);
  const tu = T.spanTriangles({ kind: 'turb', phi: 0.6, psi: 2, R: 0, Um: 300 });
  near('impulse turbine with ψ = 2 has no exit swirl', tu.mean.Ct3, 0, 1e-9);
  near('impulse turbine: work = 2U²', tu.mean.work, 2 * 300 ** 2, 1e-6);
  near('zero exit swirl: ψ = 2(1 − R) at R = 0.5', T.zeroSwirlPsi(0.5), 1, 1e-12);
  log('total-to-static efficiency below total-to-total', T.etaTS(0.9, 2e5, 200) < 0.9, T.etaTS(0.9, 2e5, 200).toFixed(4));
  near('Holland–Thake coolant fraction', T.coolingFlow('film', 1700, 1150, 800).frac, 0.025 * (550 / 900) / (1 - 550 / 900), 1e-12);
  const M = T.matching({ piD: 8, thetaD: 4.5 });
  near('matching: design fuel setting returns the design point (π)', M.design.pi, 8, 1e-3);
  near('matching: design point at design corrected flow', M.design.m, 1, 1e-3);
  near('matching: design point at design speed', M.design.n, 1, 1e-3);
  log('matching: throttling back reduces surge margin', M.at(3.2).SM < M.design.SM, `${(M.at(3.2).SM * 100).toFixed(1)}% vs ${(M.design.SM * 100).toFixed(1)}%`);
  log('matching: opening the nozzle raises surge margin', T.matching({ piD: 8, thetaD: 4.5, nozzle: 1.1 }).at(4.5).SM > M.design.SM, '');
}

export function heatTransferTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${tol})`);
  near('lecture 18: copper slab 1 cm, ΔT 100 K → 3.72 MW/m²', HT.conduction({ geom: 'plane', layers: [{ k: 372, t: 0.01 }], inner: { T: 400 }, outer: { T: 300 } }).Q, 3.72e6, 1);
  near('cylinder wall: Q′ = 2πkΔT/ln(r₂/r₁)', HT.conduction({ geom: 'cyl', r0: 0.01, layers: [{ k: 372, t: 0.002 }], inner: { T: 400 }, outer: { T: 300 } }).Q, 2 * Math.PI * 372 * 100 / Math.log(1.2), 1e-6);
  near('sphere wall: Q = 4πkΔT/(1/r₁ − 1/r₂)', HT.conduction({ geom: 'sph', r0: 0.1, layers: [{ k: 1, t: 0.1 }], inner: { T: 400 }, outer: { T: 300 } }).Q, 4 * Math.PI * 100 / (10 - 5), 1e-9);
  const two = HT.conduction({ geom: 'plane', layers: [{ k: 372, t: 0.005 }, { k: 50, t: 0.005 }], inner: { T: 500 }, outer: { T: 300 } });
  near('compound wall: resistances in series', two.Q, 200 / (0.005 / 372 + 0.005 / 50), 1e-6);
  const cv = HT.conduction({ geom: 'plane', layers: [{ k: 1, t: 0.1 }], inner: { Tinf: 400, h: 10 }, outer: { Tinf: 300, h: 10 } });
  near('convection both sides: Q = ΔT/(1/h₁ + L/k + 1/h₂)', cv.Q, 100 / 0.3, 1e-9);
  near('laminar plate: Nu = 0.664 Re^½ Pr^⅓', HT.nusselt('plate', 1e5, 0.7).Nu, 0.664 * Math.sqrt(1e5) * 0.7 ** (1 / 3), 1e-9);
  near('pipe, laminar constant T: Nu = 3.66', HT.nusselt('pipe', 1000, 5).Nu, 3.66, 1e-12);
  near('Gnielinski within 20% of Dittus–Boelter at Re 1e5, Pr 3 (Dittus–Boelter is good to about ±25%)', HT.nusselt('pipe', 1e5, 3).Nu / HT.nusselt('pipe', 1e5, 3).NuDB, 1, 0.2);
  near('Reynolds analogy exact for the laminar plate', HT.convection({ geom: 'plate', V: 2, L: 0.3, Tinf: 300, Ts: 320 }).colburn / HT.convection({ geom: 'plate', V: 2, L: 0.3, Tinf: 300, Ts: 320 }).analogy, 1, 1e-9);
  near('air at 300 K: k = 0.0263 W/mK', HT.fluidProps('air', 300).k, 0.0263, 0.0005);
  near('air at 300 K: Pr = 0.707', HT.fluidProps('air', 300).Pr, 0.707, 0.01);
  near('Wien: band fraction below the peak = 0.250', HT.bandFraction(HT.WIEN / 5800, 5800), 0.25005, 1e-4);
  near('band fraction below λT = 10 000 µm·K = 0.9142', HT.bandFraction(1e-2 / 1000, 1000), 0.91415, 1e-4);
  near('blackbody enclosure: σ(T₁⁴ − T₂⁴)', HT.enclosure({ T1: 400, T2: 300, eps1: 1, eps2: 1 }).q, HT.SIGMA * (400 ** 4 - 300 ** 4), 1e-9);
  near('one shield (ε = 1) between black plates halves the exchange', HT.enclosure({ T1: 400, T2: 300, eps1: 1, eps2: 1, nShields: 1, epsS: 1 }).q / HT.enclosure({ T1: 400, T2: 300, eps1: 1, eps2: 1 }).q, 0.5, 1e-12);
  near('view factor, coaxial disks r = L', HT.VIEW_FACTORS.disks.F({ r1: 1, r2: 1, L: 1 }), 0.38197, 1e-4);
  near('view factor, parallel squares a = b = L', HT.VIEW_FACTORS.plates.F({ a: 1, b: 1, L: 1 }), 0.1998, 2e-4);
  near('view factor, perpendicular squares with a common edge', HT.VIEW_FACTORS.perp.F({ a: 1, b: 1, L: 1 }), 0.2000, 2e-4);
  near('radiative equilibrium of a black plate in sunlight', HT.radiativeEquilibrium(1361, 1), 393.6, 0.5);
}

export function rotorsTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${tol})`);
  const A = RO.actuatorDisk({ T: 1000, D: 2, V: 0 });
  near('hover: vᵢ = √(T/2ρA)', A.vi, Math.sqrt(1000 / (2 * 1.225 * Math.PI)), 1e-9);
  near('hover: P = T^(3/2)/√(2ρA)', A.P, A.Phover, 1e-9);
  const F = RO.actuatorDisk({ T: 1000, D: 2, V: 40 });
  near('forward flight: T = 2ρA vᵢ(V + vᵢ)', 2 * 1.225 * F.A * F.vi * (40 + F.vi), 1000, 1e-6);
  near('ideal efficiency equals 2/(1 + uₑ/u)', F.eta, RO.propulsiveEff(F.ue / 40), 1e-12);
  const g = RO.bladeGeometry({ D: 1.8, B: 2, c75: 0.12, taper: 0.6, pitch: 1.4 });
  const r = RO.bemt(g, { V: 40, rpm: 2400 });
  near('BEMT: η = J C_T / C_P', r.eta, r.J * r.CT / r.CP, 1e-9);
  const tight = RO.bemt(g, { V: 40, rpm: 2400, tolFrac: 1e-9, maxOuter: 1000 });
  near('BEMT: default tolerance within 0.1% of the fully converged thrust', r.T / tight.T, 1, 1e-3);
  log('BEMT: peak efficiency 0.75–0.9 for a typical propeller', (() => { let m = 0; for (let J = 0.2; J < 1.2; J += 0.02) { const q = RO.bemt(g, { V: J * 40 * 1.8, rpm: 2400 }); if (q.eta > m && q.T > 0) m = q.eta; } return m > 0.75 && m < 0.9; })(), '');
  log('BEMT: thrust reverses at high advance ratio (windmilling)', RO.bemt(g, { V: 90, rpm: 2400 }).T < 0, '');
  const rot = RO.bladeGeometry({ D: 7.68, B: 2, c75: 0.18, taper: 1, twist: -8 * Math.PI / 180, collective: 10 * Math.PI / 180 });
  const hv = RO.bemt(rot, { V: 0, rpm: 205 / 3.84 * 30 / Math.PI });
  log('BEMT hover: figure of merit 0.6–0.8', hv.FM > 0.6 && hv.FM < 0.8, hv.FM.toFixed(3));
  const sw = RO.heliSweep(RO.HELIS[0]);
  log('helicopter: power bucket (min power below hover)', sw.minP.P < sw.hover.P && sw.minP.V > 0, `${(sw.minP.P / 1e3).toFixed(1)} vs ${(sw.hover.P / 1e3).toFixed(1)} kW`);
  log('helicopter: best range faster than best endurance', sw.bestRange.V > sw.minP.V, '');
  near('Glauert inflow → W/(2ρAV) at high speed', RO.helicopter(RO.HELIS[0], 80).vi, RO.helicopter(RO.HELIS[0], 0).vh ** 2 / 80, 0.02);
}

export function plugNozzleTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${ref} (±${tol})`);
  for (const g of [1.4, 1.2]) {
    const D = PL.design({ type: 'plug', eps: 10, g });
    near(`Angelino plug (γ ${g}): contour ends on the axis`, D.tip.y, 0, 1e-9);
    near(`Angelino plug (γ ${g}): last Mach line at μe`, Math.atan2(D.cornerY - D.tip.y, D.tip.x), Math.asin(1 / D.Me), 1e-9);
    near(`Angelino plug (γ ${g}): throat line has unit width`, Math.hypot(D.throat.x, D.throat.y - D.cornerY), 1, 1e-6);
  }
  const E = PL.design({ type: 'ed', eps: 10, g: 1.4, rd: 0.5 });
  near('E-D: wall exit height = deflector height + ε', E.tip.y, 5 + 10, 1e-9);
  const D = PL.design({ type: 'plug', eps: 10, g: 1.4 });
  const Od = PL.operating(D, D.pe);
  log('operating at pe is the design regime', Od.regime === 'design', Od.regime);
  near('design: flow at the last Mach line is axial', Od.deltaB, 0, 1e-6);
  near('design: CF equals a fixed nozzle of the same ε', PL.thrustCoefficient(D, D.pe), PL.cfFixed(10, 1.4, D.pe), 1e-9);
  const pbO = 5 * D.pe, Oo = PL.operating(D, pbO);
  log('over-expanded: fan stops early and the boundary turns toward the spike', Oo.regime === 'over' && Oo.Mb < D.Me && Oo.deltaB > 0, `M_b ${Oo.Mb.toFixed(3)}, δ ${(Oo.deltaB * 180 / Math.PI).toFixed(2)}°`);
  log('over-expanded: plug beats a fixed nozzle (altitude compensation)', PL.thrustCoefficient(D, pbO) > PL.cfFixed(10, 1.4, pbO), `${PL.thrustCoefficient(D, pbO).toFixed(4)} vs ${PL.cfFixed(10, 1.4, pbO).toFixed(4)}`);
  const Ou = PL.operating(D, D.pe / 4);
  log('under-expanded: fan continues past Me and turns outward', Ou.Mb > D.Me && Ou.deltaB < 0, '');
  near('under-expanded: same CF as a fixed nozzle', PL.thrustCoefficient(D, D.pe / 4), PL.cfFixed(10, 1.4, D.pe / 4), 1e-9);
  const sMid = PL.stateAt(D, Od, 0.5 * D.tip.x, PL.wallY(D, 0.5 * D.tip.x) + 0.3);
  log('state just above the spike is supersonic gas', sMid && sMid.k === 1 && sMid.M > 1, sMid ? sMid.M.toFixed(3) : 'none');
  log('outside the free boundary is ambient', PL.stateAt(D, Oo, 0.5 * D.tip.x, D.cornerY + 2).k === 2, '');
  log('inside the spike is solid', PL.stateAt(D, Od, 0.5 * D.tip.x, 0.5 * PL.wallY(D, 0.5 * D.tip.x)) === null, '');
}
