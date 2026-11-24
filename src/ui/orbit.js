// The Orbit tab: mission and trajectory design. Elements and the vehicle link on the left; a 3D view, the ground
// track, transfers and the Δv budget in the centre; the derived orbit and J2 drift on the right; key numbers below.
import { h, s, fx, minus } from './dom.js';
import { toolTopbar, numberField, selectField, segmented, derived, kv, plotCard, stat, subTabs, dur, km, table } from './tools.js';
import { chart } from './charts.js';
import { allVehicles, loadVehicle } from '../model/store.js';
import { VEHICLE_CLASSES } from '../model/vehicle.js';
import { O, elementsOf, apsesOf, describe, transfer, orbitVehicle, missionOrbit, spacecraftBudget, launcherAt, launchNeed } from '../analyses/orbit.js';
import { LAND, WATER, SITES } from '../data/worldMap.js';

const D = Math.PI / 180;
const KEY = 'works-orbit';
const VIEWS = [{ id: '3d', label: '3D view' }, { id: 'ground', label: 'Ground track' }, { id: 'transfer', label: 'Transfer' }, { id: 'budget', label: 'Δv budget' }];
const DEFAULTS = {
  vehicle: '', body: 'earth', hp: 418e3, ha: 422e3, i: 51.64, raan: 0, argp: 0, nu: 0,
  view: '3d', az: 35, el: 22, revs: 3, tFrac: 0, cover: true, sites: true, elev: 10,
  hT: 35786e3, di: 0, method: 'hohmann', rbF: 2, site: 'Cape Canaveral', losses: 1500, payload: 300,
};
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function loadState() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
function saveState(S) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } }

export function renderOrbit(root, { vehicle } = {}) {
  const S = loadState();
  if (vehicle) applyVehicle(S, loadVehicle(vehicle));
  let R = null;            // the current results
  let lastLaunch = null, launchTimer = 0, firstLaunch = true;

  const left = h('aside', { class: 'col', 'aria-label': 'Orbit and mission' });
  const right = h('aside', { class: 'col right', 'aria-label': 'Orbit results' });
  const bar = h('div', { class: 'view-bar' });
  const canvas = h('div', { class: 'canvas' });
  const stats = h('div', { class: 'stats' });
  const pill = h('span', { class: 'pill' });
  root.replaceChildren(h('div', { class: 'ws' }, toolTopbar('orbit', pill),
    h('div', { class: 'ws-main' }, left, h('section', { class: 'pnl view', 'aria-label': 'Orbit views' }, bar, canvas), right), stats));

  function compute() {
    const el = elementsOf(S), d = describe(el);
    const tr = transfer(el, { hTarget: S.hT, di: S.di, rbFactor: S.rbF, method: S.method });
    const site = SITES.find(x => x[0] === S.site) || SITES[0];
    const need = S.body === 'earth' ? launchNeed(el, { lat: site[1], losses: S.losses }) : null;
    const v = S.vehicle ? loadVehicle(S.vehicle) : null;
    let budget = null;
    if (v?.class === 'spacecraft') budget = { kind: 'spacecraft', v, ...spacecraftBudget(v, tr.chosen.dv) };
    if (v?.class === 'launch-vehicle' && S.body === 'earth') {
      // the launcher's own analysis flies an ascent (~0.15 s), so it runs once the inputs settle, not on every slider tick
      const key = JSON.stringify([v.id, v.revision, Math.round(el.a * (1 - el.e)), S.i, site[1], S.payload]);
      budget = { kind: 'launcher', v, ...(lastLaunch && lastLaunch.id === v.id ? lastLaunch.res : {}), stale: !lastLaunch || lastLaunch.key !== key };
      if (budget.stale) {
        clearTimeout(launchTimer);
        launchTimer = setTimeout(() => {
          let res; try { res = { run: launcherAt(v, { altKm: (el.a * (1 - el.e) - O.body('earth').R) / 1e3, inc: S.i, lat: site[1], payload: S.payload }) }; } catch (e) { res = { error: e.message }; }
          lastLaunch = { id: v.id, key, res };
          if (canvas.isConnected) { compute(); paintStats(); if (S.view === 'budget') paintView(); }
        }, firstLaunch ? 0 : 180);
        firstLaunch = false;
      }
    }
    R = { el, d, tr, need, site, v, budget };
  }
  function update({ left: L = false } = {}) { compute(); saveState(S); if (L) paintLeft(); paintRight(); paintView(); paintStats(); paintPill(); }

  // ---------- left: vehicle, elements, mission ----------
  function paintLeft() {
    const vs = allVehicles().filter(orbitVehicle);
    const ap = { hp: S.hp, ha: S.ha };
    const altMax = S.body === 'earth' ? 400000e3 : O.body(S.body).soi;
    const isEarth = S.body === 'earth';
    left.replaceChildren(...[
      h('div', { class: 'pnl pnl-pad' },
        h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Vehicle'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'optional')),
        selectField('Couple to', S.vehicle, [{ value: '', label: 'None (orbit only)' }, ...vs.map(v => ({ value: v.id, label: `${v.name} · ${VEHICLE_CLASSES[v.class].label}` }))], id => {
          S.vehicle = id; if (id) applyVehicle(S, loadVehicle(id)); update({ left: true });
        }),
        h('p', { class: 'note' }, S.vehicle ? 'The orbit starts from the vehicle\'s mission. Its stages or thruster size the Δv budget.' : 'Pick a spacecraft or launch vehicle from the hangar to size its propellant or payload.')),
      h('div', { class: 'pnl pnl-pad' },
        h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Orbit'), h('span', { style: { fontSize: '12px', color: 'var(--accent)' } }, O.body(S.body).label)),
        selectField('Central body', S.body, Object.values(O.BODIES).filter(b => b.id !== 'sun').map(b => ({ value: b.id, label: b.label })), b => {
          S.body = b; const B = O.body(b); S.hp = Math.max(S.hp, 0.05 * B.R); S.ha = Math.max(S.ha, S.hp); if (b !== 'earth') S.view = S.view === 'budget' ? '3d' : S.view; update({ left: true });
        }),
        selectField('Preset', '', [{ value: '', label: 'Choose a preset…' }, ...O.ORBIT_PRESETS.map(p => ({ value: p.id, label: `${p.label} · ${p.short}` }))], id => {
          const p = O.ORBIT_PRESETS.find(x => x.id === id); if (!p) return;
          const B = O.body(p.body); Object.assign(S, { body: p.body, hp: p.a * (1 - p.e) - B.R, ha: p.a * (1 + p.e) - B.R, i: p.i / D, raan: p.raan / D, argp: p.argp / D, nu: p.nu / D });
          update({ left: true });
        }),
        numberField('Perigee altitude', 'km', ap.hp / 1e3, { min: 0, max: altMax / 1e3, step: 1, smin: 100, smax: Math.max(2000, ap.ha / 1e3 * 1.2) }, v => { S.hp = v * 1e3; if (S.ha < S.hp) { S.ha = S.hp; haF.set(v); } update(); }),
        haF = numberField('Apogee altitude', 'km', ap.ha / 1e3, { min: 0, max: altMax / 1e3, step: 1, smin: 100, smax: Math.max(45000, ap.ha / 1e3 * 1.2) }, v => { S.ha = Math.max(v * 1e3, S.hp); update(); }),
        numberField('Inclination', '°', S.i, { min: 0, max: 180, step: 0.01 }, v => { S.i = v; update(); }),
        numberField('RAAN Ω', '°', S.raan, { min: 0, max: 360, step: 0.1 }, v => { S.raan = v; update(); }),
        numberField('Argument of perigee ω', '°', S.argp, { min: 0, max: 360, step: 0.1 }, v => { S.argp = v; update(); }),
        numberField('True anomaly ν', '°', S.nu, { min: 0, max: 360, step: 0.1 }, v => { S.nu = v; update(); }),
        h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } },
          h('button', { class: 'btn small', type: 'button', title: 'Set the inclination that makes J2 turn the orbit plane once a year', disabled: !(S.body === 'earth' || S.body === 'mars'), onclick: () => { const v = describe(elementsOf(S)).ssoI; if (isFinite(v)) { S.i = v; update({ left: true }); } } }, 'Sun-synchronous i'),
          h('button', { class: 'btn small', type: 'button', title: 'Make the orbit circular at the perigee altitude', onclick: () => { S.ha = S.hp; update({ left: true }); } }, 'Circularise'))),
      h('div', { class: 'pnl pnl-pad' },
        h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Transfer'), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'from perigee, circular')),
        numberField('Target altitude', 'km', S.hT / 1e3, { min: 0, max: altMax / 1e3, step: 1, smin: 200, smax: 80000 }, v => { S.hT = v * 1e3; update(); }),
        numberField('Plane change', '°', S.di, { min: 0, max: 90, step: 0.1, smax: 60 }, v => { S.di = v; update(); }),
        segmented('Method', S.method, [{ value: 'hohmann', label: 'Hohmann' }, { value: 'bi-elliptic', label: 'Bi-elliptic' }], m => { S.method = m; update({ left: true }); }),
        S.method === 'bi-elliptic' ? numberField('Intermediate apoapsis', '× larger r', S.rbF, { min: 1, max: 50, step: 0.1, smax: 20 }, v => { S.rbF = v; update(); }) : null),
      isEarth ? h('div', { class: 'pnl pnl-pad' },
        h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Launch')),
        selectField('Launch site', S.site, SITES.slice(0, 9).map(x => ({ value: x[0], label: `${x[0]} · ${fx(Math.abs(x[1]), 1)}°${x[1] < 0 ? 'S' : 'N'}` })), v => { S.site = v; update(); }),
        numberField('Gravity, drag and steering losses', 'm/s', S.losses, { min: 0, max: 4000, step: 10, smin: 800, smax: 2500 }, v => { S.losses = v; update(); }),
        R?.v?.class === 'launch-vehicle' ? numberField('Payload', 'kg', S.payload, { min: 0, max: 1e6, step: 1, smax: Math.max(1000, S.payload * 2) }, v => { S.payload = v; update(); }) : null) : null,
    ].filter(Boolean));
  }
  let haF;

  // ---------- right: derived values ----------
  function paintRight() {
    const { d, el, tr } = R, B = d.B;
    const warn = [];
    if (d.reentry) warn.push(h('p', { class: 'note', style: { color: 'var(--bad)' } }, `The perigee is inside the ${B.label === 'Earth' ? 'atmosphere' : 'body or its atmosphere'}: the orbit decays or hits the surface.`));
    if (d.isSSO) warn.push(h('p', { class: 'note', style: { color: 'var(--good)' } }, 'Sun-synchronous: the node turns with the Sun, so passes keep the same local time.'));
    if (d.critical) warn.push(h('p', { class: 'note', style: { color: 'var(--good)' } }, 'At the critical inclination: J2 does not turn the apsides.'));
    right.replaceChildren(
      h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Orbit')),
        derived('Semi-major axis a', `${km(el.a)} km`), derived('Eccentricity e', fx(el.e, 5)), derived('Period', dur(d.T)),
        derived('Perigee × apogee', `${km(d.hp)} × ${km(d.ha)} km`), derived('Speed at perigee', `${fx(d.vp / 1e3, 3)} km/s`), derived('Speed at apogee', `${fx(d.va / 1e3, 3)} km/s`),
        derived('Specific energy', `${minus(fx(d.energy / 1e6, 2))} MJ/kg`), derived('Ground coverage (10° elev.)', `${fx(d.coverage, 1)}° half-angle`), ...warn),
      h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'J2 drift'), h('span', { class: 'muted', style: { fontSize: '12px' } }, `J2 ${fx(B.J2 * 1e3, 3)}e-3`)),
        derived('Node Ω̇', `${minus(fx(d.raanDot, 3))} °/day`), derived('Perigee ω̇', `${minus(fx(d.argpDot, 3))} °/day`),
        derived('Sun-synchronous i here', isFinite(d.ssoI) ? `${fx(d.ssoI, 2)}°` : 'out of reach'), derived('Revolutions per day', fx(d.revsPerDay, 3)),
        derived('Track shift per rev', `${fx(d.shift, 2)}° west`), derived('Nodal period', dur(d.Tn))),
      h('div', { class: 'pnl pnl-pad' }, h('div', { class: 'sec-row' }, h('span', { class: 'sec' }, 'Transfer'), h('span', { class: 'muted', style: { fontSize: '12px' } }, S.method === 'hohmann' ? 'Hohmann' : 'bi-elliptic')),
        derived('Total Δv', `${fx(tr.chosen.dv, 0)} m/s`), ...tr.chosen.burns.map((b, k) => derived(`Burn ${k + 1}`, `${fx(b, 0)} m/s`)), derived('Time of flight', dur(tr.chosen.tof)),
        S.di ? derived('Plane change share at burn 1', `${fx(tr.hohmann.frac * 100, 0)}%`) : null));
  }

  // ---------- centre ----------
  function paintView() {
    bar.replaceChildren(subTabs(VIEWS.filter(v => v.id !== 'budget' || S.body === 'earth'), S.view, id => { S.view = id; saveState(S); paintView(); }), h('span', { class: 'grow' }), viewTools() || '');
    if (S.view === 'ground') return groundView();
    if (S.view === 'transfer') return transferView();
    if (S.view === 'budget') return budgetView();
    return view3d();
  }
  function viewTools() {
    if (S.view === '3d') return h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Drag to turn · double-click to reset');
    if (S.view === 'ground') {
      const tg = (label, key) => h('button', { class: 'tg sm' + (S[key] ? ' on' : ''), type: 'button', 'aria-pressed': S[key] ? 'true' : 'false', onclick: () => { S[key] = !S[key]; saveState(S); paintView(); } }, label);
      return h('span', { class: 'row', style: { gap: '6px' } }, tg('Coverage', 'cover'), S.body === 'earth' ? tg('Sites', 'sites') : null);
    }
    return null;
  }

  // 3D: an orthographic view turned by azimuth and elevation; parts of the orbit behind the body are dashed
  function view3d() {
    const holder = h('div', { class: 'view-svg' });
    canvas.replaceChildren(holder);
    const W = holder.clientWidth || 900, H = holder.clientHeight || 600;
    const { el, d } = R, B = d.B, pts = O.orbitPoints(el, 480);
    const extent = Math.max(...pts.map(p => Math.hypot(p[0], p[1], p[2])), B.R * 1.35);
    const k = Math.min(W, H) * 0.44 / extent, cx = W / 2, cy = H / 2;
    const az = S.az * D, ev = S.el * D, ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(ev), se = Math.sin(ev);
    // returns screen x, y and depth (towards the viewer positive)
    const P = ([x, y, z]) => { const x1 = x * ca + y * sa, y1 = -x * sa + y * ca; return [cx + x1 * k, cy - (z * ce - y1 * se) * k, y1 * ce + z * se]; };
    const hidden = q => q[2] < 0 && Math.hypot(q[0] - cx, q[1] - cy) < B.R * k;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'main', role: 'img', 'aria-label': `3D view of the orbit around ${B.label}` });
    const path = (list, cls, style) => list.length > 1 && svg.append(s('path', { d: 'M' + list.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' L'), class: cls, style }));
    // equatorial plane ring and the line to the vernal equinox
    const ring = []; for (let t = 0; t <= 120; t++) { const a = t / 120 * 2 * Math.PI; ring.push(P([Math.cos(a) * extent * 1.05, Math.sin(a) * extent * 1.05, 0])); }
    path(ring, 'grid-l', 'stroke-dasharray:2 5');
    const eq = P([extent * 1.12, 0, 0]); path([P([0, 0, 0]), eq], 's-warn'); svg.append(s('text', { x: eq[0] + 4, y: eq[1] + 4, class: 'pf-lbl-s' }, '♈ x (vernal equinox)'));
    // back half of the orbit first, then the body, then the front half
    const back = [], front = []; let cur = null, curHid = null;
    for (const p of pts) { const q = P(p), hd = hidden(q); if (hd !== curHid) { if (cur) (curHid ? back : front).push(cur); cur = cur ? [cur[cur.length - 1]] : []; curHid = hd; } cur.push(q); }
    if (cur) (curHid ? back : front).push(cur);
    for (const b of back) path(b, 's-accent', 'opacity:.35;stroke-dasharray:4 4');
    // the body: disc, equator and a meridian, with the far halves hidden
    svg.append(s('circle', { cx, cy, r: B.R * k, style: `fill:${B.color};fill-opacity:.22;stroke:${B.color};stroke-width:1.2` }));
    const lineOn = f => { const segs = [[]]; for (let t = 0; t <= 96; t++) { const q = P(f(t / 96 * 2 * Math.PI)); if (q[2] >= 0) segs[segs.length - 1].push(q); else if (segs[segs.length - 1].length) segs.push([]); } return segs; };
    for (const sg of lineOn(a => [Math.cos(a) * B.R, Math.sin(a) * B.R, 0])) path(sg, 's-muted', `stroke:${B.color}`);
    for (const sg of lineOn(a => [Math.cos(a) * B.R, 0, Math.sin(a) * B.R])) path(sg, 'grid-l', `stroke:${B.color};opacity:.6`);
    for (const f of front) path(f, 's-accent');
    // apsides, nodes and the satellite
    const at = nu => { const { P: Pv, Q } = O.perifocal(el.i, el.raan, el.argp), r = O.rAt(el, nu); return [0, 1, 2].map(j => r * (Math.cos(nu) * Pv[j] + Math.sin(nu) * Q[j])); };
    // labels step down a row until they clear the ones already placed (markers often coincide, e.g. perigee on the node)
    const placed = [[eq[0] + 2, eq[1] - 8, 150, 14]];
    const clash = (x, y, w) => placed.some(([px, py, pw, ph]) => x < px + pw && px < x + w && y < py + ph && py < y + 14);
    const mark = (pos, label, cls = 'pf-np', r = 4.5) => {
      const q = P(pos), hd = hidden(q); svg.append(s('circle', { cx: q[0], cy: q[1], r, class: cls, style: hd ? 'opacity:.35' : null }));
      if (label) { const w = label.length * 6.6; let y = q[1] - 18; for (let k = 0; k < 8 && clash(q[0] + 8, y, w); k++) y += 15; placed.push([q[0] + 8, y, w, 14]); svg.append(s('text', { x: q[0] + 8, y: y + 11, class: 'pf-lbl', style: hd ? 'opacity:.5' : null }, label)); }
      return q;
    };
    const nodeNu = O.wrap2pi(-el.argp);
    const an = at(nodeNu), dn = at(nodeNu + Math.PI);
    if (el.i > 0.2 * D && el.i < 179.8 * D) { path([P(an), P(dn)], 's-warn'); mark(an, 'Ascending node', 'pf-mac-dot', 3.5); mark(dn, null, 'pf-mac-dot', 3); }
    mark(at(0), `Perigee · ${km(d.hp)} km`);
    if (el.e > 0.002) mark(at(Math.PI), `Apogee · ${km(d.ha)} km`);
    const sat = P(at(el.nu));
    svg.append(s('circle', { cx: sat[0], cy: sat[1], r: 6.5, style: 'fill:var(--hl);stroke:var(--bg-elev);stroke-width:2' + (hidden(sat) ? ';opacity:.4' : '') }));
    { let y = sat[1] - 18; const w = 70; for (let k = 0; k < 8 && clash(sat[0] + 10, y, w); k++) y += 15; svg.append(s('text', { x: sat[0] + 10, y: y + 11, class: 'pf-lbl', style: 'fill:var(--hl)' }, `ν ${fx(S.nu, 0)}°`)); }
    svg.append(s('text', { x: 14, y: 22, class: 'pf-lbl' }, `${B.label} · i ${fx(S.i, 2)}° · Ω ${fx(S.raan, 1)}° · ω ${fx(S.argp, 1)}°`),
      s('text', { x: 14, y: 40, class: 'pf-lbl-s' }, `view az ${fx(S.az, 0)}° el ${fx(S.el, 0)}° · to scale`));
    holder.append(svg);
    // drag to turn
    let drag = null;
    svg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, az: S.az, el: S.el }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (!drag) return; S.az = drag.az - (e.clientX - drag.x) * 0.4; S.el = Math.max(-89, Math.min(89, drag.el + (e.clientY - drag.y) * 0.4)); cancelAnimationFrame(raf); raf = requestAnimationFrame(view3d); });
    svg.addEventListener('pointerup', () => { drag = null; saveState(S); });
    svg.addEventListener('dblclick', () => { S.az = DEFAULTS.az; S.el = DEFAULTS.el; saveState(S); view3d(); });
    svg.style.cursor = 'grab'; svg.style.touchAction = 'none';
  }
  let raf = 0;

  // Ground track on an equirectangular map (canvas), with the coverage ring and launch and ground sites
  function groundView() {
    const { el, d } = R, B = d.B;
    const dur0 = Math.max(1, S.revs) * d.T;
    const track = O.groundTrack(el, B, { duration: dur0, n: Math.min(4000, 600 * Math.max(1, S.revs)) });
    const wrap = h('div', { class: 'level-pane' });
    const cv = h('canvas', { class: 'gt-map', role: 'img', 'aria-label': 'Ground track map' });
    const time = numberField('Time along the track', '%', S.tFrac * 100, { min: 0, max: 100, step: 0.1 }, v => { S.tFrac = v / 100; draw(); paintNow(); });
    const nowBox = h('div', { class: 'kv' });
    wrap.append(h('h3', {}, `Ground track · ${S.revs} revolution${S.revs > 1 ? 's' : ''} · ${dur(dur0)}`),
      h('div', { class: 'note' }, `J2 is included, so the track drifts as the node turns. Each revolution shifts ${fx(d.shift, 1)}° west. The ring is the area that sees the satellite above ${S.elev}° elevation.`),
      h('div', { class: 'plot-card' }, cv),
      h('div', { class: 'gt-controls' },
        numberField('Revolutions', '', S.revs, { min: 1, max: 30, step: 1 }, v => { S.revs = Math.round(v); saveState(S); groundView(); }),
        time, numberField('Minimum elevation', '°', S.elev, { min: 0, max: 60, step: 1 }, v => { S.elev = v; saveState(S); draw(); })),
      nowBox);
    canvas.replaceChildren(wrap);
    const trackAt = () => track[Math.min(track.length - 1, Math.round(S.tFrac * (track.length - 1)))];
    function paintNow() {
      const p = trackAt();
      nowBox.replaceChildren(kv('Time', dur(p.t)), kv('Latitude', `${fx(Math.abs(p.lat / D), 2)}° ${p.lat < 0 ? 'S' : 'N'}`), kv('Longitude', `${fx(Math.abs(p.lon / D), 2)}° ${p.lon < 0 ? 'W' : 'E'}`), kv('Altitude', `${km(p.alt)} km`));
    }
    function draw() {
      const Wc = cv.clientWidth || 860, Hc = Wc / 2, dpr = devicePixelRatio || 1;
      cv.width = Wc * dpr; cv.height = Hc * dpr; cv.style.height = Hc + 'px';
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const X = lon => (lon / D + 180) / 360 * Wc, Y = lat => (90 - lat / D) / 180 * Hc, XL = lo => (lo + 180) / 360 * Wc, YL = la => (90 - la) / 180 * Hc;
      const dark = document.documentElement.dataset.resolvedTheme === 'dark', sea = dark ? '#0f1b2d' : '#dbe8f5';
      g.fillStyle = sea; g.fillRect(0, 0, Wc, Hc);
      if (S.body === 'earth') {
        g.fillStyle = dark ? '#24364d' : '#f4f1e8'; g.strokeStyle = dark ? '#3a5170' : '#b9b3a3'; g.lineWidth = 0.8;
        for (const poly of LAND) { g.beginPath(); poly.forEach(([lo, la], j) => (j ? g.lineTo(XL(lo), YL(la)) : g.moveTo(XL(lo), YL(la)))); g.closePath(); g.fill(); g.stroke(); }
        g.fillStyle = sea; for (const poly of WATER) { g.beginPath(); poly.forEach(([lo, la], j) => (j ? g.lineTo(XL(lo), YL(la)) : g.moveTo(XL(lo), YL(la)))); g.closePath(); g.fill(); g.stroke(); }
      } else { g.fillStyle = B.color; g.globalAlpha = 0.18; g.fillRect(0, 0, Wc, Hc); g.globalAlpha = 1; }
      g.strokeStyle = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)'; g.lineWidth = 1;
      for (let lo = -150; lo <= 150; lo += 30) { g.beginPath(); g.moveTo(XL(lo), 0); g.lineTo(XL(lo), Hc); g.stroke(); }
      for (let la = -60; la <= 60; la += 30) { g.beginPath(); g.moveTo(0, YL(la)); g.lineTo(Wc, YL(la)); g.stroke(); }
      // track: the whole span faint, the part flown so far bold
      const acc = css('--accent'), iNow = Math.round(S.tFrac * (track.length - 1));
      const part = (a, b, alpha, w) => { g.strokeStyle = acc; g.globalAlpha = alpha; g.lineWidth = w; g.beginPath(); let prev = null; for (let j = a; j <= b; j++) { const p = track[j]; if (!prev || Math.abs(p.lon - prev.lon) > Math.PI) g.moveTo(X(p.lon), Y(p.lat)); else g.lineTo(X(p.lon), Y(p.lat)); prev = p; } g.stroke(); g.globalAlpha = 1; };
      part(0, track.length - 1, 0.45, 1.3); if (iNow > 0) part(0, iNow, 1, 2.3);
      const p = trackAt(), lam = O.coverageAngle(Math.max(1, p.alt), B.R, S.elev * D);
      const inView = (la, lo) => Math.acos(Math.max(-1, Math.min(1, Math.sin(la) * Math.sin(p.lat) + Math.cos(la) * Math.cos(p.lat) * Math.cos(lo - p.lon)))) <= lam;
      if (S.cover) {
        const ring = [];
        for (let k = 0; k <= 180; k++) { const a = k / 180 * 2 * Math.PI, la2 = Math.asin(Math.sin(p.lat) * Math.cos(lam) + Math.cos(p.lat) * Math.sin(lam) * Math.cos(a)); ring.push([la2, O.wrapPi(p.lon + Math.atan2(Math.sin(a) * Math.sin(lam) * Math.cos(p.lat), Math.cos(lam) - Math.sin(p.lat) * Math.sin(la2)))]); }
        const wraps = ring.some((q, j) => j && Math.abs(q[1] - ring[j - 1][1]) > Math.PI) || inView(Math.PI / 2, 0) || inView(-Math.PI / 2, 0);
        g.strokeStyle = css('--warn'); g.fillStyle = css('--warn'); g.lineWidth = 1.5; g.beginPath();
        ring.forEach(([la, lo], j) => (!j || (wraps && Math.abs(lo - ring[j - 1][1]) > Math.PI) ? g.moveTo(X(lo), Y(la)) : g.lineTo(X(lo), Y(la))));
        if (!wraps) { g.closePath(); g.globalAlpha = 0.14; g.fill(); g.globalAlpha = 1; }
        g.stroke();
      }
      if (S.sites && S.body === 'earth') {
        g.font = '10px ' + css('--font'); g.textBaseline = 'middle';
        for (const [n, la, lo] of SITES) {
          const on = S.cover && inView(la * D, lo * D), x = XL(lo), y = YL(la);
          g.fillStyle = on ? css('--good') : css('--text-2'); g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 3.5, y + 3); g.lineTo(x - 3.5, y + 3); g.closePath(); g.fill();
          if (on || Wc > 900) { g.lineJoin = 'round'; g.strokeStyle = sea; g.lineWidth = 3; g.strokeText(n, x + 6, y); g.fillStyle = on ? css('--good') : css('--text-3'); g.fillText(n, x + 6, y); }
        }
      }
      g.beginPath(); g.arc(X(p.lon), Y(p.lat), 5.5, 0, 2 * Math.PI); g.fillStyle = css('--hl'); g.fill(); g.strokeStyle = css('--bg-elev'); g.lineWidth = 2; g.stroke();
      if (S.body !== 'earth') { g.fillStyle = css('--text-2'); g.font = '11px ' + css('--font'); g.textBaseline = 'top'; g.fillText(`${B.label}: no map, latitude and longitude only`, 8, 8); }
    }
    draw(); paintNow();
    gtDraw = draw;
  }
  let gtDraw = null;

  // Transfer: the orbits in their plane, and how Hohmann and bi-elliptic compare against the radius ratio
  function transferView() {
    const { tr } = R, B = tr.B, bi = S.method === 'bi-elliptic';
    const W = 620, H = 420, rMax = (bi ? tr.rb : Math.max(tr.r1, tr.r2)) * 1.06, k = Math.min(W, H) * 0.46 / rMax;
    const cx = bi ? W / 2 + (tr.rb - Math.max(tr.r1, tr.r2)) * k * 0.0 : W / 2, cy = H / 2;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Transfer orbit diagram' });
    const circle = (r, cls, style) => svg.append(s('circle', { cx, cy, r: r * k, class: cls, style }));
    const half = (rpA, raA, from, cls) => { const a = (rpA + raA) / 2, e = (raA - rpA) / (raA + rpA), p = a * (1 - e * e), pts = []; for (let t = 0; t <= 90; t++) { const nu = from + t / 90 * Math.PI, r = p / (1 + e * Math.cos(nu - from)); pts.push(`${(cx + r * Math.cos(nu) * k).toFixed(1)},${(cy - r * Math.sin(nu) * k).toFixed(1)}`); } svg.append(s('path', { d: 'M' + pts.join(' L'), class: cls })); };
    svg.append(s('circle', { cx, cy, r: B.R * k, style: `fill:${B.color};fill-opacity:.25;stroke:${B.color}` }));
    circle(tr.r1, 's-muted'); circle(tr.r2, 's-good');
    const burn = (r, ang, label) => { const x = cx + r * Math.cos(ang) * k, y = cy - r * Math.sin(ang) * k; svg.append(s('circle', { cx: x, cy: y, r: 5, style: 'fill:var(--hl)' }), s('text', { x: x + 8, y: y + (ang ? -8 : 16), class: 'pf-lbl' }, label)); };
    if (!bi) { half(Math.min(tr.r1, tr.r2), Math.max(tr.r1, tr.r2), tr.r1 <= tr.r2 ? 0 : Math.PI, 's-accent'); burn(tr.r1, tr.r1 <= tr.r2 ? 0 : Math.PI, `Δv₁ ${fx(tr.chosen.burns[0], 0)} m/s`); burn(tr.r2, tr.r1 <= tr.r2 ? Math.PI : 0, `Δv₂ ${fx(tr.chosen.burns[1], 0)} m/s`); }
    else { half(tr.r1, tr.rb, 0, 's-accent'); half(tr.r2, tr.rb, Math.PI, 's-hl'); burn(tr.r1, 0, `Δv₁ ${fx(tr.chosen.burns[0], 0)}`); burn(tr.rb, Math.PI, `Δv₂ ${fx(tr.chosen.burns[1], 0)}`); burn(tr.r2, 0.0001, `Δv₃ ${fx(tr.chosen.burns[2], 0)}`); }
    svg.append(s('text', { x: 12, y: 20, class: 'pf-lbl-s' }, `grey: start, circular at ${km(tr.r1 - B.R)} km · green: target at ${km(tr.r2 - B.R)} km`));
    const q = tr.r2 / tr.r1, cur = tr.curve;
    const cmp = chart({ w: 620, h: 260, x: [Math.log10(1.05), Math.log10(60)], y: [0, Math.max(...cur.map(c => Math.max(c.h, c.b))) * 1.08], xFmt: v => fx(10 ** v, v < 1 ? 1 : 0),
      xLabel: 'Target radius ÷ start radius (log)', yLabel: 'Δv ÷ circular speed', label: 'Hohmann and bi-elliptic total Δv against the radius ratio',
      series: [{ pts: cur.map(c => [Math.log10(c.q), c.h]), cls: 's-accent' }, { pts: cur.map(c => [Math.log10(c.q), c.b]), cls: 's-hl' }],
      legend: [{ label: 'Hohmann', cls: 's-accent' }, { label: `Bi-elliptic, rb = ${fx(S.rbF, 1)} × r₂`, cls: 's-hl' }],
      marks: [{ x: Math.log10(11.94), label: '11.94', cls: 's-warn' }, ...(q > 1.05 && q < 60 ? [{ x: Math.log10(q), label: `this transfer ${fx(q, 2)}`, cls: 's-hl', row: 1, color: 'var(--hl)' }] : [])] });
    canvas.replaceChildren(h('div', { class: 'level-pane' },
      h('h3', {}, `Transfer · ${bi ? 'bi-elliptic' : 'Hohmann'} · ${fx(tr.chosen.dv, 0)} m/s`),
      h('div', { class: 'note' }, 'From a circular orbit at the current perigee altitude to a circular target, both in the same plane unless a plane change is set. With a plane change, the Hohmann splits the turn between its two burns to keep the total low.'),
      h('div', { class: 'tr-grid' }, plotCard('In the orbit plane, to scale', svg), plotCard('Which transfer is cheaper', cmp, 'Bi-elliptic wins only beyond a radius ratio of about 11.94 (sooner with a very distant rb), and takes much longer.')),
      h('div', { class: 'kv' },
        kv('Hohmann total', `${fx(tr.hohmann.dv, 0)} m/s`), kv('Hohmann time of flight', dur(tr.hohmann.tof)), kv('Bi-elliptic total', `${fx(tr.biElliptic.dvPlane, 0)} m/s`), kv('Bi-elliptic time of flight', dur(tr.biElliptic.tof)),
        S.di ? kv('Coplanar Hohmann + separate plane change', `${fx(tr.hohmann.separate, 0)} m/s`) : null, S.di ? kv('Plane change alone, at the slower orbit', `${fx(tr.planeOnly, 0)} m/s`) : null,
        kv('Rendezvous: target leads by', `${fx(tr.rendezvous.lead / D, 1)}°`), kv('Synodic period', dur(tr.rendezvous.synodic)))));
  }

  // Δv budget: launch from a site, then the vehicle's stages or thruster
  function budgetView() {
    const { need, budget, tr, site } = R;
    const pane = h('div', { class: 'level-pane' });
    const add = (...xs) => pane.append(...xs.filter(Boolean));
    if (!need) { canvas.replaceChildren(h('div', { class: 'level-pane' }, h('div', { class: 'placeholder' }, 'The launch budget is for Earth orbits.'))); return; }
    add(h('h3', {}, `Δv budget · launch from ${site[0]}`),
      h('div', { class: 'note' }, `Circular speed at the perigee altitude, less the eastward speed the ground lends along the launch azimuth, plus ${fx(S.losses, 0)} m/s of gravity, drag and steering losses.`),
      h('div', { class: 'kv' },
        kv('Circular speed', `${fx(need.vc, 0)} m/s`), kv('Ground speed at the site', `${fx(need.vrot, 0)} m/s`), kv('Launch azimuth', need.reachable ? `${fx(((need.az / D) + 360) % 360, 1)}° from north` : 'not reachable'),
        kv('Gain from rotation', `${minus(fx(need.gain, 0))} m/s`), kv('Losses', `${fx(S.losses, 0)} m/s`), kv('Launch Δv needed', `${fx(need.dv, 0)} m/s`)),
      !need.reachable ? h('div', { class: 'placeholder' }, `${site[0]} is at ${fx(site[1], 1)}°, above this inclination: a direct launch cannot reach it. A dogleg or a plane change after launch costs extra Δv.`) : null);
    if (budget?.kind === 'launcher' && !budget.run && !budget.error) add(h('div', { class: 'placeholder' }, `Flying ${budget.v.name}'s ascent…`));
    else if (budget?.kind === 'launcher' && budget.error) add(h('div', { class: 'placeholder' }, `${budget.v.name} cannot be flown to this orbit: ${budget.error}`));
    else if (budget?.kind === 'launcher') {
      const r = budget.run;
      if (budget.stale) pane.style.opacity = '.6';
      add(h('h3', {}, `${budget.v.name} · flown to ${km(R.d.hp)} km at ${fx(S.i, 1)}° with ${fx(S.payload, 0)} kg`),
        h('div', { class: 'note' }, `${budget.v.name}'s own analysis, the same as its workspace: a gravity-turn ascent sets the gravity and drag losses, then a transfer from burnout to the circular orbit. The quick estimate above uses the losses on the left instead.`),
        table(['Stage', 'Start mass', 'Burnout mass', 'Isp (effective)', 'Δv', 'T/W at ignition'], r.rows.map(x => [x.name, `${fx(x.m0, 0)} kg`, `${fx(x.mf, 0)} kg`, `${fx(x.ispEff, 0)} s`, `${fx(x.dv, 0)} m/s`, fx(x.TW0, 2)])),
        h('div', { class: 'kv' },
          kv('Ideal Δv, all stages', `${fx(r.dvIdeal, 0)} m/s`), kv('Δv required', `${fx(r.dvRequired, 0)} m/s`),
          kv('Margin', h('span', { style: { color: r.margin >= 0 ? 'var(--good)' : 'var(--bad)' } }, `${r.margin >= 0 ? '+' : '−'}${fx(Math.abs(r.margin), 0)} m/s`)),
          kv('Largest payload to this orbit', isFinite(r.capacity) ? `${fx(r.capacity, 0)} kg` : 'cannot reach it'),
          kv('Simulated losses', `${fx(r.gravityLoss + r.dragLoss, 0)} m/s (gravity ${fx(r.gravityLoss, 0)}, drag ${fx(r.dragLoss, 0)})`),
          kv('Liftoff mass', `${fx(r.liftoff / 1e3, 2)} t`), kv('Liftoff T/W', fx(r.tw, 2))));
    } else if (budget?.kind === 'spacecraft' && budget.isp) {
      add(h('h3', {}, `${budget.v.name} · propellant for the transfer`),
        h('div', { class: 'kv' }, kv('Thruster', `${budget.thruster} · Isp ${fx(budget.isp, 0)} s`), kv('Dry mass (parts)', `${fx(budget.dry, 2)} kg`),
          kv('Transfer Δv', `${fx(tr.chosen.dv, 0)} m/s`), kv('Mass ratio', fx(budget.MR, 3)), kv('Propellant needed', `${fx(budget.prop, budget.prop < 10 ? 2 : 0)} kg`), kv('Propellant fraction', `${fx(budget.propFraction * 100, 1)}%`)),
        budget.propFraction > 0.5 ? h('div', { class: 'placeholder' }, `Over half the spacecraft would be propellant: a ${budget.isp < 150 ? 'cold-gas' : 'chemical'} thruster is not a practical way to make this transfer. Try a smaller change, or a higher-Isp thruster.`) : null);
    } else add(h('div', { class: 'placeholder' }, 'Couple a launch vehicle (stage sizes) or a spacecraft (thruster) on the left to turn these Δv numbers into payload or propellant.'));
    canvas.replaceChildren(pane);
  }

  // ---------- bottom ----------
  function paintStats() {
    const { d, tr, need, budget } = R;
    stats.replaceChildren(
      stat('Period', dur(d.T), '', `${fx(d.revsPerDay, 2)} rev/day`),
      stat('Perigee × apogee', `${km(d.hp)} × ${km(d.ha)}`, 'km', `e ${fx(R.el.e, 4)}`, d.reentry ? 'var(--bad)' : null),
      stat('Speed at perigee', fx(d.vp / 1e3, 3), 'km/s', `apogee ${fx(d.va / 1e3, 3)} km/s`),
      stat('Node drift', minus(fx(d.raanDot, 3)), '°/day', d.isSSO ? 'sun-synchronous' : isFinite(d.ssoI) ? `SSO at ${fx(d.ssoI, 1)}°` : 'J2'),
      stat('Transfer Δv', fx(tr.chosen.dv, 0), 'm/s', `to ${km(S.hT)} km · ${dur(tr.chosen.tof)}`),
      budget?.kind === 'launcher' && budget.run ? stat('Payload to orbit', isFinite(budget.run.capacity) ? fx(budget.run.capacity, 0) : '—', 'kg', `${budget.v.name} · needs ${fx(budget.run.dvRequired, 0)} m/s`, budget.run.capacity < S.payload ? 'var(--bad)' : null)
        : budget?.kind === 'spacecraft' && budget.isp ? stat('Transfer propellant', fx(budget.prop, budget.prop < 10 ? 2 : 0), 'kg', `${budget.v.name} · Isp ${fx(budget.isp, 0)} s`, budget.propFraction > 0.5 ? 'var(--bad)' : null)
          : stat('Launch Δv', need ? fx(need.dv, 0) : '—', need ? 'm/s' : '', need ? `from ${R.site[0]}` : 'Earth only'));
  }
  function paintPill() { pill.replaceChildren(R.v ? h('span', {}, 'Coupled to ', h('b', {}, R.v.name)) : 'Not coupled to a vehicle'); }

  addEventListener('themechange', () => { if (canvas.isConnected) paintView(); });
  new ResizeObserver(() => {
    if (!canvas.isConnected) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (S.view === '3d') view3d(); else if (S.view === 'ground' && gtDraw) gtDraw(); });
  }).observe(canvas);

  compute(); paintLeft(); update();
  window.__orbit = { S, get R() { return R; } };
}

function applyVehicle(S, v) {
  if (!v || !orbitVehicle(v)) return;
  S.vehicle = v.id;
  Object.assign(S, { body: 'earth', ...missionOrbit(v), raan: 0, argp: 0, nu: 0 });
  if (v.class === 'spacecraft') { S.hT = S.hp + 50e3; S.di = 0; S.method = 'hohmann'; }
  if (v.class === 'launch-vehicle') { S.payload = v.mission?.payload ?? S.payload; S.site = (SITES.find(x => Math.abs(x[1] - (v.mission?.latitude ?? 34.7)) < 0.2) || SITES[1])[0]; if (S.view === 'transfer') S.view = 'budget'; }
}
