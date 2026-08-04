/**
 * Local API: health vitals POST/GET and nextId normalization.
 * Run: node --test test/test-local-health-vitals.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const sessionStore = new Map();
globalThis.localStorage = {
  getItem: (k) => sessionStore.get(k) ?? null,
  setItem: (k, v) => sessionStore.set(k, v),
  removeItem: (k) => sessionStore.delete(k),
};

const { resetState, setSession, loadState, getState, nextId } = await import('../public/local/store.js');
const { createSeedState } = await import('../public/local/seed.js');
const { handleLocalApi } = await import('../public/local/handlers.js');
const { handleHealthApi } = await import('../public/local/health-handlers.js');

async function withUser(fn) {
  sessionStore.clear();
  const seed = createSeedState();
  seed.users = [{ id: 1, username: 'admin', display_name: 'Admin', role: 'admin', password_hash: 'x' }];
  await resetState(seed);
  setSession({ userId: 1, csrfToken: 'test' });
  return fn(getState());
}

test('nextId recovers when stored state has invalid nextId', async () => {
  sessionStore.clear();
  const seed = createSeedState();
  seed.nextId = undefined;
  await resetState(seed);
  await loadState();
  const id = nextId();
  assert.equal(id, 1);
  assert.equal(getState().nextId, 2);
});

test('POST /health/vitals stores weight measurement', async () => {
  await withUser(async (state) => {
    const res = await handleLocalApi('POST', 'health/vitals', {
      type: 'weight',
      value_num: 72,
      unit: 'kg',
      measured_at: '2026-08-04T10:30',
      visibility: 'private',
    }, {});
    assert.ok(Number.isFinite(res.data.id));
    assert.equal(res.data.type, 'weight');
    assert.equal(res.data.value_num, 72);
    assert.equal(res.data.measured_at, '2026-08-04T10:30');

    const list = await handleLocalApi('GET', 'health/vitals', null, { user_id: '1' });
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].id, res.data.id);
  });
});

test('POST /health/vitals stores blood pressure with optional pulse', async () => {
  await withUser(async () => {
    const res = await handleLocalApi('POST', 'health/vitals', {
      type: 'bp',
      value_num: 120,
      value_num2: 80,
      unit: 'mmHg',
      measured_at: '2026-08-04T08:00',
      visibility: 'family',
    }, {});
    assert.equal(res.data.value_num2, 80);
    assert.equal(res.data.value_num3, null);
  });
});

test('POST /health/vitals rejects missing measured_at', async () => {
  await withUser(async (state) => {
    await assert.rejects(
      () => handleHealthApi('POST', ['health', 'vitals'], {}, {
        type: 'weight',
        value_num: 70,
        unit: 'kg',
      }, state, 1),
      (err) => err.status === 400,
    );
  });
});

test('POST /health/vitals rejects invalid type', async () => {
  await withUser(async (state) => {
    await assert.rejects(
      () => handleHealthApi('POST', ['health', 'vitals'], {}, {
        type: 'hr',
        value_num: 60,
        measured_at: '2026-08-04T08:00',
      }, state, 1),
      (err) => err.status === 400,
    );
  });
});
