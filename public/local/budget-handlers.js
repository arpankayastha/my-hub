/**
 * Local API handlers for budget module (IndexedDB-backed).
 */

import { saveState, nowIso } from './store.js';
import { DEFAULT_BUDGET_CATEGORIES, DEFAULT_BUDGET_SUBCATEGORIES } from './budget-seed.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
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

function computeSummary(state, month) {
  const { from, to } = monthRange(month);
  const rows = entriesInRange(state, from, to);
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

function computePlanProgress(state, month) {
  const { from, to } = monthRange(month);
  const planMap = new Map(state.budget_plans.map((p) => [p.category, Number(p.amount) || 0]));
  const spentRows = entriesInRange(state, from, to);
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
  const summary = computeSummary(state, month);
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
export function computeDashboardBudget(state, userId, budgetMode = 'shared') {
  ensureBudgetState(state);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { from, to } = monthRange(currentMonth);
  let rows = entriesInRange(state, from, to);
  if (budgetMode === 'personal') {
    rows = rows.filter((e) => e.created_by === userId);
  }

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

function monthsPerInterval(interval) {
  return interval === 'yearly' ? 12 : interval === 'half_year' ? 6 : 1;
}

function effectiveMonthly(amount, interval) {
  return Math.round((Number(amount || 0) / monthsPerInterval(interval)) * 100) / 100;
}

function resolveSeriesParent(state, entry) {
  const parentId = entry.recurrence_parent_id ?? (entry.is_recurring ? entry.id : null);
  if (!parentId) return null;
  return state.budget_entries.find((e) => e.id === parentId) ?? null;
}

async function updateEntrySeries(state, entryId, body, findUser) {
  const entry = state.budget_entries.find((e) => e.id === entryId);
  if (!entry) throw apiError('Entry not found.', 404);

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

async function deleteEntrySeries(state, entryId) {
  const entry = state.budget_entries.find((e) => e.id === entryId);
  if (!entry) throw apiError('Entry not found.', 404);

  const parent = resolveSeriesParent(state, entry);
  if (!parent) throw apiError('Not a recurring entry.', 400);

  state.budget_entries = state.budget_entries.filter((e) =>
    e.id !== parent.id && e.recurrence_parent_id !== parent.id,
  );
  await saveState();
  return { ok: true };
}

function generateRecurringInstances(state, month) {
  if (!Array.isArray(state.budget_recurrence_skipped)) state.budget_recurrence_skipped = [];
  const [y, m] = month.split('-').map(Number);
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

    const interval = orig.recurrence_interval || 'monthly';
    if (!orig.recurrence_virtual) {
      const [oy, om] = orig.date.split('-').map(Number);
      const monthsDiff = (y - oy) * 12 + (m - om);
      if (monthsDiff < 1 || monthsDiff % monthsPerInterval(interval) !== 0) continue;
    }

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
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
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
export async function handleBudgetApi(method, parts, query, body, state, userId, findUser) {
  ensureBudgetState(state);
  const m = method.toUpperCase();
  const sub = parts[1];
  const baseCurrency = 'EUR';

  if (sub === 'summary' && m === 'GET') {
    const month = query.month || new Date().toISOString().slice(0, 7);
    if (!MONTH_RE.test(month)) throw apiError('month muss YYYY-MM sein', 400);
    return { data: computeSummary(state, month) };
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
        created_by: userId,
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
        created_by: userId,
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
      else state.budget_plans.push({ category: planCat, amount, created_by: userId });
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
      return { data: computePlanProgress(state, month) };
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
    return { data: '' };
  }

  if (sub === 'categories') {
    return await handleCategoriesRoute(m, parts.slice(2), body, state);
  }

  if (sub === 'clone-month' && m === 'POST') {
    const fromMonth = String(body.from_month || body.from || '').trim();
    const toMonth = String(body.to_month || body.to || query.month || '').trim();
    const copied = await cloneMonthEntries(state, fromMonth, toMonth, userId);
    return { data: { copied, from_month: fromMonth, to_month: toMonth } };
  }

  // GET/POST /budget — entries list or create
  if (!sub && m === 'GET') {
    const month = query.month || new Date().toISOString().slice(0, 7);
    if (!MONTH_RE.test(month)) throw apiError('month muss YYYY-MM sein', 400);
    generateRecurringInstances(state, month);
    await saveState();
    const { from, to } = monthRange(month);
    let rows = entriesInRange(state, from, to);
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
      visibility: body.visibility || 'shared',
      created_by: userId,
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
      if (m === 'PUT') return await updateEntrySeries(state, entryId, body, findUser);
      if (m === 'DELETE') return await deleteEntrySeries(state, entryId);
    }

    const entry = state.budget_entries.find((e) => e.id === entryId);
    if (m === 'PUT' && entry) {
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
