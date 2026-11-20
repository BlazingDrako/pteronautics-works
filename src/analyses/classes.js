// Which analysis graph runs on which vehicle class. Pages ask here rather than naming a graph themselves.
import { fixedWingNodes } from './fixedWing.js';
import { sailplaneNodes } from './sailplane.js';
import { hoverNode } from './rotors.js';
import { launcherNodes } from './launcher.js';

// lift + cruise eVTOL: the fixed-wing graph (wing-borne flight on the cruise propeller) with a Hover node
function evtolNodes(options) {
  const nodes = fixedWingNodes(options), i = nodes.findIndex(n => n.id === 'requirements');
  nodes.splice(i, 0, hoverNode());
  nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], after: [...nodes[nodes.length - 1].after, 'hover'] };
  // the mission's hover segments fly at the Hover node's figure of merit (fixed, or the blade-element one)
  const m = nodes.findIndex(n => n.id === 'mission'), mission = nodes[m];
  nodes[m] = { ...mission, after: [...mission.after, 'hover'], run: args => mission.run({ ...args, rotorFM: args.inputs.hover?.FM }) };
  return nodes;
}

const GRAPHS = { 'fixed-wing': fixedWingNodes, sailplane: sailplaneNodes, rotorcraft: evtolNodes, 'launch-vehicle': launcherNodes };
// the output a class is designed around (the default metric for its trade studies)
export const MAIN_METRIC = { 'fixed-wing': 'performance.endurance', sailplane: 'glide.xcSpeed', rotorcraft: 'mission.margin', 'launch-vehicle': 'orbit.payloadCapacity' };

export const hasGraph = doc => !!GRAPHS[doc?.class];
export function analysisNodes(doc, options) {
  const make = GRAPHS[doc.class];
  if (!make) throw new Error(`no analysis graph for class "${doc.class}"`);
  return make(options);
}
