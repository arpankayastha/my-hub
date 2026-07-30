/**
 * Local API: profile context switch + family member PATCH.
 * Run: node --test test/test-local-profile-context.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const sessionStore = new Map();
globalThis.localStorage = {
  getItem: (k) => sessionStore.get(k) ?? null,
  setItem: (k, v) => sessionStore.set(k, v),
  removeItem: (k) => sessionStore.delete(k),
};

const { resetState, setSession } = await import('../public/local/store.js');
const { createSeedState } = await import('../public/local/seed.js');
const { handleLocalApi } = await import('../public/local/handlers.js');
const { ensureBudgetState } = await import('../public/local/budget-handlers.js');

async function withHousehold(fn) {
  sessionStore.clear();
  const seed = createSeedState();
  seed.sync_config = { ...(seed.sync_config || {}), budget_mode: 'personal' };
  seed.users = [
    { id: 1, username: 'admin', display_name: 'Arpan', role: 'admin', password_hash: 'x', family_role: 'parent', access_scope: 'family' },
    { id: 2, username: 'wife', display_name: 'Wife', role: 'member', password_hash: 'x', family_role: 'wife', access_scope: 'family' },
  ];
  ensureBudgetState(seed);
  seed.budget_entries.push({
    id: 1,
    title: 'Admin rent',
    amount: -5000,
    category: 'housing',
    subcategory: 'rent_mortgage',
    date: new Date().toISOString().slice(0, 10),
    is_recurring: 0,
    created_by: 1,
    owner_id: 1,
    visibility: 'private',
  });
  seed.budget_entries.push({
    id: 2,
    title: 'Wife groceries',
    amount: -200,
    category: 'food',
    subcategory: 'groceries',
    date: new Date().toISOString().slice(0, 10),
    is_recurring: 0,
    created_by: 2,
    owner_id: 2,
    visibility: 'private',
  });
  await resetState(seed);
  setSession({ userId: 1, csrfToken: 'test' });
  return fn(seed);
}

test('POST auth/context switches acting_as and budget summary', async () => {
  await withHousehold(async () => {
    const ctx = await handleLocalApi('POST', 'auth/context', { user_id: 2 }, {});
    assert.equal(ctx.acting_as?.display_name, 'Wife');

    const dash = await handleLocalApi('GET', 'dashboard', null, {});
    assert.equal(dash.budget.expenses, 200);

    const summary = await handleLocalApi('GET', 'budget/summary', null, { month: new Date().toISOString().slice(0, 7), scope: 'mine' });
    assert.equal(Math.abs(summary.data.expenses), 200);
  });
});

test('profile switch scopes budget in shared household mode', async () => {
  sessionStore.clear();
  const seed = createSeedState();
  seed.sync_config = { ...(seed.sync_config || {}), budget_mode: 'shared' };
  seed.users = [
    { id: 1, username: 'admin', display_name: 'Arpan', role: 'admin', password_hash: 'x', family_role: 'parent', access_scope: 'family' },
    { id: 2, username: 'wife', display_name: 'Wife', role: 'member', password_hash: 'x', family_role: 'wife', access_scope: 'family' },
  ];
  ensureBudgetState(seed);
  const today = new Date().toISOString().slice(0, 10);
  seed.budget_entries.push({
    id: 1,
    title: 'Admin rent',
    amount: -5000,
    category: 'housing',
    date: today,
    is_recurring: 0,
    created_by: 1,
    owner_id: 1,
    visibility: 'shared',
  });
  seed.budget_entries.push({
    id: 2,
    title: 'Wife groceries',
    amount: -200,
    category: 'food',
    date: today,
    is_recurring: 0,
    created_by: 2,
    owner_id: 2,
    visibility: 'shared',
  });
  await resetState(seed);
  setSession({ userId: 1, csrfToken: 'test' });

  const ctx = await handleLocalApi('POST', 'auth/context', { user_id: 2 }, {});
  assert.equal(ctx.acting_as?.display_name, 'Wife');

  const dash = await handleLocalApi('GET', 'dashboard', null, {});
  assert.equal(dash.budget.expenses, 200);

  const list = await handleLocalApi('GET', 'budget', null, { month: new Date().toISOString().slice(0, 7) });
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].title, 'Wife groceries');
});

test('admin default profile shows only own budget in shared mode', async () => {
  sessionStore.clear();
  const seed = createSeedState();
  seed.sync_config = { ...(seed.sync_config || {}), budget_mode: 'shared' };
  seed.users = [
    { id: 1, username: 'arpan', display_name: 'Arpan', role: 'admin', password_hash: 'x', family_role: 'parent', access_scope: 'family' },
    { id: 2, username: 'ranjan', display_name: 'Ranjan', role: 'member', password_hash: 'x', family_role: 'wife', access_scope: 'family' },
  ];
  ensureBudgetState(seed);
  const today = new Date().toISOString().slice(0, 10);
  seed.budget_entries.push({
    id: 1, title: 'Arpan rent', amount: -1000, category: 'housing', date: today,
    is_recurring: 0, created_by: 1, owner_id: 1, visibility: 'shared',
  });
  seed.budget_entries.push({
    id: 2, title: 'Ranjan groceries', amount: -200, category: 'food', date: today,
    is_recurring: 0, created_by: 2, owner_id: 2, visibility: 'shared',
  });
  await resetState(seed);
  setSession({ userId: 1, csrfToken: 'test', contextUserId: 1 });

  const list = await handleLocalApi('GET', 'budget', null, { month: today.slice(0, 7) });
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].title, 'Arpan rent');
});

test('PATCH auth/users/:id updates family member (local mode)', async () => {
  await withHousehold(async () => {
    const res = await handleLocalApi('PATCH', 'auth/users/2', {
      username: 'wife',
      display_name: 'Partner',
      family_role: 'wife',
      system_admin: false,
    }, {});
    assert.equal(res.user.display_name, 'Partner');
  });
});
