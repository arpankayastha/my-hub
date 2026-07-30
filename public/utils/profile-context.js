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

/** Session → effective id for API handlers (local IndexedDB session). */
export function actingUserIdFromSession(session, authUserId) {
  const auth = Number(authUserId);
  const ctx = session?.contextUserId;
  if (ctx != null && ctx !== '' && Number(ctx) !== auth) return Number(ctx);
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
