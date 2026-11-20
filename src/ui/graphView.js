// The coupling graph panel: every analysis node with its state (current / stale / running / failed) and run time.
import { s } from './dom.js';

const W = 310, BOX_H = 42, ROW = 82, PAD = 8;

export function graphSvg(graph) {
  const lv = graph.levels(), rows = new Map();
  for (const id of graph.order) { const l = lv.get(id); if (!rows.has(l)) rows.set(l, []); rows.get(l).push(id); }
  const pos = new Map();
  for (const [l, ids] of rows) {
    const n = ids.length, gap = 10, bw = Math.min(150, (W - 2 * PAD - gap * (n - 1)) / n), total = n * bw + (n - 1) * gap;
    ids.forEach((id, i) => pos.set(id, { x: (W - total) / 2 + i * (bw + gap), y: PAD + l * ROW, w: bw }));
  }
  const H = PAD * 2 + (rows.size - 1) * ROW + BOX_H;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Coupling graph: ' + graph.order.map(id => `${graph.nodes.get(id).label} ${graph.state.get(id).state}`).join(', ') });
  for (const id of graph.order) {
    const nd = graph.nodes.get(id), b = pos.get(id), st = graph.state.get(id).state;
    for (const a of nd.after) {
      const p = pos.get(a), x1 = p.x + p.w / 2, y1 = p.y + BOX_H, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
      svg.append(s('path', { d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, class: 'cg-edge' + (st === 'current' ? '' : ' stale') }));
    }
  }
  for (const id of graph.order) {
    const nd = graph.nodes.get(id), b = pos.get(id), st = graph.state.get(id);
    const out = st.outputs;
    let detail;
    if (st.state === 'running') detail = 'running…';
    else if (st.state === 'stale') detail = 'stale · queued';
    else if (st.state === 'failed') detail = 'failed';
    else detail = `${(out && out.method) ? shortMethod(out.method) : nd.detail || 'current'} · ${fmtMs(st.ms)}`;
    const g = s('g', { class: 'cg-node ' + st.state });
    g.append(s('title', {}, `${nd.label}: ${st.state}${st.error ? ' — ' + st.error : ''}${st.ms != null ? ` (${fmtMs(st.ms)})` : ''}`));
    g.append(s('rect', { x: b.x, y: b.y, width: b.w, height: BOX_H, rx: 8 }));
    g.append(s('text', { x: b.x + b.w / 2, y: b.y + 17, class: 't', 'text-anchor': 'middle' }, nd.label));
    g.append(s('text', { x: b.x + b.w / 2, y: b.y + 32, class: 'd', 'text-anchor': 'middle' }, detail));
    g.append(s('circle', { cx: b.x + b.w - 8, cy: b.y + 8, r: 3.5, class: 'cg-dot ' + st.state }));
    svg.append(g);
  }
  return svg;
}

const shortMethod = m => m.replace('Vortex lattice', 'VLM').replace('Lifting line (Glauert)', 'LLT');
export const fmtMs = ms => (ms == null ? '' : ms < 1 ? '<1 ms' : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`);

export function graphSummary(graph) {
  const states = [...graph.state.values()];
  const failed = states.filter(x => x.state === 'failed').length;
  if (graph.busy || states.some(x => x.state === 'running')) return { text: 'recomputing…', cls: '' };
  if (failed) return { text: `${failed} failed`, cls: 'bad' };
  if (states.some(x => x.state === 'stale')) return { text: 'stale', cls: 'warn' };
  const ms = states.reduce((t, x) => t + (x.ms || 0), 0);
  return { text: `current · ${fmtMs(ms)}`, cls: 'good' };
}
