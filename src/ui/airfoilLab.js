// The airfoil lab: the Section and Boundary layer zoom levels. It runs the core's mfoil viscous panel method in a
// worker at a wing station's chord, Reynolds number and local lift (or at whatever you set), and shows the
// pressure distribution with the boundary layer drawn on the section, polars swept progressively, and the
// boundary-layer quantities along both surfaces.
import { h, s, fx, minus, toast } from './dom.js';
import { chart, extent } from './charts.js';
import { AirfoilWorker } from '../workers/client.js';
import { NPANEL } from '../adapters/airfoil.js';
import { firstOf } from '../model/vehicle.js';

const kv = (k, v, title) => h('div', { title }, h('span', {}, k), h('b', {}, v));
const card = (title, sub, el) => h('div', { class: 'plot-card' }, h('h4', {}, title, sub ? h('span', { class: 'sub' }, sub) : null), el);

export function createAirfoilLab({ doc, edit, onNavigate }) {
  const lab = { eta: 0.45, code: null, mode: 'cl', alpha: 4, cl: null, Re: null, ncrit: 9, viscous: true };
  const pointW = new AirfoilWorker(), polarW = new AirfoilWorker();
  let out = {}, res = null, resKey = '', polar = null, polarKey = '', pending = false, polarBusy = false, err = null;
  const els = { section: null, bl: null };

  // ---------- the operating point the lab is at (station defaults, with the user's overrides) ----------
  function station() {
    const g = out.geometry, ae = out.aero, st = out.stability, atm = out.atmosphere;
    if (!g || !atm) return null;
    const eta = lab.eta, c = g.P.chord(eta), V = doc.mission.cruiseSpeed;
    let clLocal = null;
    if (ae && st) { const strips = ae.spanLoad(st.CLtrim); let best = strips[0]; for (const p of strips) if (Math.abs(p.eta - eta) < Math.abs(best.eta - eta)) best = p; clLocal = best.cl; }
    const wingCode = eta < 0.5 ? g.wing.rootAirfoil : g.wing.tipAirfoil;
    const ReAuto = atm.cruise.rho * V * c / atm.cruise.mu;
    return { eta, c, V, clLocal, wingCode: String(wingCode).padStart(4, '0'), ReAuto, Ma: V / atm.cruise.a };
  }
  function opOf(stn) {
    const code = lab.code || stn.wingCode, Re = lab.Re || Math.round(stn.ReAuto / 1000) * 1000;
    const cl = lab.cl ?? (stn.clLocal != null ? +stn.clLocal.toFixed(3) : 0.5);
    return { code, Re, Ma: Math.round(stn.Ma * 1000) / 1000, ncrit: lab.ncrit, viscous: lab.viscous, mode: lab.mode, alpha: lab.alpha, cl, npanel: NPANEL };
  }

  function request() {
    const stn = station(); if (!stn) return;
    const op = opOf(stn), key = JSON.stringify(op);
    if (key !== resKey) {
      resKey = key; pending = true; err = null; paintStatus();
      pointW.latest({ type: 'point', op }).then(r => {
        if (key !== resKey) return;
        pending = false; res = { ...r, op };
        if (!r.ok || (op.viscous && !r.conv)) err = op.viscous ? 'The viscous solution did not converge here (try a lower α or cℓ, or inviscid).' : 'No solution.';
        paintResult();
      }).catch(e => { if (!e.superseded && key === resKey) { pending = false; err = e.message; paintStatus(); } });
    }
    const pargs = { code: op.code, Re: op.Re, Ma: op.Ma, ncrit: op.ncrit, npanel: NPANEL };
    const pkey = JSON.stringify(pargs);
    if (op.viscous && pkey !== polarKey) {
      polarKey = pkey; polar = { ...pargs, points: [] }; polarBusy = true; paintPolars();
      polarW.cancel();
      polarW.polar(pargs, ({ points }) => { if (pkey === polarKey) { polar = { ...pargs, points }; paintPolars(); } })
        .then(p => { if (pkey === polarKey) { polar = p; polarBusy = false; paintPolars(); } })
        .catch(e => { if (!e.superseded && pkey === polarKey) { polarBusy = false; paintPolars(); } });
    }
  }

  // ---------- Section level ----------
  const parts = {};
  function buildSection() {
    parts.title = h('h3'); parts.status = h('span', { class: 'lab-status' });
    parts.controls = h('div', { class: 'lab-controls' });
    parts.cp = h('div'); parts.kv = h('div', { class: 'kv' }); parts.polars = h('div', { class: 'lab-polars' });
    parts.apply = h('div', { class: 'row', style: { gap: '6px' } });
    return h('div', { class: 'level-pane lab' },
      h('div', { class: 'sec-row', style: { alignItems: 'baseline' } }, parts.title, parts.status),
      h('div', { class: 'note' }, 'mfoil (the core\'s port of Fidkowski\'s viscous panel method, coupled integral boundary layer with eN transition) at a wing station. It follows the station\'s chord, Reynolds number and local cℓ at cruise trim until you override them; ', h('i', {}, 'auto'), ' puts a field back on the wing.'),
      parts.controls, parts.apply,
      h('div', { class: 'lab-grid' }, card('Pressure and boundary layer', '−Cp against x/c · section with δ* to scale', parts.cp), parts.polars),
      parts.kv);
  }

  function field(label, input, auto) {
    return h('label', { class: 'lab-f' }, h('span', {}, label, auto ? h('button', { class: 'auto' + (auto.on ? ' on' : ''), type: 'button', title: auto.title, onclick: e => { e.preventDefault(); auto.reset(); } }, 'auto') : null), input);
  }
  function numIn(value, { min, max, step }, onChange, label) {
    const el = h('input', { class: 'num', type: 'number', min, max, step, value, 'aria-label': label });
    el.addEventListener('change', () => { const v = +el.value; if (el.value === '' || !isFinite(v) || v < min || v > max) { el.classList.add('invalid'); toast(`${label} must be between ${min} and ${max}`, true); return; } el.classList.remove('invalid'); onChange(v); });
    return el;
  }
  function paintControls() {
    const stn = station(); if (!stn || !parts.controls) return;
    const op = opOf(stn);
    const eta = h('input', { type: 'range', min: 0.02, max: 0.98, step: 0.01, value: lab.eta, 'aria-label': 'Span station η' });
    const etaOut = h('b', { class: 'mono' }, fx(lab.eta, 2));
    eta.addEventListener('input', () => { lab.eta = +eta.value; etaOut.textContent = fx(lab.eta, 2); eta.style.setProperty('--fill', ((lab.eta - 0.02) / 0.96 * 100) + '%'); });
    eta.addEventListener('change', () => refreshAll());
    eta.style.setProperty('--fill', ((lab.eta - 0.02) / 0.96 * 100) + '%');
    const code = h('input', { class: 'txt', type: 'text', value: op.code, maxlength: 4, inputmode: 'numeric', 'aria-label': 'NACA code', style: { width: '74px' } });
    code.addEventListener('change', () => { const v = code.value.trim(); if (!/^\d{4}$/.test(v) || +v.slice(2) < 4) { code.classList.add('invalid'); toast('Use a NACA 4-digit code with at least 4% thickness, for example 2412', true); return; } lab.code = v === stn.wingCode ? null : v; refreshAll(); });
    const modeBtns = h('span', { class: 'opts' }, ...[['alpha', 'α'], ['cl', 'cℓ']].map(([m, t]) => h('button', { class: 'tg sm' + (lab.mode === m ? ' on' : ''), type: 'button', 'aria-pressed': lab.mode === m ? 'true' : 'false', onclick: () => { lab.mode = m; refreshAll(); } }, t)));
    const value = lab.mode === 'alpha'
      ? numIn(lab.alpha, { min: -10, max: 20, step: 0.5 }, v => { lab.alpha = v; refreshAll(); }, 'Angle of attack (deg)')
      : numIn(op.cl, { min: -0.5, max: 1.8, step: 0.05 }, v => { lab.cl = v; refreshAll(); }, 'Lift coefficient');
    const re = numIn(op.Re, { min: 2e4, max: 2e7, step: 1000 }, v => { lab.Re = v; refreshAll(); }, 'Reynolds number');
    const nc = numIn(lab.ncrit, { min: 1, max: 14, step: 0.5 }, v => { lab.ncrit = v; refreshAll(); }, 'Ncrit');
    const visc = h('input', { type: 'checkbox', checked: lab.viscous }); visc.addEventListener('change', () => { lab.viscous = visc.checked; refreshAll(); });
    parts.controls.replaceChildren(
      h('label', { class: 'lab-f wide' }, h('span', {}, 'Span station η ', etaOut, h('small', {}, ` · chord ${fx(stn.c * 1000, 0)} mm`)), eta),
      field('NACA', code, { on: !lab.code, title: 'Use the wing\'s airfoil at this station', reset: () => { lab.code = null; refreshAll(); } }),
      h('label', { class: 'lab-f' }, h('span', {}, 'Solve for'), h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, modeBtns, value)),
      field('Reynolds', re, { on: !lab.Re, title: 'Use the station\'s Reynolds number at cruise', reset: () => { lab.Re = null; refreshAll(); } }),
      field('Ncrit', nc),
      h('label', { class: 'toggle lab-f', style: { alignSelf: 'end', minWidth: '110px' } }, h('span', {}, 'Viscous'), visc, h('span', { class: 'sw' })));
    if (lab.mode === 'cl' && lab.cl != null) parts.controls.children[2].querySelector('span').append(h('button', { class: 'auto', type: 'button', title: 'Use the station\'s local cℓ at cruise trim', onclick: () => { lab.cl = null; refreshAll(); } }, 'auto'));
    // apply a different section to the wing
    const g = out.geometry, w = g && g.wing;
    parts.apply.replaceChildren(...(lab.code && w ? [
      h('span', { class: 'muted', style: { fontSize: '12px' } }, `NACA ${lab.code} is not on the wing.`),
      h('button', { class: 'btn small', type: 'button', onclick: () => apply('rootAirfoil') }, `Use as root airfoil (now ${w.rootAirfoil})`),
      h('button', { class: 'btn small', type: 'button', onclick: () => apply('tipAirfoil') }, `Use as tip airfoil (now ${w.tipAirfoil})`),
      h('button', { class: 'btn small', type: 'button', onclick: () => { apply('rootAirfoil'); apply('tipAirfoil'); } }, 'Use for both')] : []));
    parts.title.textContent = `Airfoil lab · NACA ${op.code} at η ${fx(lab.eta, 2)}`;
  }
  function apply(key) {
    const w = firstOf(doc, 'wing'); if (!w || !lab.code) return;
    const code = lab.code; edit(`${w.id}.${key}`, code); toast(`Wing ${key === 'rootAirfoil' ? 'root' : 'tip'} airfoil set to NACA ${code}`);
    if (doc.components.find(c => c.id === w.id)[key] === code) lab.code = null;
  }

  function paintStatus() {
    const t = pending ? 'solving…' : err ? 'not converged' : res ? `${res.viscous ? (res.conv ? `converged · ${res.iters} iterations` : 'not converged') : 'inviscid'} · ${fx(res.timeMs, 0)} ms` : '';
    for (const el of [parts.status, parts.blStatus]) if (el) { el.textContent = t; el.className = 'lab-status ' + (pending ? 'run' : err ? 'bad' : 'ok'); }
  }

  function paintResult() {
    paintStatus();
    if (!res) return;
    const r = res, c = r.coef, stn = station();
    if (parts.cp) {
      parts.cp.replaceChildren(r.ok ? cpView(r) : h('div', { class: 'placeholder' }, err || 'No solution.'));
      const tr = r.transition || [];
      parts.kv.replaceChildren(
        kv('cℓ', fx(c.cl, 3)), kv('α', `${minus(fx(r.alpha, 2))}°`), kv('cd', r.viscous ? fx(c.cd, 5) : '— (inviscid)'), kv('cℓ / cd', r.viscous ? fx(c.cl / c.cd, 1) : '—'),
        kv('cm, c/4', minus(fx(c.cm, 4))), kv('cd friction / pressure', r.viscous ? `${fx(c.cdf, 5)} / ${fx(c.cdp, 5)}` : '—'),
        kv('Transition, upper', tr[1] ? (tr[1].x == null ? 'laminar to TE' : `${fx(tr[1].x, 3)} c`) : '—'), kv('Transition, lower', tr[0] ? (tr[0].x == null ? 'laminar to TE' : `${fx(tr[0].x, 3)} c`) : '—'),
        kv('Reynolds', `${fx(r.Re / 1e6, 3)} M`), kv('Mach', fx(r.Ma, 3)),
        stn && stn.clLocal != null ? kv('Wing cℓ here at cruise', fx(stn.clLocal, 3), 'From the wing solution at cruise trim') : null,
        kv('Solve', r.viscous ? `${r.conv ? 'converged' : 'not converged'} · ${r.iters} it · ${fx(r.timeMs, 0)} ms${r.warm ? ' (warm)' : ''}` : `inviscid · ${fx(r.timeMs, 0)} ms`));
    }
    paintPolars(); paintBL();
  }

  function paintPolars() {
    if (!parts.polars) return;
    const pts = polar ? polar.points.filter(p => p.conv && isFinite(p.cl)) : [];
    const op = res && res.ok ? { a: res.alpha, cl: res.coef.cl, cd: res.coef.cd, cm: res.coef.cm } : null;
    const sub = !lab.viscous ? 'viscous only' : polarBusy ? `sweeping… ${polar ? polar.points.length : 0} points` : polar ? `Re ${fx(polar.Re / 1e6, 2)} M · Ncrit ${polar.ncrit}` : '';
    if (!lab.viscous || pts.length < 2) {
      parts.polars.replaceChildren(card('Polars', sub, h('div', { class: 'placeholder' }, !lab.viscous ? 'Polars are swept with the viscous solver. Turn Viscous on.' : 'Sweeping the polar in the background…')));
      return;
    }
    const sorted = pts.slice().sort((p, q) => p.alpha - q.alpha);
    const clR = extent(sorted.map(p => p.cl).concat(op ? [op.cl] : []), 0.08);
    const top = sorted.reduce((b, p) => (p.cl > b.cl ? p : b), sorted[0]);
    const la = chart({ w: 420, h: 220, x: extent(sorted.map(p => p.alpha), 0.04), y: clR, xLabel: 'α (deg)', yLabel: 'cℓ', label: 'Lift against angle of attack',
      series: [{ pts: sorted.map(p => [p.alpha, p.cl]), cls: 's-accent' }], marks: [{ x: top.alpha, label: `cℓ,max ${fx(top.cl, 2)}`, cls: 's-warn', color: 'var(--text-2)' }],
      points: [...sorted.map(p => ({ x: p.alpha, y: p.cl, r: 2, color: 'var(--accent)' })), ...(op ? [{ x: op.a, y: op.cl, r: 5, color: 'var(--hl)' }] : [])] });
    const below = sorted.filter(p => p.alpha <= top.alpha + 2);
    const dp = chart({ w: 420, h: 220, x: [0, Math.max(...below.map(p => p.cd)) * 1.08], y: clR, xLabel: 'cd', yLabel: 'cℓ', label: 'Drag polar',
      series: [{ pts: below.slice().sort((p, q) => p.cl - q.cl).map(p => [p.cd, p.cl]), cls: 's-accent' }],
      points: [...below.map(p => ({ x: p.cd, y: p.cl, r: 2, color: 'var(--accent)' })), ...(op && isFinite(op.cd) ? [{ x: op.cd, y: op.cl, r: 5, color: 'var(--hl)' }] : [])] });
    const xu = sorted.filter(p => p.xtrU != null), xl = sorted.filter(p => p.xtrL != null);
    const tr = chart({ w: 420, h: 170, x: extent(sorted.map(p => p.alpha), 0.04), y: [0, 1.05], xLabel: 'α (deg)', yLabel: 'x_tr / c', label: 'Transition location against angle of attack',
      series: [{ pts: xu.map(p => [p.alpha, p.xtrU]), cls: 's-accent' }, { pts: xl.map(p => [p.alpha, p.xtrL]), cls: 's-hl' }],
      legend: [{ label: 'upper', cls: 's-accent' }, { label: 'lower', cls: 's-hl' }] });
    parts.polars.replaceChildren(card('Lift curve', sub, la), card('Drag polar', '', dp), card('Transition', 'free, eN', tr));
  }

  // ---------- Boundary layer level ----------
  function buildBL() {
    parts.blTitle = h('h3'); parts.blStatus = h('span', { class: 'lab-status' });
    parts.blBody = h('div', { class: 'lab-bl' });
    return h('div', { class: 'level-pane lab' },
      h('div', { class: 'sec-row', style: { alignItems: 'baseline' } }, parts.blTitle, parts.blStatus),
      h('div', { class: 'note' }, 'The integral boundary layer from the airfoil lab\'s current solution (change the station, airfoil or operating point at the Section level). Upper surface in blue, lower in orange; dashed lines mark transition.'),
      parts.blBody);
  }
  function paintBL() {
    if (!parts.blBody) return;
    const op = res && res.op;
    parts.blTitle.textContent = op ? `Boundary layer · NACA ${op.code} at η ${fx(lab.eta, 2)}, Re ${fx(op.Re / 1e6, 2)} M` : 'Boundary layer';
    if (!res || !res.viscous || !res.dist) {
      parts.blBody.replaceChildren(h('div', { class: 'placeholder' }, res && !res.viscous ? 'The airfoil lab is inviscid. Turn Viscous on at the Section level to see the boundary layer.' : pending ? 'Solving…' : 'No viscous solution yet.'));
      return;
    }
    const r = res, N = r.N, D = r.dist;
    const surf = is => Array.from(r.Is[is]).filter(i => i < N).sort((a, b) => r.foil.x[a] - r.foil.x[b]);
    const S = [surf(1), surf(0)];
    const ser = (f, clip) => S.map((idx, k) => ({ pts: idx.map(i => [r.foil.x[i], clip ? Math.max(clip[0], Math.min(clip[1], f(i))) : f(i)]), cls: k ? 's-hl' : 's-accent' }));
    const marks = r.transition.map((t, is) => t.x == null ? null : { x: t.x, cls: 's-warn', label: `${is ? 'upper' : 'lower'} ${fx(t.x, 2)}`, row: is ? 0 : 1, color: is ? 'var(--accent)' : 'var(--hl)' }).filter(Boolean);
    const legend = [{ label: 'upper', cls: 's-accent' }, { label: 'lower', cls: 's-hl' }];
    const mk = (title, sub, f, y, yl, clip) => card(title, sub, chart({ w: 440, h: 210, x: [0, 1], y, xLabel: 'x / c', yLabel: yl, label: title, series: ser(f, clip), marks, legend }));
    const cfv = i => D.cf[i] * 1e3, hk = i => D.Hk[i];
    const all = (f) => S.flat().map(f).filter(isFinite);
    parts.blBody.replaceChildren(
      card('Boundary layer on the section', 'displacement thickness × 8, laminar and turbulent', blStrip(r)),
      h('div', { class: 'lab-grid2' },
        mk('Shape factor Hk', 'laminar separation near 3.5–4, turbulent near 2.5–3', hk, [1, Math.min(6, Math.max(3, ...all(hk)) * 1.05)], 'Hk', [1, 6]),
        mk('Skin friction', 'cf × 1000 · below zero is separated', cfv, extent(all(cfv).map(v => Math.max(-2, Math.min(12, v))), 0.08), 'cf × 10³', [-2, 12]),
        mk('Displacement and momentum thickness', 'δ*/c solid, θ/c dashed', i => D.ds[i] * 100, [0, Math.max(...all(i => D.ds[i] * 100)) * 1.08], '% chord'),
        mk('Edge velocity', 'ue / V∞, viscous', i => Math.abs(D.ue[i]), [0, Math.max(...all(i => Math.abs(D.ue[i]))) * 1.08], 'ue / V∞')));
    // momentum thickness as dashed lines on the thickness chart
    const th = parts.blBody.querySelectorAll('.plot-card svg')[3];
    if (th) addDashed(th, S.map(idx => idx.map(i => [r.foil.x[i], D.th[i] * 100])), [0, Math.max(...all(i => D.ds[i] * 100)) * 1.08]);
  }
  function addDashed(svg, sets, y) {
    // mirrors chart()'s full-size padding (l 52, r 16, t 30 with a legend, b 38)
    const [, , w, hh] = svg.getAttribute('viewBox').split(' ').map(Number), pad = { l: 52, r: 16, t: 30, b: 38 };
    const X = v => pad.l + v * (w - pad.l - pad.r), Y = v => hh - pad.b - (v - y[0]) / (y[1] - y[0]) * (hh - pad.t - pad.b);
    sets.forEach((pts, k) => svg.append(s('path', { d: 'M' + pts.filter(p => isFinite(p[1])).map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' L'), class: k ? 's-hl dash' : 's-accent dash' })));
  }
  // ---------- life cycle ----------
  function refreshAll() { paintControls(); request(); paintResult(); }
  return {
    // called whenever the coupling graph has new outputs
    update(outputs) { out = outputs; if (els.section?.isConnected || els.bl?.isConnected) { paintControls(); request(); } },
    pane(level, outputs) {
      out = outputs;
      if (level === 'section') { els.section = els.section || buildSection(); paintControls(); request(); paintResult(); return els.section; }
      els.bl = els.bl || buildBL(); request(); paintStatus(); paintBL(); return els.bl;
    },
    get state() { return { lab: { ...lab }, res, polar, pending, polarBusy }; },
    dispose() { pointW.cancel(); polarW.cancel(); },
  };
}

// Cp along the chord above the section drawn with its displacement thickness
export function cpView(r, W = 640) {
  const N = r.N, cp = r.cp, cpi = r.cpi, xs = r.foil.x, zs = r.foil.z;
  const padL = 46, padR = 16, cpTop = 24, cpH = 230, k = W - padL - padR, arrow = 0.035 * k;
  let zmax = 0, zmin = 0; for (let i = 0; i < N; i++) { zmax = Math.max(zmax, zs[i]); zmin = Math.min(zmin, zs[i]); }
  const foilY = cpTop + cpH + 30 + arrow * 1.6 + zmax * k, H = Math.round(foilY - zmin * k + arrow * 1.6 + 30);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Pressure coefficient along the chord and the section with its boundary layer' });
  const X = x => padL + x * k;
  const surf = is => Array.from(r.Is[is]).filter(i => i < N);
  const series = (arr, is) => surf(is).map(i => [xs[i], -arr[i]]).sort((a, b) => a[0] - b[0]);
  const all = [...Array.from(cp.subarray(0, N)), ...Array.from(cpi.subarray(0, N))].map(v => -v).filter(isFinite);
  const lo = Math.max(-1.6, Math.min(-0.4, ...all)), hi = Math.min(8, Math.max(1, ...all));
  const [y0, y1] = extent([lo, hi], 0.05);
  const Y = v => cpTop + (y1 - v) / (y1 - y0) * cpH;
  // grid
  for (let v = Math.ceil(y0 * 2) / 2; v <= y1; v += 0.5) {
    svg.append(s('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v), class: v === 0 ? 'ax' : 'grid-l' }));
    if (Math.abs(v * 2 - Math.round(v * 2)) < 1e-9 && (Math.round(v * 2) % 2 === 0 || y1 - y0 < 3)) svg.append(s('text', { x: padL - 6, y: Y(v) + 3.5, class: 'ax-t', 'text-anchor': 'end' }, minus(String(+v.toFixed(1)))));
  }
  svg.append(s('text', { x: 12, y: cpTop + cpH / 2, class: 'ax-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${cpTop + cpH / 2})` }, '−Cp'));
  const line = (pts, cls) => { if (pts.length) svg.append(s('path', { d: 'M' + pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' L'), class: cls })); };
  if (r.viscous) { line(series(cpi, 1), 's-muted'); line(series(cpi, 0), 's-muted'); }
  line(series(cp, 1), 's-accent'); line(series(cp, 0), 's-hl');
  // legend
  const lg = [['Upper surface', 's-accent'], ['Lower surface', 's-hl'], ...(r.viscous ? [['Inviscid', 's-muted']] : [])];
  let lx = W - padR;
  for (const [t, c] of lg.reverse()) { const tw = t.length * 6.4 + 34; lx -= tw; svg.append(s('line', { x1: lx, x2: lx + 16, y1: 10, y2: 10, class: c }), s('text', { x: lx + 21, y: 13.5, class: 'leg-t' }, t)); }

  // ---- the section, to scale on the same x axis ----
  const Z = z => foilY - z * k;
  // pressure arrows: suction pulls away from the surface, pressure pushes onto it
  const nrm = normals(r);
  const arrows = s('g', { class: 'cp-arrows' });
  for (let i = 1; i < N - 1; i += 2) {
    const c = cp[i]; if (!isFinite(c)) continue;
    const L = Math.min(1.6, Math.abs(c)) * arrow, [nx, nz] = nrm[i], x0 = X(xs[i]), z0 = Z(zs[i]);
    const x1 = x0 + nx * L, z1 = z0 - nz * L;
    arrows.append(s('line', { x1: x0, y1: z0, x2: x1, y2: z1, class: c < 0 ? 'cp-suc' : 'cp-pre' }));
  }
  svg.append(arrows);
  const foil = 'M' + Array.from({ length: N }, (_, i) => `${X(xs[i]).toFixed(1)},${Z(zs[i]).toFixed(1)}`).join(' L') + ' Z';
  svg.append(s('path', { d: foil, class: 'lab-foil' }));
  if (r.viscous && r.dist) {
    // displacement thickness: the surface pushed out along its normal by δ*, laminar and turbulent in turn
    for (const is of [0, 1]) {
      const idx = surf(is); let seg = [], turb = null;
      const flush = () => { if (seg.length > 1) svg.append(s('path', { d: 'M' + seg.join(' L'), class: turb ? 'bl-turb' : 'bl-lam' })); };
      for (const i of idx) {
        const t = !!r.dist.turb[i], d = r.dist.ds[i], p = `${(X(xs[i]) + nrm[i][0] * d * k).toFixed(1)},${(Z(zs[i]) - nrm[i][1] * d * k).toFixed(1)}`;
        if (turb !== null && t !== turb) { seg.push(p); flush(); seg = []; }
        turb = t; seg.push(p);
      }
      flush();
    }
    // the wake: δ* split either side of the wake line
    if (r.wake && r.Nw) {
      const up = [], dn = [];
      for (let j = 0; j < r.Nw; j++) { const x = r.wake.x[j]; if (x > 1.12) break; const d = r.dist.ds[N + j] / 2; up.push(`${X(x).toFixed(1)},${Z(r.wake.z[j] + d).toFixed(1)}`); dn.push(`${X(x).toFixed(1)},${Z(r.wake.z[j] - d).toFixed(1)}`); }
      if (up.length > 1) svg.append(s('path', { d: 'M' + up.join(' L') + ' L' + dn.reverse().join(' L') + ' Z', class: 'bl-wake' }));
    }
    // transition and separation
    r.transition.forEach((t, is) => {
      if (t.x == null) return;
      const idx = surf(is); let best = idx[0]; for (const i of idx) if (Math.abs(xs[i] - t.x) < Math.abs(xs[best] - t.x)) best = i;
      const px = X(xs[best]), pz = Z(zs[best]) - nrm[best][1] * 14;
      svg.append(s('circle', { cx: px, cy: Z(zs[best]), r: 4, class: 'tr-dot' }), s('text', { x: px, y: pz + (is ? -4 : 12), class: 'pf-lbl-s', 'text-anchor': 'middle' }, `${is ? 'upper' : 'lower'} transition ${fx(t.x, 2)}`));
    });
    for (const is of [0, 1]) for (const i of surf(is)) if (r.dist.cf[i] < 0) svg.append(s('circle', { cx: X(xs[i]), cy: Z(zs[i]), r: 2.2, class: 'sep-dot' }));
  }
  if (r.stag) svg.append(s('circle', { cx: X(r.stag.x), cy: Z(r.stag.z), r: 3.5, class: 'stag-dot' }));
  // x axis
  for (let i = 0; i <= 8; i += 2) svg.append(s('text', { x: X(i / 10), y: H - 6, class: 'ax-t', 'text-anchor': 'middle' }, String(i / 10)));
  svg.append(s('text', { x: W - padR, y: H - 6, class: 'ax-label', 'text-anchor': 'end' }, 'x / c'));
  return svg;
}

// the section with its boundary layer exaggerated, laminar and turbulent coloured, separation marked
export function blStrip(r, W = 900, H = 220) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Section with its boundary layer, thickness exaggerated eight times' });
  const padL = 30, k = W - 2 * padL - 60, X = x => padL + x * k, Z = z => H / 2 + 10 - z * k, N = r.N, nrm = normals(r), ex = 8;
  for (const is of [0, 1]) {
    const idx = Array.from(r.Is[is]).filter(i => i < N);
    for (let j = 0; j + 1 < idx.length; j++) {
      const a = idx[j], b = idx[j + 1], da = r.dist.ds[a] * ex, db = r.dist.ds[b] * ex;
      const q = [[X(r.foil.x[a]), Z(r.foil.z[a])], [X(r.foil.x[b]), Z(r.foil.z[b])], [X(r.foil.x[b] + nrm[b][0] * db), Z(r.foil.z[b] + nrm[b][1] * db)], [X(r.foil.x[a] + nrm[a][0] * da), Z(r.foil.z[a] + nrm[a][1] * da)]];
      const cls = r.dist.cf[a] < 0 ? 'bls-sep' : r.dist.turb[a] ? 'bls-turb' : 'bls-lam';
      svg.append(s('path', { d: 'M' + q.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L') + ' Z', class: cls }));
    }
  }
  if (r.wake && r.Nw) {
    const up = [], dn = [];
    for (let j = 0; j < r.Nw; j++) { const x = r.wake.x[j]; if (x > 1.08) break; const d = r.dist.ds[N + j] * ex / 2; up.push(`${X(x).toFixed(1)},${Z(r.wake.z[j] + d).toFixed(1)}`); dn.push(`${X(x).toFixed(1)},${Z(r.wake.z[j] - d).toFixed(1)}`); }
    if (up.length > 1) svg.append(s('path', { d: 'M' + up.join(' L') + ' L' + dn.reverse().join(' L') + ' Z', class: 'bls-turb', style: 'opacity:.45' }));
  }
  svg.append(s('path', { d: 'M' + Array.from({ length: N }, (_, i) => `${X(r.foil.x[i]).toFixed(1)},${Z(r.foil.z[i]).toFixed(1)}`).join(' L') + ' Z', class: 'lab-foil' }));
  const lg = [['laminar', 'bls-lam'], ['turbulent', 'bls-turb'], ['separated', 'bls-sep']];
  lg.forEach(([t, c], i) => { svg.append(s('rect', { x: padL + i * 110, y: H - 22, width: 14, height: 10, rx: 2, class: c }), s('text', { x: padL + i * 110 + 20, y: H - 13, class: 'leg-t' }, t)); });
  return svg;
}

// outward unit normals at the foil nodes (from neighbouring nodes; one sign for the whole closed contour)
function normals(r) {
  const N = r.N, x = r.foil.x, z = r.foil.z, n = [];
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1), tx = x[b] - x[a], tz = z[b] - z[a], l = Math.hypot(tx, tz) || 1;
    n.push([tz / l, -tx / l]);
  }
  // make the normal at the upper surface's mid-chord point upward
  const up = Array.from(r.Is[1]).filter(i => i < N);
  let mid = up[0]; for (const i of up) if (Math.abs(x[i] - 0.5) < Math.abs(x[mid] - 0.5)) mid = i;
  if (mid != null && n[mid][1] < 0) for (const v of n) { v[0] = -v[0]; v[1] = -v[1]; }
  return n;
}
