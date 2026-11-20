// Small SVG line charts that follow the theme.
import { s } from './dom.js';

export const nice = (lo, hi, n = 5) => {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(st => span / st <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(+v.toPrecision(10));
  return out;
};

// chart({ w, h, x: [lo, hi], y: [lo, hi], series: [{ pts: [[x, y]], cls }], marks: [{ x, label, cls }], xLabel, yLabel, compact })
export function chart(o) {
  const { w = 480, h = 260, compact = false } = o;
  const pad = compact ? { l: 30, r: 8, t: 8, b: 20 } : { l: 52, r: 16, t: o.legend ? 30 : 14, b: 38 };
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const X = v => pad.l + (v - x0) / (x1 - x0) * (w - pad.l - pad.r), Y = v => h - pad.b - (v - y0) / (y1 - y0) * (h - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': o.label || 'chart' });
  for (const v of nice(y0, y1, compact ? 3 : 5)) { svg.append(s('line', { x1: pad.l, x2: w - pad.r, y1: Y(v), y2: Y(v), class: 'grid-l' }), s('text', { x: pad.l - 5, y: Y(v) + 3.5, class: 'ax-t', 'text-anchor': 'end' }, fmt(v))); }
  for (const v of nice(x0, x1, compact ? 4 : 7)) svg.append(s('text', { x: X(v), y: h - pad.b + 13, class: 'ax-t', 'text-anchor': 'middle' }, fmt(v)));
  svg.append(s('path', { d: `M${pad.l},${pad.t} L${pad.l},${h - pad.b} L${w - pad.r},${h - pad.b}`, class: 'ax' }));
  if (o.xLabel) svg.append(s('text', { x: (pad.l + w - pad.r) / 2, y: h - 4, class: 'ax-label', 'text-anchor': 'middle' }, o.xLabel));
  if (o.yLabel) svg.append(s('text', { x: 12, y: (pad.t + h - pad.b) / 2, class: 'ax-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(pad.t + h - pad.b) / 2})` }, o.yLabel));
  // shaded spans: bands [{ x0, x1, cls }] across the plot's height, ybands [{ y0, y1, cls }] across its width
  const cx = v => Math.max(pad.l, Math.min(w - pad.r, X(v))), cy = v => Math.max(pad.t, Math.min(h - pad.b, Y(v)));
  for (const b of o.bands || []) { const a = cx(b.x0), c = cx(b.x1); if (c > a) svg.append(s('rect', { x: a, y: pad.t, width: c - a, height: h - pad.b - pad.t, class: b.cls || 'band-good' })); }
  for (const b of o.ybands || []) { const a = cy(Math.max(b.y0, b.y1)), c = cy(Math.min(b.y0, b.y1)); if (c > a) svg.append(s('rect', { x: pad.l, y: a, width: w - pad.l - pad.r, height: c - a, class: b.cls || 'band-bad' })); }
  // horizontal reference lines: hlines [{ y, label, cls, color }]
  for (const L of o.hlines || []) {
    if (!isFinite(L.y) || L.y < y0 || L.y > y1) continue;
    svg.append(s('line', { x1: pad.l, x2: w - pad.r, y1: Y(L.y), y2: Y(L.y), class: L.cls || 's-target' }));
    if (L.label && !compact) svg.append(s('text', { x: w - pad.r - 3, y: Y(L.y) - 4, class: 'ax-ref', 'text-anchor': 'end', style: `fill:${L.color || 'var(--text-2)'}` }, L.label));
  }
  // points outside the y range break the line rather than being drawn flat along the edge
  const inY = v => v >= y0 - (y1 - y0) * 0.02 && v <= y1 + (y1 - y0) * 0.02, clip = v => Math.max(y0, Math.min(y1, v));
  for (const se of o.series || []) {
    let d = '', pen = false;
    for (const p of se.pts) {
      if (!isFinite(p[0]) || !isFinite(p[1]) || !inY(p[1])) { pen = false; continue; }
      d += `${pen ? ' L' : ' M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`; pen = true;
    }
    if (d) svg.append(s('path', { d: d.trim(), class: se.cls || 's-accent' }));
  }
  for (const m of o.marks || []) {
    if (!isFinite(m.x) || m.x < x0 || m.x > x1) continue;
    svg.append(s('line', { x1: X(m.x), x2: X(m.x), y1: pad.t, y2: h - pad.b, class: m.cls || 's-muted' }));
    if (m.label) svg.append(s('text', { x: X(m.x) + 4, y: pad.t + 12 + (m.row || 0) * 14, class: 'ax-ref', style: `fill:${m.color || 'var(--text-2)'}` }, m.label));
  }
  // legend along the top, Atlas style: a short line swatch and a label
  if (o.legend && !compact) {
    let x = pad.l;
    for (const L of o.legend) {
      svg.append(s('line', { x1: x, x2: x + 16, y1: 12, y2: 12, class: L.cls }), s('text', { x: x + 21, y: 15.5, class: 'leg-t' }, L.label));
      x += 30 + L.label.length * 6;
    }
  }
  for (const p of o.points || []) if (isFinite(p.x) && isFinite(p.y)) svg.append(s('circle', { cx: X(p.x), cy: Y(clip(p.y)), r: p.r || 3.5, style: `fill:${p.color || 'var(--accent)'}` }));
  // onPick(x): a click in the plot reports the x value under it
  if (o.onPick) {
    svg.classList.add('pickable');
    svg.addEventListener('click', e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * w / r.width;
      o.onPick(x0 + (px - pad.l) / (w - pad.l - pad.r) * (x1 - x0));
    });
  }
  return svg;
}
const fmt = v => Math.abs(v) >= 1000 ? (v / 1000) + 'k' : String(+v.toPrecision(4));
export const extent = (vals, padFrac = 0.06) => { const f = vals.filter(isFinite); let lo = Math.min(...f), hi = Math.max(...f); if (lo === hi) { lo -= 1; hi += 1; } const p = (hi - lo) * padFrac; return [lo - p, hi + p]; };
