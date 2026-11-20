// The vehicle in 3D: a lofted mesh of the airframe (NACA sections, taper, sweep, twist, dihedral; a body of
// revolution; tail surfaces; propeller) drawn as a hidden-line wireframe on a canvas: section lines and stringers,
// the wing's lines coloured by local lift, faces filled with the stage colour in a painter's sort so the far side
// shows only as a ghost. No WebGL and no dependencies. World axes: x aft from the nose, y to starboard, z up.
//
// Each face carries `wire`: one entry per edge, 0 = not drawn, 1 = a wire line, 2 = an outline (LE, TE, tip).
//
//   buildMesh(doc, out, opts) → { faces, bounds, anchors }       pure; tested
//   mountView3d(holder, doc, out, layers, cam, opts) → { redraw }  canvas with orbit, zoom and view presets
import { h, fx } from './dom.js';
import { firstOf } from '../model/vehicle.js';
import { wingOf, surfaceOf, Wing } from '../adapters/aircraft.js';
import { nacaPanels } from '../../core/solvers/airfoilTheory.js';
import { bodyHalf, rampColor } from './planform.js';
import { rotorLayout } from '../analyses/rotors.js';

const DEG = Math.PI / 180;

export const PRESETS = {
  iso: { label: 'Iso', yaw: -132, pitch: 22, ortho: false },
  front: { label: 'Front', yaw: 180, pitch: 0, ortho: true },
  side: { label: 'Side', yaw: -90, pitch: 0, ortho: true },
  top: { label: 'Top', yaw: 0, pitch: 90, ortho: true },
};
export const defaultCamera = () => ({ ...PRESETS.iso, preset: 'iso', zoom: 1 });

// ---------------------------------------------------------------- mesh
// A section loft: stations [{ le: [x, y, z], c, twist (deg, nose up), code, axis }] where axis 'y' lofts a
// horizontal surface (thickness along z) and 'z' a vertical one (thickness along y). Returns quads.
function loft(stations, { n = 36, part, color = null, cap = true, stepI = 3, stepJ = 2 } = {}) {
  const faces = [];
  const profiles = new Map();
  const prof = code => { if (!profiles.has(code)) profiles.set(code, nacaPanels(code, n)); return profiles.get(code); };
  const ring = st => {
    const { X, Y } = prof(st.code), tw = (st.twist || 0) * DEG, ct = Math.cos(tw), sn = Math.sin(tw);
    return X.map((x, i) => {
      // rotate the section about its quarter chord, nose up for positive twist
      const u = (x - 0.25) * st.c, v = Y[i] * st.c, xr = 0.25 * st.c + u * ct + v * sn, vr = -u * sn + v * ct;
      return st.axis === 'z' ? [st.le[0] + xr, st.le[1] + vr, st.le[2]] : [st.le[0] + xr, st.le[1], st.le[2] + vr];
    });
  };
  const rings = stations.map(ring), last = rings.length - 1, m = Math.floor(n / 2);
  // section lines every stepJ stations (the root and tip always, as outlines); stringers every stepI profile
  // points, with the leading and trailing edges as outlines
  const secW = j => (j === 0 || j === last ? 2 : j % stepJ === 0 ? 1 : 0);
  const strW = i => (i === 0 || i === m || i === n ? 2 : i % stepI === 0 ? 1 : 0);
  for (let j = 0; j < last; j++) {
    const a = rings[j], b = rings[j + 1], col = color ? color(stations[j], stations[j + 1]) : null;
    for (let i = 0; i + 1 < a.length; i++) faces.push({ p: [a[i], a[i + 1], b[i + 1], b[i]], part, color: col, wire: [secW(j), strW(i + 1), secW(j + 1), strW(i)] });
  }
  if (cap) { const t = rings[last]; faces.push({ p: t.slice(0, -1), part, color: color ? color(stations[last], stations[last]) : null, wire: t.slice(0, -1).map(() => 0) }); }
  return faces;
}

export function buildMesh(doc, out = {}, { clMap = null } = {}) {
  const w = firstOf(doc, 'wing'), ht = firstOf(doc, 'htail'), vt = firstOf(doc, 'vtail'), f = firstOf(doc, 'fuselage'), pr = firstOf(doc, 'propulsor');
  if (!w) throw new Error('the vehicle has no wing');
  const W = wingOf(w), P = Wing.planform(W), faces = [];
  const L = f ? f.length : 0, d = f ? f.width : 0, hgt = d * 1.12;
  const r = x => (L > 0 ? bodyHalf(L, d, Math.max(0, Math.min(L, x))) : 0);

  // ---- wing: both halves, from the body side to the tip, coloured by local cl / cl,max when given ----
  const xc = w.x + P.cr * 0.4, rw = r(xc) * (hgt / d);
  const zRoot = w.position === 'high' ? 0.72 * rw : w.position === 'low' ? -0.72 * rw : 0;
  const tanG = Math.tan(W.dihedral * DEG), N = 22;
  const etaAt = i => 1 - Math.cos(i / N * Math.PI / 2);           // finer towards the tip
  const stripColor = clMap ? (s0, s1) => {
    const eta = (Math.abs(s0.eta) + Math.abs(s1.eta)) / 2;
    let best = clMap.strips[0]; for (const p of clMap.strips) if (Math.abs(p.eta - eta) < Math.abs(best.eta - eta)) best = p;
    return rampColor(best.cl / clMap.clmax);
  } : null;
  for (const sg of [1, -1]) {
    const st = [];
    for (let i = 0; i <= N; i++) {
      const eta = etaAt(i), y = eta * P.s, code = eta < 0.5 ? W.root : W.tip;
      st.push({ eta, le: [w.x + P.xle(eta), sg * y, zRoot + y * tanG], c: P.chord(eta), twist: W.twist * eta, code: String(code).padStart(4, '0'), axis: 'y' });
    }
    faces.push(...loft(st, { part: 'wing', color: stripColor }));
  }

  // ---- horizontal tail ----
  let tailX = 0;
  if (ht) {
    const t = surfaceOf(ht.area, ht.aspect), xr = ht.x - t.mac / 4, tl = Math.tan(ht.sweep * DEG) * t.b / 2, zt = 0;
    for (const sg of [1, -1]) {
      const st = [];
      for (let i = 0; i <= 8; i++) { const e = i / 8; st.push({ le: [xr + e * tl, sg * e * t.b / 2, zt], c: t.cr * (1 - (1 - t.ct / t.cr) * e), code: '0010', axis: 'y' }); }
      faces.push(...loft(st, { part: 'tail', n: 24, stepJ: 2, stepI: 4 }));
    }
    tailX = Math.max(tailX, xr + t.cr * 0.9);
  }
  // ---- fin: from the boom upward ----
  if (vt) {
    const t = surfaceOf(vt.area, vt.aspect, 0.5), x0 = vt.x - t.mac / 4, tl = Math.tan(vt.sweep * DEG) * t.b, st = [];
    for (let i = 0; i <= 8; i++) { const e = i / 8; st.push({ le: [x0 + e * tl, 0, e * t.b], c: t.cr * (1 - 0.5 * e), code: '0010', axis: 'z' }); }
    faces.push(...loft(st, { part: 'tail', n: 24, stepJ: 2, stepI: 4 }));
    tailX = Math.max(tailX, x0 + t.cr * 0.9);
  }

  // ---- fuselage: a body of revolution with a slightly taller-than-wide section, and the boom to the tail ----
  if (L > 0) {
    const xs = []; for (let i = 0; i <= 40; i++) xs.push(L * (1 - Math.cos(i / 40 * Math.PI)) / 2);
    const boomR = Math.max(r(L * 0.999), d * 0.06);
    if (tailX > L) xs.push(tailX);
    const rad = x => (x <= L ? r(x) : boomR * (1 - 0.2 * (x - L) / (tailX - L)));
    const M = 20, rings = xs.map(x => { const rr = rad(x); return Array.from({ length: M + 1 }, (_, k) => { const a = k / M * 2 * Math.PI; return [x, rr * Math.cos(a), rr * (hgt / d) * Math.sin(a)]; }); });
    // frames every third station, ten stringers round the body
    const last = rings.length - 1, frame = j => (j === last ? 2 : j > 0 && j % 3 === 0 ? 1 : 0), stringer = k => (k % 2 === 0 ? 1 : 0);
    for (let j = 0; j < last; j++) for (let k = 0; k < M; k++) faces.push({ p: [rings[j][k], rings[j][k + 1], rings[j + 1][k + 1], rings[j + 1][k]], part: 'body', wire: [frame(j), stringer(k + 1), frame(j + 1), stringer(k)] });
    faces.push({ p: rings[last].slice(0, -1), part: 'body', wire: rings[last].slice(0, -1).map(() => 0) });
  }

  // ---- propeller: spinner cone and two blades (a tractor at the nose, or a pusher behind the tail) ----
  let prop = null;
  if (pr) {
    const Lf = f ? f.length : 0, pusher = Lf > 0 && pr.x > Lf / 2;
    const R = pr.diameter / 2, xp = pusher ? Math.max(pr.x, Lf) + 0.03 : Math.min(pr.x, 0.02) - 0.03, sr = Math.max(0.025, d * 0.22), M = 14, tipX = pusher ? xp + sr * 1.6 : xp - sr * 1.6;
    for (let k = 0; k < M; k++) {
      const a0 = k / M * 2 * Math.PI, a1 = (k + 1) / M * 2 * Math.PI;
      faces.push({ p: [[tipX, 0, 0], [xp, sr * Math.cos(a0), sr * Math.sin(a0)], [xp, sr * Math.cos(a1), sr * Math.sin(a1)]], part: 'spinner', wire: [k % 2 ? 0 : 1, 2, 0] });
    }
    for (const sg of [1, -1]) {
      const bl = [];
      for (let i = 0; i <= 8; i++) { const u = i / 8, rr = sr + (R - sr) * u, cw = 0.09 * R * (1 - 0.55 * u) * Math.sin(Math.PI * (0.15 + 0.85 * u)) + 0.01; bl.push([xp + 0.004, 0, sg * rr, cw]); }
      const pts = [...bl.map(([x, , z, c]) => [x - c * 0.25, sg * c * 0.6, z]), ...bl.slice().reverse().map(([x, , z, c]) => [x + c * 0.15, -sg * c * 0.4, z])];
      faces.push({ p: pts, part: 'blade', wire: pts.map(() => 2) });
    }
    prop = { x: xp, R };
  }

  // ---- lift rotors (eVTOL): square booms under the wing, a mast and two blades per rotor; the discs are drawn later ----
  const rotors = [];
  for (const rr of rotorLayout(doc)) {
    const z = zRoot + rr.R * 0.12, mast = 0.06 * rr.R;
    // two blades, crossing at the hub
    for (const a of [0.35, 0.35 + Math.PI]) {
      const tip = [rr.x + rr.R * Math.cos(a), rr.y + rr.R * Math.sin(a), z], cw = 0.07 * rr.R, nx = -Math.sin(a) * cw, ny = Math.cos(a) * cw;
      faces.push({ p: [[rr.x + nx, rr.y + ny, z], [tip[0] + nx * 0.5, tip[1] + ny * 0.5, z], [tip[0] - nx * 0.5, tip[1] - ny * 0.5, z], [rr.x - nx, rr.y - ny, z]], part: 'blade', wire: [2, 2, 2, 2] });
    }
    faces.push({ p: [[rr.x - mast, rr.y, zRoot], [rr.x + mast, rr.y, zRoot], [rr.x + mast, rr.y, z], [rr.x - mast, rr.y, z]], part: 'body', wire: [1, 1, 1, 1] });
    rotors.push({ x: rr.x, y: rr.y, z, R: rr.R });
  }
  const boomsBy = new Map();
  for (const rr of rotorLayout(doc)) { const k = rr.side + ':' + rr.boom; if (!boomsBy.has(k)) boomsBy.set(k, []); boomsBy.get(k).push(rr); }
  for (const rs of boomsBy.values()) {
    const x0 = Math.min(...rs.map(r => r.x)) - 0.1 * rs[0].R, x1 = Math.max(...rs.map(r => r.x)) + 0.1 * rs[0].R, y = rs[0].y, bw = 0.04 * rs[0].R + 0.02, z0 = zRoot - bw;
    const c = [[-bw, -bw], [bw, -bw], [bw, bw], [-bw, bw]];
    for (let k = 0; k < 4; k++) { const [a, b] = [c[k], c[(k + 1) % 4]]; faces.push({ p: [[x0, y + a[0], z0 + a[1]], [x1, y + a[0], z0 + a[1]], [x1, y + b[0], z0 + b[1]], [x0, y + b[0], z0 + b[1]]], part: 'body', wire: [1, 0, 1, 0] }); }
  }

  // ---- bounds and anchors for markers ----
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const fc of faces) for (const q of fc.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  const anchors = { zWing: zRoot, wingLE: eta => [w.x + P.xle(eta), eta * P.s, zRoot + eta * P.s * tanG], chord: eta => P.chord(eta), s: P.s, prop, rotors };
  return { faces, bounds: { lo, hi, c: lo.map((v, k) => (v + hi[k]) / 2), size: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) }, anchors, W, P };
}

// ---------------------------------------------------------------- rendering
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// colour strings → [r, g, b] (via a canvas, which normalises any CSS colour)
const rgbCache = new Map();
function rgbOf(ctx, css) {
  if (rgbCache.has(css)) return rgbCache.get(css);
  ctx.fillStyle = '#000'; ctx.fillStyle = css; const v = ctx.fillStyle;
  let out = [128, 128, 128];
  if (v[0] === '#') out = [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16));
  else { const m = v.match(/[\d.]+/g); if (m) out = m.slice(0, 3).map(Number); }
  rgbCache.set(css, out); return out;
}
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Camera: orbit about the model centre. The eye sits in the direction (yaw about z from +x, pitch above the
// horizon): yaw 180 looks at the nose, −90 at the port side, pitch 90 straight down with the nose up the screen.
// Returns a projector world → [sx, sy, depth toward the eye].
function camera(cam, bounds, W, H) {
  const yaw = cam.yaw * DEG, pitch = cam.pitch * DEG;
  // camera looks from direction d (unit vector from the target towards the eye)
  const d = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  const up0 = Math.abs(pitch) > 89.5 * DEG ? [-Math.cos(yaw), -Math.sin(yaw), 0] : [0, 0, 1];
  const right = norm(cross(up0, d)), up = cross(d, right);
  const c = bounds.c, R = bounds.size / 2, dist = R * 3.2;
  // fit the projected box of the model (its 8 corners) to the viewport, centred
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const q = [i & 1 ? bounds.hi[0] : bounds.lo[0], i & 2 ? bounds.hi[1] : bounds.lo[1], i & 4 ? bounds.hi[2] : bounds.lo[2]], v = sub(q, c);
    const k = cam.ortho ? 1 : dist / (dist - dot(v, d)), xr = dot(v, right) * k, yr = dot(v, up) * k;
    x0 = Math.min(x0, xr); x1 = Math.max(x1, xr); y0 = Math.min(y0, yr); y1 = Math.max(y1, yr);
  }
  const scale = Math.min(W * 0.9 / Math.max(1e-6, x1 - x0), H * 0.82 / Math.max(1e-6, y1 - y0)) * cam.zoom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const proj = q => {
    const v = sub(q, c), zr = dot(v, d), k = cam.ortho ? 1 : dist / (dist - zr);
    const xr = dot(v, right) * k - cx, yr = dot(v, up) * k - cy;
    return [W / 2 + (cam.panX || 0) + xr * scale, H / 2 + (cam.panY || 0) - yr * scale, zr];
  };
  return { proj, eye: d, right, up, scale };
}

// opts.chrome: false leaves out the preset buttons and the hint; opts.autoRotate turns the model slowly until the
// first drag (not with prefers-reduced-motion, and only while the canvas is on screen).
export function mountView3d(holder, doc, out, layers, cam, { onCamera, reserveRight = 0, chrome = true, autoRotate = false } = {}) {
  const g = out.geometry, ae = out.aero, st = out.stability, m = out.mass, sec = out.sections;
  const clmax = sec ? Math.min(sec.root.clmax, sec.tip.clmax) : g ? Math.min(g.root.clmax, g.tip.clmax) : 1.4;
  const strips = ae && st ? ae.spanLoad(st.CLtrim) : null;
  const mesh = buildMesh(doc, out, { clMap: layers.clmap && strips ? { strips, clmax } : null });
  const canvas = h('canvas', { class: 'v3d', role: 'img', 'aria-label': `${doc.name} in 3D. Drag to orbit, scroll to zoom, double-click to reset.` });
  const presets = h('div', { class: 'v3d-presets', role: 'group', 'aria-label': 'View' },
    ...Object.entries(PRESETS).map(([id, p]) => h('button', { class: 'tg sm' + (cam.preset === id ? ' on' : ''), type: 'button', 'data-preset': id, 'aria-pressed': cam.preset === id ? 'true' : 'false', onclick: () => setPreset(id) }, p.label)));
  const hint = h('div', { class: 'v3d-hint' }, 'Drag to orbit · shift-drag to pan · scroll to zoom · double-click to reset');
  holder.replaceChildren(canvas, ...(chrome ? [presets, hint] : []));
  const ctx = canvas.getContext('2d');
  let raf = 0, anim = null, drag = null;

  function setPreset(id) {
    const p = PRESETS[id], from = { yaw: cam.yaw, pitch: cam.pitch };
    let dy = ((p.yaw - from.yaw) % 360 + 540) % 360 - 180;     // the short way round
    const t0 = performance.now();
    cam.preset = id; cam.ortho = p.ortho; cam.panX = 0; cam.panY = 0;
    anim = () => {
      const u = Math.min(1, (performance.now() - t0) / 380), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      cam.yaw = from.yaw + dy * e; cam.pitch = from.pitch + (p.pitch - from.pitch) * e;
      if (u >= 1) { cam.yaw = p.yaw; anim = null; }
    };
    paintPresets(); onCamera && onCamera(cam); schedule();
  }
  function paintPresets() { for (const b of presets.children) { const on = b.dataset.preset === cam.preset; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let spinning = autoRotate && !still, onScreen = true, last = 0;
  if (spinning && typeof IntersectionObserver !== 'undefined') new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) schedule(); }).observe(canvas);
  function frame(t) {
    if (anim) anim();
    if (spinning && onScreen && !drag) { cam.yaw += Math.min(50, t - (last || t)) * 0.006; last = t; }
    draw();
    if (anim || (spinning && onScreen && canvas.isConnected)) schedule(); else last = 0;
  }

  function draw() {
    if (!canvas.isConnected) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), Wc = holder.clientWidth || 900, Hc = holder.clientHeight || 640;
    if (canvas.width !== Math.round(Wc * dpr) || canvas.height !== Math.round(Hc * dpr)) { canvas.width = Math.round(Wc * dpr); canvas.height = Math.round(Hc * dpr); }
    canvas.style.width = Wc + 'px'; canvas.style.height = Hc + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, Wc, Hc);
    const Wv = Wc - reserveRight, C = camera(cam, mesh.bounds, Wv, Hc - 40);
    const P = q => { const p = C.proj(q); return [p[0], p[1] + 10, p[2]]; };
    const col = {
      body: rgbOf(ctx, cssVar('--pf-body') || '#f7f9fc'), wing: rgbOf(ctx, cssVar('--pf-skin-le') || '#e9f2fa'), tail: rgbOf(ctx, cssVar('--pf-tail') || '#d7e4f0'),
      line: rgbOf(ctx, cssVar('--pf-line') || '#2a3240'),
    };
    const dark = document.documentElement.dataset.resolvedTheme === 'dark';
    // light from upper front-left of the viewer, plus a sky/ground ambient
    const Ld = norm([C.eye[0] * 0.6 - C.right[0] * 0.5 + 0.0, C.eye[1] * 0.6 - C.right[1] * 0.5, C.eye[2] * 0.6 + 0.8]);

    // ground grid under the model (not in the level views, where it would be edge-on)
    const stage = rgbOf(ctx, cssVar('--stage') || (dark ? '#0b0d11' : '#f7f9fc')), lineRGB = col.line, acc = rgbOf(ctx, cssVar('--accent') || '#1677b3');
    if (Math.abs(cam.pitch) > 4) {
      const B = mesh.bounds, zg = B.lo[2] - 0.35 * (B.hi[2] - B.lo[2]) - 0.04 * B.size, step = 0.25;
      const ext = 0.62 * B.size, cx = Math.round(B.c[0] / step) * step, cy = 0;
      ctx.lineWidth = 1;
      for (let i = -Math.ceil(ext / step); i <= Math.ceil(ext / step); i++) for (const along of [0, 1]) {
        const segs = 16;
        for (let k = 0; k < segs; k++) {
          const u0 = -ext + 2 * ext * k / segs, u1 = -ext + 2 * ext * (k + 1) / segs, o = i * step;
          const p0 = along ? [cx + u0, cy + o, zg] : [cx + o, cy + u0, zg], p1 = along ? [cx + u1, cy + o, zg] : [cx + o, cy + u1, zg];
          const rr = Math.hypot((p0[0] + p1[0]) / 2 - cx, (p0[1] + p1[1]) / 2 - cy) / ext, al = Math.max(0, 1 - rr) ** 1.6 * (dark ? 0.22 : 0.16);
          if (al < 0.01) continue;
          const s0 = P(p0), s1 = P(p1);
          ctx.strokeStyle = `rgba(${lineRGB[0]},${lineRGB[1]},${lineRGB[2]},${al})`; ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke();
        }
      }
    }

    // faces far to near: fill with the stage colour (nearly opaque, so hidden lines show only as a ghost), then
    // stroke the face's wire edges, fading with depth
    const list = mesh.faces.map(fc => {
      const sp = fc.p.map(P);
      let z = 0; for (const s of sp) z += s[2];
      return { fc, sp, z: z / sp.length };
    }).sort((a, b) => a.z - b.z);
    const zs = list.map(e => e.z), zLo = zs[0], zHi = zs[zs.length - 1] || 1;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const { fc, sp, z } of list) {
      const n0 = norm(cross(sub(fc.p[1], fc.p[0]), sub(fc.p[2], fc.p[0])));
      const nn = dot(n0, C.eye) < 0 ? [-n0[0], -n0[1], -n0[2]] : n0;
      const lam = Math.max(0, dot(nn, Ld)), tint = fc.color ? rgbOf(ctx, fc.color) : acc;
      // a whisper of shading so the surfaces still read as surfaces
      const t = (dark ? 0.05 : 0.035) + (dark ? 0.06 : 0.05) * (1 - lam);
      const fill = stage.map((v, k) => Math.round(v + (tint[k] - v) * t));
      ctx.beginPath(); sp.forEach((s, i) => (i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]))); ctx.closePath();
      ctx.fillStyle = `rgba(${fill[0]},${fill[1]},${fill[2]},0.9)`; ctx.fill();
      ctx.strokeStyle = `rgba(${fill[0]},${fill[1]},${fill[2]},0.9)`; ctx.lineWidth = 0.5; ctx.stroke();   // seals seams
      if (!fc.wire) continue;
      const depth = (z - zLo) / Math.max(1e-9, zHi - zLo);              // 0 far … 1 near
      const lc = fc.color ? rgbOf(ctx, fc.color) : fc.part === 'spinner' ? rgbOf(ctx, cssVar('--hl') || '#d9483b') : lineRGB;
      for (let e = 0; e < sp.length; e++) {
        const wv = fc.wire[e]; if (!wv) continue;
        const a = sp[e], b = sp[(e + 1) % sp.length];
        const al = (wv === 2 ? (dark ? 0.8 : 0.85) : (dark ? 0.45 : 0.55)) * (0.5 + 0.5 * depth) * (fc.color ? (dark ? 1.25 : 1.45) : 1);
        ctx.strokeStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},${Math.min(1, al)})`; ctx.lineWidth = wv === 2 ? 1.5 : (fc.color ? 1.05 : 0.85);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    // propeller disc
    if (mesh.anchors.prop) {
      const { x, R } = mesh.anchors.prop; ctx.beginPath();
      for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI, s = P([x - 0.01, R * Math.cos(a), R * Math.sin(a)]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }
      ctx.fillStyle = dark ? 'rgba(255,122,107,.07)' : 'rgba(217,72,59,.06)'; ctx.fill();
      ctx.strokeStyle = dark ? 'rgba(255,122,107,.35)' : 'rgba(217,72,59,.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // lift rotor discs, horizontal
    for (const r of mesh.anchors.rotors || []) {
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI, s = P([r.x + r.R * Math.cos(a), r.y + r.R * Math.sin(a), r.z]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }
      ctx.fillStyle = dark ? 'rgba(58,160,216,.08)' : 'rgba(22,119,179,.07)'; ctx.fill();
      ctx.setLineDash([4, 3]); ctx.strokeStyle = dark ? 'rgba(58,160,216,.6)' : 'rgba(22,119,179,.55)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    }

    const accent = cssVar('--accent') || '#1677b3', hl = cssVar('--hl') || '#d9483b', text = cssVar('--text') || '#111', text2 = cssVar('--text-2') || '#555';
    const font = '500 11.5px "Space Grotesk", system-ui, sans-serif';

    // span load ribbon: c·cl/c̄ standing above the quarter-chord line
    const spanPx = (() => { const a = P(mesh.anchors.wingLE(1)), b = P([a ? mesh.anchors.wingLE(1)[0] : 0, -mesh.anchors.wingLE(1)[1], mesh.anchors.wingLE(1)[2]]); return Math.hypot(a[0] - b[0], a[1] - b[1]); })();
    if (layers.load && strips && g && spanPx > 0.35 * Wv * 0.5) {
      const peak = Math.max(...strips.map(p => p.ccl)), hMax = 0.32 * mesh.anchors.s;
      const pts = [];
      for (const sg of [-1, 1]) for (const p of (sg < 0 ? strips.slice().reverse() : strips)) {
        const le = mesh.anchors.wingLE(p.eta), base = [le[0] + 0.25 * mesh.anchors.chord(p.eta), sg * le[1], le[2] + 0.02];
        pts.push([base, [base[0], base[1], base[2] + p.ccl / peak * hMax]]);
      }
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.18; ctx.lineWidth = 0.8;
      pts.forEach(([a, b], i) => { if (i % 2) return; const sa = P(a), sb = P(b); ctx.beginPath(); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]); ctx.stroke(); });
      ctx.globalAlpha = 0.06; ctx.fillStyle = accent; ctx.beginPath();
      pts.forEach(([, b], i) => { const s = P(b); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
      for (let i = pts.length - 1; i >= 0; i--) { const s = P(pts[i][0]); ctx.lineTo(s[0], s[1]); }
      ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); pts.forEach(([, b], i) => { const s = P(b); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
      ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.stroke();
      const tip = P(pts[pts.length - 1][1]);
      label(tip[0] + 8, tip[1] - 6, `span load · CL ${fx(st.CLtrim, 2)}`, accent);
    }

    // CG and neutral point, on the body centreline at the wing height
    if (layers.cg && m) {
      const z = mesh.anchors.zWing + 0.02, a = P([m.xcg, 0, z]);
      if (st) {
        const b = P([st.xnp, 0, z]);
        ctx.strokeStyle = hl; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.fillStyle = hl; ctx.beginPath(); ctx.moveTo(b[0], b[1] - 8); ctx.lineTo(b[0] + 7, b[1] + 5); ctx.lineTo(b[0] - 7, b[1] + 5); ctx.closePath(); ctx.fill();
        label(b[0] + 12, b[1] + 18, `NP · margin ${fx(st.SM, 1)}%`, hl);
      }
      const r = 8;
      ctx.fillStyle = dark ? '#0b0d11' : '#ffffff'; ctx.beginPath(); ctx.arc(a[0], a[1], r + 2.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(a[0], a[1], r, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.arc(a[0], a[1], r, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.arc(a[0], a[1], r, Math.PI, 1.5 * Math.PI); ctx.closePath(); ctx.fill();
      label(a[0] + 14, a[1] - 12, `CG · ${fx(m.h * 100, 1)}% MAC`, text);
    }

    // axis triad, bottom-left
    const o = [44, Hc - 46];
    for (const [v, name, c] of [[[1, 0, 0], 'x aft', text2], [[0, 1, 0], 'y', text2], [[0, 0, 1], 'z up', text2]]) {
      const sx = dot(v, C.right), sy = -dot(v, C.up), l = Math.hypot(sx, sy);
      if (l < 0.08) continue;
      ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(o[0] + sx * 22, o[1] + sy * 22); ctx.stroke();
      ctx.fillStyle = text2; ctx.font = '400 10.5px "Space Grotesk", system-ui'; ctx.fillText(name, o[0] + sx * 28 - 6, o[1] + sy * 28 + 3);
    }
    // scale bar for the orthographic views
    if (cam.ortho) {
      const px = 0.5 * C.scale, x1 = Wv - 18, y = Hc - 22;
      ctx.strokeStyle = text2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1 - px, y); ctx.lineTo(x1, y); ctx.moveTo(x1 - px, y - 4); ctx.lineTo(x1 - px, y + 4); ctx.moveTo(x1, y - 4); ctx.lineTo(x1, y + 4); ctx.stroke();
      ctx.fillStyle = text2; ctx.font = '400 11.5px "Space Grotesk", system-ui'; ctx.textAlign = 'center'; ctx.fillText('0.5 m', x1 - px / 2, y - 8); ctx.textAlign = 'left';
    }

    function label(x, y, t, color) {
      ctx.font = font; const tw = ctx.measureText(t).width + 16;
      x = Math.min(x, Wv - tw - 6);
      ctx.fillStyle = dark ? 'rgba(17,21,28,.92)' : 'rgba(255,255,255,.94)'; ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - 11, tw, 22, 6) : ctx.rect(x, y - 11, tw, 22); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(t, x + 8, y + 4);
    }
  }

  // ---- interaction ----
  canvas.addEventListener('pointerdown', e => { spinning = false; drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 || e.button === 2 }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing'); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) { cam.panX = (cam.panX || 0) + dx; cam.panY = (cam.panY || 0) + dy; }
    else { cam.yaw -= dx * 0.4; cam.pitch = Math.max(-89.9, Math.min(89.9, cam.pitch + dy * 0.35)); if (cam.preset) { cam.preset = null; cam.ortho = false; paintPresets(); } }
    anim = null; schedule();
  });
  const end = () => { if (drag) { drag = null; canvas.classList.remove('grabbing'); onCamera && onCamera(cam); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.4, Math.min(6, cam.zoom * Math.exp(-e.deltaY * 0.0015))); schedule(); onCamera && onCamera(cam); }, { passive: false });
  canvas.addEventListener('dblclick', () => { cam.zoom = 1; setPreset('iso'); });
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', e => {
    const k = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key]; if (!k) return;
    e.preventDefault(); cam.yaw -= k[0]; cam.pitch = Math.max(-89.9, Math.min(89.9, cam.pitch - k[1])); cam.preset = null; cam.ortho = false; paintPresets(); schedule();
  });
  draw();
  if (spinning) schedule();
  return { redraw: schedule, mesh, stop: () => { spinning = false; } };
}
