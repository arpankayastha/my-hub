/**
 * Local API: PATCH /auth/me/profile and /auth/me/password
 * Run: node --test test/test-local-auth-profile.js
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
const { createSeedState, hashPasswordSimple } = await import('../public/local/seed.js');
const { handleLocalApi } = await import('../public/local/handlers.js');

async function withUser(fn) {
  sessionStore.clear();
  const seed = createSeedState();
  const pwd = hashPasswordSimple('secret123');
  seed.users = [
    {
      id: 1,
      username: 'arpan',
      display_name: 'Arpan',
      role: 'admin',
      password_hash: pwd,
      family_role: 'parent',
      access_scope: 'family',
      avatar_color: '#007AFF',
      avatar_data: null,
      phone: null,
      email: null,
      birth_date: null,
    },
  ];
  seed.contacts = [];
  seed.birthdays = [];
  await resetState(seed);
  setSession({ userId: 1, csrfToken: 'test' });
  return fn();
}

test('PATCH /auth/me/profile updates display name and contact fields', async () => {
  await withUser(async () => {
    const res = await handleLocalApi('PATCH', 'auth/me/profile', {
      display_name: 'Arpan Kayastha',
      phone: '+1 555 0100',
      email: 'arpan@example.com',
      birth_date: '1990-05-15',
    }, {});
    assert.equal(res.user.display_name, 'Arpan Kayastha');
    assert.equal(res.user.phone, '+1 555 0100');
    assert.equal(res.user.email, 'arpan@example.com');
    assert.equal(res.user.birth_date, '1990-05-15');

    const me = await handleLocalApi('GET', 'auth/me', null, {});
    assert.equal(me.user.display_name, 'Arpan Kayastha');
  });
});

test('PATCH /auth/me/password changes password', async () => {
  await withUser(async () => {
    const res = await handleLocalApi('PATCH', 'auth/me/password', {
      current_password: 'secret123',
      new_password: 'newsecret99',
    }, {});
    assert.equal(res.ok, true);

    const bad = await handleLocalApi('PATCH', 'auth/me/password', {
      current_password: 'secret123',
      new_password: 'another99',
    }, {}).catch((e) => e);
    assert.equal(bad.status, 401);

    const good = await handleLocalApi('PATCH', 'auth/me/password', {
      current_password: 'newsecret99',
      new_password: 'secret123',
    }, {});
    assert.equal(good.ok, true);
  });
});
