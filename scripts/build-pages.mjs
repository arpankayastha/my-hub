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

const WEB_EXT = new Set(['.html', '.css', '.json', '.webmanifest', '.svg']);

function alreadyPrefixed(afterSlash, repoSegment) {
  return repoSegment && afterSlash.startsWith(`${repoSegment}/`);
}

/** href/src only — inline <script> may use '/' + variable (must not become '/Genospace/' + seg). */
function rewriteHtmlPaths(content, basePath) {
  if (!basePath) return content;
  const base = basePath.replace(/\/$/, '');
  const repoSegment = base.slice(1);

  return content.replace(
    /\b(href|src)=(['"])\/(?!\/)/gi,
    (match, _attr, quote, offset, whole) => {
      const afterSlash = whole.slice(offset + match.length);
      if (alreadyPrefixed(afterSlash, repoSegment)) return match;
      return match.replace(`${quote}/`, `${quote}${base}/`);
    },
  );
}

/** Quote-prefixed root paths in CSS/JSON/manifest (includes bare "/"). */
function rewriteQuotedRootPaths(content, basePath) {
  if (!basePath) return content;
  const base = basePath.replace(/\/$/, '');
  const repoSegment = base.slice(1);

  return content.replace(/(['"])\/(?!\/)/g, (match, quote, offset, whole) => {
    const afterSlash = whole.slice(offset + match.length);
    if (alreadyPrefixed(afterSlash, repoSegment)) return match;
    return `${quote}${base}/`;
  });
}

/** Static imports and page module paths only — never backticks or regex literals. */
function rewriteJsPaths(content, basePath) {
  if (!basePath) return content;
  const base = basePath.replace(/\/$/, '');
  const repoSegment = base.slice(1);

  return content.split('\n').map((line) => {
    if (/\bassetUrl\s*\(/.test(line) || /\btoAppUrl\s*\(/.test(line) || /\bfromAppUrl\s*\(/.test(line)) {
      return line;
    }
    return line.replace(
      /(\bfrom\s+|\bimport\s+|import\s*\(\s*)(['"])\/(?!\/)/g,
      (match, prefix, quote, offset, whole) => {
        const afterSlash = whole.slice(offset + match.length);
        if (alreadyPrefixed(afterSlash, repoSegment)) return match;
        return `${prefix}${quote}${base}/`;
      },
    );
  }).join('\n');
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
    const original = readFileSync(path, 'utf8');
    let rewritten = original;
    if (ext === '.js' || ext === '.mjs') {
      rewritten = rewriteJsPaths(original, basePath);
    } else if (ext === '.html') {
      rewritten = rewriteHtmlPaths(original, basePath);
    } else if (WEB_EXT.has(ext)) {
      rewritten = rewriteQuotedRootPaths(original, basePath);
    }
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

// GitHub Pages serves 404.html for missing paths while keeping the URL — required for SPA deep links.
function injectCanonicalBase(html, basePath) {
  if (!basePath) return html;
  return html.replace(
    'window.__YUVOMI_LOCAL_MODE__ = true;',
    `window.__YUVOMI_CANONICAL_BASE__='${basePath}'; window.__YUVOMI_LOCAL_MODE__ = true;`,
  );
}

const indexHtml = resolve(siteDir, 'index.html');
if (existsSync(indexHtml)) {
  let html = readFileSync(indexHtml, 'utf8');
  if (basePath) html = injectCanonicalBase(html, basePath);
  writeFileSync(indexHtml, html);
  writeFileSync(resolve(siteDir, '404.html'), html);
}
