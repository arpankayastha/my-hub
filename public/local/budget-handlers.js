/**
 * Local API handlers for budget module (IndexedDB-backed).
 */

import { saveState, nowIso, cfgGet } from './store.js';
import { DEFAULT_BUDGET_CATEGORIES, DEFAULT_BUDGET_SUBCATEGORIES } from './budget-seed.js';
import {
  effectiveMonthly,
  shouldAutoMaterializeRecurring,
  shouldPlanMaterializeRecurring,
} from '../utils/budget-recurrence.js';
import {
  budgetCategoryLabel,
  budgetSubcategoryLabel,
} from '../utils/category-labels.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BUDGET_SAVINGS_KEY = '__savings__';

export function ensureBudgetState(state) {
  if (!Array.isArray(state.budget_entries)) state.budget_entries = [];
  if (!Array.isArray(state.budget_categories)) state.budget_categories = [];
  if (!Array.isArray(state.budget_subcategories)) state.budget_subcategories = [];
  if (!Array.isArray(state.budget_accounts)) state.budget_accounts = [];
  if (!Array.isArray(state.budget_loans)) state.budget_loans = [];
  if (!Array.isArray(state.budget_loan_payments)) state.budget_loan_payments = [];
  if (!Array.isArray(state.budget_plans)) state.budget_plans = [];
  if (!Array.isArray(state.budget_recurrence_skipped)) state.budget_recurrence_skipped = [];
  if (!state.budget_categories.length) {
    state.budget_categories = DEFAULT_BUDGET_CATEGORIES.map((c) => ({ ...c }));
    state.budget_subcategories = DEFAULT_BUDGET_SUBCATEGORIES.map((s) => ({ ...s }));
  }
}

function bumpId(state) {
  if (!state.nextId) state.nextId = 1;
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

function monthRange(month) {
  return { from: `${month}-01`, to: `${month}-31` };
}

function entriesInRange(state, from, to) {
  return state.budget_entries.filter((e) => e.date >= from && e.date <= to);
}

function resolveBudgetMode() {
  return cfgGet('budget_mode') === 'personal' ? 'personal' : 'shared';
}

function entryOwnerId(entry) {
  return entry.owner_id ?? entry.created_by;
}

function canEditEntry(entry, userId) {
  if (!entry) return false;
  return entryOwnerId(entry) === userId;
}

/** Personal mode: visibility gate (private entries only for owner). */
function entryReadable(entry, userId, budgetMode) {
  if (budgetMode !== 'personal') return true;
  return entry.visibility === 'shared' || entryOwnerId(entry) === userId;
}

/** Personal mode: mine vs household view filter. */
function entryMatchesScope(entry, userId, scope, budgetMode) {
  if (budgetMode !== 'personal') return true;
  if (scope === 'household') return entry.visibility === 'shared';
  return entryOwnerId(entry) === userId;
}

function filterEntriesForView(rows, effectiveUserId, scope, authUserId) {
  const mode = resolveBudgetMode();
  if (mode === 'personal') {
    const filterMode = 'personal';
    const viewScope = scope === 'household' ? 'household' : 'mine';
    return rows.filter((e) =>
      entryReadable(e, effectiveUserId, filterMode)
      && entryMatchesScope(e, effectiveUserId, viewScope, filterMode));
  }
  // Shared household mode: each profile sees only entries they own.
  return rows.filter((e) => entryOwnerId(e) === Number(effectiveUserId));
}

function computeSummary(state, month, effectiveUserId, scope, authUserId) {
  const { from, to } = monthRange(month);
  let rows = entriesInRange(state, from, to);
  rows = filterEntriesForView(rows, effectiveUserId, scope, authUserId);
  let income = 0;
  let expenses = 0;
  const byCat = new Map();
  for (const e of rows) {
    const amt = Number(e.amount) || 0;
    if (amt > 0) income += amt;
    if (amt < 0) expenses += amt;
    const cat = e.category || 'financial_other';
    const cur = byCat.get(cat) || { category: cat, income: 0, expenses: 0, total: 0 };
    if (amt > 0) cur.income += amt;
    if (amt < 0) cur.expenses += amt;
    cur.total += amt;
    byCat.set(cat, cur);
  }
  const balance = income + expenses;
  return {
    month,
    income,
    expenses,
    balance,
    byCategory: [...byCat.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
  };
}

function loadBudgetMeta(state) {
  const categories = [...state.budget_categories].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');
  const expenseSubcategories = {};
  for (const sub of state.budget_subcategories) {
    if (!expenseSubcategories[sub.category_key]) expenseSubcategories[sub.category_key] = [];
    expenseSubcategories[sub.category_key].push(sub);
  }
  return { categories, expenseCategories, incomeCategories, expenseSubcategories };
}

function enrichEntry(state, entry, findUser) {
  const creator = findUser(entry.created_by);
  return {
    ...entry,
    creator_name: creator?.display_name ?? null,
    loan_payment_id: null,
    loan_id: null,
    loan_installment_number: null,
    loan_title: null,
    loan_borrower: null,
  };
}

function resolveExportRange(query) {
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  if (DATE_RE.test(from) && DATE_RE.test(to)) return { from, to, month: from.slice(0, 7) };
  const month = MONTH_RE.test(query.month || '') ? query.month : new Date().toISOString().slice(0, 7);
  return { from: `${month}-01`, to: `${month}-31`, month };
}

function csvSafe(val) {
  let s = String(val ?? '').replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s}"`;
}

function buildBudgetExportCsv(state, from, to, effectiveUserId, scope, authUserId, findUser, labelFns = {}) {
  const categoryLabel = labelFns.categoryLabel ?? ((key) => key);
  const subcategoryLabel = labelFns.subcategoryLabel ?? ((key) => key);
  let rows = entriesInRange(state, from, to);
  rows = filterEntriesForView(rows, effectiveUserId, scope, authUserId);
  rows = rows.sort((a, b) => (a.date > b.date ? 1 : -1));
  const header = 'Date,Title,Amount,Category,Subcategory,Recurring,Created by\n';
  const body = rows.map((e) => {
    const enriched = enrichEntry(state, e, findUser);
    const cat = state.budget_categories.find((c) => c.key === e.category);
    const sub = state.budget_subcategories.find(
      (s) => s.key === e.subcategory && s.category_key === e.category,
    );
    return [
      e.date,
      csvSafe(e.title),
      Number(e.amount).toFixed(2),
      csvSafe(categoryLabel(e.category, cat?.name ?? '')),
      e.subcategory ? csvSafe(subcategoryLabel(e.subcategory, sub?.name ?? '')) : '',
      e.is_recurring ? 'Yes' : 'No',
      csvSafe(enriched.creator_name),
    ].join(',');
  }).join('\n');
  return header + body;
}

function listAccounts(state, includeArchived) {
  return state.budget_accounts
    .filter((a) => includeArchived || !a.archived)
    .map((a) => {
      const movement = state.budget_entries
        .filter((e) => e.account_id === a.id)
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const starting = Number(a.starting_balance) || 0;
      const current_balance = starting + movement;
      return {
        ...a,
        current_balance,
        projected_balance: current_balance,
      };
    });
}

function loansPayload(state, baseCurrency) {
  const loans = state.budget_loans.map((loan) => ({
    ...loan,
    remaining_amount: Number(loan.remaining_amount ?? loan.total_amount ?? 0),
    remaining_principal: Number(loan.remaining_principal ?? loan.principal ?? 0),
    remaining_installments: Number(loan.remaining_installments ?? 0),
    paid_amount: Number(loan.paid_amount ?? 0),
    is_foreign_currency: Boolean(loan.currency && loan.currency !== baseCurrency),
    interest: Boolean(loan.interest_mode && loan.interest_mode !== 'none'),
  }));
  const active = loans.filter((l) => l.status === 'active');
  const totals = loans.reduce(
    (acc, loan) => {
      acc.remaining_amount += Number(loan.remaining_amount) || 0;
      acc.remaining_installments += Number(loan.remaining_installments) || 0;
      return acc;
    },
    { remaining_amount: 0, remaining_installments: 0 },
  );
  return {
    loans,
    summary: {
      active_count: active.length,
      total_count: loans.length,
      currency: baseCurrency,
      has_foreign_currency: loans.some((l) => l.is_foreign_currency),
      has_interest: loans.some((l) => l.interest),
      total_amount: 0,
      paid_amount: 0,
      remaining_amount: totals.remaining_amount,
      remaining_principal: 0,
      remaining_installments: totals.remaining_installments,
    },
  };
}

function computePlanProgress(state, month, effectiveUserId, scope, authUserId) {
  const { from, to } = monthRange(month);
  const planMap = new Map(state.budget_plans.map((p) => [p.category, Number(p.amount) || 0]));
  let spentRows = entriesInRange(state, from, to);
  spentRows = filterEntriesForView(spentRows, effectiveUserId, scope, authUserId);
  const spentMap = new Map();
  for (const e of spentRows) {
    const amt = Number(e.amount) || 0;
    if (amt < 0) {
      const cat = e.category || 'financial_other';
      spentMap.set(cat, (spentMap.get(cat) || 0) + -amt);
    }
  }
  const plans = [];
  for (const [category, planned] of planMap) {
    if (category === BUDGET_SAVINGS_KEY) continue;
    const actual = spentMap.get(category) || 0;
    plans.push({
      category,
      planned,
      actual,
      remaining: planned - actual,
      ratio: planned > 0 ? actual / planned : 0,
      over: actual > planned + 0.005,
    });
  }
  plans.sort((a, b) => b.ratio - a.ratio);
  const totalPlanned = plans.reduce((s, p) => s + p.planned, 0);
  const totalActual = plans.reduce((s, p) => s + p.actual, 0);
  const summary = computeSummary(state, month, effectiveUserId, scope, authUserId);
  const savingsPlanned = planMap.get(BUDGET_SAVINGS_KEY);
  const balance = summary.balance;
  const income = summary.income;
  const savings = savingsPlanned != null
    ? {
        planned: savingsPlanned,
        actual: balance,
        remaining: savingsPlanned - balance,
        ratio: savingsPlanned > 0 ? balance / savingsPlanned : 0,
        met: balance >= savingsPlanned - 0.005,
        income,
      }
    : null;
  return { month, plans, savings, totalPlanned, totalActual };
}

/** Dashboard widget slice — mirrors server/routes/dashboard.js budget block. */
export function computeDashboardBudget(state, effectiveUserId, budgetMode = 'shared', authUserId = effectiveUserId) {
  ensureBudgetState(state);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { from, to } = monthRange(currentMonth);
  let rows = entriesInRange(state, from, to);
  rows = rows.filter((e) => entryOwnerId(e) === Number(effectiveUserId));

  let income = 0;
  let expenses = 0;
  const expenseByCategory = new Map();
  for (const e of rows) {
    const amt = Number(e.amount) || 0;
    if (amt > 0) income += amt;
    if (amt < 0) {
      expenses += amt;
      const cat = e.category || 'financial_other';
      expenseByCategory.set(cat, (expenseByCategory.get(cat) || 0) + amt);
    }
  }

  let topExpenseCategory = null;
  let topExpenseAmount = 0;
  for (const [cat, amt] of expenseByCategory) {
    const abs = Math.abs(amt);
    if (abs > topExpenseAmount) {
      topExpenseAmount = abs;
      topExpenseCategory = cat;
    }
  }

  const savingsPlan = state.budget_plans.find((p) => p.category === BUDGET_SAVINGS_KEY);
  const savingsGoal = savingsPlan != null
    ? Math.round(Number(savingsPlan.amount) * 100) / 100
    : null;

  return {
    month: currentMonth,
    income,
    expenses: Math.abs(expenses),
    balance: income + expenses,
    entryCount: rows.length,
    topExpenseCategory,
    topExpenseAmount,
    savingsGoal,
  };
}

function computeStatsRange(range, anchor) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? new Date(anchor + 'T12:00:00') : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const key = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  let from;
  let to;
  let prevFrom;
  let prevTo;
  let bucketKeys = [];
  let granularity = 'day';
  if (range === 'week') {
    const day = d.getDay();
    const mondayOffset = (day + 6) % 7;
    const start = new Date(d);
    start.setDate(d.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    from = key(start);
    to = key(end);
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(prevStart);
    prevEnd.setDate(prevStart.getDate() + 6);
    prevFrom = key(prevStart);
    prevTo = key(prevEnd);
    for (let i = 0; i < 7; i++) {
      const b = new Date(start);
      b.setDate(start.getDate() + i);
      bucketKeys.push(key(b));
    }
  } else if (range === 'year') {
    const y = d.getFullYear();
    from = `${y}-01-01`;
    to = `${y}-12-31`;
    prevFrom = `${y - 1}-01-01`;
    prevTo = `${y - 1}-12-31`;
    granularity = 'month';
    for (let m = 1; m <= 12; m++) bucketKeys.push(`${y}-${pad(m)}`);
  } else {
    const y = d.getFullYear();
    const m = d.getMonth();
    from = `${y}-${pad(m + 1)}-01`;
    to = `${y}-${pad(m + 1)}-31`;
    const prev = new Date(y, m - 1, 1);
    prevFrom = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`;
    prevTo = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-31`;
    for (let i = 1; i <= 31; i++) bucketKeys.push(`${y}-${pad(m + 1)}-${pad(i)}`);
  }
  return { range: range || 'month', from, to, prevFrom, prevTo, bucketKeys, granularity };
}

function computeStats(state, range, anchor) {
  const r = computeStatsRange(range, anchor);
  const cur = entriesInRange(state, r.from, r.to);
  const prev = entriesInRange(state, r.prevFrom, r.prevTo);
  const sumTotals = (rows) => {
    let income = 0;
    let expenses = 0;
    for (const e of rows) {
      const amt = Number(e.amount) || 0;
      if (amt > 0) income += amt;
      else expenses += amt;
    }
    return { income, expenses, balance: income + expenses };
  };
  const totals = sumTotals(cur);
  const comparison = sumTotals(prev);
  const byCategoryMap = new Map();
  for (const e of cur) {
    const amt = Number(e.amount) || 0;
    const cat = e.category || 'financial_other';
    const row = byCategoryMap.get(cat) || { category: cat, income: 0, expenses: 0, total: 0 };
    if (amt > 0) row.income += amt;
    if (amt < 0) row.expenses += amt;
    row.total += amt;
    byCategoryMap.set(cat, row);
  }
  const byPeriod = new Map();
  for (const e of cur) {
    const period = r.granularity === 'month' ? e.date.slice(0, 7) : e.date;
    const row = byPeriod.get(period) || { period, income: 0, expenses: 0, balance: 0 };
    const amt = Number(e.amount) || 0;
    if (amt > 0) row.income += amt;
    if (amt < 0) row.expenses += amt;
    row.balance += amt;
    byPeriod.set(period, row);
  }
  const series = r.bucketKeys.map((period) => byPeriod.get(period) || { period, income: 0, expenses: 0, balance: 0 });
  const plans = {};
  for (const p of state.budget_plans) {
    if (p.category !== BUDGET_SAVINGS_KEY) plans[p.category] = Number(p.amount) || 0;
  }
  return {
    range: r.range,
    from: r.from,
    to: r.to,
    totals,
    series,
    byCategory: [...byCategoryMap.values()],
    comparison,
    plans,
  };
}

function apiError(message, status, data = null) {
  const err = new Error(message);
  err.status = status;
  err.data = data;
  return err;
}

function slugKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'item';
}

function uniqueCategoryKey(state, name) {
  let key = slugKey(name);
  let n = 0;
  while (state.budget_categories.some((c) => c.key === key)) {
    n += 1;
    key = `${slugKey(name)}_${n}`;
  }
  return key;
}

function uniqueSubcategoryKey(state, categoryKey, name) {
  let key = `${categoryKey}_${slugKey(name)}`;
  let n = 0;
  while (state.budget_subcategories.some((s) => s.key === key)) {
    n += 1;
    key = `${categoryKey}_${slugKey(name)}_${n}`;
  }
  return key;
}

function categoryInUseCount(state, key) {
  return state.budget_entries.filter((e) => e.category === key).length;
}

function subcategoryInUseCount(state, key) {
  return state.budget_entries.filter((e) => e.subcategory === key).length;
}

function listCategoriesForManager(state) {
  const subsByCat = {};
  for (const sub of state.budget_subcategories) {
    if (!subsByCat[sub.category_key]) subsByCat[sub.category_key] = [];
    subsByCat[sub.category_key].push(sub);
  }
  return [...state.budget_categories]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
      return a.sort_order - b.sort_order;
    })
    .map((cat) => ({
      ...cat,
      subcategories: (subsByCat[cat.key] || []).sort((a, b) => a.sort_order - b.sort_order),
    }));
}

function resolveSeriesParent(state, entry) {
  const parentId = entry.recurrence_parent_id ?? (entry.is_recurring ? entry.id : null);
  if (!parentId) return null;
  return state.budget_entries.find((e) => e.id === parentId) ?? null;
}

async function updateEntrySeries(state, entryId, body, findUser, userId) {
  const entry = state.budget_entries.find((e) => e.id === entryId);
  if (!entry) throw apiError('Entry not found.', 404);
  if (!canEditEntry(entry, userId)) throw apiError('You cannot modify this entry.', 403);

  const parent = resolveSeriesParent(state, entry);
  if (!parent) throw apiError('Not a recurring entry.', 400);

  const finalInterval = body.recurrence_interval !== undefined
    ? body.recurrence_interval
    : (parent.recurrence_interval || 'monthly');
  const finalRecurring = body.is_recurring !== undefined ? (body.is_recurring ? 1 : 0) : parent.is_recurring;
  let finalVirtual = body.recurrence_virtual !== undefined
    ? (body.recurrence_virtual ? 1 : 0)
    : parent.recurrence_virtual;
  if (!finalRecurring) finalVirtual = 0;

  const configuredFull = body.amount !== undefined
    ? Number(body.amount)
    : (parent.recurrence_full_amount != null ? parent.recurrence_full_amount : parent.amount);
  const storeAmount = finalVirtual ? effectiveMonthly(configuredFull, finalInterval) : configuredFull;
  const fullAmount = finalVirtual ? configuredFull : null;

  if (body.title !== undefined) parent.title = String(body.title).trim();
  parent.amount = storeAmount;
  if (body.category !== undefined) parent.category = body.category;
  if (body.subcategory !== undefined) parent.subcategory = body.subcategory;
  parent.is_recurring = finalRecurring;
  parent.recurrence_interval = finalInterval;
  parent.recurrence_virtual = finalVirtual;
  parent.recurrence_full_amount = fullAmount;
  if (body.visibility !== undefined) parent.visibility = body.visibility;
  if (body.account_id !== undefined) {
    parent.account_id = body.account_id ? Number(body.account_id) : null;
  }
  parent.updated_at = nowIso();

  const currentMonthStart = new Date().toISOString().slice(0, 7) + '-01';
  state.budget_entries = state.budget_entries.filter((e) =>
    e.recurrence_parent_id !== parent.id || e.date < currentMonthStart,
  );

  if (body.visibility !== undefined) {
    for (const e of state.budget_entries) {
      if (e.recurrence_parent_id === parent.id) e.visibility = parent.visibility;
    }
  }

  await saveState();
  return { data: enrichEntry(state, parent, findUser) };
}

async function deleteEntrySeries(state, entryId, userId) {
  const entry = state.budget_entries.find((e) => e.id === entryId);
  if (!entry) throw apiError('Entry not found.', 404);
  if (!canEditEntry(entry, userId)) throw apiError('You cannot modify this entry.', 403);

  const parent = resolveSeriesParent(state, entry);
  if (!parent) throw apiError('Not a recurring entry.', 400);

  const cutoff = new Date().toISOString().slice(0, 7) + '-01';
  state.budget_entries = state.budget_entries.filter((e) => {
    if (e.recurrence_parent_id === parent.id && e.date >= cutoff) return false;
    if (e.id === parent.id) return parent.date < cutoff;
    return true;
  });
  if (parent.date < cutoff) {
    parent.is_recurring = 0;
    parent.recurrence_rule = null;
    parent.updated_at = nowIso();
  }
  await saveState();
  return { ok: true };
}

function latestInstanceMonth(state, parentId) {
  let latest = null;
  for (const e of state.budget_entries) {
    if (e.recurrence_parent_id !== parentId) continue;
    const ym = e.date.slice(0, 7);
    if (!latest || ym > latest) latest = ym;
  }
  return latest;
}

function pushRecurringInstance(state, orig, month) {
  const [y, m] = month.split('-').map(Number);
  const origDay = parseInt(orig.date.split('-')[2], 10);
  const lastDay = new Date(y, m, 0).getDate();
  const instanceDay = Math.min(origDay, lastDay);
  const instanceDate = `${month}-${String(instanceDay).padStart(2, '0')}`;
  state.budget_entries.push({
    id: bumpId(state),
    title: orig.title,
    amount: orig.amount,
    category: orig.category,
    subcategory: orig.subcategory || '',
    date: instanceDate,
    is_recurring: 0,
    recurrence_parent_id: orig.id,
    recurrence_interval: null,
    recurrence_virtual: 0,
    recurrence_full_amount: null,
    account_id: orig.account_id ?? null,
    visibility: orig.visibility || 'shared',
    created_by: orig.created_by,
    owner_id: orig.owner_id ?? orig.created_by,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}

function generateRecurringInstances(state, month, { planning = false, nowMonth = new Date().toISOString().slice(0, 7) } = {}) {
  if (!Array.isArray(state.budget_recurrence_skipped)) state.budget_recurrence_skipped = [];
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;

  const originals = state.budget_entries.filter((e) =>
    e.is_recurring === 1
    && !e.recurrence_parent_id
    && e.date.slice(0, 7) < month,
  );

  for (const orig of originals) {
    if (state.budget_recurrence_skipped.some((s) => s.parent_id === orig.id && s.month === month)) {
      continue;
    }
    const existing = state.budget_entries.some((e) =>
      e.recurrence_parent_id === orig.id
      && e.date >= monthStart
      && e.date <= monthEnd,
    );
    if (existing) continue;

    const latestYm = latestInstanceMonth(state, orig.id);
    const shouldCreate = planning
      ? shouldPlanMaterializeRecurring(orig, month)
      : shouldAutoMaterializeRecurring(orig, month, latestYm, nowMonth);
    if (!shouldCreate) continue;

    pushRecurringInstance(state, orig, month);
  }
}

function applyRecurringToMonth(state, month) {
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const beforeIds = new Set(
    state.budget_entries
      .filter((e) => e.recurrence_parent_id && e.date >= monthStart && e.date <= monthEnd)
      .map((e) => e.id),
  );
  generateRecurringInstances(state, month, { planning: true });
  let created = 0;
  for (const e of state.budget_entries) {
    if (
      e.recurrence_parent_id
      && e.date >= monthStart
      && e.date <= monthEnd
      && !beforeIds.has(e.id)
    ) {
      created += 1;
    }
  }
  return created;
}

async function handleCategoriesRoute(m, tail, body, state) {
  if (m === 'GET' && tail.length === 0) {
    return { data: listCategoriesForManager(state), lang: 'de' };
  }

  if (m === 'POST' && tail.length === 0) {
    const name = String(body.name || '').trim();
    const type = body.type === 'income' ? 'income' : 'expense';
    if (!name) throw apiError('Name is required.', 400);
    const conflict = state.budget_categories.find(
      (c) => c.type === type && c.name.toLowerCase() === name.toLowerCase(),
    );
    if (conflict) throw apiError('Category already exists.', 409, { reason: 'category_exists' });
    const maxOrder = state.budget_categories
      .filter((c) => c.type === type)
      .reduce((max, c) => Math.max(max, c.sort_order), -1);
    const cat = {
      key: uniqueCategoryKey(state, name),
      name,
      type,
      sort_order: maxOrder + 1,
    };
    state.budget_categories.push(cat);
    await saveState();
    return { data: { ...cat, subcategories: [] } };
  }

  if (m === 'PATCH' && tail[0] === 'reorder') {
    const type = body.type === 'income' ? 'income' : 'expense';
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    order.forEach((key, i) => {
      const cat = state.budget_categories.find((c) => c.key === key && c.type === type);
      if (cat) cat.sort_order = i;
    });
    await saveState();
    return { data: true };
  }

  if (tail.length === 1 && m === 'PUT') {
    const cat = state.budget_categories.find((c) => c.key === tail[0]);
    if (!cat) throw apiError('Category not found.', 404);
    const name = String(body.name || '').trim();
    if (!name) throw apiError('Name is required.', 400);
    const conflict = state.budget_categories.find(
      (c) => c.type === cat.type && c.key !== cat.key && c.name.toLowerCase() === name.toLowerCase(),
    );
    if (conflict) throw apiError('Category already exists.', 409, { reason: 'category_exists' });
    cat.name = name;
    await saveState();
    const subs = state.budget_subcategories.filter((s) => s.category_key === cat.key);
    return { data: { ...cat, subcategories: subs } };
  }

  if (tail.length === 1 && m === 'DELETE') {
    const cat = state.budget_categories.find((c) => c.key === tail[0]);
    if (!cat) throw apiError('Category not found.', 404);
    const inUse = categoryInUseCount(state, cat.key);
    if (inUse > 0) {
      throw apiError(`Category is in use by ${inUse} entries.`, 409, { reason: 'category_in_use', count: inUse });
    }
    const sameType = state.budget_categories.filter((c) => c.type === cat.type);
    if (sameType.length <= 1) {
      throw apiError('Cannot delete the last category.', 409, { reason: 'category_last' });
    }
    state.budget_categories = state.budget_categories.filter((c) => c.key !== cat.key);
    state.budget_subcategories = state.budget_subcategories.filter((s) => s.category_key !== cat.key);
    await saveState();
    return { ok: true };
  }

  if (m === 'POST' && tail.length === 2 && tail[1] === 'subcategories') {
    const cat = state.budget_categories.find((c) => c.key === tail[0] && c.type === 'expense');
    if (!cat) throw apiError('Category not found.', 404);
    const name = String(body.name || '').trim();
    if (!name) throw apiError('Name is required.', 400);
    const conflict = state.budget_subcategories.find(
      (s) => s.category_key === cat.key && s.name.toLowerCase() === name.toLowerCase(),
    );
    if (conflict) throw apiError('Subcategory already exists.', 409, { reason: 'subcategory_exists' });
    const maxOrder = state.budget_subcategories
      .filter((s) => s.category_key === cat.key)
      .reduce((max, s) => Math.max(max, s.sort_order), -1);
    const sub = {
      key: uniqueSubcategoryKey(state, cat.key, name),
      category_key: cat.key,
      name,
      sort_order: maxOrder + 1,
    };
    state.budget_subcategories.push(sub);
    await saveState();
    return { data: sub };
  }

  if (tail.length === 3 && tail[1] === 'subcategories' && m === 'PUT') {
    const sub = state.budget_subcategories.find((s) => s.category_key === tail[0] && s.key === tail[2]);
    if (!sub) throw apiError('Subcategory not found.', 404);
    const name = String(body.name || '').trim();
    if (!name) throw apiError('Name is required.', 400);
    const conflict = state.budget_subcategories.find(
      (s) => s.category_key === tail[0] && s.key !== tail[2] && s.name.toLowerCase() === name.toLowerCase(),
    );
    if (conflict) throw apiError('Subcategory already exists.', 409, { reason: 'subcategory_exists' });
    sub.name = name;
    await saveState();
    return { data: sub };
  }

  if (tail.length === 3 && tail[1] === 'subcategories' && m === 'DELETE') {
    const sub = state.budget_subcategories.find((s) => s.category_key === tail[0] && s.key === tail[2]);
    if (!sub) throw apiError('Subcategory not found.', 404);
    const inUse = subcategoryInUseCount(state, sub.key);
    if (inUse > 0) {
      throw apiError(`Subcategory is in use by ${inUse} entries.`, 409, { reason: 'subcategory_in_use', count: inUse });
    }
    const siblings = state.budget_subcategories.filter((s) => s.category_key === tail[0]);
    if (siblings.length <= 1) {
      throw apiError('Cannot delete the last subcategory.', 409, { reason: 'subcategory_last' });
    }
    state.budget_subcategories = state.budget_subcategories.filter((s) => s.key !== sub.key);
    await saveState();
    return { ok: true };
  }

  if (m === 'PATCH' && tail.length === 3 && tail[1] === 'subcategories' && tail[2] === 'reorder') {
    const categoryKey = tail[0];
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    order.forEach((key, i) => {
      const sub = state.budget_subcategories.find((s) => s.key === key && s.category_key === categoryKey);
      if (sub) sub.sort_order = i;
    });
    await saveState();
    return { data: true };
  }

  throw apiError('Not found.', 404);
}

async function cloneMonthEntries(state, fromMonth, toMonth, userId) {
  if (!MONTH_RE.test(fromMonth) || !MONTH_RE.test(toMonth)) {
    throw apiError('month must be YYYY-MM', 400);
  }
  if (fromMonth === toMonth) throw apiError('Source and target month must differ.', 400);
  const { from, to } = monthRange(fromMonth);
  const sources = state.budget_entries.filter((e) =>
    e.date >= from
    && e.date <= to
    && !e.recurrence_parent_id
    && !e.is_recurring,
  );
  let copied = 0;
  const [ty, tm] = toMonth.split('-').map(Number);
  const lastDay = new Date(ty, tm, 0).getDate();
  for (const src of sources) {
    const day = Math.min(parseInt(src.date.slice(8, 10), 10), lastDay);
    const newDate = `${toMonth}-${String(day).padStart(2, '0')}`;
    const dup = state.budget_entries.some((e) =>
      e.date === newDate
      && e.title === src.title
      && e.amount === src.amount
      && e.category === src.category,
    );
    if (dup) continue;
    state.budget_entries.push({
      id: bumpId(state),
      title: src.title,
      amount: src.amount,
      category: src.category,
      subcategory: src.subcategory || null,
      date: newDate,
      account_id: src.account_id ?? null,
      is_recurring: 0,
      recurrence_parent_id: null,
      recurrence_interval: null,
      recurrence_virtual: 0,
      recurrence_full_amount: null,
      visibility: src.visibility || 'shared',
      owner_id: src.owner_id ?? src.created_by ?? userId,
      created_by: userId,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    copied += 1;
  }
  await saveState();
  return copied;
}

/**
 * @returns {object|null} response body or null if not a budget route
 */
export async function handleBudgetApi(method, parts, query, body, state, effectiveUserId, findUser, authUserId = effectiveUserId) {
  ensureBudgetState(state);
  const m = method.toUpperCase();
  const sub = parts[1];
  const baseCurrency = 'EUR';

  if (sub === 'summary' && m === 'GET') {
    const month = query.month || new Date().toISOString().slice(0, 7);
    if (!MONTH_RE.test(month)) throw apiError('month muss YYYY-MM sein', 400);
    return { data: computeSummary(state, month, effectiveUserId, query.scope, authUserId) };
  }

  if (sub === 'meta' && m === 'GET') {
    return { data: loadBudgetMeta(state) };
  }

  if (sub === 'accounts') {
    if (m === 'GET') {
      const includeArchived = query.include_archived === '1' || query.include_archived === 'true';
      const accounts = listAccounts(state, includeArchived);
      const net_worth = accounts.filter((a) => !a.archived).reduce((s, a) => s + a.current_balance, 0);
      return { data: { accounts, net_worth } };
    }
    if (m === 'POST') {
      const id = bumpId(state);
      const account = {
        id,
        name: String(body.name || '').trim(),
        type: body.type || 'checking',
        starting_balance: Number(body.starting_balance) || 0,
        currency: body.currency || null,
        color: body.color || null,
        archived: 0,
        sort_order: state.budget_accounts.length,
        created_by: effectiveUserId,
        created_at: nowIso(),
      };
      state.budget_accounts.push(account);
      await saveState();
      return { data: { ...account, current_balance: account.starting_balance, projected_balance: account.starting_balance } };
    }
    const accountId = Number(parts[2]);
    if (m === 'PUT') {
      const account = state.budget_accounts.find((a) => a.id === accountId);
      if (!account) throw apiError('Not found.', 404);
      if (body.name) account.name = String(body.name).trim();
      if (body.type) account.type = body.type;
      if (body.archived !== undefined) account.archived = body.archived ? 1 : 0;
      await saveState();
      const enriched = listAccounts(state, true).find((a) => a.id === accountId);
      return { data: enriched };
    }
    if (m === 'DELETE') {
      state.budget_accounts = state.budget_accounts.filter((a) => a.id !== accountId);
      await saveState();
      return { ok: true };
    }
  }

  if (sub === 'loans') {
    if (parts[2] === 'preview' && m === 'POST') {
      return { data: { ok: false } };
    }
    if (m === 'GET') {
      return { data: loansPayload(state, baseCurrency) };
    }
    if (m === 'POST') {
      const id = bumpId(state);
      const loan = {
        id,
        title: String(body.title || '').trim(),
        borrower: body.borrower || null,
        total_amount: Number(body.total_amount) || 0,
        paid_amount: 0,
        remaining_amount: Number(body.total_amount) || 0,
        principal: Number(body.principal) || Number(body.total_amount) || 0,
        remaining_principal: Number(body.principal) || Number(body.total_amount) || 0,
        installment_count: Number(body.installment_count) || 0,
        remaining_installments: Number(body.installment_count) || 0,
        monthly_payment: Number(body.monthly_payment) || 0,
        start_month: body.start_month || new Date().toISOString().slice(0, 7),
        status: 'active',
        interest_mode: body.interest_mode || 'none',
        currency: body.currency || null,
        exchange_rate: Number(body.exchange_rate) || 1,
        created_by: effectiveUserId,
        created_at: nowIso(),
      };
      state.budget_loans.push(loan);
      await saveState();
      return { data: loan };
    }
  }

  if (sub === 'plans') {
    const planCat = parts[2];
    if (planCat && m === 'PUT') {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw apiError('Betrag muss größer als 0 sein.', 400);
      const existing = state.budget_plans.find((p) => p.category === planCat);
      if (existing) existing.amount = amount;
      else state.budget_plans.push({ category: planCat, amount, created_by: effectiveUserId });
      await saveState();
      return { data: { category: planCat, amount } };
    }
    if (planCat && m === 'DELETE') {
      state.budget_plans = state.budget_plans.filter((p) => p.category !== planCat);
      await saveState();
      return { data: { deleted: true } };
    }
    if (m === 'GET') {
      const month = MONTH_RE.test(query.month || '') ? query.month : new Date().toISOString().slice(0, 7);
      return { data: computePlanProgress(state, month, effectiveUserId, query.scope, authUserId) };
    }
  }

  if (sub === 'stats' && m === 'GET') {
    const range = query.range || 'month';
    const anchor = query.anchor || new Date().toISOString().slice(0, 10);
    return { data: computeStats(state, range, anchor) };
  }

  if (sub === 'subscriptions') {
    if (m === 'GET') return { data: [] };
    if (parts[2] === 'meta' && m === 'GET') {
      return { data: { categories: [], payment_methods: [], order: { categories: [], payment_methods: [] } } };
    }
    if (parts[2] === 'settings' && m === 'GET') {
      return { data: { reminder_days: 3, default_currency: baseCurrency } };
    }
  }

  if (sub === 'export' && m === 'GET') {
    const range = resolveExportRange(query);
    const filename = DATE_RE.test(String(query.from || '')) && DATE_RE.test(String(query.to || ''))
      ? `budget-${range.from}_${range.to}.csv`
      : `budget-${query.month || range.month}.csv`;
    const { t } = await import('/i18n.js');
    const labelFns = {
      categoryLabel: (key, name) => budgetCategoryLabel(key, name, t),
      subcategoryLabel: (key, name) => budgetSubcategoryLabel(key, name, t),
    };
    const csv = buildBudgetExportCsv(
      state, range.from, range.to, effectiveUserId, query.scope, authUserId, findUser, labelFns,
    );
    return {
      __export: {
        body: csv,
        filename,
        mime: 'text/csv; charset=utf-8',
      },
    };
  }

  if (sub === 'categories') {
    return await handleCategoriesRoute(m, parts.slice(2), body, state);
  }

  if (sub === 'clone-month' && m === 'POST') {
    const fromMonth = String(body.from_month || body.from || '').trim();
    const toMonth = String(body.to_month || body.to || query.month || '').trim();
    const copied = await cloneMonthEntries(state, fromMonth, toMonth, effectiveUserId);
    return { data: { copied, from_month: fromMonth, to_month: toMonth } };
  }

  if (sub === 'apply-recurring' && m === 'POST') {
    const toMonth = String(body.to_month || body.month || query.month || '').trim();
    if (!MONTH_RE.test(toMonth)) throw apiError('month must be YYYY-MM', 400);
    const created = applyRecurringToMonth(state, toMonth);
    await saveState();
    return { data: { created, to_month: toMonth } };
  }

  // GET/POST /budget — entries list or create
  if (!sub && m === 'GET') {
    const month = query.month || new Date().toISOString().slice(0, 7);
    if (!MONTH_RE.test(month)) throw apiError('month muss YYYY-MM sein', 400);
    generateRecurringInstances(state, month);
    await saveState();
    const { from, to } = monthRange(month);
    let rows = entriesInRange(state, from, to);
    rows = filterEntriesForView(rows, effectiveUserId, query.scope, authUserId);
    if (query.category) rows = rows.filter((e) => e.category === query.category);
    if (query.account_id) rows = rows.filter((e) => e.account_id === Number(query.account_id));
    rows = rows.sort((a, b) => (b.date > a.date ? 1 : -1));
    return { data: rows.map((e) => enrichEntry(state, e, findUser)) };
  }

  if (!sub && m === 'POST') {
    const id = bumpId(state);
    const isRecurring = body.is_recurring ? 1 : 0;
    const interval = isRecurring ? (body.recurrence_interval || 'monthly') : 'monthly';
    const isVirtual = isRecurring && body.recurrence_virtual ? 1 : 0;
    const rawAmount = Number(body.amount);
    const storeAmount = isVirtual ? effectiveMonthly(rawAmount, interval) : rawAmount;
    const fullAmount = isVirtual ? rawAmount : null;
    const personal = resolveBudgetMode() === 'personal';
    const entry = {
      id,
      title: String(body.title || '').trim(),
      amount: storeAmount,
      category: body.category || 'financial_other',
      subcategory: body.subcategory || null,
      date: body.date || new Date().toISOString().slice(0, 10),
      account_id: body.account_id ? Number(body.account_id) : null,
      is_recurring: isRecurring,
      recurrence_parent_id: null,
      recurrence_interval: isRecurring ? interval : null,
      recurrence_virtual: isVirtual,
      recurrence_full_amount: fullAmount,
      visibility: body.visibility || (personal ? 'private' : 'shared'),
      owner_id: effectiveUserId,
      created_by: effectiveUserId,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.budget_entries.push(entry);
    await saveState();
    return { data: enrichEntry(state, entry, findUser) };
  }

  const entryId = Number(sub);
  if (Number.isInteger(entryId) && entryId > 0) {
    if (parts[2] === 'series') {
      if (m === 'PUT') return await updateEntrySeries(state, entryId, body, findUser, effectiveUserId);
      if (m === 'DELETE') return await deleteEntrySeries(state, entryId, effectiveUserId);
    }

    const entry = state.budget_entries.find((e) => e.id === entryId);
    if (m === 'PUT' && entry) {
      if (!canEditEntry(entry, effectiveUserId)) throw apiError('You cannot modify this entry.', 403);
      Object.assign(entry, {
        title: body.title ?? entry.title,
        amount: body.amount !== undefined ? Number(body.amount) : entry.amount,
        category: body.category ?? entry.category,
        subcategory: body.subcategory ?? entry.subcategory,
        date: body.date ?? entry.date,
        account_id: body.account_id !== undefined ? (body.account_id ? Number(body.account_id) : null) : entry.account_id,
        updated_at: nowIso(),
      });
      await saveState();
      return { data: enrichEntry(state, entry, findUser) };
    }
    if (m === 'DELETE' && entry) {
      if (!canEditEntry(entry, effectiveUserId)) throw apiError('You cannot modify this entry.', 403);
      if (entry.recurrence_parent_id) {
        const month = entry.date.slice(0, 7);
        state.budget_recurrence_skipped.push({ parent_id: entry.recurrence_parent_id, month });
      }
      state.budget_entries = state.budget_entries.filter((e) => e.id !== entryId);
      await saveState();
      return { ok: true };
    }
  }

  return null;
}
