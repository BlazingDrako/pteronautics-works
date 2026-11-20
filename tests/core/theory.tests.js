// Classical aerodynamic theory checks: thin-airfoil theory (NACA zero-lift angles, a piecewise camber line against
// a worked example, flaps, inverse design), the discrete-vortex and vortex-panel methods, the Joukowski airfoil,
// boundary layers (Falkner–Skan table values, momentum-integral profiles, Thwaites, the law of the wall, plate
// friction), linearized compressible flow (critical Mach number, ramp in a duct) and Biot–Savart kernels.
import * as T from '../../core/solvers/airfoilTheory.js';
import * as B from '../../core/solvers/boundaryLayer.js';
import * as Lz from '../../core/solvers/linearized.js';
import * as Wg from '../../core/solvers/wing.js';
import { obliqueShock, betaFromTheta } from '../../core/solvers/gasdyn.js';

export function theoryTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(6)}, expected ${(+ref).toPrecision(6)} (±${tol})`);
  const PI = Math.PI, D = PI / 180;

  // ---- thin-airfoil theory ----
  const t4 = T.thinAirfoil(T.camberNACA4(0.02, 0.4), 4 * D);
  near('NACA 2412: α_L=0 = −2.077° (thin-airfoil theory)', t4.alphaL0 / D, -2.077, 0.003);
  near('NACA 2412: cl = 2π(α − α_L=0) at 4°', t4.cl, 2 * PI * (4 + 2.0772) * D, 1e-4);
  near('NACA 2412: Cm,c/4 ≈ −0.053', t4.cmc4, -0.0531, 5e-4);
  near('NACA 23012: design (ideal) cl = 0.3', T.thinAirfoil(T.camberNACA5('23012'), 0).clIdeal, 0.3, 0.003);
  const pw = T.thinAirfoil(T.camberPiecewise([[0, 0], [0.25, 0.1], [0.5, 0.1], [0.75, 0.06], [1, 0]]), 2 * D);
  near('piecewise camber (0.1, 0.1, 0.06 at the quarter points), α = 2°: cl = 1.203', pw.cl, 1.203, 5e-4);
  near('…center of pressure 0.4317c', pw.xcp, 0.43166, 5e-5);
  near('…stability margin −18.2%', pw.margin * 100, -18.17, 0.05);
  const pc = T.camberPiecewise([[0, 0], [0.25, 0.1], [0.5, 0.1], [0.75, 0.06], [1, 0]]);
  const pn = T.thinAirfoil({ z: pc.z, dz: pc.dz }, 2 * D, { n: 20000 });
  near('exact segment integrals agree with quadrature', pn.cl, pw.cl, 2e-4);
  const xh = 0.75, th = Math.acos(1 - 2 * xh), fl = T.thinAirfoil(T.camberFlap(xh, 0.01), 0);
  near('flap: Δcl/δ = 2(π − θh + sin θh)', fl.cl / Math.tan(0.01), 2 * (PI - th + Math.sin(th)), 1e-9);
  near('parabolic arc: α_L=0 = −2h', T.thinAirfoil(T.camberParabolic(0.04), 0).alphaL0, -0.08, 1e-6);
  near('parabolic arc: Cm,c/4 = −πh', T.thinAirfoil(T.camberParabolic(0.04), 0).cmc4, -PI * 0.04, 1e-6);
  const ds = T.designCubic(0.5, 0.01, 2 * D), td = T.thinAirfoil(ds.camber, 2 * D);
  log('inverse design hits cl and a reflexed Cm,c/4 > 0', Math.abs(td.cl - 0.5) < 1e-9 && Math.abs(td.cmc4 - 0.01) < 1e-9, `cl ${td.cl.toFixed(6)}, cm ${td.cmc4.toFixed(6)}`);

  // ---- discrete vortices and panels ----
  near('one discrete vortex (1/4–3/4 rule): flat-plate cl = 2π sin α exactly', T.lumpedVortex(T.camberNACA4(0, 0), 6 * D, 1).cl, 2 * PI * Math.sin(6 * D), 1e-12);
  near('160 discrete vortices converge to thin-airfoil cl (NACA 2412)', T.lumpedVortex(T.camberNACA4(0.02, 0.4), 4 * D, 160, { spacing: 'cosine' }).cl, t4.cl, 0.003);
  const g0 = T.nacaPanels('0012', 200), v0 = T.vortexPanels(g0.X, g0.Y, 0);
  near('vortex panels: NACA 0012 at α = 0 has no lift', v0.cl, 0, 1e-9);
  const v5 = T.vortexPanels(g0.X, g0.Y, 5 * D);
  log('vortex panels: NACA 0012 lift slope ≈ 2π(1 + 0.77t/c)', Math.abs(v5.cl / (5 * D) / (2 * PI) - 1.09) < 0.025, `cl/α = ${(v5.cl / (5 * D) / (2 * PI)).toFixed(4)} × 2π`);
  near('vortex panels: circulation lift = pressure-integrated lift', v5.cl, v5.clPressure, 0.01);
  // ---- Joukowski ----
  const jp = T.joukowski({ mx: 0, my: 0, alpha: 5 * D });
  near('Joukowski: a centered circle is a flat plate, cl = 2π sin α', jp.cl, 2 * PI * Math.sin(5 * D), 1e-9);
  const jk = T.joukowski({ mx: -0.1, my: 0.1, alpha: 5 * D });
  near('Joukowski: pressure-integrated lift = Kutta–Joukowski lift', jk.clPressure, jk.cl, 2e-3);
  near('Joukowski: zero-lift angle −β', T.joukowski({ mx: -0.1, my: 0.1, alpha: -jk.beta }).cl, 0, 1e-9);

  // ---- boundary layers ----
  const bl = B.falknerSkan(0);
  near('Blasius: f″(0) = 0.4696 (f‴ + ff″ = 0 form)', bl.fpp0, 0.46960, 2e-5);
  near('Blasius: δ*√(Ue/νx) = 1.7208', bl.dstar, 1.7208, 5e-4);
  near('Blasius: θ√(Ue/νx) = 0.664', bl.theta, 0.6641, 5e-4);
  near('Blasius: δ99 = 4.91 x/√Re', bl.d99, 4.91, 0.01);
  near('Blasius: cf√Re = 0.664', bl.cfRe, 0.6641, 5e-4);
  near('Falkner–Skan β = 1 (stagnation): f″(0) = 1.2326', B.falknerSkan(1).fpp0, 1.2326, 2e-4);
  near('Falkner–Skan β = 0.5: f″(0) = 0.9277', B.falknerSkan(0.5).fpp0, 0.9277, 2e-4);
  near('Falkner–Skan β = −0.1: f″(0) = 0.3193', B.falknerSkan(-0.1).fpp0, 0.3193, 2e-4);
  log('Falkner–Skan β = −0.1988: separation, f″(0) ≈ 0, H ≈ 4.0', B.falknerSkan(-0.1988).fpp0 < 0.01 && Math.abs(B.falknerSkan(-0.1988).H - 4.03) < 0.06, `f″(0) ${B.falknerSkan(-0.1988).fpp0.toFixed(4)}, H ${B.falknerSkan(-0.1988).H.toFixed(3)}`);
  const quart = B.assumedProfile(B.PROFILES.find(p => p.id === 'quartic').F);
  near('Pohlhausen quartic profile: δ√Re/x = 5.84', quart.delta, 5.836, 0.005);
  near('parabolic profile: cf√Re = 0.730', B.assumedProfile(B.PROFILES.find(p => p.id === 'parabolic').F).cfRe, 0.7303, 5e-4);
  const nu = 1e-6, tp = B.thwaites(() => 1, 0, 1, nu);
  near('Thwaites, flat plate: θ = 0.671√(νx/U)', tp.theta.at(-1) / Math.sqrt(nu), Math.sqrt(0.45), 1e-4);
  near('Thwaites, Howarth ue = 1 − x: separation at x = 0.123', B.thwaites(x => 1 - x, 0, 0.3, nu).sep, 0.123, 0.002);
  near('Thwaites, stagnation flow: θ = 0.275√(ν/a)', B.thwaites(x => x, 0, 1, nu).theta[1000] / Math.sqrt(nu), Math.sqrt(0.075), 2e-3);
  near('law of the wall: u⁺ = y⁺ in the sublayer', B.spalding(2), 2, 0.05);
  near('law of the wall: log law at y⁺ = 1000', B.spalding(1000), Math.log(1000) / 0.41 + 5, 1e-3);
  near('plate friction: transition correction A ≈ 1700 at Re_tr = 5×10⁵', B.plateCf(1e7, 5e5).A, 1742, 5);

  // ---- linearized compressible flow ----
  near('Cp* at M = 0.8', Lz.cpStar(0.8), -0.4346, 1e-4);
  const mpg = Lz.criticalMach(-0.43, 'pg');
  near('Prandtl–Glauert critical Mach: Cp₀/β = Cp* there', Lz.RULES.pg.cp(-0.43, mpg), Lz.cpStar(mpg), 1e-8);
  log('critical Mach: Kármán–Tsien below Prandtl–Glauert', Lz.criticalMach(-0.43, 'kt') < mpg, `${Lz.criticalMach(-0.43, 'kt').toFixed(4)} < ${mpg.toFixed(4)}`);
  near('cylinder (Cp₀ = −3): Kármán–Tsien critical Mach ≈ 0.40', Lz.criticalMach(-3, 'kt'), 0.395, 0.01);
  const duct = Lz.rampInDuct({ M1: 2, theta: 5 * D, H: 1, L: 6 }), os = obliqueShock(2, betaFromTheta(2, 5 * D, 1.4), 1.4);
  near('ramp in a duct: first region is the exact oblique shock', duct.regions[1].p, os.p2_p1, 1e-12);
  near('ramp in a duct: linear Cp = 2θ/√(M² − 1)', duct.linLower.cp[0], 2 * 5 * D / Math.sqrt(3), 1e-12);
  log('ramp in a duct: exact reflections strengthen beyond linear theory', duct.lower.cp[2] > duct.linLower.cp[2], `${duct.lower.cp[2].toFixed(4)} vs ${duct.linLower.cp[2].toFixed(4)}`);

  // ---- Biot–Savart kernels ----
  near('infinite line: Γ/(2πd)', Wg.inducedByLine([0, 2, 0], [0, 0, 0], [1, 0, 0], 4 * PI)[2], 1, 1e-6);
  near('ring on its axis: ΓR²/(2(R² + x²)^{3/2})', Wg.inducedByRing([0.5, 0, 0], 0, 1, 1, 720)[0], 1 / (2 * 1.25 ** 1.5), 2e-5);
  near('horseshoe at mid-span: Γ/(πb) from the legs', -Wg.inducedByHorseshoe([0, 0, 0], 0, 0, 0, 2, 2 * PI)[2], 1, 1e-9);
}
