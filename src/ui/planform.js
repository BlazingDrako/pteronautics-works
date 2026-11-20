// Top view of a fixed-wing vehicle, to scale: nose up, span across. World coordinates: x aft from the nose (m),
// y to starboard (m). Used on the hangar cards and, large and data-coloured, as the workspace's centrepiece.
import { s, fx } from './dom.js';
import { firstOf } from '../model/vehicle.js';
import { wingOf, surfaceOf, Wing } from '../adapters/aircraft.js';

const DEG = Math.PI / 180;
let uid = 0;

export function airframe(doc) {
  const w = firstOf(doc, 'wing'), ht = firstOf(doc, 'htail'), vt = firstOf(doc, 'vtail'), f = firstOf(doc, 'fuselage'), pr = firstOf(doc, 'propulsor');
  const W = wingOf(w), P = Wing.planform(W);
  const le = e => w.x + P.xle(Math.abs(e)), ch = e => P.chord(Math.abs(e));
  const wingPoly = [], N = 32;
  for (let i = 0; i <= N; i++) { const e = -1 + 2 * i / N; wingPoly.push([le(e), e * P.s]); }
  for (let i = N; i >= 0; i--) { const e = -1 + 2 * i / N; wingPoly.push([le(e) + ch(e), e * P.s]); }
  let tail = null, fin = null;
  if (ht) {
    const t = surfaceOf(ht.area, ht.aspect), xr = ht.x - t.mac / 4, tl = Math.tan(ht.sweep * DEG) * t.b / 2;
    const tle = e => xr + Math.abs(e) * tl, tch = e => t.cr * (1 - (1 - t.ct / t.cr) * Math.abs(e));
    tail = { t, le: tle, ch: tch, poly: [[tle(-1), -t.b / 2], [xr, 0], [tle(1), t.b / 2], [tle(1) + t.ct, t.b / 2], [xr + t.cr, 0], [tle(-1) + t.ct, -t.b / 2]] };
  }
  if (vt) { const t = surfaceOf(vt.area, vt.aspect, 0.5); fin = { x0: vt.x - t.mac / 4, c: t.cr }; }
  const L = f ? f.length : 0, d = f ? f.width : 0;
  const xs = [0, L, ...wingPoly.map(p => p[0]), ...(tail ? tail.poly.map(p => p[0]) : []), ...(fin ? [fin.x0, fin.x0 + fin.c] : []), pr ? pr.x - 0.05 : 0];
  const ys = [...wingPoly.map(p => p[1]), ...(tail ? tail.poly.map(p => p[1]) : []), pr ? pr.diameter / 2 : 0];
  return { W, P, w, le, ch, wingPoly, tail, fin, L, d, prop: pr, xMin: Math.min(...xs), xMax: Math.max(...xs), yMax: Math.max(...ys.map(Math.abs)) };
}

// half-width of the fuselage at x: rounded nose, parallel cabin, tapering boom
function bodyHalf(L, d, x) {
  const r = d / 2, u = x / L;
  return u < 0.16 ? r * Math.sqrt(Math.max(0, 1 - ((0.16 - u) / 0.16) ** 2)) : u < 0.55 ? r : r * (1 - 0.72 * (u - 0.55) / 0.45);
}
const path = pts => 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L');

// Colour scale for local cℓ / cℓ,max, in the Atlas palette: the skin colour when lightly loaded, through the
// accent blue, to coral only as a strip nears its stall (no muddy middle). One scale per theme.
const RAMPS = {
  dark: [[0, [36, 52, 70]], [0.4, [32, 96, 142]], [0.7, [58, 160, 216]], [0.85, [150, 190, 222]], [1, [255, 122, 107]]],
  light: [[0, [226, 236, 245]], [0.4, [152, 196, 229]], [0.7, [58, 140, 200]], [0.85, [120, 120, 170]], [1, [217, 72, 59]]],
};
const theme = () => (typeof document !== 'undefined' && document.documentElement.dataset.resolvedTheme === 'light' ? 'light' : 'dark');
export function rampColor(t, which = theme()) {
  const R = RAMPS[which]; t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < R.length; i++) if (t <= R[i][0]) {
    const [a, ca] = R[i - 1], [b, cb] = R[i], u = (t - a) / (b - a);
    return `rgb(${ca.map((c, k) => Math.round(c + u * (cb[k] - c))).join(',')})`;
  }
  return `rgb(${R[R.length - 1][1].join(',')})`;
}

// A label in a small rounded box (readable over any background). anchor: 'start' | 'end' | 'middle'
function chip(svg, x, y, text, { anchor = 'start', color = null } = {}) {
  const w = text.length * 6.4 + 16, h = 22, x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  const g = s('g', { class: 'pf-chip' });
  g.append(s('rect', { x: x0, y: y - h / 2, width: w, height: h, rx: 6, style: color ? `stroke:${color}` : null }),
    s('text', { x: x0 + 8, y: y + 4, style: color ? `fill:${color}` : null }, text));
  svg.append(g);
  return { x0, w };
}

// Fit the airframe into box {x, y, w, h} (px) and draw it. opts.detail adds shading and the control surfaces;
// opts.clMap = { strips, clmax } colours the wing by local cℓ / cℓ,max. Returns the world → px transform and scale.
export function planformShapes(svg, doc, box, { detail = true, clMap = null, compact = false } = {}) {
  const A = airframe(doc), id = 'pf' + (++uid);
  const spanW = 2 * A.yMax, len = A.xMax - A.xMin;
  const k = Math.min(box.w / spanW, box.h / len);
  const cx = box.x + box.w / 2, top = box.y + (box.h - len * k) / 2;
  const T = (x, y) => [cx + y * k, top + (x - A.xMin) * k];
  const P = pts => pts.map(([x, y]) => T(x, y));

  const defs = s('defs');
  defs.innerHTML = `
    <linearGradient id="${id}-body" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" style="stop-color:var(--pf-body-edge)"/><stop offset=".42" style="stop-color:var(--pf-body-hi)"/>
      <stop offset=".58" style="stop-color:var(--pf-body-hi)"/><stop offset="1" style="stop-color:var(--pf-body-edge)"/></linearGradient>
    <linearGradient id="${id}-skin" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" style="stop-color:var(--pf-skin-le)"/><stop offset="1" style="stop-color:var(--pf-skin-te)"/></linearGradient>
    <radialGradient id="${id}-disc"><stop offset="0" style="stop-color:var(--hl);stop-opacity:.05"/><stop offset=".8" style="stop-color:var(--hl);stop-opacity:.18"/><stop offset="1" style="stop-color:var(--hl);stop-opacity:.45"/></radialGradient>
    <filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="${compact ? 4 : 14}" stdDeviation="${compact ? 4 : 12}" style="flood-color:var(--pf-shadow)"/></filter>`;
  svg.append(defs);
  const g = s('g', { filter: detail ? `url(#${id}-shadow)` : null });
  svg.append(g);
  const sw = compact ? 1.1 : 1.4;

  // ---- wing: skin (or the cℓ map), then outline and surface detail ----
  const wingPts = P(A.wingPoly);
  g.append(s('path', { d: path(wingPts) + ' Z', style: `fill:url(#${id}-skin);stroke:none` }));
  if (clMap) {
    const st = clMap.strips, edges = [0, ...st.slice(1).map((p, i) => (p.eta + st[i].eta) / 2), 1];
    const strip = (e0, e1, sgn, c) => {
      const q = [[A.le(e0), sgn * e0 * A.P.s], [A.le(e1), sgn * e1 * A.P.s], [A.le(e1) + A.ch(e1), sgn * e1 * A.P.s], [A.le(e0) + A.ch(e0), sgn * e0 * A.P.s]];
      g.append(s('path', { d: path(P(q)) + ' Z', style: `fill:${c};stroke:${c};stroke-width:.6` }));
    };
    st.forEach((p, i) => { const c = rampColor(p.cl / clMap.clmax); strip(edges[i], edges[i + 1], 1, c); strip(edges[i], edges[i + 1], -1, c); });
    // a sheen from the leading edge so the coloured wing still reads as a surface
    g.append(s('path', { d: path(wingPts) + ' Z', style: `fill:url(#${id}-skin);opacity:.35;stroke:none` }));
  }
  g.append(s('path', { d: path(wingPts) + ' Z', class: 'pf-outline', style: `stroke-width:${sw}` }));
  if (detail) {
    const line = (pts, cls) => g.append(s('path', { d: path(P(pts)), class: cls }));
    const chordLine = (frac, e0, e1, sgn) => { const pts = []; for (let i = 0; i <= 8; i++) { const e = e0 + (e1 - e0) * i / 8; pts.push([A.le(e) + frac * A.ch(e), sgn * e * A.P.s]); } return pts; };
    for (const sg of [-1, 1]) {
      line(chordLine(0.28, 0.02, 0.98, sg), 'pf-spar');                                    // main spar
      const ail = [0.56, 0.95], flap = [0.08, 0.52];
      for (const [e0, e1] of [ail, flap]) {                                                 // aileron and flap hinge lines with their ends
        line(chordLine(0.74, e0, e1, sg), 'pf-hinge');
        line([[A.le(e0) + 0.74 * A.ch(e0), sg * e0 * A.P.s], [A.le(e0) + A.ch(e0), sg * e0 * A.P.s]], 'pf-hinge');
        line([[A.le(e1) + 0.74 * A.ch(e1), sg * e1 * A.P.s], [A.le(e1) + A.ch(e1), sg * e1 * A.P.s]], 'pf-hinge');
      }
    }
  }

  // ---- horizontal tail with its elevator ----
  if (A.tail) {
    const t = A.tail;
    g.append(s('path', { d: path(P(t.poly)) + ' Z', style: clMap ? 'fill:var(--pf-tail)' : `fill:url(#${id}-skin)` }));
    g.append(s('path', { d: path(P(t.poly)) + ' Z', class: 'pf-outline', style: `stroke-width:${sw}` }));
    if (detail) {
      const ep = []; for (let i = 0; i <= 10; i++) { const e = -0.96 + 1.92 * i / 10; ep.push([t.le(e) + 0.68 * t.ch(e), e * t.t.b / 2]); }
      g.append(s('path', { d: path(P(ep)), class: 'pf-hinge' }));
    }
  }

  // ---- fuselage: shaded body, hatch, sensor window ----
  if (A.L > 0) {
    const up = [], dn = [];
    for (let i = 0; i <= 48; i++) { const x = A.L * i / 48, hw = bodyHalf(A.L, A.d, x); up.push(T(x, hw)); dn.push(T(x, -hw)); }
    const body = path([...up, ...dn.reverse()]) + ' Z';
    g.append(s('path', { d: body, style: `fill:url(#${id}-body)` }), s('path', { d: body, class: 'pf-outline', style: `stroke-width:${sw}` }));
    if (detail && !compact) {
      const hw = A.d / 2 * 0.62, x0 = A.L * 0.2, x1 = A.L * 0.48;
      const [a, b] = [T(x0, -hw), T(x1, hw)];
      g.append(s('rect', { x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1], rx: 3, class: 'pf-hatch' }));
      const [c] = [T(A.L * 0.1, 0)];
      g.append(s('ellipse', { cx: c[0], cy: c[1], rx: A.d / 2 * 0.42 * k, ry: A.d / 2 * 0.3 * k, class: 'pf-canopy' }));
    }
  }

  // ---- tail boom: if the tail sits behind the end of the body, carry the tail cone back to it ----
  if (A.L > 0) {
    const tailX = Math.max(A.tail ? A.tail.le(0) + 0.5 * A.tail.ch(0) : 0, A.fin ? A.fin.x0 + 0.5 * A.fin.c : 0);
    if (tailX > A.L - 0.01) {
      const hw = Math.max(bodyHalf(A.L, A.d, A.L * 0.999), A.d * 0.06);
      const pts = [T(A.L * 0.97, hw), T(tailX, hw * 0.8), T(tailX, -hw * 0.8), T(A.L * 0.97, -hw)];
      g.append(s('path', { d: path(pts) + ' Z', style: `fill:url(#${id}-body)` }), s('path', { d: path(pts) + ' Z', class: 'pf-outline', style: `stroke-width:${sw}` }));
    }
  }

  // ---- fin seen from above: a slim symmetric section ----
  if (A.fin) {
    const pts = [], th = 0.09 * A.fin.c;
    for (let i = 0; i <= 16; i++) { const u = i / 16; pts.push([A.fin.x0 + u * A.fin.c, th * 2.9 * (Math.sqrt(u) - u) * 1.2]); }
    for (let i = 16; i >= 0; i--) { const u = i / 16; pts.push([A.fin.x0 + u * A.fin.c, -th * 2.9 * (Math.sqrt(u) - u) * 1.2]); }
    g.append(s('path', { d: path(P(pts)) + ' Z', style: 'fill:var(--pf-body-hi)', class: 'pf-outline' }));
  }

  // ---- propeller: spinning disc, two blades and a spinner ----
  if (A.prop) {
    const R = A.prop.diameter / 2, xp = A.prop.x - 0.035, [px, py] = T(xp, 0);
    svg.append(s('ellipse', { cx: px, cy: py, rx: R * k, ry: Math.max(2.5, 0.028 * k), style: `fill:url(#${id}-disc)` }));
    if (detail) {
      const blade = sg => { const b = []; for (let i = 0; i <= 10; i++) { const u = i / 10; b.push(T(xp + (sg > 0 ? -1 : 1) * 0.012 * Math.sin(Math.PI * u) * (1 - 0.5 * u), sg * (0.04 + u * (R - 0.04)))); } return b; };
      for (const sg of [-1, 1]) svg.append(s('path', { d: path(blade(sg)), class: 'pf-blade', style: `stroke-width:${compact ? 1.4 : 2.6}` }));
    }
    svg.append(s('ellipse', { cx: px, cy: py + 0.012 * k, rx: Math.max(2, 0.03 * k), ry: Math.max(2.5, 0.045 * k), class: 'pf-spinner' }));
  }
  return { A, T, k };
}

// The workspace vehicle view, drawn at the canvas's own pixel size so the airframe fills it.
// out: graph outputs { geometry, aero, mass, stability } (any may be null while stale or failed).
// opts.reserveRight: px kept free on the right for the floating lens panels.
export function vehicleView(doc, out, layers, size = { w: 900, h: 640 }, { reserveRight = 0 } = {}) {
  const W = Math.max(320, size.w), H = Math.max(320, size.h);
  const svg = s('svg', { class: 'main', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${doc.name} top view to scale, coloured by local lift, with span load, centre of gravity and neutral point` });
  const g = out.geometry, ae = out.aero, m = out.mass, st = out.stability;
  const narrow = W < 560;
  const left = 18, right = reserveRight + 18, head = 30;
  const band = layers.load && ae && st ? (narrow ? 56 : Math.max(60, Math.min(120, H * 0.15))) : 0;
  const box = { x: left, y: head + band + (band ? 20 : 0), w: W - left - right, h: H - head - band - (band ? 20 : 0) - 50 };
  const clmax = g ? Math.min(g.root.clmax, g.tip.clmax) : 1.4;
  const strips = ae && st ? ae.spanLoad(st.CLtrim) : null;
  const { A, T, k } = planformShapes(svg, doc, box, { clMap: layers.clmap && strips ? { strips, clmax } : null });

  // span load band above the airframe: c·cℓ / c̄ along the span against the elliptic loading of the same lift
  if (band && strips) {
    const base = head + band, s0 = A.P.s;
    const peak = Math.max(...strips.map(p => p.ccl), 1e-6), ell0 = 4 / Math.PI * st.CLtrim * g.S / (g.span * g.mac);
    const sc = (band - 18) / Math.max(peak, ell0);
    const pts = [...strips.map(p => [-p.y, p.ccl]).reverse(), ...strips.map(p => [p.y, p.ccl])].map(([y, v]) => [T(0, y)[0], base - v * sc]);
    const gid = 'ld' + (++uid);
    const defs = s('defs'); defs.innerHTML = `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:.03"/></linearGradient>`;
    svg.append(defs);
    svg.append(s('path', { d: `M${T(0, -s0)[0]},${base} L` + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L') + ` L${T(0, s0)[0]},${base} Z`, style: `fill:url(#${gid})` }));
    svg.append(s('path', { d: path(pts), class: 'pf-load' }));
    const E = []; for (let i = 0; i <= 64; i++) { const e = -1 + 2 * i / 64; E.push([T(0, e * s0)[0], base - ell0 * Math.sqrt(1 - e * e) * sc]); }
    svg.append(s('path', { d: path(E), class: 'pf-ellipse' }));
    svg.append(s('line', { x1: T(0, -s0)[0], y1: base, x2: T(0, s0)[0], y2: base, class: 'pf-dim' }));
    const t = s('text', { x: 18, y: 19, class: 'pf-lbl' }, 'Span load');
    t.append(s('tspan', { class: 'pf-lbl-s', dx: 8 }, narrow ? `CL ${fx(st.CLtrim, 2)}` : `c·cℓ/c̄ at cruise trim, CL ${fx(st.CLtrim, 2)} · span efficiency ${fx(ae.eInv, 3)} · dashed line is elliptic`));
    svg.append(t);
    // drop lines from the band to the wing tips tie the two views together
    for (const sg of [-1, 1]) { const [x] = T(0, sg * s0), [, y1] = T(A.le(1), sg * s0); svg.append(s('line', { x1: x, y1: base, x2: x, y2: y1, class: 'pf-guide' })); }
  }

  if (layers.mac && g) {
    const a = T(g.xMacLE, g.yMac), b = T(g.xMacLE + g.mac, g.yMac);
    svg.append(s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'pf-mac' }));
    svg.append(s('circle', { cx: a[0], cy: a[1], r: 3, class: 'pf-mac-dot' }), s('circle', { cx: b[0], cy: b[1], r: 3, class: 'pf-mac-dot' }));
    chip(svg, Math.max(a[0], b[0]) + 10, (a[1] + b[1]) / 2, `MAC ${fx(g.mac * 1000, 0)} mm`);
  }

  if (layers.items && m) {
    m.items.filter(i => !i.derived).sort((p, q) => p.x - q.x).forEach((it, j) => {
      const [px, py] = T(it.x, 0), r = Math.max(3, Math.sqrt(it.mass) * k / 70), right = j % 2 === 0;
      svg.append(s('circle', { cx: px, cy: py, r, class: 'pf-item' }));
      const lx = px + (right ? 1 : -1) * (A.d / 2 * k + 30);
      svg.append(s('line', { x1: px + (right ? r : -r), y1: py, x2: lx, y2: py, class: 'pf-guide' }));
      chip(svg, lx, py, `${it.name} · ${fx(it.mass, 2)} kg`, { anchor: right ? 'start' : 'end' });
    });
  }

  if (layers.cg && m) {
    const [px, py] = T(m.xcg, 0), r = Math.max(8, Math.min(13, k / 22));
    if (st) {
      const [nx, ny] = T(st.xnp, 0);
      // static-margin bar along the centreline, CG to NP
      svg.append(s('line', { x1: px, y1: py, x2: nx, y2: ny, class: 'pf-sm' }));
      svg.append(s('path', { d: `M${nx},${ny - r} L${nx + r * 0.9},${ny + r * 0.7} L${nx - r * 0.9},${ny + r * 0.7} Z`, class: 'pf-np' }));
    }
    svg.append(s('circle', { cx: px, cy: py, r: r + 3, class: 'pf-cg-halo' }), s('circle', { cx: px, cy: py, r, class: 'pf-cg-b' }));
    svg.append(s('path', { d: `M${px},${py} L${px + r},${py} A${r},${r} 0 0 1 ${px},${py + r} Z M${px},${py} L${px - r},${py} A${r},${r} 0 0 1 ${px},${py - r} Z`, class: 'pf-cg-a' }));
    // CG and NP chips to the left of the body, with short leaders; the NP chip sits below so they never overlap
    const lx = px - (A.d / 2 * k + r + 24);
    svg.append(s('line', { x1: px - r - 3, y1: py, x2: lx, y2: py - 14, class: 'pf-guide' }));
    chip(svg, lx, py - 14, narrow ? `CG ${fx(m.h * 100, 1)}%` : `CG · ${fx(m.h * 100, 1)}% MAC`, { anchor: 'end' });
    if (st) {
      const [nx, ny] = T(st.xnp, 0), y2 = Math.max(ny, py) + 16;
      svg.append(s('line', { x1: nx - r, y1: ny, x2: lx, y2, class: 'pf-guide', style: 'stroke:var(--hl);opacity:.6' }));
      chip(svg, lx, y2, narrow ? `NP · ${fx(st.SM, 1)}%` : `NP · margin ${fx(st.SM, 1)}%`, { anchor: 'end', color: 'var(--hl)' });
    }
  }

  // footer: cℓ colour bar, span dimension, scale bar
  const y0 = H - 22;
  if (layers.clmap && strips) {
    const cid = 'cb' + (++uid), defs = s('defs');
    defs.innerHTML = `<linearGradient id="${cid}">${[0, 0.25, 0.45, 0.6, 0.75, 0.9, 1].map(t => `<stop offset="${t}" stop-color="${rampColor(t)}"/>`).join('')}</linearGradient>`;
    svg.append(defs, s('rect', { x: 18, y: y0 - 4, width: 130, height: 7, rx: 3.5, fill: `url(#${cid})` }),
      s('text', { x: 18, y: y0 - 11, class: 'pf-lbl-s' }, 'Local cℓ / cℓ,max'), s('text', { x: 18, y: y0 + 16, class: 'pf-lbl-s' }, '0'), s('text', { x: 148, y: y0 + 16, class: 'pf-lbl-s', 'text-anchor': 'end' }, '1 = stall'));
  }
  const a = T(A.xMax, -A.P.s), b = T(A.xMax, A.P.s);
  if (!narrow) svg.append(s('path', { d: `M${a[0]},${y0 - 5} L${a[0]},${y0 + 5} M${a[0]},${y0} L${b[0]},${y0} M${b[0]},${y0 - 5} L${b[0]},${y0 + 5}`, class: 'pf-dim' }));
  if (!narrow) svg.append(s('text', { x: (a[0] + b[0]) / 2, y: y0 - 7, class: 'pf-lbl-s', 'text-anchor': 'middle' }, `b ${fx(A.P.b, 2)} m · S ${fx(A.W.S, 3)} m² · AR ${fx(A.W.AR, 1)}`));
  const bar = 0.5 * k, bx1 = W - right;
  svg.append(s('path', { d: `M${bx1 - bar},${y0} L${bx1},${y0} M${bx1 - bar},${y0 - 4} L${bx1 - bar},${y0 + 4} M${bx1},${y0 - 4} L${bx1},${y0 + 4}`, class: 'pf-dim', style: 'stroke-width:1.5' }));
  svg.append(s('text', { x: bx1 - bar / 2, y: y0 - 7, class: 'pf-lbl-s', 'text-anchor': 'middle' }, '0.5 m'));
  return { svg, T, k, A };
}
