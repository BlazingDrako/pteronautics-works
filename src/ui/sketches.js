// Card sketches. Vehicles of a class this build analyses (fixed-wing, sailplanes) are drawn from their own geometry,
// to scale, so the card follows every edit; the concept classes use fixed drawings until their classes are implemented.
import { s } from './dom.js';
import { planformShapes } from './planform.js';
import { VEHICLE_CLASSES } from '../model/vehicle.js';

const FIXED = {
  'high-speed': `<path d="M140,14 L118,140 M140,14 L162,140" class="sk-hl" style="stroke-width:.8;stroke-dasharray:3 3;opacity:.7"/>
    <path class="sk-body" d="M140,22 C146,34 147,60 147,74 L214,130 L214,138 L150,136 L148,148 L132,148 L130,136 L66,138 L66,130 L133,74 C133,60 134,34 140,22 Z"/>
    <path class="sk-line" d="M140,96 L140,148 M126,92 L126,110 M154,92 L154,110"/><path class="sk-hl-fill" d="M136,148 L140,160 L144,148 Z"/>`,
  rotorcraft: `<g class="sk-line" style="stroke-dasharray:2 3;opacity:.8"><circle cx="92" cy="40" r="21"/><circle cx="188" cy="40" r="21"/><circle cx="92" cy="122" r="21"/><circle cx="188" cy="122" r="21"/></g>
    <path d="M92,30 L92,132 M188,30 L188,132" class="sk-line" style="stroke-width:2.2;stroke-linecap:round"/>
    <path class="sk-body" d="M28,74 L140,70 L252,74 L252,90 L140,94 L28,90 Z"/>
    <path class="sk-dark" d="M140,26 C152,30 152,52 152,70 L148,138 L132,138 L128,70 C128,52 128,30 140,26 Z"/>
    <path class="sk-line" style="stroke-width:1.4" d="M118,140 L140,132 L162,140"/><path class="sk-hl" d="M126,146 L154,146"/>`,
  'launch-vehicle': `<path class="sk-body" d="M50,74 L232,74 C246,74 258,80 266,85 C258,90 246,96 232,96 L50,96 Z"/>
    <path class="sk-line" style="stroke-dasharray:3 2" d="M150,74 L150,96 M196,72 L196,98"/>
    <path class="sk-body" style="fill-opacity:.6" d="M50,74 L36,62 L36,74 Z M50,96 L36,108 L36,96 Z"/>
    <path class="sk-line" style="stroke-width:1.2" d="M50,78 L40,74 L40,96 L50,92"/><path class="sk-hl-fill" style="opacity:.75" d="M40,76 C28,79 16,82 6,85 C16,88 28,91 40,94 Z"/>
    <text x="98" y="114" class="sk-text" text-anchor="middle">S1</text><text x="173" y="114" class="sk-text" text-anchor="middle">S2</text>`,
  sailplane: `<path class="sk-body" style="stroke-width:1.3" d="M8,80 L140,76 L272,80 L272,86 L140,90 L8,86 Z"/>
    <path class="sk-dark" style="stroke-width:1.3" d="M140,40 C145,44 145,62 144,74 L141,146 L139,146 L136,74 C135,62 135,44 140,40 Z"/>
    <path class="sk-body" style="stroke-width:1.1" d="M118,144 L140,142 L162,144 L162,150 L140,152 L118,150 Z"/>
    <path d="M8,83 C60,60 220,60 272,83" fill="none" style="stroke:var(--lam);stroke-width:1;stroke-dasharray:2 3"/>`,
  spacecraft: `<ellipse cx="140" cy="88" rx="120" ry="42" fill="none" style="stroke:var(--text-3);stroke-width:.8;stroke-dasharray:3 4" transform="rotate(-12 140 88)"/>
    <path class="sk-dark" d="M126,70 L140,62 L154,70 L154,104 L140,112 L126,104 Z"/><path class="sk-line" d="M126,70 L140,78 L154,70 M140,78 L140,112"/>
    <path class="sk-body" d="M70,72 L122,80 L122,96 L70,88 Z M158,80 L210,72 L210,88 L158,96 Z"/>
    <path class="sk-line" style="stroke-width:.6" d="M83,74 L83,90 M96,76 L96,92 M109,78 L109,94 M171,78 L171,94 M184,76 L184,92 M197,74 L197,90"/>
    <circle cx="140" cy="40" r="3" class="sk-hl-fill"/>`,
};

export function sketch(v) {
  const svg = s('svg', { viewBox: '0 0 280 170', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  if (VEHICLE_CLASSES[v.class]?.implemented && v.components?.some(c => c.type === 'wing')) {
    try { planformShapes(svg, v, { x: 14, y: 16, w: 252, h: 140 }, { compact: true }); return svg; } catch { /* fall through */ }
  }
  svg.innerHTML = FIXED[v.class] || FIXED.sailplane;
  return svg;
}
