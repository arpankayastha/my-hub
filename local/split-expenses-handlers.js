/**
 * Local API for split expenses (IndexedDB-backed).
 */

import { saveState, nextId, nowIso, cfgGet } from './store.js';

const GROUP_TYPES = ['household', 'couple', 'travel', 'event', 'shopping', 'general'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

function apiError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function defaultCurrency() {
  return cfgGet('currency') ?? 'EUR';
}

function ensureSplitState(state) {
  if (!Array.isArray(state.expense_groups)) state.expense_groups = [];
  if (!Array.isArray(state.expense_group_members)) state.expense_group_members = [];
  if (!Array.isArray(state.split_expenses)) state.split_expenses = [];
}

function findUser(state, userId) {
  return state.users?.find((u) => u.id === userId) ?? null;
}

function enrichGroup(state, group, userId) {
  const members = state.expense_group_members.filter((m) => m.group_id === group.id);
  const member = members.find((m) => m.user_id === userId);
  const creator = findUser(state, group.created_by);
  return {
    ...group,
    creator_name: creator?.display_name ?? '',
    member_count: members.length,
    member_role: member?.role ?? 'owner',
  };
}

function listGroups(state, userId, status = 'active', query = '') {
  const memberGroupIds = new Set(
    state.expense_group_members.filter((m) => m.user_id === userId).map((m) => m.group_id),
  );
  const q = String(query || '').trim().toLowerCase();
  return state.expense_groups
    .filter((g) => memberGroupIds.has(g.id))
    .filter((g) => g.status === status)
    .filter((g) => !q || String(g.name || '').toLowerCase().includes(q))
    .map((g) => enrichGroup(state, g, userId))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function metaPayload() {
  return {
    group_types: GROUP_TYPES,
    group_roles: ['owner', 'admin', 'guest'],
    split_methods: ['equal', 'exact', 'percentage', 'shares'],
    categories: ['groceries', 'rent', 'utilities', 'general'],
    currencies: CURRENCIES,
    frequencies: ['weekly', 'monthly', 'yearly'],
    default_currency: defaultCurrency(),
  };
}

function dashboardPayload(state, userId) {
  const currency = defaultCurrency();
  const groups = listGroups(state, userId, 'active');
  return {
    total_owed: [],
    total_owing: [],
    groups: groups.slice(0, 6),
    recent_expenses: [],
    default_currency: currency,
  };
}

/**
 * @returns {object|null}
 */
export async function handleSplitExpensesApi(method, parts, query, body, state, userId) {
  ensureSplitState(state);
  const m = method.toUpperCase();
  const sub = parts[1];

  if (sub === 'meta' && m === 'GET') return { data: metaPayload() };
  if (sub === 'dashboard' && m === 'GET') return { data: dashboardPayload(state, userId) };

  if (sub === 'groups' && m === 'GET' && !parts[2]) {
    const status = query.status === 'archived' ? 'archived' : 'active';
    return { data: listGroups(state, userId, status, query.q || query.query || '') };
  }

  if (sub === 'groups' && m === 'POST' && !parts[2]) {
    const name = String(body.name || '').trim();
    if (!name) throw apiError('Name is required.', 400);
    const now = nowIso();
    const id = nextId();
    const group = {
      id,
      name,
      description: String(body.description || '').trim(),
      type: GROUP_TYPES.includes(body.type) ? body.type : 'general',
      default_currency: CURRENCIES.includes(body.default_currency) ? body.default_currency : defaultCurrency(),
      default_split_method: 'equal',
      default_split_config: null,
      status: 'active',
      created_by: userId,
      created_at: now,
      updated_at: now,
    };
    state.expense_groups.push(group);
    state.expense_group_members.push({
      group_id: id,
      user_id: userId,
      role: 'owner',
      invited_by: userId,
    });
    await saveState();
    return { data: enrichGroup(state, group, userId) };
  }

  const groupId = Number(parts[2]);
  if (sub === 'groups' && groupId) {
    const group = state.expense_groups.find((g) => g.id === groupId);
    const isMember = state.expense_group_members.some((mem) => mem.group_id === groupId && mem.user_id === userId);
    if (!group || !isMember) throw apiError('Group not found.', 404);

    if (m === 'PATCH') {
      if (body.name !== undefined) group.name = String(body.name || '').trim();
      if (body.description !== undefined) group.description = String(body.description || '').trim();
      if (body.type && GROUP_TYPES.includes(body.type)) group.type = body.type;
      if (body.default_currency && CURRENCIES.includes(body.default_currency)) {
        group.default_currency = body.default_currency;
      }
      group.updated_at = nowIso();
      await saveState();
      return { data: enrichGroup(state, group, userId) };
    }

    if (parts[3] === 'expenses' && m === 'GET') return { data: [] };
    if (parts[3] === 'balances' && m === 'GET') return { data: { balances: [], simplified_debts: [] } };
    if (parts[3] === 'activity' && m === 'GET') return { data: [] };
    if (parts[3] === 'members' && m === 'GET') {
      const rows = state.expense_group_members
        .filter((mem) => mem.group_id === groupId)
        .map((mem) => ({
          ...mem,
          display_name: findUser(state, mem.user_id)?.display_name ?? '',
        }));
      return { data: rows };
    }
    if (parts[3] === 'member-candidates' && m === 'GET') return { data: [] };
  }

  if (sub === 'search' && m === 'GET') return { data: [] };

  if (m === 'GET') return { data: [] };
  if (m === 'DELETE') return { ok: true };

  return null;
}
