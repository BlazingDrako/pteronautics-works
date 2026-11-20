// Airfoil worker: runs mfoil off the main thread for the airfoil lab and the viscous sections node.
// Messages in:  { id, type: 'point', op }  |  { id, type: 'polar', args }
// Messages out: { id, type: 'progress', point, points }  |  { id, type: 'done', result }  |  { id, type: 'error', message }
import { AirfoilSession, solvePoint, sweepPolar } from '../adapters/airfoil.js';

const session = new AirfoilSession();
const polars = new Map();                    // finished polars by key, so repeated requests come back at once

self.onmessage = ({ data: { id, type, op, args } }) => {
  try {
    if (type === 'point') return self.postMessage({ id, type: 'done', result: solvePoint(session, op) });
    if (type === 'polar') {
      const key = JSON.stringify(args);
      let result = polars.get(key);
      if (!result) {
        result = sweepPolar(session, { ...args, onPoint: (point, points) => self.postMessage({ id, type: 'progress', point, points }) });
        polars.set(key, result);
        if (polars.size > 40) polars.delete(polars.keys().next().value);
      }
      return self.postMessage({ id, type: 'done', result });
    }
    throw new Error('unknown request ' + type);
  } catch (e) { self.postMessage({ id, type: 'error', message: e.message || String(e) }); }
};
