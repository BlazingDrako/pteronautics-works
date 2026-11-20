// Small SVG line charts that follow the theme.
import { s } from './dom.js';

const nice = (lo, hi, n = 5) => {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(st => span / st <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(+v.toPrecision(10));
  return out;
};

// chart({ w, h, x: [lo, hi], y: [lo, hi], series: [{ pts: [[x, y]], cls }], marks: [{ x, label, cls }], xLabel, yLabel, compact })
export function chart(o) {
  const { w = 480, h = 260, compact = false } = o;
  const pad = compact ? { l: 30, r: 8, t: 8, b: 20 } : { l: 48, r: 14, t: 14, b: 36 };
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const X = v => pad.l + (v - x0) / (x1 - x0) * (w - pad.l - pad.r), Y = v => h - pad.b - (v - y0) / (y1 - y0) * (h - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': o.label || 'chart' });
  for (const v of nice(y0, y1, compact ? 3 : 5)) { svg.append(s('line', { x1: pad.l, x2: w - pad.r, y1: Y(v), y2: Y(v), class: 'grid-l' }), s('text', { x: pad.l - 5, y: Y(v) + 3.5, class: 'ax-t', 'text-anchor': 'end' }, fmt(v))); }
  for (const v of nice(x0, x1, compact ? 4 : 7)) svg.append(s('text', { x: X(v), y: h - pad.b + 13, class: 'ax-t', 'text-anchor': 'middle' }, fmt(v)));
  svg.append(s('path', { d: `M${pad.l},${pad.t} L${pad.l},${h - pad.b} L${w - pad.r},${h - pad.b}`, class: 'ax' }));
  if (o.xLabel) svg.append(s('text', { x: (pad.l + w - pad.r) / 2, y: h - 4, class: 'ax-label', 'text-anchor': 'middle' }, o.xLabel));
  if (o.yLabel) svg.append(s('text', { x: 12, y: (pad.t + h - pad.b) / 2, class: 'ax-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(pad.t + h - pad.b) / 2})` }, o.yLabel));
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
    if (m.label) svg.append(s('text', { x: X(m.x) + 3, y: pad.t + 10 + (m.row || 0) * 12, class: 'ax-t' }, m.label));
  }
  for (const p of o.points || []) if (isFinite(p.x) && isFinite(p.y)) svg.append(s('circle', { cx: X(p.x), cy: Y(clip(p.y)), r: p.r || 3.5, style: `fill:${p.color || 'var(--accent)'}` }));
  return svg;
}
const fmt = v => Math.abs(v) >= 1000 ? (v / 1000) + 'k' : String(+v.toPrecision(4));
export const extent = (vals, padFrac = 0.06) => { const f = vals.filter(isFinite); let lo = Math.min(...f), hi = Math.max(...f); if (lo === hi) { lo -= 1; hi += 1; } const p = (hi - lo) * padFrac; return [lo - p, hi + p]; };
