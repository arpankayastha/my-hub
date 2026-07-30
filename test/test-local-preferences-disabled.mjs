import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseDisabledModules,
  TOGGLEABLE_MODULES,
} from '../public/local/preferences-helpers.js';

test('parseDisabledModules accepts JSON array', () => {
  assert.deepEqual(parseDisabledModules(JSON.stringify(['calendar', 'tasks'])), ['calendar', 'tasks']);
});

test('parseDisabledModules accepts legacy comma-separated values', () => {
  assert.deepEqual(parseDisabledModules('calendar,tasks'), ['calendar', 'tasks']);
});

test('parseDisabledModules filters unknown modules', () => {
  assert.deepEqual(parseDisabledModules(JSON.stringify(['calendar', 'nonsense'])), ['calendar']);
});
