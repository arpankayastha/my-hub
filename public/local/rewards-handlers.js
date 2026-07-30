/**
 * Local API handlers for rewards (IndexedDB-backed).
 */

import { saveState, nextId, nowIso, cfgGet } from './store.js';

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toInt(val) {
  const n = Math.trunc(Number(val));
  return Number.isFinite(n) ? n : NaN;
}

export function ensureRewardsState(state) {
  if (!Array.isArray(state.reward_participants)) state.reward_participants = [];
  if (!Array.isArray(state.reward_catalog)) state.reward_catalog = [];
  if (!Array.isArray(state.reward_ledger)) state.reward_ledger = [];
  if (!Array.isArray(state.reward_redemptions)) state.reward_redemptions = [];
}

function isEnrolled(state, userId) {
  return state.reward_participants.some((p) => p.user_id === userId && p.enabled === 1);
}

function getBalance(state, userId) {
  return state.reward_ledger
    .filter((l) => l.user_id === userId)
    .reduce((sum, l) => sum + Number(l.delta || 0), 0);
}

function requiresApproval() {
  return cfgGet('rewards_require_approval') !== '0';
}

function postLedger(state, { userId, delta, type, reason = null, taskId = null, redemptionId = null, createdBy = null }) {
  state.reward_ledger.push({
    id: nextId(),
    user_id: userId,
    delta,
    type,
    reason,
    task_id: taskId,
    redemption_id: redemptionId,
    created_by: createdBy,
    created_at: nowIso(),
  });
}

function withRanks(rows) {
  let rank = 0;
  let prev = null;
  return rows.map((row, i) => {
    if (prev === null || row.balance !== prev) rank = i + 1;
    prev = row.balance;
    return { ...row, rank };
  });
}

function balancesOfEnrolled(state, users) {
  const rows = users
    .filter((u) => isEnrolled(state, u.id))
    .map((u) => ({
      id: u.id,
      display_name: u.display_name,
      avatar_color: u.avatar_color,
      avatar_data: u.avatar_data ?? null,
      family_role: u.family_role ?? null,
      balance: getBalance(state, u.id),
    }))
    .sort((a, b) => b.balance - a.balance || a.display_name.localeCompare(b.display_name));
  return withRanks(rows);
}

function ensureAllParticipants(state, users) {
  users.forEach((u) => {
    if (!state.reward_participants.some((p) => p.user_id === u.id)) {
      state.reward_participants.push({ user_id: u.id, enabled: 1, updated_at: nowIso() });
    }
  });
}

/** Sync earn ledger when a task is marked done (exported for tasks handler). */
export function syncTaskRewardEarn(state, task, actorId) {
  ensureRewardsState(state);
  if (!task || task.status !== 'done') return;
  const points = Number(task.points) || 0;
  if (points <= 0) return;
  const assignees = task.assigned_to ? [task.assigned_to] : [];
  assignees.forEach((uid) => {
    if (!isEnrolled(state, uid)) return;
    const exists = state.reward_ledger.some((l) => l.task_id === task.id && l.user_id === uid && l.type === 'earn');
    if (exists) return;
    postLedger(state, {
      userId: uid,
      delta: points,
      type: 'earn',
      reason: task.title,
      taskId: task.id,
      createdBy: actorId,
    });
  });
}

/**
 * @returns {object|null}
 */
export async function handleRewardsApi(m, parts, query, body, state, userId, findUser, users) {
  ensureRewardsState(state);
  ensureAllParticipants(state, users);
  const method = m.toUpperCase();
  const isAdmin = true; // local mode: single household admin

  if (parts[1] === 'overview' && method === 'GET') {
    const balances = balancesOfEnrolled(state, users);
    const catalog = state.reward_catalog.filter((c) => c.is_active === 1);
    const pendingCount = state.reward_redemptions.filter((r) => r.status === 'pending').length;
    const participantCount = state.reward_participants.filter((p) => p.enabled === 1).length;
    const catalogCount = catalog.length;
    const pointedTaskCount = state.tasks.filter((t) => Number(t.points) > 0).length;
    return {
      data: {
        balances,
        catalog,
        pendingCount,
        isAdmin,
        me: userId,
        setup: { participantCount, catalogCount, pointedTaskCount },
      },
    };
  }

  if (parts[1] === 'participants' && method === 'GET') {
    const rows = users.map((u) => {
      const p = state.reward_participants.find((x) => x.user_id === u.id);
      return {
        id: u.id,
        display_name: u.display_name,
        avatar_color: u.avatar_color,
        avatar_data: u.avatar_data ?? null,
        family_role: u.family_role ?? null,
        enabled: p?.enabled === 1,
        balance: getBalance(state, u.id),
      };
    });
    return { data: rows };
  }

  if (parts[1] === 'participants' && parts[2] && method === 'PUT') {
    const targetId = toInt(parts[2]);
    const enabled = body?.enabled === true || body?.enabled === 1 ? 1 : 0;
    let p = state.reward_participants.find((x) => x.user_id === targetId);
    if (!p) {
      p = { user_id: targetId, enabled, updated_at: nowIso() };
      state.reward_participants.push(p);
    } else {
      p.enabled = enabled;
      p.updated_at = nowIso();
    }
    await saveState();
    return { data: { user_id: targetId, enabled: enabled === 1 } };
  }

  if (parts[1] === 'catalog' && method === 'GET') {
    const all = query.all === '1' && isAdmin;
    const rows = all
      ? [...state.reward_catalog]
      : state.reward_catalog.filter((c) => c.is_active === 1);
    rows.sort((a, b) => (a.sort_order - b.sort_order) || (a.cost - b.cost));
    return { data: rows };
  }

  if (parts[1] === 'catalog' && !parts[2] && method === 'POST') {
    const name = String(body?.name || '').trim();
    const cost = toInt(body?.cost);
    if (!name) throw apiError('name is required.', 400);
    if (!Number.isFinite(cost) || cost < 1) throw apiError('cost must be positive.', 400);
    const id = nextId();
    const row = {
      id,
      name,
      cost,
      icon: body.icon ?? null,
      description: body.description ?? null,
      is_active: 1,
      sort_order: toInt(body.sort_order) || 0,
      created_by: userId,
      created_at: nowIso(),
    };
    state.reward_catalog.push(row);
    await saveState();
    return { data: row };
  }

  const catalogId = Number(parts[2]);
  if (parts[1] === 'catalog' && catalogId && method === 'PATCH') {
    const row = state.reward_catalog.find((c) => c.id === catalogId);
    if (!row) throw apiError('Reward not found.', 404);
    if (body.name !== undefined) row.name = String(body.name).trim();
    if (body.cost !== undefined) row.cost = toInt(body.cost);
    if (body.icon !== undefined) row.icon = body.icon;
    if (body.description !== undefined) row.description = body.description;
    if (body.sort_order !== undefined) row.sort_order = toInt(body.sort_order) || 0;
    if (body.is_active !== undefined) row.is_active = body.is_active ? 1 : 0;
    await saveState();
    return { data: row };
  }

  if (parts[1] === 'catalog' && catalogId && method === 'DELETE') {
    state.reward_catalog = state.reward_catalog.filter((c) => c.id !== catalogId);
    await saveState();
    return { ok: true };
  }

  if (parts[1] === 'ledger' && method === 'GET') {
    const limit = Math.min(Math.max(toInt(query.limit) || 100, 1), 500);
    const filterUser = query.user_id ? toInt(query.user_id) : null;
    let rows = [...state.reward_ledger];
    if (filterUser) rows = rows.filter((l) => l.user_id === filterUser);
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    rows = rows.slice(0, limit).map((l) => {
      const u = findUser(l.user_id);
      const actor = l.created_by ? findUser(l.created_by) : null;
      return {
        ...l,
        user_name: u?.display_name ?? null,
        user_color: u?.avatar_color ?? null,
        user_avatar: u?.avatar_data ?? null,
        actor_name: actor?.display_name ?? null,
      };
    });
    return { data: rows };
  }

  if (parts[1] === 'redemptions' && method === 'GET') {
    const status = ['pending', 'fulfilled', 'rejected', 'cancelled'].includes(query.status) ? query.status : null;
    let rows = [...state.reward_redemptions];
    if (status) rows = rows.filter((r) => r.status === status);
    rows.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return b.created_at.localeCompare(a.created_at);
    });
    rows = rows.slice(0, 300).map((r) => {
      const u = findUser(r.user_id);
      return {
        ...r,
        user_name: u?.display_name ?? null,
        user_color: u?.avatar_color ?? null,
        user_avatar: u?.avatar_data ?? null,
      };
    });
    return { data: rows };
  }

  if (parts[1] === 'redemptions' && !parts[2] && method === 'POST') {
    const targetId = body?.user_id != null && isAdmin ? toInt(body.user_id) : userId;
    const item = state.reward_catalog.find((c) => c.id === toInt(body?.catalog_id) && c.is_active === 1);
    if (!item) throw apiError('Reward not found.', 404);
    if (!isEnrolled(state, targetId)) throw apiError('User does not participate.', 400);
    const balance = getBalance(state, targetId);
    if (balance < item.cost) throw apiError('Insufficient points.', 400);
    const autoFulfill = !requiresApproval();
    const id = nextId();
    const redemption = {
      id,
      user_id: targetId,
      catalog_id: item.id,
      reward_name: item.name,
      reward_icon: item.icon,
      cost: item.cost,
      note: body?.note?.trim() || null,
      requested_by: userId,
      status: autoFulfill ? 'fulfilled' : 'pending',
      decided_by: autoFulfill ? userId : null,
      decided_at: autoFulfill ? nowIso() : null,
      created_at: nowIso(),
    };
    state.reward_redemptions.push(redemption);
    postLedger(state, {
      userId: targetId,
      delta: -item.cost,
      type: 'redeem',
      reason: item.name,
      redemptionId: id,
      createdBy: userId,
    });
    await saveState();
    return { data: redemption };
  }

  const redemptionId = Number(parts[2]);
  if (parts[1] === 'redemptions' && redemptionId && method === 'PATCH') {
    const row = state.reward_redemptions.find((r) => r.id === redemptionId);
    if (!row) throw apiError('Redemption not found.', 404);
    if (row.status !== 'pending') throw apiError('Redemption already decided.', 409);
    const action = body?.action;
    if (!['fulfill', 'reject', 'cancel'].includes(action)) throw apiError('Invalid action.', 400);
    if (action !== 'fulfill') {
      postLedger(state, {
        userId: row.user_id,
        delta: row.cost,
        type: 'reversal',
        reason: row.reward_name,
        redemptionId: row.id,
        createdBy: userId,
      });
    }
    row.status = action === 'fulfill' ? 'fulfilled' : action === 'reject' ? 'rejected' : 'cancelled';
    row.decided_by = userId;
    row.decided_at = nowIso();
    await saveState();
    return { data: row };
  }

  if (parts[1] === 'bonus' && method === 'POST') {
    const targetId = toInt(body?.user_id);
    const delta = toInt(body?.delta);
    if (!Number.isFinite(targetId)) throw apiError('user_id is required.', 400);
    if (!Number.isFinite(delta) || delta === 0) throw apiError('delta must be non-zero.', 400);
    if (!isEnrolled(state, targetId)) throw apiError('User does not participate.', 400);
    postLedger(state, {
      userId: targetId,
      delta,
      type: delta > 0 ? 'bonus' : 'adjust',
      reason: body?.reason?.trim() || null,
      createdBy: userId,
    });
    await saveState();
    return { data: { user_id: targetId, balance: getBalance(state, targetId) } };
  }

  return null;
}
