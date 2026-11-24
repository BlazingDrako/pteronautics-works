// Shared pieces of the analysis tabs (Orbit, Pilot): the top bar with the tab strip, form fields, small tables.
import { h, icon, brand, themeButton, toast } from './dom.js';

export const TOOLS = [
  { id: 'orbit', label: 'Orbit', href: '#/orbit', note: 'Mission and trajectory design' },
  { id: 'pilot', label: 'Pilot', href: '#/pilot', note: 'Flight dynamics and controls' },
];

// Top bar: brand, back to the hangar, the analysis tabs, then whatever the page adds on the right
export function toolTopbar(active, ...right) {
  return h('header', { class: 'topbar' },
    brand({ compact: true }), h('span', { class: 'vsep' }),
    h('nav', { class: 'row', 'aria-label': 'Analysis tabs', style: { gap: '4px' } },
      h('a', { class: 'vtab', href: '#/' }, icon('back'), 'Hangar'),
      ...TOOLS.map(t => h('a', { class: 'vtab' + (t.id === active ? ' on' : ''), href: t.href, 'aria-current': t.id === active ? 'page' : null, title: t.note },
        t.id === active ? h('span', { class: 'dot' }) : null, icon(t.id), t.label))),
    h('span', { class: 'grow' }), ...right, themeButton('btn small'));
}

// A number with a slider, like the workspace editors. opts: { min, max, step, smin, smax, digits }
export function numberField(label, unit, value, opts, onInput) {
  const { min, max, step } = opts, lo = Math.max(min, opts.smin ?? min), hi = Math.min(max, opts.smax ?? max);
  const range = h('input', { type: 'range', min: lo, max: hi, step, value, 'aria-label': label });
  const num = h('input', { class: 'num', type: 'number', min, max, step, value: +(+value).toPrecision(6), 'aria-label': label + (unit ? ` (${unit})` : '') });
  const fill = () => range.style.setProperty('--fill', ((Math.min(hi, Math.max(lo, +range.value)) - lo) / (hi - lo) * 100) + '%');
  range.addEventListener('input', () => { num.value = +(+range.value).toPrecision(6); num.classList.remove('invalid'); fill(); onInput(+range.value); });
  num.addEventListener('change', () => {
    const v = +num.value;
    if (num.value === '' || !isFinite(v) || v < min || v > max) { num.classList.add('invalid'); toast(`${label} must be between ${min} and ${max}${unit ? ' ' + unit : ''}`, true); return; }
    num.classList.remove('invalid'); range.value = v; fill(); onInput(v);
  });
  fill();
  const el = h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, label), h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, num, h('span', { class: 'unit' }, unit || ''))), range);
  el.set = v => { range.value = v; num.value = +(+v).toPrecision(6); fill(); };
  return el;
}
export function selectField(label, value, options, onChange) {
  const sel = h('select', { class: 'txt', 'aria-label': label, onchange: e => onChange(e.target.value) },
    options.map(o => h('option', { value: o.value, selected: o.value === value }, o.label)));
  return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, label), sel));
}
// A segmented choice (Atlas-style toggle buttons)
export function segmented(label, value, options, onChange) {
  return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, label)),
    h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(o => h('button', {
      class: 'tg sm' + (o.value === value ? ' on' : ''), type: 'button', 'aria-pressed': o.value === value ? 'true' : 'false', title: o.title, onclick: () => onChange(o.value),
    }, o.label))));
}
export const derived = (k, v, title) => h('div', { class: 'derived', title }, h('span', {}, k), h('span', { class: 'mono' }, v));
export const kv = (k, v, title) => h('div', { title }, h('span', {}, k), h('b', {}, v));
export const plotCard = (title, el, note) => h('div', { class: 'plot-card' }, h('h4', {}, title), el, note ? h('div', { class: 'note', style: { marginTop: '4px' } }, note) : null);
export const stat = (label, value, unit, sub, color) => h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label),
  h('span', { class: 'stat-v', style: { color } }, value, unit ? h('small', {}, unit) : null), h('span', { class: 'stat-s', title: typeof sub === 'string' ? sub : null }, sub));
// Sub-tabs inside the centre view, drawn like the workspace breadcrumbs but without the arrows
export function subTabs(tabs, active, onPick) {
  return h('nav', { class: 'crumbs subtabs', role: 'tablist', 'aria-label': 'Views' }, tabs.map(t => h('button', {
    class: 'crumb' + (t.id === active ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': t.id === active ? 'true' : 'false', onclick: () => onPick(t.id),
  }, t.label)));
}
// Duration from seconds: "1 h 32 min", "12.4 min", "38 s", "2.3 d"
export function dur(s) {
  if (!isFinite(s)) return '—';
  const a = Math.abs(s);
  if (a < 90) return `${a.toFixed(a < 10 ? 1 : 0)} s`;
  if (a < 3600) return `${(a / 60).toFixed(1)} min`;
  if (a < 2 * 86400) { const hh = Math.floor(a / 3600), m = Math.round((a - hh * 3600) / 60); return `${hh} h ${m} min`; }
  return `${(a / 86400).toFixed(a < 20 * 86400 ? 2 : 1)} d`;
}
export const km = m => (isFinite(m) ? (Math.abs(m) >= 1e12 ? (m / 1e3).toExponential(3) : Math.round(m / 1e3).toLocaleString('en-US')) : '—');
// A small table: rows of cells; head is a list of column titles
export function table(head, rows, cls = 'rq') {
  return h('div', { class: 'mx-wrap' }, h('table', { class: cls },
    h('thead', {}, h('tr', {}, head.map(t => h('th', {}, t)))),
    h('tbody', {}, rows.map(r => h('tr', {}, r.map(c => (c instanceof Node ? h('td', {}, c) : h('td', { class: typeof c === 'number' || /^[−\-\d.]/.test(String(c)) ? 'num-c' : '' }, c))))))));
}
