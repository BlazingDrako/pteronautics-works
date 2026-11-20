// Fluid Flow Sandbox theory checks: potential-flow superposition against closed forms (cylinder Cp, stagnation points
// with circulation, Kutta–Joukowski lift and d'Alembert's zero drag by Blasius' theorem, images, Rankine bodies), the
// expression parser, and the exact viscous solutions.
import * as F from '../../core/solvers/flow.js';
import { compileReal, compileComplex } from '../../core/lib/expr.js';

export function flowTests(log) {
  const near = (name, v, ref, tol) => log(name, Math.abs(v - ref) <= tol, `got ${(+v).toPrecision(7)}, expected ${(+ref).toPrecision(7)} (±${tol})`);
  const PI = Math.PI, preset = id => F.POT_PRESETS.find(p => p.id === id);

  // expressions
  near('expr: 2x + sin(pi/2)·y^2 at (3, 2)', compileReal('2x + sin(pi/2)*y^2', ['x', 'y'])(3, 2), 10, 1e-12);
  near('expr: right-associative power 2^3^2', compileReal('2^3^2', [])(), 512, 1e-9);
  const cz = compileComplex('z^2 + i*z', [])([1, 1]);
  log('complex expr: z² + iz at 1 + i = −1 + 3i', Math.abs(cz[0] + 1) < 1e-12 && Math.abs(cz[1] - 3) < 1e-12, `${cz}`);
  let threw = false; try { compileReal('x +* 2', ['x']); } catch { threw = true; }
  log('expr: bad input throws', threw, '');

  // cylinder
  const cyl = F.potentialFlow({ elements: preset('cylinder').elements });
  near('cylinder: Cp = −3 at the top', cyl.cp(0, 1), -3, 1e-9);
  near('cylinder: Cp = 1 at the front stagnation point', cyl.cp(-1, 0), 1, 1e-9);
  near('cylinder: Cp = 1 − 4 sin²θ at θ = 30°', cyl.cp(Math.cos(PI / 6), Math.sin(PI / 6)), 0, 1e-9);
  const fd = F.blasiusForce(cyl, 0, 0, 2);
  log('cylinder: d\'Alembert, zero force (Blasius)', Math.hypot(fd.Fx, fd.Fy) < 1e-9, `F = (${fd.Fx.toExponential(2)}, ${fd.Fy.toExponential(2)})`);
  near('cylinder: |ψ| on the surface is 0 (dividing streamline)', Math.abs(cyl.F([Math.cos(1), Math.sin(1)])[1]), 0, 1e-12);

  // lifting cylinder
  const sp = F.potentialFlow({ elements: preset('spinning').elements });
  const st = F.stagnationPoints(sp, { x0: -3, x1: 3, y0: -2, y1: 2 });
  log('lifting cylinder (Γ = −2π): stagnation points at sin θ = −1/2', st.length === 2 && st.every(p => Math.abs(p.y + 0.5) < 1e-6 && Math.abs(Math.abs(p.x) - Math.sqrt(3) / 2) < 1e-6), st.map(p => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`).join(' '));
  const fl = F.blasiusForce(sp, 0, 0, 2);
  near('lifting cylinder: Kutta–Joukowski lift ρU∞|Γ| = 2π (Blasius)', fl.Fy, 2 * PI, 1e-8);
  near('lifting cylinder: zero drag', fl.Fx, 0, 1e-9);
  const big = F.potentialFlow({ elements: [{ type: 'uniform', U: 1 }, { type: 'doublet', x: 0, y: 0, k: 2 * PI }, { type: 'vortex', x: 0, y: 0, G: -6 * PI }] });
  const sb = F.stagnationPoints(big, { x0: -3, x1: 3, y0: -3, y1: 3 }).filter(p => Math.hypot(p.x, p.y) > 1);
  log('lifting cylinder, |Γ| > 4πU∞R: one stagnation point off the surface, below', sb.length === 1 && Math.abs(sb[0].x) < 1e-6 && sb[0].y < -1, sb.map(p => `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`).join(' '));
  // the same flow typed as a complex potential
  const ex = F.potentialFlow({ expr: 'U*(z + R^2/z) + i*G/(2*pi)*log(z)', params: { U: 1, R: 1, G: 2 * PI } });
  near('typed F(z) matches the elements: Cp at (0.3, 1.4)', ex.cp(0.3, 1.4), sp.cp(0.3, 1.4), 1e-6);

  // Rankine oval and half-body
  const ov = F.potentialFlow({ elements: preset('rankine').elements });
  const so = F.stagnationPoints(ov, { x0: -4, x1: 4, y0: -2, y1: 2 });
  near('Rankine oval: stagnation points at x = ±√(a² + ma/(πU)) = ±√3', Math.max(...so.map(p => Math.abs(p.x))), Math.sqrt(3), 1e-6);
  const hb = F.potentialFlow({ elements: preset('halfbody').elements });
  const sh = F.stagnationPoints(hb, { x0: -4, x1: 4, y0: -2, y1: 2 });
  near('half-body: nose at −m/(2πU) = −1', sh[0].x, -1, 1e-6);

  // images
  const gv = F.potentialFlow({ elements: preset('gvortex').elements, ground: true });
  let maxV = 0; for (let x = -3; x <= 3; x += 0.25) maxV = Math.max(maxV, Math.abs(gv.vel(x, 0)[1]));
  log('ground plane: no flow through y = 0 (method of images)', maxV < 1e-12, `max |v| on the ground ${maxV.toExponential(2)}`);
  const c = F.forceContour(gv), fg = F.blasiusForce(gv, c.x, c.y, c.r);
  near('vortex near the ground: lift ρΓ(U∞ − Γ/(4πh)) = 0.75π', fg.Fy, 0.75 * PI, 1e-6);
  const hg = F.potentialFlow({ elements: preset('hangar').elements, ground: true });
  near('hangar: roof Cp = −3 at the top', hg.cp(0, 1.000001), -3, 1e-4);
  const sh2 = F.stagnationPoints(hg, { x0: -3, x1: 3, y0: 0, y1: 3 });
  log('hangar: stagnation points found on the ground at x = ±1', sh2.length === 2 && sh2.every(p => Math.abs(Math.abs(p.x) - 1) < 1e-6 && p.y === 0), sh2.map(p => p.x.toFixed(4)).join(', '));

  // viscous
  const co = F.couette({ U: 1, h: 1, G: 0, mu: 1 });
  near('Couette: Q′ = Uh/2', co.Q, 0.5, 1e-12);
  const cp2 = F.couette({ U: 1, h: 1, G: -6, mu: 1 });
  log('Couette–Poiseuille: adverse gradient with P < −1 gives backflow', cp2.P < -1 && cp2.backflow, `P = ${cp2.P.toFixed(3)}, min u = ${Math.min(...cp2.u).toFixed(4)}`);
  const cp3 = F.couette({ U: 1, h: 1, G: -1, mu: 1 });
  log('…and P = −0.5 does not', cp3.P > -1 && !cp3.backflow, `P = ${cp3.P.toFixed(3)}`);
  const pp = F.pipe({ R: 0.01, G: 100, mu: 1e-3, rho: 1000 });
  near('Hagen–Poiseuille: Q = πGR⁴/(8μ)', pp.Q, PI * 100 * 1e-8 / 8e-3, 1e-15);
  near('pipe: f = 64/Re', pp.f, 64 / pp.Re, 1e-12);
  near('start-up Couette: steady at large t (mid-gap U/2)', F.startupCouette({ U: 1, h: 1, nu: 1, t: 5 }).u[50], 0.5, 1e-9);
  near('start-up Couette: early profile follows Stokes erfc', F.startupCouette({ U: 1, h: 1, nu: 1, t: 1e-3 }, 1001).u[30], 1 - F.erf(0.03 / (2 * Math.sqrt(1e-3))), 2e-3);
  near('erf(1)', F.erf(1), 0.8427007929, 2e-7);
  near('Stokes 2nd problem: amplitude e^(−1) at y = 1/k', F.stokes2(Math.sqrt(2), 0, 1, 1, 1), Math.exp(-1) * Math.cos(-1), 1e-12);

}
