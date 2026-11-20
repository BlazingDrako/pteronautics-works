// Small DOM helpers (no framework).
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function h(tag, attrs, ...kids) { const el = document.createElement(tag); apply(el, attrs); append(el, kids); return el; }
export function s(tag, attrs, ...kids) { const el = document.createElementNS(SVG_NS, tag); apply(el, attrs); append(el, kids); return el; }

// number formatting
export const fx = (v, d = 1) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
export const fsig = (v, n = 3) => (typeof v === 'number' && isFinite(v) ? (Math.abs(v) >= 10 ** n ? v.toFixed(0) : +v.toPrecision(n) + '') : '—');
export const pct = (v, d = 1) => (typeof v === 'number' && isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—');
export const minus = str => String(str).replace(/^-/, '−');
// powers and energies in W / Wh, switching to kW / kWh from 10 kW(h) so an eVTOL reads as easily as a small UAS
export const fW = w => (typeof w === 'number' && isFinite(w) ? (Math.abs(w) >= 1e4 ? `${(w / 1000).toFixed(Math.abs(w) >= 1e5 ? 0 : 1)} kW` : `${w.toFixed(0)} W`) : '—');
export const fWh = e => (typeof e === 'number' && isFinite(e) ? (Math.abs(e) >= 1e4 ? `${(e / 1000).toFixed(Math.abs(e) >= 1e5 ? 0 : 1)} kWh` : `${e.toFixed(Math.abs(e) < 10 ? 1 : 0)} Wh`) : '—');

export function ago(iso) {
  const t = Date.parse(iso); if (!isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d < 14 ? d + ' d ago' : Math.round(d / 7) + ' wk ago';
}

let toastTimer = null;
export function toast(msg, err = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), err ? 6000 : 2600);
}

// Line icons (stroke = currentColor)
const ICONS = {
  hangar: '<path d="M3 10 L12 4 L21 10 V20 H3 Z"/><path d="M8 20 V14 H16 V20"/>',
  mission: '<path d="M3 17 C7 7 13 7 21 13"/><circle cx="21" cy="13" r="1.6"/><circle cx="3" cy="17" r="1.6"/>',
  list: '<path d="M4 6 H20 M4 12 H20 M4 18 H14"/>',
  bars: '<path d="M4 20 V10 M10 20 V4 M16 20 V13 M22 20 H2"/>',
  airfoil: '<path d="M2 13 C6 8 16 7 22 12 C16 14 7 15 2 13 Z"/>',
  motor: '<rect x="3" y="8" width="13" height="8" rx="2"/><path d="M16 10 L21 7 V17 L16 14"/>',
  grid: '<path d="M4 4 H20 V20 H4 Z M4 12 H20 M12 4 V20"/>',
  cell: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M10 3 V1 H14 V3"/>',
  doc: '<path d="M6 2 H15 L20 7 V22 H6 Z"/><path d="M15 2 V7 H20"/>',
  plus: '<path d="M12 5 V19 M5 12 H19"/>',
  upload: '<path d="M12 16 V4 M7 9 L12 4 L17 9 M4 20 H20"/>',
  download: '<path d="M12 4 V16 M7 11 L12 16 L17 11 M4 20 H20"/>',
  reset: '<path d="M4 12 A8 8 0 1 0 7 5.8"/><path d="M4 4 V9 H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22 M4.9 4.9 L6.3 6.3 M17.7 17.7 L19.1 19.1 M4.9 19.1 L6.3 17.7 M17.7 6.3 L19.1 4.9"/>',
  moon: '<path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z"/>',
  back: '<path d="M15 5 L8 12 L15 19"/>',
};
export function icon(name) {
  const el = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.innerHTML = ICONS[name] || '';
  return el;
}

// The Pteronautics mark: the same drawing as Atlas (js/app.js BRAND_SVG), colored by the theme
export const BRAND_SVG = `<svg viewBox="0 4 100 100" aria-hidden="true">
<path class="bm-fill" d="M50 10 L54 24 L53 36 C62 35 70 33 78 31 C86 36 92 44 96 54 C80 52 68 56 60 66 L56 76 L50 70 L44 76 L40 66 C32 56 20 52 4 54 C8 44 14 36 22 31 C30 33 38 35 47 36 L46 24 Z"/>
<path class="bm-line" d="M50 10 L54 24 L53 36 C62 35 70 33 78 31 C86 36 92 44 96 54 C80 52 68 56 60 66 L56 76 L50 70 L44 76 L40 66 C32 56 20 52 4 54 C8 44 14 36 22 31 C30 33 38 35 47 36 L46 24 Z"/>
<path class="bm-line" d="M50 72 L50 84"/>
<path class="bm-flame" d="M50 82 L54 89 L50 97 L46 89 Z"/></svg>`;
export function brandMark() { const el = h('span', { class: 'brand-mark' }); el.innerHTML = BRAND_SVG; return el; }
export function brand({ compact = false } = {}) {
  return h('a', { class: 'brand', href: '#/', 'aria-label': 'Pteronautics Works hangar' }, brandMark(),
    compact ? h('span', { class: 'brand-name' }, 'Works')
      : h('div', {}, h('div', { class: 'brand-name' }, 'Pteronautics'), h('div', { class: 'brand-sub brand-product' }, 'Works')));
}

// ---------- theme (same behaviour as Atlas: system default, or a stored choice) ----------
const THEME_KEY = 'works-theme';
export function resolvedTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme() { document.documentElement.dataset.resolvedTheme = resolvedTheme(); dispatchEvent(new Event('themechange')); }
export function initTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.dataset.theme = t; } catch { }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}
export function themeButton(cls = 'nav-item') {
  const b = h('button', { class: cls, type: 'button' });
  const paint = () => { const dark = resolvedTheme() === 'dark'; b.replaceChildren(icon(dark ? 'sun' : 'moon'), h('span', {}, dark ? 'Light theme' : 'Dark theme')); b.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme'; };
  b.addEventListener('click', () => {
    const t = resolvedTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch { }
    applyTheme(); paint();
  });
  paint();
  return b;
}
