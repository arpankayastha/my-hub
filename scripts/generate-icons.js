/**
 * Icon Generator for My Hub PWA
 * Generates icons from docs/logo.svg
 * Sizes: 192px and 512px, both "any" and "maskable" variants
 * Maskable icons: full-bleed background, logo content stays within 80% safe zone
 *
 * Usage: node scripts/generate-icons.js
 * Dependencies: sharp (devDependency)
 */

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'public', 'icons');

mkdirSync(ICONS_DIR, { recursive: true });

/** Hub mark — central node with four spokes (maskable safe zone). */
const HUB_MARK = `<g fill="#fff">
    <circle cx="80" cy="80" r="17" fill-opacity="0.92"/>
    <circle cx="80" cy="46" r="11" fill-opacity="0.78"/>
    <circle cx="114" cy="80" r="11" fill-opacity="0.78"/>
    <circle cx="80" cy="114" r="11" fill-opacity="0.78"/>
    <circle cx="46" cy="80" r="11" fill-opacity="0.78"/>
    <rect x="76" y="57" width="8" height="18" rx="4" fill-opacity="0.55"/>
    <rect x="76" y="85" width="8" height="18" rx="4" fill-opacity="0.55"/>
    <rect x="57" y="76" width="18" height="8" rx="4" fill-opacity="0.55"/>
    <rect x="85" y="76" width="18" height="8" rx="4" fill-opacity="0.55"/>
  </g>`;

/** Brand sapphire gradient + top sheen */
const DEFS = `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="160" y2="160" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="160" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

/** Logo SVG (any): rounded corners, gradient background + sheen */
function createLogoSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 160 160" fill="none">
  ${DEFS}
  <rect width="160" height="160" rx="36" fill="url(#bg)"/>
  <rect width="160" height="160" rx="36" fill="url(#sheen)"/>
  ${HUB_MARK}
</svg>`;
}

/** Maskable logo SVG: full-bleed background (no rx), logo within safe zone */
function createMaskableLogoSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 160 160" fill="none">
  ${DEFS}
  <rect width="160" height="160" fill="url(#bg)"/>
  <rect width="160" height="160" fill="url(#sheen)"/>
  ${HUB_MARK}
</svg>`;
}

/** Apple Touch Icon (180x180): same as any-icon */
function createAppleTouchSvg() {
  return createLogoSvg(180);
}

/** Favicon (32x32): simplified - just gradient background with house */
function createFaviconSvg() {
  return createLogoSvg(32);
}

const icons = [
  { name: 'icon-192.png',          size: 192, svg: createLogoSvg(192)         },
  { name: 'icon-512.png',          size: 512, svg: createLogoSvg(512)         },
  { name: 'icon-maskable-192.png', size: 192, svg: createMaskableLogoSvg(192) },
  { name: 'icon-maskable-512.png', size: 512, svg: createMaskableLogoSvg(512) },
  { name: 'apple-touch-icon.png',  size: 180, svg: createAppleTouchSvg()      },
  { name: 'favicon-32.png',        size: 32,  svg: createFaviconSvg()         },
];

for (const icon of icons) {
  const outputPath = join(ICONS_DIR, icon.name);
  await sharp(Buffer.from(icon.svg))
    .png()
    .toFile(outputPath);
  console.log(`  ✓ ${icon.name} (${icon.size}x${icon.size})`);
}

console.log('\nIcons generated in public/icons/');
