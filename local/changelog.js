/**
 * Parse keep-a-changelog markdown and build the changelog API payload.
 */

function normalizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^release[-_\s]*/i, '')
    .replace(/^v/i, '')
    .toLowerCase();
}

function cleanMarkdownText(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseLine(value) {
  return /^(assets?|downloads?|source code|full changelog|compare|all reactions?)\b/i.test(value)
    || /^https:\/\/github\.com\/.+\/compare\//i.test(value);
}

function ensureSection(sections, title) {
  const requestedTitle = title || 'Changes';
  let current = sections[sections.length - 1];
  if (!title && current) return current;
  if (!current || current.title !== requestedTitle) {
    current = { title: requestedTitle, items: [] };
    sections.push(current);
  }
  return current;
}

function parseReleaseBody(body) {
  const sections = [];
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const title = cleanMarkdownText(heading[1]);
      if (title && !isNoiseLine(title)) ensureSection(sections, title);
      continue;
    }

    const bullet = line.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    const text = cleanMarkdownText(bullet ? bullet[1] : line);
    if (!text || isNoiseLine(text)) continue;

    const current = ensureSection(sections);
    if (bullet || current.items.length === 0) {
      current.items.push(text);
    } else {
      current.items[current.items.length - 1] = `${current.items[current.items.length - 1]} ${text}`.trim();
    }
  }

  return sections
    .map((section) => ({
      title: section.title,
      items: section.items.filter(Boolean),
    }))
    .filter((section) => section.items.length);
}

/** Split CHANGELOG.md into per-release bodies keyed by version tag. */
export function parseChangelogMarkdown(markdown) {
  const releases = [];
  let current = null;

  for (const rawLine of String(markdown || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = line.match(/^##\s+\[([^\]]+)]\s*(?:-\s*(.+))?$/);
    if (header) {
      if (current) releases.push(current);
      current = {
        version: header[1].trim(),
        date: (header[2] || '').trim(),
        bodyLines: [],
      };
      continue;
    }
    if (current && line) current.bodyLines.push(rawLine);
  }
  if (current) releases.push(current);

  return releases.map((release) => ({
    version: release.version,
    sections: parseReleaseBody(release.bodyLines.join('\n')),
  }));
}

export function buildChangelogPayload(releases, currentVersion) {
  const normalized = (Array.isArray(releases) ? releases : [])
    .filter((release) => release?.version)
    .map((release) => ({
      version: String(release.version).trim(),
      sections: Array.isArray(release.sections) ? release.sections : [],
    }))
    .filter((release) => release.version);

  const currentKey = normalizeVersion(currentVersion);
  const latestVersion = normalized[0]?.version || null;
  const currentInReleases = Boolean(currentKey)
    && normalized.some((release) => normalizeVersion(release.version) === currentKey);

  return {
    current_version: currentVersion,
    latest_version: latestVersion,
    current_in_releases: currentInReleases,
    releases: normalized,
  };
}

let cachedMarkdown = null;
let cachedPayload = null;

function changelogUrl() {
  const base = typeof window !== 'undefined' ? (window.__MY_HUB_BASE__ || '') : '';
  return `${base}/changelog.md`;
}

export async function loadLocalChangelog(currentVersion) {
  if (cachedPayload && cachedMarkdown) {
    return cachedPayload;
  }

  const response = await fetch(changelogUrl(), { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`changelog.md returned ${response.status}`);
  }

  cachedMarkdown = await response.text();
  cachedPayload = buildChangelogPayload(
    parseChangelogMarkdown(cachedMarkdown),
    currentVersion,
  );
  return cachedPayload;
}

export const __test = {
  normalizeVersion,
  parseChangelogMarkdown,
  buildChangelogPayload,
  parseReleaseBody,
};
