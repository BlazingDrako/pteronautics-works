// Top view of a fixed-wing vehicle, to scale: nose up, span across. World coordinates: x aft from the nose (m),
// y to starboard (m). Used small on the hangar cards and large in the workspace with the analysis overlays.
import { s, fx } from './dom.js';
import { firstOf } from '../model/vehicle.js';
import { wingOf, surfaceOf, Wing } from '../adapters/aircraft.js';

const DEG = Math.PI / 180;

export function airframe(doc) {
  const w = firstOf(doc, 'wing'), ht = firstOf(doc, 'htail'), vt = firstOf(doc, 'vtail'), f = firstOf(doc, 'fuselage'), pr = firstOf(doc, 'propulsor');
  const W = wingOf(w), P = Wing.planform(W);
  const wingPoly = [];
  const N = 24;
  for (let i = 0; i <= N; i++) { const e = -1 + 2 * i / N; wingPoly.push([w.x + P.xle(Math.abs(e)), e * P.s]); }
  for (let i = N; i >= 0; i--) { const e = -1 + 2 * i / N; wingPoly.push([w.x + P.xle(Math.abs(e)) + P.chord(Math.abs(e)), e * P.s]); }
  let tail = null, fin = null;
  if (ht) {
    const t = surfaceOf(ht.area, ht.aspect), xr = ht.x - t.mac / 4, tl = Math.tan(ht.sweep * DEG) * t.b / 2;
    tail = [[xr + tl, -t.b / 2], [xr, 0], [xr + tl, t.b / 2], [xr + tl + t.ct, t.b / 2], [xr + t.cr, 0], [xr + tl + t.ct, -t.b / 2]];
  }
  if (vt) { const t = surfaceOf(vt.area, vt.aspect, 0.5); fin = [vt.x - t.mac / 4, vt.x - t.mac / 4 + t.cr]; }
  const L = f ? f.length : 0, d = f ? f.width : 0;
  const xs = [0, L, ...wingPoly.map(p => p[0]), ...(tail ? tail.map(p => p[0]) : []), ...(fin || []), pr ? pr.x - 0.03 : 0];
  const ys = [...wingPoly.map(p => p[1]), ...(tail ? tail.map(p => p[1]) : []), pr ? pr.diameter / 2 : 0];
  return { W, P, w, wingPoly, tail, fin, L, d, prop: pr, xMin: Math.min(...xs), xMax: Math.max(...xs), yMax: Math.max(...ys.map(Math.abs)) };
}

function fuselagePath(L, d, T) {
  if (!(L > 0)) return '';
  const r = d / 2, pts = [];
  const half = x => { const u = x / L; return u < 0.16 ? r * Math.sqrt(1 - ((0.16 - u) / 0.16) ** 2) : u < 0.55 ? r : r * (1 - 0.72 * (u - 0.55) / 0.45); };
  for (let i = 0; i <= 40; i++) { const x = L * i / 40; pts.push(T(x, half(x))); }
  for (let i = 40; i >= 0; i--) { const x = L * i / 40; pts.push(T(x, -half(x))); }
  return 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L') + ' Z';
}

// Fit the airframe into box {x, y, w, h} (px) and draw it into `svg`. Returns the world → px transform and scale.
export function planformShapes(svg, doc, box, { cls = {} } = {}) {
  const A = airframe(doc);
  const spanW = 2 * A.yMax, len = A.xMax - A.xMin;
  const k = Math.min(box.w / spanW, box.h / len);
  const cx = box.x + box.w / 2, top = box.y + (box.h - len * k) / 2;
  const T = (x, y) => [cx + y * k, top + (x - A.xMin) * k];
  const poly = pts => pts.map(([x, y]) => T(x, y).map(v => v.toFixed(1)).join(',')).join(' ');
  svg.append(s('polygon', { class: cls.wing || 'pf-wing', points: poly(A.wingPoly) }));
  if (A.tail) svg.append(s('polygon', { class: cls.wing || 'pf-wing', points: poly(A.tail) }));
  if (A.L > 0) svg.append(s('path', { class: cls.body || 'pf-body', d: fuselagePath(A.L, A.d, T) }));
  if (A.fin) { const [a, b] = [T(A.fin[0], 0), T(A.fin[1], 0)]; svg.append(s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls.wing ? 'sk-line' : 'pf-thin', style: 'stroke-width:3;opacity:.9' })); }
  if (A.prop) { const a = T(A.prop.x - 0.03, -A.prop.diameter / 2), b = T(A.prop.x - 0.03, A.prop.diameter / 2); svg.append(s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls.prop || 'pf-prop' })); }
  return { A, T, k };
}

// The workspace vehicle view: airframe plus span load, MAC, mass items, CG, neutral point and a scale bar.
// out: the graph outputs { geometry, aero, mass, stability, performance } (any may be missing while stale).
export function vehicleView(doc, out, layers, size = { w: 720, h: 620 }) {
  const svg = s('svg', { class: 'main', viewBox: `0 0 ${size.w} ${size.h}`, role: 'img', 'aria-label': `${doc.name} top view to scale with span load, centre of gravity and neutral point` });
  const box = { x: 150, y: 160, w: size.w - 190, h: size.h - 215 };
  const { A, T, k } = planformShapes(svg, doc, box);
  const g = out.geometry, ae = out.aero, m = out.mass, st = out.stability;

  // span load above the planform: c·cℓ / c̄ along the span, with the elliptic loading of the same lift
  if (layers.load && ae && st) {
    const strips = ae.spanLoad(st.CLtrim);
    const base = T(A.xMin, 0)[1] - 18, H = 105, s0 = A.P.s;
    const peak = Math.max(...strips.map(p => p.ccl), 1e-6);
    const ell0 = 4 / Math.PI * st.CLtrim * g.S / (g.span * g.mac);   // elliptic c·cℓ/c̄ at the root for the same CL
    const sc = H / Math.max(peak, ell0);
    const pts = [...strips.map(p => [-p.y, p.ccl]).reverse(), ...strips.map(p => [p.y, p.ccl])];
    const P = pts.map(([y, v]) => [T(0, y)[0], base - v * sc]);
    svg.append(s('path', { class: 'pf-load', d: `M${T(0, -s0)[0]},${base} L` + P.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L') + ` L${T(0, s0)[0]},${base} Z` }));
    const E = []; for (let i = 0; i <= 60; i++) { const e = -1 + 2 * i / 60; E.push([T(0, e * s0)[0], base - ell0 * Math.sqrt(1 - e * e) * sc]); }
    svg.append(s('path', { class: 'pf-ellipse', d: 'M' + E.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L') }));
    svg.append(s('line', { x1: T(0, -s0)[0], y1: base, x2: T(0, s0)[0], y2: base, class: 'pf-dim' }));
    svg.append(s('text', { x: T(0, -s0)[0], y: base - H - 8, class: 'pf-lbl' }, `Span load c·cℓ/c̄ at cruise trim, CL ${fx(st.CLtrim, 2)}`));
    svg.append(s('text', { x: T(0, s0)[0], y: base - H - 8, class: 'pf-lbl-s', 'text-anchor': 'end' }, `e ${fx(ae.eInv, 3)} inviscid · dashed: elliptic`));
  }

  // mean aerodynamic chord
  if (layers.mac && g) {
    const a = T(g.xMacLE, g.yMac), b = T(g.xMacLE + g.mac, g.yMac);
    svg.append(s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'pf-mac' }));
    svg.append(s('text', { x: a[0] + 8, y: (a[1] + b[1]) / 2 + 4, class: 'pf-lbl-s' }, `MAC ${fx(g.mac * 1000, 0)} mm`));
  }

  // mass items along the centreline
  if (layers.items && m) {
    m.items.filter(i => !i.derived).sort((p, q) => p.x - q.x).forEach((it, j) => {
      const [px, py] = T(it.x, 0), r = Math.max(3, Math.sqrt(it.mass) * 2.4), right = j % 2 === 0;
      svg.append(s('circle', { cx: px, cy: py, r, class: 'pf-item' }));
      const lx = px + (right ? 1 : -1) * (A.d / 2 * k + 26);
      svg.append(s('line', { x1: px + (right ? r : -r), y1: py, x2: lx - (right ? 4 : -4), y2: py, class: 'pf-dim', style: 'opacity:.5' }));
      svg.append(s('text', { x: lx, y: py + 3.5, class: 'pf-lbl-s', 'text-anchor': right ? 'start' : 'end' }, `${it.name} ${fx(it.mass, 2)} kg`));
    });
  }

  // CG (quartered circle) and neutral point (triangle), with the static margin between them
  if (layers.cg && m) {
    const [px, py] = T(m.xcg, 0), r = 9;
    svg.append(s('circle', { cx: px, cy: py, r, class: 'pf-cg-b' }));
    svg.append(s('path', { d: `M${px},${py} L${px + r},${py} A${r},${r} 0 0 1 ${px},${py + r} Z M${px},${py} L${px - r},${py} A${r},${r} 0 0 1 ${px},${py - r} Z`, class: 'pf-cg-a' }));
    // labels in the left margin with leaders, CG above and NP below so they never collide
    const bx = box.x - 10;
    const leader = (y0, y1) => svg.append(s('path', { d: `M${px - r - 2},${y0} L${bx + 18},${y0} L${bx + 6},${y1}`, class: 'pf-dim', style: 'opacity:.6' }));
    if (st) {
      const [nx, ny] = T(st.xnp, 0);
      svg.append(s('path', { d: `M${nx},${ny - 9} L${nx + 8},${ny + 6} L${nx - 8},${ny + 6} Z`, class: 'pf-np' }));
      const yc = Math.min(py, ny) - 26, yn = Math.max(py, ny) + 30;
      leader(py, yc); svg.append(s('path', { d: `M${nx - 9},${ny} L${bx + 18},${ny} L${bx + 6},${yn}`, class: 'pf-dim', style: 'opacity:.6;stroke:var(--hl)' }));
      svg.append(s('text', { x: bx, y: yc - 2, class: 'pf-lbl', 'text-anchor': 'end' }, `CG ${fx(m.xcg, 3)} m`));
      svg.append(s('text', { x: bx, y: yc + 12, class: 'pf-lbl-s', 'text-anchor': 'end' }, `${fx(m.h * 100, 1)}% MAC`));
      svg.append(s('text', { x: bx, y: yn + 2, class: 'pf-lbl', 'text-anchor': 'end', style: 'fill:var(--hl)' }, `NP ${fx(st.xnp, 3)} m`));
      svg.append(s('text', { x: bx, y: yn + 16, class: 'pf-lbl-s', 'text-anchor': 'end' }, `static margin ${fx(st.SM, 1)}%`));
    } else {
      leader(py, py - 26);
      svg.append(s('text', { x: bx, y: py - 28, class: 'pf-lbl', 'text-anchor': 'end' }, `CG ${fx(m.xcg, 3)} m`));
    }
  }

  // span dimension and scale bar
  const y0 = size.h - 26, a = T(A.xMax, -A.P.s), b = T(A.xMax, A.P.s);
  svg.append(s('path', { d: `M${a[0]},${y0 - 5} L${a[0]},${y0 + 5} M${a[0]},${y0} L${b[0]},${y0} M${b[0]},${y0 - 5} L${b[0]},${y0 + 5}`, class: 'pf-dim' }));
  svg.append(s('text', { x: (a[0] + b[0]) / 2, y: y0 - 6, class: 'pf-lbl-s', 'text-anchor': 'middle' }, `b ${fx(A.P.b, 2)} m · S ${fx(A.W.S, 3)} m² · AR ${fx(A.W.AR, 1)}`));
  const bar = 0.5 * k;
  svg.append(s('path', { d: `M${size.w - 40 - bar},${y0} L${size.w - 40},${y0} M${size.w - 40 - bar},${y0 - 4} L${size.w - 40 - bar},${y0 + 4} M${size.w - 40},${y0 - 4} L${size.w - 40},${y0 + 4}`, class: 'pf-dim', style: 'stroke-width:1.5' }));
  svg.append(s('text', { x: size.w - 40 - bar / 2, y: y0 - 7, class: 'pf-lbl-s', 'text-anchor': 'middle' }, '0.5 m'));
  return { svg, T, k, A };
}
