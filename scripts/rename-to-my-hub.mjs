/**
 * One-shot rebrand: My Hub/My Hub → My Hub (my-hub).
 * Run from repo root: node scripts/rename-to-my-hub.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'site', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json']); // refresh via npm install
const TEXT_EXT = new Set([
  '.js', '.mjs', '.json', '.html', '.md', '.css', '.yml', '.yaml', '.xml',
  '.sh', '.txt', '.example', '.container', '.webmanifest',
]);

const REPLACEMENTS = [
  [/window\.myhub/g, 'window.myHub'],
  [/window\.myhub/g, 'window.myHub'],
  [/MyHubInstallPrompt/g, 'MyHubInstallPrompt'],
  [/MyHubLocalePicker/g, 'MyHubLocalePicker'],
  [/createLogger\('My Hub'\)/g, "createLogger('My Hub')"],
  [/createLogger\('My Hub'\)/g, "createLogger('My Hub')"],
  [/\[My Hub\]/g, '[My Hub]'],
  [/\[My Hub\]/g, '[My Hub]'],
  [/__MY_HUB_/g, '__MY_HUB_'],
  [/__MY_HUB_/g, '__MY_HUB_'],
  [/MY_HUB_/g, 'MY_HUB_'],
  [/MY_HUB_/g, 'MY_HUB_'],
  [/My Hub/g, 'My Hub'],
  [/My Hub/g, 'My Hub'],
  [/My Hub/g, 'My Hub'],
  [/My Hub/g, 'My Hub'],
  [/my-hub/g, 'my-hub'],
  [/my-hub-/g, 'my-hub-'],
  [/myhub/g, 'myhub'],
  [/myhub\.db/g, 'my-hub.db'],
  [/myhub\.db/g, 'my-hub.db'],
  [/my-hub-/g, 'my-hub-'],
  [/My Hub/g, 'My Hub'],
  [/myhub/g, 'myhub'],
  [/ulsklyc\/myhub/g, 'arpankayastha/my-hub'],
  [/ulsklyc\/myhub/g, 'arpankayastha/my-hub'],
  [/ghcr\.io\/ulsklyc\/myhub/g, 'ghcr.io/arpankayastha/my-hub'],
  [/ghcr\.io\/ulsklyc\/myhub/g, 'ghcr.io/arpankayastha/my-hub'],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function apply(content) {
  let out = content;
  for (const [re, rep] of REPLACEMENTS) out = out.replace(re, rep);
  return out;
}

let changed = 0;
for (const path of walk(ROOT)) {
  const rel = path.slice(ROOT.length + 1);
  if (SKIP_FILES.has(rel)) continue;
  const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.')) : '';
  if (!TEXT_EXT.has(ext)) continue;
  const original = readFileSync(path, 'utf8');
  const rewritten = apply(original);
  if (rewritten !== original) {
    writeFileSync(path, rewritten);
    changed += 1;
  }
}

console.log(`Updated ${changed} files`);
