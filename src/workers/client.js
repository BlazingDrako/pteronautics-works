// A small client for the airfoil worker. Each AirfoilWorker runs one request at a time; a new request through
// `latest()` supersedes the one in flight (the worker is restarted, so a long polar sweep stops at once).
// Where module workers are not available (the tests run in a page that has them, but be safe) it solves inline.
import { AirfoilSession, solvePoint, sweepPolar } from '../adapters/airfoil.js';

const WORKER_URL = new URL('./airfoil.worker.js', import.meta.url);

export class AirfoilWorker {
  constructor() { this.seq = 0; this.w = null; this.pending = new Map(); }

  _worker() {
    if (this.w) return this.w;
    try { this.w = new Worker(WORKER_URL, { type: 'module' }); } catch { this.w = null; return null; }
    this.w.onmessage = ({ data }) => {
      const p = this.pending.get(data.id); if (!p) return;
      if (data.type === 'progress') { p.onProgress && p.onProgress(data); return; }
      this.pending.delete(data.id);
      data.type === 'done' ? p.resolve(data.result) : p.reject(new Error(data.message));
    };
    this.w.onerror = e => { for (const p of this.pending.values()) p.reject(new Error(e.message || 'airfoil worker failed')); this.pending.clear(); this.w = null; };
    return this.w;
  }

  request(msg, onProgress) {
    const w = this._worker();
    if (!w) return inline(msg, onProgress);
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, onProgress }); w.postMessage({ id, ...msg }); });
  }

  // Cancel whatever is running (its promise rejects with a 'superseded' error) and start this request
  latest(msg, onProgress) { this.cancel(); return this.request(msg, onProgress); }

  cancel() {
    if (!this.pending.size) return;
    for (const p of this.pending.values()) { const e = new Error('superseded'); e.superseded = true; p.reject(e); }
    this.pending.clear();
    if (this.w) { this.w.terminate(); this.w = null; }
  }

  point(op) { return this.request({ type: 'point', op }); }
  polar(args, onProgress) { return this.request({ type: 'polar', args }, onProgress); }
}

let inlineSession = null;
async function inline(msg, onProgress) {
  inlineSession = inlineSession || new AirfoilSession();
  if (msg.type === 'point') return solvePoint(inlineSession, msg.op);
  return sweepPolar(inlineSession, { ...msg.args, onPoint: (point, points) => onProgress && onProgress({ point, points }) });
}
