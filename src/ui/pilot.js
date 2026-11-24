// The Pilot tab: flight dynamics and controls of a Works fixed-wing vehicle. The vehicle and flight condition on the
// left; the modes, open-loop responses and single-loop controller design in the centre; derivatives and handling
// qualities on the right; the mode numbers below. The vehicle's own coupling graph supplies the derivatives.
import { h, s, fx, minus } from './dom.js';
import { toolTopbar, numberField, selectField, segmented, derived, kv, plotCard, stat, subTabs, dur, table } from './tools.js';
import { chart, extent } from './charts.js';
import { allVehicles, loadVehicle } from '../model/store.js';
import { flies, solveVehicle, analyzeAt, modeRows, speedSweep, INPUTS, SHAPES, respond, LOOPS, loopDesign, suggestGain } from '../analyses/pilot.js';

const KEY = 'works-pilot';
const VIEWS = [{ id: 'modes', label: 'Modes' }, { id: 'response', label: 'Response' }, { id: 'loop', label: 'Loop design' }];
const DEFAULTS = { view: 'modes', input: 'elevator', shape: 'doublet', amp: 2, width: 0.6, T: 20, loop: 'q', K: null, wa: 20, Tcl: 8, sweep: true };
const LEVEL = { 1: ['Level 1', 'var(--good)'], 2: ['Level 2', 'var(--warn)'], 3: ['Level 3', 'var(--bad)'], 4: ['unacceptable', 'var(--bad)'] };
const levelTag = l => h('span', { class: 'status ' + (l === 1 ? 'met' : l === 2 ? 'marginal' : 'fail') }, LEVEL[l]?.[0] ?? '—');

function loadState() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
function saveState(S) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } }

export function renderPilot(root, { vehicle } = {}) {
  const S = loadState();
  const fleet = allVehicles().filter(flies);
  const left = h('aside', { class: 'col', 'aria-label': 'Vehicle and inputs' });
  const right = h('aside', { class: 'col right', 'aria-label': 'Derivatives and handling qualities' });
  const bar = h('div', { class: 'view-bar' });
  const canvas = h('div', { class: 'canvas' });
  const stats = h('div', { class: 'stats' });
  const pill = h('span', { class: 'pill' });
  root.replaceChildren(h('div', { class: 'ws' }, toolTopbar('pilot', pill),
    h('div', { class: 'ws-main' }, left, h('section', { class: 'pnl view', 'aria-label': 'Flight dynamics views' }, bar, canvas), right), stats));

  if (!fleet.length) { canvas.replaceChildren(h('div', { class: 'level-pane' }, h('div', { class: 'placeholder' }, 'No vehicle in the hangar has a stability analysis yet (fixed-wing, sailplane or eVTOL). Create one from the hangar first.'))); return; }
  const id = (vehicle && fleet.some(v => v.id === vehicle) ? vehicle : null) || S.vehicle && fleet.find(v => v.id === S.vehicle)?.id || fleet[0].id;
  let doc = loadVehicle(id), base = null, err = null, an = null, cond = null, R = {};
  if (S.vehicle !== id) S.K = null;          // a gain tuned on one vehicle means nothing on another
  S.vehicle = id;

  // the condition the vehicle's own graph analysed (its cruise, or a sailplane's design speed)
  const cruise = () => base ? { V: base.stability.an.d.V, z: base.stability.z } : { V: doc.mission.cruiseSpeed ?? 20, z: doc.mission.altitude ?? 0 };
  function solve() {
    try { base = solveVehicle(doc); err = null; } catch (e) { base = null; err = e.message; }
    cond = cruise();
    if (base && !(S.K > 0)) S.K = null;
  }
  function analyse() {
    if (!base) { an = null; return; }
    try { an = analyzeAt(base, cond); } catch (e) { an = null; err = e.message; }
    R = {};
    if (!an) return;
    if (S.K === null || !(S.K > 0)) S.K = suggestGain(an, S.loop, S.wa);
    R.modes = modeRows(an);
    const p = base.performance, Vs = p ? p.Vs : cond.V * 0.6, Vtop = p && isFinite(p.Vmax) ? p.Vmax : cond.V * 1.6;
    R.sweep = S.sweep ? speedSweep(base, { z: cond.z, V0: Math.max(Vs * 1.1, 5), V1: Math.max(Vtop, Vs * 1.6) }) : null;
  }
  function update({ left: L = false, all = true } = {}) { analyse(); saveState(S); if (L) paintLeft(); paintRight(); paintView(); paintStats(); paintPill(); }

  // ---------- left ----------
  function paintLeft() {
    const p = base?.performance, Vs = p?.Vs ?? 10;
    left.replaceChildren(...[
      h('div', { class: 'pnl pnl-pad' },
        h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Vehicle'), h('a', { href: '#/v/' + doc.id, style: { fontSize: '12px' } }, 'Open in workspace →')),
        selectField('Fly', doc.id, fleet.map(v => ({ value: v.id, label: v.name })), v => { location.hash = '#/pilot/' + v; }),
        base ? h('p', { class: 'note' }, `Derivatives from ${doc.name}'s coupling graph (${base.aero.method}, ${fx(base.mass.total, 2)} kg, CG ${fx(base.mass.h * 100, 1)}% MAC). Edits in the workspace show here.`) : null),
      h('div', { class: 'pnl pnl-pad' },
        h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Flight condition'), h('button', { class: 'btn small', type: 'button', title: `Back to ${doc.name}'s cruise condition`, onclick: () => { cond = cruise(); update({ left: true }); } }, 'Cruise')),
        numberField('True airspeed', 'm/s', cond.V, { min: Math.max(1, Vs * 1.02), max: 300, step: 0.1, smin: Math.max(1, Vs * 1.05), smax: Math.max(cond.V * 1.8, (p?.Vmax || 0) * 1.05) }, v => { cond.V = v; update(); }),
        numberField('Altitude (ISA)', 'm', cond.z, { min: 0, max: 15000, step: 10, smax: 6000 }, v => { cond.z = v; update(); }),
        h('div', { class: 'note', id: 'pilot-trim' })),
      S.view === 'response' ? h('div', { class: 'pnl pnl-pad' },
        h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Control input'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'open loop')),
        segmented('Surface', S.input, INPUTS.map(i => ({ value: i.id, label: i.label })), v => { S.input = v; update({ left: true }); }),
        segmented('Shape', S.shape, SHAPES.map(i => ({ value: i.id, label: i.label })), v => { S.shape = v; update({ left: true }); }),
        numberField('Amplitude', '°', S.amp, { min: -15, max: 15, step: 0.1, smin: -5, smax: 5 }, v => { S.amp = v; update(); }),
        S.shape !== 'step' ? numberField('Width', 's', S.width, { min: 0.05, max: 10, step: 0.05, smax: 4 }, v => { S.width = v; update(); }) : null,
        numberField('Simulated time', 's', S.T, { min: 2, max: 300, step: 1, smax: 120 }, v => { S.T = v; update(); }),
        h('p', { class: 'note' }, S.input === 'elevator' ? 'Positive elevator is trailing edge down (nose down).' : S.input === 'aileron' ? 'Positive aileron rolls right.' : 'Positive rudder is trailing edge left (nose left).')) : null,
      S.view === 'loop' ? loopPanel() : null].filter(Boolean));
    paintTrim();
  }
  function loopPanel() {
    const lg = Math.log10(S.K || 1);
    const L = LOOPS.find(l => l.id === S.loop);
    return h('div', { class: 'pnl pnl-pad' },
      h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Controller'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'K · actuator')),
      selectField('Loop', S.loop, LOOPS.map(l => ({ value: l.id, label: l.label })), v => { S.loop = v; S.K = null; update({ left: true }); }),
      numberField('Gain K (log₁₀)', '', lg, { min: -4, max: 3, step: 0.01, smin: Math.min(lg - 2, -2), smax: Math.max(lg + 2, 1) }, v => { S.K = 10 ** v; kNote.textContent = kText(L); update(); }),
      kNote = h('div', { class: 'note' }, kText(L)),
      numberField('Actuator bandwidth', 'rad/s', S.wa, { min: 0, max: 200, step: 0.5, smax: 60 }, v => { S.wa = v; update(); }),
      numberField('Step response time', 's', S.Tcl, { min: 1, max: 120, step: 1, smax: 40 }, v => { S.Tcl = v; update(); }),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } },
        h('button', { class: 'btn small', type: 'button', title: 'Pick the gain that puts the crossover near 3 rad/s', onclick: () => { S.K = suggestGain(an, S.loop, S.wa, 3); update({ left: true }); } }, 'Suggest gain')),
      h('p', { class: 'note' }, `Negative feedback of ${L.label.toLowerCase()} to the ${L.input}. Actuator 0 means an ideal one.`));
  }
  let kNote;
  const kText = L => `K = ${fx(S.K, S.K < 0.1 ? 4 : 3)}° of ${L.input} per ${L.unit} of ${L.short} (${L.role}).`;
  function paintTrim() {
    const n = left.querySelector('#pilot-trim'); if (!n) return;
    if (!an) { n.textContent = err ? 'Cannot analyse: ' + err : ''; return; }
    const D = Math.PI / 180, tr = an.trim;
    n.textContent = `Trimmed at α ${minus(fx(tr.alpha / D, 1))}°, elevator ${minus(fx(tr.de / D, 1))}°, CL ${fx(an.d.CLtrim, 3)}, Mach ${fx(an.d.M, 3)}. Static margin ${minus(fx(an.d.SM * 100, 1))}% MAC.`;
  }

  // ---------- right ----------
  function paintRight() {
    if (!an) { right.replaceChildren(h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec' }, 'Derivatives'), h('p', { class: 'note' }, err || 'Not computed.'))); return; }
    const d = an.d, f = (v, n = 3) => minus(fx(v, n));
    const hq = an.hq;
    right.replaceChildren(
      h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Handling qualities'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'MIL-F-8785C, cat. B')),
        ...R.modes.map(m => h('div', { class: 'derived' }, h('span', {}, m.name), levelTag(m.level))),
        isFinite(hq.cap) ? derived('CAP (ωsp² / nα)', fx(hq.cap, 3), 'Control anticipation parameter') : null),
      h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Longitudinal'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'per rad')),
        derived('CLα', f(d.CLa)), derived('Cmα', f(d.Cma)), derived('Cmq', f(d.Cmq, 2)), derived('Cmα̇', f(d.Cmad, 2)), derived('CLδe', f(d.CLde)), derived('Cmδe', f(d.Cmde)),
        derived('Downwash dε/dα', f(d.deda)), derived('Tail volume VH', f(d.VH))),
      h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Lateral-directional'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'per rad')),
        derived('Cyβ', f(d.Cyb)), derived('Clβ (dihedral effect)', f(d.Clb, 4)), derived('Cnβ (weathercock)', f(d.Cnb, 4)), derived('Clp', f(d.Clp)), derived('Cnr', f(d.Cnr, 4)),
        derived('Clr', f(d.Clr, 4)), derived('Clδa', f(d.Clda, 4)), derived('Cnδr', f(d.Cndr, 4))),
      h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Inertia'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'kg·m²')),
        derived('Ixx', fx(d.Ixx, 3)), derived('Iyy', fx(d.Iyy, 3)), derived('Izz', fx(d.Izz, 3)), derived('Dynamic pressure', `${fx(d.q, 1)} Pa`)));
  }

  // ---------- centre ----------
  function paintView() {
    bar.replaceChildren(subTabs(VIEWS, S.view, v => { S.view = v; saveState(S); paintLeft(); paintView(); }), h('span', { class: 'grow' }),
      S.view === 'modes' ? h('button', { class: 'tg sm' + (S.sweep ? ' on' : ''), type: 'button', 'aria-pressed': S.sweep ? 'true' : 'false', title: 'Show how the roots move across the speed range', onclick: () => { S.sweep = !S.sweep; update(); } }, 'Roots across speed') : '');
    if (!an) { canvas.replaceChildren(h('div', { class: 'level-pane' }, h('div', { class: 'placeholder' }, `${doc.name} cannot be analysed: ${err}. Fix it in the workspace.`))); return; }
    canvas.replaceChildren(S.view === 'response' ? responsePane() : S.view === 'loop' ? loopPane() : modesPane());
  }

  function modesPane() {
    const roots = [...an.L.roots.map(r => ({ r, c: 'var(--accent)' })), ...an.Lt.roots.map(r => ({ r, c: 'var(--hl)' }))];
    const sw = R.sweep || [], all = [...roots.map(x => x.r), ...sw.flatMap(p => [...p.lon, ...p.lat])];
    const xr = extent([...all.map(z => z[0]), 0], 0.1), yr = extent([...all.map(z => z[1]), 0], 0.1);
    const pts = [];
    sw.forEach((p, k) => { const a = 0.18 + 0.5 * k / Math.max(1, sw.length - 1); for (const z of p.lon) pts.push({ x: z[0], y: z[1], r: 2.2, color: `color-mix(in srgb, var(--accent) ${a * 100}%, transparent)` }); for (const z of p.lat) pts.push({ x: z[0], y: z[1], r: 2.2, color: `color-mix(in srgb, var(--hl) ${a * 100}%, transparent)` }); });
    pts.push(...roots.map(({ r, c }) => ({ x: r[0], y: r[1], color: c, r: 5 })));
    const plane = chart({ w: 900, h: 330, x: xr, y: yr, xLabel: 'Real part (1/s)', yLabel: 'Imaginary part (rad/s)', label: 'Eigenvalues in the s-plane',
      series: [{ pts: [[0, yr[0]], [0, yr[1]]], cls: 's-muted' }], hmarks: [{ y: 0, cls: 'grid-l' }], points: pts,
      legend: [{ label: 'Longitudinal', cls: 's-accent' }, { label: 'Lateral-directional', cls: 's-hl' }] });
    const ms = R.modes;
    const t = v => (isFinite(v) ? dur(v) : '—');
    const rows = ms.map(m => [m.name, m.kind === 'oscillatory' ? `${minus(fx(m.re, 3))} ± ${fx(m.im, 3)}j` : isFinite(m.re) ? minus(fx(m.re, 4)) : '—',
      fx(m.wn, 3), fx(m.zeta, 3), t(m.period), m.re > 0 ? h('span', { style: { color: 'var(--bad)' } }, `doubles in ${t(m.t2)}`) : `halves in ${t(m.thalf)}`, levelTag(m.level)]);
    return h('div', { class: 'level-pane' },
      h('h3', {}, `Modes at ${fx(cond.V, 1)} m/s, ${fx(cond.z, 0)} m`),
      h('div', { class: 'note' }, `Linear small-disturbance models about trimmed level flight: [u, w, q, θ] and [β, p, r, φ]. Large dots are this condition${S.sweep && sw.length ? `; the trail of small dots runs from ${fx(sw[0].V, 1)} m/s (faint) to ${fx(sw[sw.length - 1].V, 1)} m/s` : ''}.`),
      plotCard('s-plane', plane),
      table(['Mode', 'Root (1/s)', 'ωn (rad/s)', 'ζ', 'Period', 'Time to half', 'Handling'], rows));
  }

  function responsePane() {
    const r = respond(an, { input: S.input, shape: S.shape, amp: S.amp, width: S.width, T: S.T });
    const inp = INPUTS.find(i => i.id === S.input);
    const mini = se => {
      const yr = extent([...se.y, 0], 0.1);
      return plotCard(`${se.label} (${se.unit})`, chart({ w: 440, h: 190, x: [0, S.T], y: yr, xLabel: 'Time (s)', label: se.label, series: [{ pts: r.t.map((t, i) => [t, se.y[i]]), cls: 's-accent' }], hmarks: [{ y: 0, cls: 'grid-l' }] }));
    };
    const uChart = chart({ w: 900, h: 120, compact: false, x: [0, S.T], y: extent([...r.u, 0], 0.2), xLabel: 'Time (s)', yLabel: '°', label: `${inp.label} input`, series: [{ pts: r.t.map((t, i) => [t, r.u[i]]), cls: 's-hl' }] });
    const fmax = se => { const k = se.y.reduce((b, v, i) => (Math.abs(v) > Math.abs(se.y[b]) ? i : b), 0); return `${minus(fx(se.y[k], 2))} ${se.unit} at ${fx(r.t[k], 1)} s`; };
    return h('div', { class: 'level-pane' },
      h('h3', {}, `${inp.label} ${SHAPES.find(x => x.id === S.shape).label.toLowerCase()} · ${minus(fx(S.amp, 1))}°${S.shape !== 'step' ? ` for ${fx(S.width, 2)} s` : ''}`),
      h('div', { class: 'note' }, `Changes from trim, linear model, controls fixed after the input. ${r.axis === 'lon' ? 'Watch the short period settle in the first seconds and the slow phugoid exchange of speed and height after.' : 'Watch the Dutch roll (β and r out of phase), the roll subsidence in p, and the spiral in φ.'}`),
      r.diverged ? h('div', { class: 'placeholder', style: { color: 'var(--bad)' } }, 'The response diverged before the end of the run (an unstable mode).') : null,
      plotCard(`${inp.label} (°)`, uChart),
      h('div', { class: 'resp-grid' }, r.series.map(mini)),
      h('div', { class: 'kv' }, r.series.map(se => kv(`Largest ${se.label.split(' ').slice(-1)[0]}`, fmax(se)))));
  }

  function loopPane() {
    const L = LOOPS.find(l => l.id === S.loop);
    const res = loopDesign(an, { loop: S.loop, K: S.K, wa: S.wa, T: S.Tcl });
    const m = res.margins, pm = m.pm, gmUp = m.gmUp, gmDown = m.gmDown;
    // root locus
    const branches = res.locus, olp = res.olPoles, olz = res.olZeros, cl = res.cl;
    const pool = [...olp, ...olz, ...cl, ...branches.flat().map(p => [p.re, p.im])].filter(z => Math.hypot(...z) < 60 * Math.max(1, ...olp.map(z => Math.hypot(...z))));
    const span = Math.max(...pool.map(z => Math.max(Math.abs(z[0]), Math.abs(z[1]))), 1);
    const lim = Math.min(span, Math.max(4 * Math.max(...cl.map(z => Math.hypot(...z)), ...olp.map(z => Math.hypot(...z))), 2)) * 1.1;
    const locus = chart({ w: 440, h: 300, x: [-lim, lim * 0.35], y: [-lim * 0.75, lim * 0.75], xLabel: 'Real (1/s)', yLabel: 'Imaginary (rad/s)', label: 'Root locus against the gain',
      series: [{ pts: [[0, -lim], [0, lim]], cls: 's-muted' }, ...branches.map(b => ({ pts: b.map(p => [p.re, p.im]), cls: 's-good' }))],
      hmarks: [{ y: 0, cls: 'grid-l' }],
      points: [...olp.map(z => ({ x: z[0], y: z[1], color: 'var(--text-3)', r: 4 })), ...olz.map(z => ({ x: z[0], y: z[1], color: 'var(--text-2)', r: 2.5 })), ...cl.map(z => ({ x: z[0], y: z[1], color: z[0] < 0 ? 'var(--accent)' : 'var(--bad)', r: 5 }))] });
    // Bode
    const bd = res.bode, lw = bd.map(p => Math.log10(p.w));
    const xw = [lw[0], lw[lw.length - 1]], wf = v => { const x = 10 ** v; return x >= 1 ? fx(x, 0) : fx(x, x >= 0.1 ? 1 : 2); };
    const mag = chart({ w: 440, h: 170, x: xw, y: extent(bd.map(p => Math.max(-80, Math.min(60, p.db))), 0.05), xFmt: wf, yLabel: 'dB', label: 'Loop gain', series: [{ pts: bd.map((p, i) => [lw[i], p.db]), cls: 's-accent' }], hmarks: [{ y: 0, cls: 's-warn' }], marks: pm ? [{ x: Math.log10(pm.w), cls: 's-hl' }] : [] });
    const ph = chart({ w: 440, h: 170, x: xw, y: extent([...bd.map(p => p.ph * 180 / Math.PI), -180], 0.05), xFmt: wf, xLabel: 'Frequency ω (rad/s)', yLabel: 'deg', label: 'Loop phase', series: [{ pts: bd.map((p, i) => [lw[i], p.ph * 180 / Math.PI]), cls: 's-accent' }], hmarks: [{ y: -180, cls: 's-warn' }], marks: pm ? [{ x: Math.log10(pm.w), cls: 's-hl' }] : [] });
    // closed-loop step
    const st = res.step, yr = extent([...st.y.filter(isFinite), 0, 1], 0.08);
    const step = chart({ w: 900, h: 220, x: [0, S.Tcl], y: [Math.max(yr[0], -3), Math.min(yr[1], 4)], xLabel: 'Time (s)', yLabel: `${L.short} per unit command`, label: 'Closed-loop step response',
      series: [{ pts: st.t.map((t, i) => [t, st.y[i]]), cls: 's-accent' }], hmarks: [{ y: 1, cls: 's-warn' }, { y: 0, cls: 'grid-l' }] });
    const info = res.info;
    return h('div', { class: 'level-pane' },
      h('h3', {}, `${L.label} loop · ${L.role} · K ${fx(S.K, S.K < 0.1 ? 4 : 3)}`),
      h('div', { class: 'note' }, `Plant: ${L.label.toLowerCase()} per degree of ${L.input}, from the linear model at ${fx(cond.V, 1)} m/s${S.wa > 0 ? `, behind a first-order actuator at ${fx(S.wa, 1)} rad/s` : ''}. Grey dots: open-loop poles; blue: closed-loop poles at this gain (red if unstable); green: where they travel as K grows.`),
      h('div', { class: 'kv' },
        kv('Closed loop', h('span', { style: { color: res.stable ? 'var(--good)' : 'var(--bad)' } }, res.stable ? 'stable' : 'unstable')),
        kv('Phase margin', pm ? `${fx(pm.pmDeg, 1)}° at ${fx(pm.w, 2)} rad/s` : 'no crossover'),
        kv('Gain margin', gmUp ? `+${fx(gmUp.gmDb, 1)} dB` : '∞') , gmDown ? kv('Gain reduction margin', `${fx(gmDown.gmDb, 1)} dB`) : null,
        kv('Delay margin', pm && pm.delay > 0 ? `${fx(pm.delay * 1000, 0)} ms` : '—'),
        info ? kv('Rise time (10–90%)', isFinite(info.rise) ? `${fx(info.rise, 2)} s` : '—') : null,
        info ? kv('Overshoot', isFinite(info.overshoot) ? `${fx(info.overshoot * 100, 0)}%` : '—') : null,
        info ? kv('Settling (2%)', isFinite(info.settle) ? `${fx(info.settle, 2)} s` : 'beyond the run') : null,
        info ? kv('Steady state', fx(info.final, 3)) : null),
      info && Math.abs(info.final) < 1e-6 ? h('div', { class: 'note' }, `The plant has a zero at the origin, so a held ${L.short} command gives no steady ${L.short}: this loop damps the motion rather than holding a value.`) : null,
      h('div', { class: 'resp-grid' }, plotCard('Root locus', locus), h('div', { class: 'plot-card bode' }, h('h4', {}, 'Bode plot of the loop'), mag, ph)),
      plotCard('Closed-loop step response', step, res.stable ? null : 'The closed loop is unstable at this gain: change K or the loop.'));
  }

  // ---------- bottom ----------
  function paintStats() {
    if (!an) { stats.replaceChildren(); return; }
    const { L, Lt } = an, sp = L.sp, ph = L.ph, dr = Lt.dr, roll = Lt.roll, spi = Lt.spiral, hq = an.hq;
    const c = l => (l === 1 ? null : l === 2 ? 'var(--warn)' : 'var(--bad)');
    stats.replaceChildren(
      stat('Short period ζ', sp.real ? 'real' : fx(sp.zeta, 2), '', sp.real ? 'overdamped' : `ωn ${fx(sp.wn, 2)} rad/s`, c(hq.sp)),
      stat('Phugoid period', ph.real ? 'real' : fx(ph.period, 1), ph.real ? '' : 's', ph.real ? '' : `ζ ${fx(ph.zeta, 3)}`, c(hq.ph)),
      stat('Dutch roll ζ', dr ? fx(dr.zeta, 3) : '—', '', dr ? `ωn ${fx(dr.wn, 2)} rad/s · ${fx(dr.period, 2)} s` : '', c(hq.dr)),
      stat('Roll time constant', roll ? fx(roll.tau, 2) : '—', 's', 'roll subsidence', c(hq.roll)),
      stat('Spiral', spi ? (spi.re > 0 ? fx(spi.t2, 0) : fx(spi.thalf, 0)) : '—', 's', spi ? (spi.re > 0 ? 'time to double' : 'time to half') : '', c(hq.spiral)),
      stat('Static margin', minus(fx(an.d.SM * 100, 1)), '% MAC', `at ${fx(cond.V, 1)} m/s`));
  }
  function paintPill() { pill.replaceChildren('Flying ', h('b', {}, doc.name), ` · rev ${doc.revision}`); }

  addEventListener('themechange', () => { if (canvas.isConnected) paintView(); });
  solve(); analyse(); paintLeft(); update();
  window.__pilot = { S, get an() { return an; }, get cond() { return cond; } };
}
