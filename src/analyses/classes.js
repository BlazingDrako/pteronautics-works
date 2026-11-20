// Which analysis graph runs on which vehicle class. Pages ask here rather than naming a graph themselves.
import { fixedWingNodes } from './fixedWing.js';
import { sailplaneNodes } from './sailplane.js';

const GRAPHS = { 'fixed-wing': fixedWingNodes, sailplane: sailplaneNodes };
// the output a class is designed around (the default metric for its trade studies)
export const MAIN_METRIC = { 'fixed-wing': 'performance.endurance', sailplane: 'glide.xcSpeed' };

export const hasGraph = doc => !!GRAPHS[doc?.class];
export function analysisNodes(doc, options) {
  const make = GRAPHS[doc.class];
  if (!make) throw new Error(`no analysis graph for class "${doc.class}"`);
  return make(options);
}
