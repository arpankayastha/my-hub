/**
 * My Hub logomark — central hub node with four spokes.
 * Background gradients use --color-accent / --color-accent-secondary in the app.
 */

/** Inner mark only (no background). Use fill="currentColor" or fill="white". */
export const LOGOMARK_MARKUP = `
  <circle cx="80" cy="80" r="17" fill-opacity="0.92"/>
  <circle cx="80" cy="46" r="11" fill-opacity="0.78"/>
  <circle cx="114" cy="80" r="11" fill-opacity="0.78"/>
  <circle cx="80" cy="114" r="11" fill-opacity="0.78"/>
  <circle cx="46" cy="80" r="11" fill-opacity="0.78"/>
  <rect x="76" y="57" width="8" height="18" rx="4" fill-opacity="0.55"/>
  <rect x="76" y="85" width="8" height="18" rx="4" fill-opacity="0.55"/>
  <rect x="57" y="76" width="18" height="8" rx="4" fill-opacity="0.55"/>
  <rect x="85" y="76" width="18" height="8" rx="4" fill-opacity="0.55"/>
`;

/** Sidebar logomark: rounded gradient tile + white hub mark. */
export function createSidebarLogomark() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const logoSvg = document.createElementNS(SVG_NS, 'svg');
  logoSvg.setAttribute('viewBox', '0 0 160 160');
  logoSvg.setAttribute('fill', 'none');

  const defs = document.createElementNS(SVG_NS, 'defs');
  const grad = document.createElementNS(SVG_NS, 'linearGradient');
  const gradId = `my-hub-logo-bg-${Math.random().toString(36).slice(2, 7)}`;
  grad.setAttribute('id', gradId);
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '160');
  grad.setAttribute('y2', '160');
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');

  const stop0 = document.createElementNS(SVG_NS, 'stop');
  stop0.setAttribute('offset', '0%');
  stop0.style.stopColor = 'var(--color-accent-secondary)';
  const stop1 = document.createElementNS(SVG_NS, 'stop');
  stop1.setAttribute('offset', '100%');
  stop1.style.stopColor = 'var(--color-accent)';
  grad.appendChild(stop0);
  grad.appendChild(stop1);
  defs.appendChild(grad);
  logoSvg.appendChild(defs);

  const bgRect = document.createElementNS(SVG_NS, 'rect');
  bgRect.setAttribute('width', '160');
  bgRect.setAttribute('height', '160');
  bgRect.setAttribute('rx', '36');
  bgRect.setAttribute('fill', `url(#${gradId})`);
  logoSvg.appendChild(bgRect);

  const marks = document.createElementNS(SVG_NS, 'g');
  marks.setAttribute('fill', 'white');
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${LOGOMARK_MARKUP}</svg>`,
    'image/svg+xml',
  );
  for (const child of parsed.documentElement.childNodes) {
    marks.appendChild(document.importNode(child, true));
  }
  logoSvg.appendChild(marks);

  return logoSvg;
}
