/**
 * Session profile context — admin acts as another household member without re-login.
 */

import {
  actingUserIdFromSession,
  publicActingAs,
} from '../public/utils/profile-context.js';

export { actingUserIdFromSession, publicActingAs };

export function resolveContextTarget(authUserId, targetId, findUser) {
  const actor = findUser(authUserId);
  if (!actor) return { error: 'User not found.', status: 401 };
  if (actor.role !== 'admin') {
    return { error: 'Admin access required.', status: 403 };
  }
  if (targetId == null || targetId === '') {
    return { contextUserId: null };
  }
  const tid = Number(targetId);
  if (tid === Number(authUserId)) {
    return { contextUserId: tid };
  }
  const target = findUser(tid);
  if (!target) return { error: 'Family member not found.', status: 404 };
  return { contextUserId: target.id };
}
