/**
 * Build static site for GitHub Pages into site/
 * Rewrites root-absolute asset paths for project-site hosting (e.g. /Genospace/).
 */
import {
  cpSync, mkdirSync, writeFileSync, existsSync, rmSync,
  readFileSync, readdirSync, statSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
const siteDir = resolve(root, 'site');

/** e.g. GITHUB_REPOSITORY=arpankayastha/Genospace → /Genospace */
function resolveBasePath() {
  if (process.env.GITHUB_PAGES_BASE) {
    const raw = process.env.GITHUB_PAGES_BASE.trim();
    if (!raw || raw === '/') return '';
    return raw.startsWith('/') ? raw.replace(/\/$/, '') : `/${raw.replace(/\/$/, '')}`;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo?.includes('/')) {
    return `/${repo.split('/')[1]}`;
  }
  return '';
}

const TEXT_EXT = new Set([
  '.js', '.mjs', '.html', '.css', '.json', '.webmanifest', '.svg',
]);

/** SPA route definitions — not static asset URLs. */
// Route paths are skipped inside rewriteLine via lookbehind on `path:`.

/**
 * Prefix root-absolute URLs (/api.js → /Genospace/api.js).
 * Skips SPA route paths (path: '/login') and already-prefixed paths.
 */
function rewriteRootPaths(content, basePath, { perLine = false } = {}) {
  if (!basePath) return content;
  const base = basePath.replace(/\/$/, '');
  const repoSegment = base.slice(1);

  const rewriteLine = (line) => {
    // Runtime helpers already apply the GitHub Pages base path.
    if (/\bassetUrl\s*\(/.test(line) || /\btoAppUrl\s*\(/.test(line) || /\bfromAppUrl\s*\(/.test(line)) {
      return line;
    }
    return line.replace(/(['"`])\/(?!\/)/g, (match, quote, offset, whole) => {
    const before = whole.slice(0, offset);
    // SPA route slug (path: '/login') — not a static asset URL.
    if (/\bpath:\s*$/.test(before)) return match;
    const afterSlash = whole.slice(offset + match.length);
    if (repoSegment && afterSlash.startsWith(`${repoSegment}/`)) return match;
    return `${quote}${base}/`;
    });
  };

  if (perLine) {
    return content.split('\n').map((line) => rewriteLine(line)).join('\n');
  }
  return rewriteLine(content);
}

function walkAndRewrite(dir, basePath) {
  if (!basePath) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walkAndRewrite(path, basePath);
      continue;
    }
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (!TEXT_EXT.has(ext)) continue;
    const original = readFileSync(path, 'utf8');
    const perLine = ext === '.js' || ext === '.mjs';
    const rewritten = rewriteRootPaths(original, basePath, { perLine });
    if (rewritten !== original) writeFileSync(path, rewritten);
  }
}

if (existsSync(siteDir)) {
  rmSync(siteDir, { recursive: true, force: true });
}
mkdirSync(siteDir, { recursive: true });

cpSync(publicDir, siteDir, { recursive: true });

const manifestSrc = resolve(siteDir, 'manifest.json');
if (existsSync(manifestSrc)) {
  cpSync(manifestSrc, resolve(siteDir, 'manifest.webmanifest'));
}

writeFileSync(resolve(siteDir, '.nojekyll'), '');

const basePath = resolveBasePath();
if (basePath) {
  walkAndRewrite(siteDir, basePath);
  console.log(`GitHub Pages build complete → site/ (base: ${basePath})`);
} else {
  console.log('GitHub Pages build complete → site/ (root paths unchanged)');
}
