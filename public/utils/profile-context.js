/**
 * Household profile context — effective user for budget/health when admin acts as a member.
 */

/** User id used for “mine” scope, health writes, and budget owner attribution. */
export function effectiveUserId(user) {
  if (!user) return null;
  const acting = user.acting_as?.id;
  if (acting != null && acting !== '') return Number(acting);
  return Number(user.id);
}

export function isActingAsOther(user) {
  if (!user?.acting_as?.id) return false;
  return Number(user.acting_as.id) !== Number(user.id);
}

/** Greeting / header label: effective household member name when admin is acting as someone else. */
export function profileDisplayName(user) {
  if (!user) return '';
  if (isActingAsOther(user)) return user.acting_as.display_name ?? user.display_name ?? '';
  return user.display_name ?? '';
}

/** Budget rows: owner_id or legacy created_by. */
export function rowOwnedByUser(row, userId, { ownerKey = 'owner_id', fallbackKey = 'created_by' } = {}) {
  const raw = row?.[ownerKey] ?? row?.[fallbackKey];
  if (raw == null || raw === '') return false;
  return Number(raw) === Number(userId);
}

/** Tasks / board items tied to a household member. */
export function taskVisibleToProfile(task, assignmentUserIds, userId) {
  const id = Number(userId);
  if (Number(task?.created_by) === id) return true;
  if (task?.assigned_to != null && Number(task.assigned_to) === id) return true;
  return assignmentUserIds.some((uid) => Number(uid) === id);
}

/** Session → effective id for API handlers (local IndexedDB session). */
export function actingUserIdFromSession(session, authUserId) {
  const auth = Number(authUserId);
  const ctx = session?.contextUserId;
  if (ctx != null && ctx !== '') return Number(ctx);
  return auth;
}

export function publicActingAs(findUser, contextUserId, authUserId) {
  if (!contextUserId || Number(contextUserId) === Number(authUserId)) return null;
  const u = findUser(contextUserId);
  if (!u) return null;
  return {
    id: u.id,
    display_name: u.display_name,
    avatar_color: u.avatar_color,
    avatar_data: u.avatar_data ?? null,
    family_role: u.family_role ?? null,
  };
}
