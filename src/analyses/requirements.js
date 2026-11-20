// Requirements: a target on one analysis output, with a margin and a status.
//   metric "node.key" reads outputs[node][key]; op '>=' (at least) or '<=' (at most).
//   margin = how far the value is on the good side of the target, as a fraction of the target.
//   status: 'met' (margin ≥ 5%), 'marginal' (0 ≤ margin < 5%), 'fail' (margin < 0, or no value).

export const MARGINAL = 0.05;

export function readMetric(outputs, metric) {
  const [node, ...rest] = metric.split('.');
  let v = outputs[node];
  for (const k of rest) v = v == null ? undefined : v[k];
  return typeof v === 'number' ? v : NaN;
}

export function evaluate(req, value) {
  if (!isFinite(value)) return { ...req, value, margin: NaN, status: 'fail' };
  const scale = Math.abs(req.target) || 1;
  const margin = (req.op === '>=' ? value - req.target : req.target - value) / scale;
  return { ...req, value, margin, status: margin < 0 ? 'fail' : margin < MARGINAL ? 'marginal' : 'met' };
}

export function evaluateRequirements(reqs, outputs) {
  return reqs.map(r => evaluate(r, readMetric(outputs, r.metric)));
}
