/**
 * Profile context switching and expanded family roles.
 * Run: node --test test/test-profile-context.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILY_ROLES, isValidFamilyRole } from '../public/utils/family-roles.js';
import {
  actingUserIdFromSession,
  effectiveUserId,
  publicActingAs,
  profileDisplayName,
} from '../public/utils/profile-context.js';
import { resolveContextTarget } from '../server/profile-context.js';

test('family roles include spouse and mother', () => {
  assert.ok(isValidFamilyRole('spouse'));
  assert.ok(isValidFamilyRole('wife'));
  assert.ok(isValidFamilyRole('mother'));
  assert.ok(!isValidFamilyRole('invalid'));
  assert.equal(FAMILY_ROLES.length, 15);
});

test('acting user id from session', () => {
  assert.equal(actingUserIdFromSession({ contextUserId: 5 }, 1), 5);
  assert.equal(actingUserIdFromSession({ contextUserId: 1 }, 1), 1);
  assert.equal(actingUserIdFromSession(null, 2), 2);
});

test('effectiveUserId on client user object', () => {
  const user = {
    id: 1,
    acting_as: { id: 3, display_name: 'Wife' },
  };
  assert.equal(effectiveUserId(user), 3);
  assert.equal(effectiveUserId({ id: 1, acting_as: null }), 1);
});

test('resolveContextTarget admin only', () => {
  const users = [
    { id: 1, role: 'admin', display_name: 'Admin' },
    { id: 2, role: 'member', display_name: 'Wife' },
  ];
  const find = (id) => users.find((u) => u.id === id);

  assert.deepEqual(resolveContextTarget(1, 2, find), { contextUserId: 2 });
  assert.deepEqual(resolveContextTarget(1, null, find), { contextUserId: null });
  assert.deepEqual(resolveContextTarget(1, 1, find), { contextUserId: 1 });
  const denied = resolveContextTarget(2, 1, find);
  assert.equal(denied.status, 403);
});

test('publicActingAs returns member summary', () => {
  const users = [
    { id: 1, role: 'admin', display_name: 'Admin', avatar_color: '#000' },
    { id: 2, role: 'member', display_name: 'Mom', avatar_color: '#fff', family_role: 'mother' },
  ];
  const find = (id) => users.find((u) => u.id === id);
  const acting = publicActingAs(find, 2, 1);
  assert.equal(acting.display_name, 'Mom');
  assert.equal(publicActingAs(find, null, 1), null);
});

test('profileDisplayName prefers acting_as', () => {
  assert.equal(profileDisplayName({ id: 1, display_name: 'Admin', acting_as: { id: 2, display_name: 'Wife' } }), 'Wife');
  assert.equal(profileDisplayName({ id: 1, display_name: 'Admin', acting_as: null }), 'Admin');
});
