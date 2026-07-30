/**
 * Local API stubs for split expenses (IndexedDB-backed minimal).
 */

import { cfgGet } from './store.js';

const GROUP_TYPES = ['household', 'couple', 'travel', 'event', 'shopping', 'general'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

function defaultCurrency() {
  return cfgGet('currency') ?? 'EUR';
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

function dashboardPayload() {
  const currency = defaultCurrency();
  return {
    total_owed: [],
    total_owing: [],
    groups: [],
    recent_expenses: [],
    default_currency: currency,
  };
}

/**
 * @returns {object|null}
 */
export async function handleSplitExpensesApi(method, parts, query, body, state, userId) {
  const m = method.toUpperCase();
  const sub = parts[1];

  if (sub === 'meta' && m === 'GET') return { data: metaPayload() };
  if (sub === 'dashboard' && m === 'GET') return { data: dashboardPayload() };
  if (sub === 'groups' && m === 'GET') return { data: [] };
  if (sub === 'search' && m === 'GET') return { data: [] };

  const groupId = Number(parts[2]);
  if (sub === 'groups' && groupId) {
    if (parts[3] === 'expenses' && m === 'GET') return { data: [] };
    if (parts[3] === 'balances' && m === 'GET') return { data: { balances: [], simplified_debts: [] } };
    if (parts[3] === 'activity' && m === 'GET') return { data: [] };
    if (parts[3] === 'members' && m === 'GET') return { data: [] };
    if (parts[3] === 'member-candidates' && m === 'GET') return { data: [] };
  }

  if (m === 'GET') return { data: [] };
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') return { data: body || {}, ok: true };
  if (m === 'DELETE') return { ok: true };

  return null;
}
