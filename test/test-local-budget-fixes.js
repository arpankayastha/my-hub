/**
 * Local budget: categories, recurrence, clone-month.
 * Run: node --test test/test-local-budget-fixes.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetState } from '../public/local/store.js';
import { createSeedState } from '../public/local/seed.js';
import { ensureBudgetState, handleBudgetApi } from '../public/local/budget-handlers.js';

async function withState(fn) {
  const seed = createSeedState();
  seed.users = [{ id: 1, username: 'admin', display_name: 'Admin', role: 'admin', password_hash: 'x' }];
  await resetState(seed);
  return fn(seed);
}

function findUser() {
  return { id: 1, display_name: 'Admin', role: 'admin' };
}

test('POST budget category and subcategory', async () => {
  await withState(async (state) => {

  const catRes = await handleBudgetApi(
    'POST',
    ['budget', 'categories'],
    {},
    { name: 'Test Cat', type: 'expense' },
    state,
    1,
    findUser,
  );
  assert.equal(catRes.data.name, 'Test Cat');

  const subRes = await handleBudgetApi(
    'POST',
    ['budget', 'categories', catRes.data.key, 'subcategories'],
    {},
    { name: 'Test Sub' },
    state,
    1,
    findUser,
  );
  assert.equal(subRes.data.name, 'Test Sub');

  const list = await handleBudgetApi('GET', ['budget', 'categories'], {}, null, state, 1, findUser);
  const found = list.data.find((c) => c.key === catRes.data.key);
  assert.ok(found?.subcategories?.some((s) => s.key === subRes.data.key));
  });
});

test('recurring entry materializes in next month', async () => {
  await withState(async (state) => {

  await handleBudgetApi(
    'POST',
    ['budget'],
    {},
    {
      title: 'Rent',
      amount: -1000,
      category: 'housing',
      subcategory: 'rent_mortgage',
      date: '2026-01-15',
      is_recurring: true,
      recurrence_interval: 'monthly',
    },
    state,
    1,
    findUser,
  );

  const feb = await handleBudgetApi('GET', ['budget'], { month: '2026-02' }, null, state, 1, findUser);
  assert.ok(feb.data.some((e) => e.title === 'Rent' && e.recurrence_parent_id));
  });
});

test('clone-month copies one-time entries only', async () => {
  await withState(async (state) => {

  await handleBudgetApi(
    'POST',
    ['budget'],
    {},
    { title: 'Coffee', amount: -5, category: 'food', date: '2026-03-10' },
    state,
    1,
    findUser,
  );

  const res = await handleBudgetApi(
    'POST',
    ['budget', 'clone-month'],
    {},
    { from_month: '2026-03', to_month: '2026-04' },
    state,
    1,
    findUser,
  );
  assert.equal(res.data.copied, 1);

  const apr = await handleBudgetApi('GET', ['budget'], { month: '2026-04' }, null, state, 1, findUser);
  assert.ok(apr.data.some((e) => e.title === 'Coffee' && e.date.startsWith('2026-04')));
  });
});

test('PUT series updates parent and keeps past instance amounts', async () => {
  await withState(async (state) => {

  const created = await handleBudgetApi(
    'POST',
    ['budget'],
    {},
    {
      title: 'Rent',
      amount: -1000,
      category: 'housing',
      subcategory: 'rent_mortgage',
      date: '2026-01-15',
      is_recurring: true,
      recurrence_interval: 'monthly',
    },
    state,
    1,
    findUser,
  );
  const parentId = created.data.id;

  await handleBudgetApi('GET', ['budget'], { month: '2026-02' }, null, state, 1, findUser);
  const febBefore = await handleBudgetApi('GET', ['budget'], { month: '2026-02' }, null, state, 1, findUser);
  const febInst = febBefore.data.find((e) => e.recurrence_parent_id === parentId);
  assert.ok(febInst);
  assert.equal(febInst.amount, -1000);

  await handleBudgetApi(
    'PUT',
    ['budget', String(parentId), 'series'],
    {},
    { amount: -1200 },
    state,
    1,
    findUser,
  );

  const febAfter = await handleBudgetApi('GET', ['budget'], { month: '2026-02' }, null, state, 1, findUser);
  const febInstAfter = febAfter.data.find((e) => e.recurrence_parent_id === parentId);
  assert.equal(febInstAfter.amount, -1000, 'past month instance keeps old amount');

  const parent = state.budget_entries.find((e) => e.id === parentId);
  assert.equal(parent.amount, -1200, 'parent carries new amount');
  });
});
