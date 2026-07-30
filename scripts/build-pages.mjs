/**
 * Build static site for GitHub Pages into docs/
 */
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
const siteDir = resolve(root, 'site');

if (existsSync(siteDir)) {
  rmSync(siteDir, { recursive: true, force: true });
}
mkdirSync(siteDir, { recursive: true });

cpSync(publicDir, siteDir, { recursive: true });

// PWA manifest alias (index.html references manifest.webmanifest)
const manifestSrc = resolve(siteDir, 'manifest.json');
if (existsSync(manifestSrc)) {
  cpSync(manifestSrc, resolve(siteDir, 'manifest.webmanifest'));
}

writeFileSync(resolve(siteDir, '.nojekyll'), '');

console.log('GitHub Pages build complete → site/');
