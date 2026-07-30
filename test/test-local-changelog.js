/**
 * Tests: local changelog parser (CHANGELOG.md for GitHub Pages build).
 * Ausführen: node --test test/test-local-changelog.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { __test } from '../public/local/changelog.js';

const changelogMd = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md'),
  'utf8',
);

test('parseChangelogMarkdown reads keep-a-changelog release sections', () => {
  const releases = __test.parseChangelogMarkdown(changelogMd);
  assert.ok(releases.some((r) => r.version === '1.1.2'));
  const latest = releases.find((r) => r.version === '1.1.2');
  assert.ok(latest.sections.some((s) => s.title === 'Added'));
  assert.ok(latest.sections.some((s) => s.items.some((i) => /hub-and-spoke/i.test(i))));
});

test('buildChangelogPayload marks current version when listed in changelog', () => {
  const releases = __test.parseChangelogMarkdown(changelogMd);
  const payload = __test.buildChangelogPayload(releases, '1.1.2');
  assert.equal(payload.current_version, '1.1.2');
  assert.equal(payload.latest_version, '1.1.2');
  assert.equal(payload.current_in_releases, true);
  assert.ok(payload.releases.length >= 4);
});

test('buildChangelogPayload reports missing current version', () => {
  const releases = __test.parseChangelogMarkdown(changelogMd);
  const payload = __test.buildChangelogPayload(releases, '9.9.9');
  assert.equal(payload.current_in_releases, false);
});
