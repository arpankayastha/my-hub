/**
 * Local API route handlers (IndexedDB-backed).
 */

import {
  loadState, saveState, getState, nextId, nowIso, cfgGet, cfgSet,
  cfgUserGet, cfgUserSet, getSession, setSession,
} from './store.js';
import {
  createSeedState, publicUser, adminPermissions, hashPasswordSimple,
  verifyPasswordSimple, AVATAR_COLORS,
} from './seed.js';
import { ensureBudgetState, handleBudgetApi, computeDashboardBudget } from './budget-handlers.js';
import { handleHealthApi } from './health-handlers.js';
import { handleSplitExpensesApi } from './split-expenses-handlers.js';
import { handleBirthdaysApi } from './birthdays-handlers.js';
import { handleContactsApi } from './contacts-handlers.js';
import { handleMealsApi, handleRecipesApi } from './meals-recipes-handlers.js';
import { handleRewardsApi, syncTaskRewardEarn } from './rewards-handlers.js';
import { handleHousekeepingApi } from './housekeeping-handlers.js';
import { handleDocumentsApi } from './documents-handlers.js';
import { handleNotificationsApi } from './notifications-handlers.js';
import { handlePermissionsApi } from './permissions-handlers.js';

const APP_VERSION = '1.0.0';
const VALID_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
const VALID_STATUSES = ['open', 'in_progress', 'done', 'archived'];
const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

function parseJson(val, fallback) {
  try {
    const p = JSON.parse(val);
    return p ?? fallback;
  } catch {
    return fallback;
  }
}

function authUserId() {
  const s = getSession();
  return s?.userId ?? null;
}

function requireAuth() {
  const id = authUserId();
  if (!id) throw apiError('Unauthorized', 401);
  return id;
}

function apiError(message, status, data = null) {
  const err = new Error(message);
  err.status = status;
  err.data = data;
  return err;
}

function findUser(id) {
  return getState().users.find((u) => u.id === id);
}

function enrichTask(task, userId) {
  const state = getState();
  const assigned = state.task_assignments
    .filter((a) => a.task_id === task.id)
    .map((a) => findUser(a.user_id))
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      display_name: u.display_name,
      color: u.avatar_color,
      avatar_data: u.avatar_data,
    }));
  const subtasks = state.tasks
    .filter((t) => t.parent_task_id === task.id)
    .map((s) => ({ id: s.id, title: s.title, status: s.status }));
  const subtaskDone = subtasks.filter((s) => s.status === 'done').length;
  const primary = task.assigned_to ? findUser(task.assigned_to) : null;
  return {
    ...task,
    assigned_name: primary?.display_name ?? null,
    assigned_color: primary?.avatar_color ?? null,
    assigned_avatar: primary?.avatar_data ?? null,
    assigned_users: assigned,
    subtasks,
    subtask_total: subtasks.length,
    subtask_done: subtaskDone,
    document_count: state.task_documents.filter((td) => td.task_id === task.id).length,
  };
}

function enrichNote(note) {
  const creator = findUser(note.created_by);
  return {
    ...note,
    creator_name: creator?.display_name ?? null,
    creator_color: creator?.avatar_color ?? null,
    creator_avatar: creator?.avatar_data ?? null,
  };
}

function enrichEvent(event) {
  const state = getState();
  const assigned = state.event_assignments
    .filter((a) => a.event_id === event.id)
    .map((a) => findUser(a.user_id))
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      display_name: u.display_name,
      color: u.avatar_color,
      avatar_data: u.avatar_data,
    }));
  const primary = event.assigned_to ? findUser(event.assigned_to) : null;
  return {
    ...event,
    assigned_name: primary?.display_name ?? null,
    assigned_color: primary?.avatar_color ?? null,
    creator_name: findUser(event.created_by)?.display_name ?? null,
    assigned_users: assigned,
    source: event.external_source || 'local',
  };
}

function preferencesData(userId) {
  const raw = cfgGet('visible_meal_types') ?? VALID_MEAL_TYPES.join(',');
  const visibleMealTypes = raw.split(',').filter((t) => VALID_MEAL_TYPES.includes(t));
  return {
    visible_meal_types: visibleMealTypes.length ? visibleMealTypes : [...VALID_MEAL_TYPES],
    currency: cfgGet('currency') ?? 'EUR',
    date_format: cfgGet('date_format') ?? 'dmy',
    time_format: cfgGet('time_format') ?? '24h',
    week_start: cfgGet('week_start') ?? 'monday',
    region: cfgGet('region') || null,
    app_name: cfgGet('app_name') ?? 'Yuvomi',
    dashboard_widgets: parseJson(cfgGet('dashboard_widgets') ?? '[]', []),
    disabled_modules: parseJson(cfgGet('disabled_modules') ?? '[]', []),
    module_order: (cfgUserGet('module_order', userId) ?? cfgGet('module_order') ?? '')
      .split(',').filter(Boolean),
    mobile_nav_order: (cfgUserGet('mobile_nav_order', userId) ?? '').split(',').filter(Boolean),
    housekeeping_payment_tasks: cfgGet('housekeeping_payment_tasks') === '1',
    budget_mode: cfgGet('budget_mode') ?? 'shared',
    calendar_default_duration: Number(cfgGet('calendar_default_duration')) || 60,
    calendar_default_reminders: parseJson(cfgUserGet('calendar_default_reminders', userId) ?? '[]', []),
    calendar_default_assign_me: cfgUserGet('calendar_default_assign_me', userId) === '1',
    health_cycle_enabled: cfgGet('health_cycle_enabled') !== '0',
    rewards_require_approval: cfgGet('rewards_require_approval') !== '0',
    tasks_default_points: Number(cfgGet('tasks_default_points')) || 0,
    weather_provider: cfgGet('weather_provider') ?? null,
    weather_lat: cfgGet('weather_lat') ?? null,
    weather_lon: cfgGet('weather_lon') ?? null,
    weather_city: cfgGet('weather_city') ?? '',
    weather_units: cfgGet('weather_units') ?? 'metric',
    weather_auto_locate: cfgGet('weather_auto_locate') === '1',
    weather_user: null,
    holiday_country: cfgGet('holiday_country') ?? null,
    holiday_subdivision: cfgGet('holiday_subdivision') ?? null,
    holiday_group: cfgGet('holiday_group') ?? null,
    holiday_show_public: cfgGet('holiday_show_public') === '1',
    holiday_show_school: cfgGet('holiday_show_school') === '1',
    holiday_public_color: cfgGet('holiday_public_color') ?? '#FF3B30',
    holiday_school_color: cfgGet('holiday_school_color') ?? '#34C759',
    holiday_last_sync: cfgGet('holiday_last_sync') ?? null,
  };
}

function eventInRange(event, from, to) {
  const start = String(event.start_datetime || '').slice(0, 10);
  if (!start) return false;
  if (event.recurrence_rule) return start <= to;
  const end = String(event.end_datetime || event.start_datetime || '').slice(0, 10);
  return start <= to && end >= from;
}

export async function handleLocalApi(method, path, body, query = {}) {
  await loadState();
  const state = getState();
  const parts = path.replace(/^\//, '').split('/').filter(Boolean);
  const resource = parts[0] || '';
  const m = method.toUpperCase();

  // GET /version
  if (resource === 'version' && m === 'GET') {
    const setupRequired = state.users.length === 0;
    const session = getSession();
    const payload = {
      app_name: cfgGet('app_name') ?? 'Yuvomi',
      setup_required: setupRequired,
      password_reset_enabled: false,
    };
    if (session?.userId) payload.version = APP_VERSION;
    return payload;
  }

  // Auth routes
  if (resource === 'auth') {
    const sub = parts[1];
    if (sub === 'setup' && m === 'POST') {
      if (state.users.length > 0) throw apiError('Setup has already been completed.', 403);
      const username = String(body.username || '').trim();
      const display_name = String(body.display_name || '').trim();
      const password = body.password;
      if (!username || !display_name || !password) throw apiError('Username, display name, and password are required.', 400);
      const id = nextId();
      const user = {
        id,
        username,
        display_name,
        password_hash: hashPasswordSimple(password),
        avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        avatar_data: null,
        role: 'admin',
        family_role: 'parent',
        access_scope: 'family',
        created_at: nowIso(),
      };
      state.users.push(user);
      setSession({ userId: id, csrfToken: crypto.randomUUID() });
      await saveState();
      return { user: publicUser(user) };
    }
    if (sub === 'login' && m === 'POST') {
      const username = String(body.username || '').trim();
      const password = body.password;
      const user = state.users.find((u) => u.username === username);
      if (!user || !verifyPasswordSimple(password, user.password_hash)) {
        throw apiError('Invalid credentials.', 401);
      }
      const csrf = crypto.randomUUID();
      setSession({ userId: user.id, csrfToken: csrf });
      await saveState();
      return { user: publicUser(user), permissions: adminPermissions(), csrfToken: csrf };
    }
    if (sub === 'logout' && m === 'POST') {
      setSession(null);
      return { ok: true };
    }
    if (sub === 'me' && m === 'GET') {
      const userId = requireAuth();
      const user = findUser(userId);
      if (!user) throw apiError('User not found.', 401);
      const session = getSession();
      return { user: publicUser(user), permissions: adminPermissions(), csrfToken: session?.csrfToken };
    }
    if (sub === 'users' && m === 'GET') {
      requireAuth();
      return { data: state.users.map(publicUser) };
    }
    throw apiError('Not found.', 404);
  }

  const userId = requireAuth();

  if (resource === 'preferences' && parts.length === 1) {
    if (m === 'GET') return { data: preferencesData(userId) };
    if (m === 'PUT') {
      if (body.visible_meal_types) cfgSet('visible_meal_types', body.visible_meal_types.join(','));
      if (body.currency) cfgSet('currency', body.currency);
      if (body.date_format) cfgSet('date_format', body.date_format);
      if (body.time_format) cfgSet('time_format', body.time_format);
      if (body.week_start) cfgSet('week_start', body.week_start);
      if (body.region !== undefined) cfgSet('region', body.region || '');
      if (body.app_name) cfgSet('app_name', body.app_name);
      if (body.dashboard_widgets) cfgSet('dashboard_widgets', JSON.stringify(body.dashboard_widgets));
      if (body.disabled_modules) cfgSet('disabled_modules', JSON.stringify(body.disabled_modules));
      if (body.module_order) cfgUserSet('module_order', userId, body.module_order.join(','));
      if (body.mobile_nav_order) cfgUserSet('mobile_nav_order', userId, body.mobile_nav_order.join(','));
      if (body.budget_mode) cfgSet('budget_mode', body.budget_mode);
      if (body.calendar_default_duration) cfgSet('calendar_default_duration', String(body.calendar_default_duration));
      if (body.calendar_default_reminders) cfgUserSet('calendar_default_reminders', userId, JSON.stringify(body.calendar_default_reminders));
      if (body.calendar_default_assign_me !== undefined) cfgUserSet('calendar_default_assign_me', userId, body.calendar_default_assign_me ? '1' : '0');
      await saveState();
      return { data: preferencesData(userId) };
    }
  }

  if (resource === 'modules' && parts.length === 1 && m === 'GET') {
    return { data: [] };
  }

  if (resource === 'changelog' && m === 'GET') {
    return { data: [] };
  }

  if (resource === 'dashboard' && m === 'GET') {
    ensureBudgetState(state);
    const today = new Date().toISOString().slice(0, 10);
    const budgetMode = cfgGet('budget_mode') === 'personal' ? 'personal' : 'shared';
    const tasks = state.tasks
      .filter((t) => !t.parent_task_id && t.status !== 'done')
      .slice(0, 5)
      .map((t) => enrichTask(t, userId));
    const events = state.calendar_events
      .filter((e) => eventInRange(e, today, today))
      .slice(0, 5)
      .map(enrichEvent);
    const notes = state.notes
      .filter((n) => n.pinned)
      .slice(0, 3)
      .map(enrichNote);
    return {
      upcomingEvents: events,
      urgentTasks: tasks,
      todayMeals: [],
      pinnedNotes: notes,
      shoppingLists: [],
      birthdays: [],
      birthdayCount: state.birthdays?.length ?? 0,
      users: state.users.map(publicUser),
      budget: computeDashboardBudget(state, userId, budgetMode),
      rewards: { standings: [], participantCount: 0, pending: 0 },
      health: {
        hasMeds: false,
        dosesTotal: 0,
        dosesTaken: 0,
        dosesSkipped: 0,
        nextDose: null,
        lowStockCount: 0,
      },
      housekeeping: {
        configured: false,
        present: false,
        presentSince: null,
        workerName: null,
        visitsThisMonth: 0,
        unpaidAmount: 0,
        lastVisit: null,
      },
    };
  }

  if (resource === 'reminders') {
    if (parts[1] === 'pending' && m === 'GET') {
      const now = nowIso();
      const rows = state.reminders
        .filter((r) => r.created_by === userId && !r.dismissed && r.remind_at <= now)
        .map((r) => {
          let entity_title = '';
          if (r.entity_type === 'task') entity_title = state.tasks.find((t) => t.id === r.entity_id)?.title ?? '';
          if (r.entity_type === 'event') entity_title = state.calendar_events.find((e) => e.id === r.entity_id)?.title ?? '';
          return { ...r, entity_title };
        });
      return { data: rows };
    }
    if (parts[1] === 'all' && m === 'GET') {
      const rows = state.reminders.filter(
        (r) => r.entity_type === query.entity_type && r.entity_id === Number(query.entity_id) && r.created_by === userId && !r.dismissed,
      );
      return { data: rows };
    }
    if (parts.length === 1 && m === 'GET') {
      const rows = state.reminders.filter(
        (r) => r.entity_type === query.entity_type && r.entity_id === Number(query.entity_id) && r.created_by === userId && !r.dismissed,
      );
      return { data: rows[0] ?? null };
    }
    if (parts.length === 1 && m === 'POST') {
      const id = nextId();
      const reminder = {
        id,
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        remind_at: body.remind_at,
        created_by: userId,
        dismissed: 0,
        created_at: nowIso(),
      };
      state.reminders.push(reminder);
      await saveState();
      return { data: reminder };
    }
    if (parts.length === 1 && m === 'PUT') {
      const entityType = query.entity_type;
      const entityId = Number(query.entity_id);
      state.reminders = state.reminders.filter(
        (r) => r.entity_type !== entityType || r.entity_id !== entityId || r.created_by !== userId,
      );
      for (const at of body.remind_ats || []) {
        state.reminders.push({
          id: nextId(),
          entity_type: entityType,
          entity_id: entityId,
          remind_at: at,
          created_by: userId,
          dismissed: 0,
          created_at: nowIso(),
        });
      }
      await saveState();
      return { ok: true };
    }
    if (parts.length === 1 && m === 'DELETE') {
      state.reminders = state.reminders.filter(
        (r) => r.entity_type !== query.entity_type || r.entity_id !== Number(query.entity_id) || r.created_by !== userId,
      );
      await saveState();
      return { ok: true };
    }
    if (parts[2] === 'dismiss' && m === 'PATCH') {
      const r = state.reminders.find((x) => x.id === Number(parts[1]));
      if (r) r.dismissed = 1;
      await saveState();
      return { ok: true };
    }
  }

  if (resource === 'tasks') {
    if (parts[1] === 'categories') {
      if (m === 'GET') return { data: state.task_categories };
      if (m === 'POST') {
        const key = String(body.name || 'category').toLowerCase().replace(/\W+/g, '-').slice(0, 32);
        const cat = { key, name: body.name, label_key: `tasks.category.${key}`, sort_order: state.task_categories.length };
        state.task_categories.push(cat);
        await saveState();
        return { data: cat };
      }
    }
    if (parts[1] === 'meta' && parts[2] === 'options' && m === 'GET') {
      return {
        users: state.users.map((u) => ({ id: u.id, display_name: u.display_name, avatar_color: u.avatar_color })),
        priorities: VALID_PRIORITIES,
        statuses: VALID_STATUSES,
        categories: state.task_categories,
        default_points: Number(cfgGet('tasks_default_points')) || 0,
      };
    }
    if (parts.length === 1 && m === 'GET') {
      let rows = state.tasks.filter((t) => !t.parent_task_id);
      if (!query.include_future) {
        const today = new Date().toISOString().slice(0, 10);
        rows = rows.filter((t) => !t.start_date || t.start_date <= today);
      }
      if (query.status) rows = rows.filter((t) => t.status === query.status);
      return { data: rows.map((t) => enrichTask(t, userId)) };
    }
    if (parts.length === 1 && m === 'POST') {
      const id = nextId();
      const task = {
        id,
        title: body.title,
        description: body.description ?? null,
        category: body.category ?? 'misc',
        priority: body.priority ?? 'none',
        status: 'open',
        start_date: body.start_date ?? null,
        due_date: body.due_date ?? null,
        due_time: body.due_time ?? null,
        assigned_to: body.assigned_to ?? null,
        parent_task_id: body.parent_task_id ?? null,
        points: body.points ?? 0,
        visibility: body.visibility ?? 'everyone',
        is_recurring: 0,
        recurrence_rule: null,
        created_by: userId,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.tasks.push(task);
      if (body.assigned_to) state.task_assignments.push({ task_id: id, user_id: body.assigned_to });
      await saveState();
      return { data: enrichTask(task, userId) };
    }
    const taskId = Number(parts[1]);
    if (parts[2] === 'status' && m === 'PATCH') {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) throw apiError('Task not found.', 404);
      task.status = body.status;
      task.updated_at = nowIso();
      if (task.status === 'done') syncTaskRewardEarn(state, task, userId);
      await saveState();
      return { data: enrichTask(task, userId) };
    }
    if (parts[2] === 'documents' && m === 'PUT') {
      state.task_documents = state.task_documents.filter((td) => td.task_id !== taskId);
      for (const docId of body.document_ids || []) {
        state.task_documents.push({ task_id: taskId, document_id: docId });
      }
      await saveState();
      return { ok: true };
    }
    if (parts.length === 2 && m === 'GET') {
      const task = state.tasks.find((t) => t.id === taskId && !t.parent_task_id);
      if (!task) throw apiError('Task not found.', 404);
      return { data: enrichTask(task, userId) };
    }
    if (parts.length === 2 && m === 'PUT') {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) throw apiError('Task not found.', 404);
      Object.assign(task, {
        title: body.title ?? task.title,
        description: body.description ?? task.description,
        category: body.category ?? task.category,
        priority: body.priority ?? task.priority,
        status: body.status ?? task.status,
        start_date: body.start_date ?? task.start_date,
        due_date: body.due_date ?? task.due_date,
        due_time: body.due_time ?? task.due_time,
        points: body.points ?? task.points,
        visibility: body.visibility ?? task.visibility,
        recurrence_rule: body.recurrence_rule ?? task.recurrence_rule,
        updated_at: nowIso(),
      });
      if (task.status === 'done') syncTaskRewardEarn(state, task, userId);
      await saveState();
      return { data: enrichTask(task, userId) };
    }
    if (parts.length === 2 && m === 'DELETE') {
      state.tasks = state.tasks.filter((t) => t.id !== taskId && t.parent_task_id !== taskId);
      state.task_assignments = state.task_assignments.filter((a) => a.task_id !== taskId);
      await saveState();
      return { ok: true };
    }
  }

  if (resource === 'shopping') {
    if (parts[1] === 'categories' && m === 'GET') {
      return { data: state.shopping_categories };
    }
    if (parts[1] === 'suggestions' && m === 'GET') {
      const q = String(query.q || '').toLowerCase();
      const names = new Set(state.shopping_items.map((i) => i.name));
      return { data: [...names].filter((n) => n.toLowerCase().includes(q)).slice(0, 10) };
    }
    if (parts[1] === 'items' && parts[2]) {
      const itemId = Number(parts[2]);
      const item = state.shopping_items.find((i) => i.id === itemId);
      if (!item) throw apiError('Not found.', 404);
      if (m === 'PATCH') {
        Object.assign(item, body);
        await saveState();
        return { data: item };
      }
      if (m === 'DELETE') {
        state.shopping_items = state.shopping_items.filter((i) => i.id !== itemId);
        await saveState();
        return { ok: true };
      }
    }
    if (parts.length === 1 && m === 'GET') {
      return { data: state.shopping_lists };
    }
    if (parts.length === 1 && m === 'POST') {
      const id = nextId();
      const list = { id, name: body.name, created_at: nowIso() };
      state.shopping_lists.push(list);
      await saveState();
      return { data: list };
    }
    const listId = Number(parts[1]);
    if (parts[2] === 'items' && m === 'GET') {
      return { data: state.shopping_items.filter((i) => i.list_id === listId) };
    }
    if (parts[2] === 'items' && m === 'POST') {
      const id = nextId();
      const item = {
        id,
        list_id: listId,
        name: body.name,
        quantity: body.quantity ?? null,
        category: body.category ?? 'Other',
        is_checked: 0,
        notes: null,
        url: null,
        created_at: nowIso(),
      };
      state.shopping_items.push(item);
      await saveState();
      return { data: item };
    }
    if (parts[2] === 'items' && parts[3] === 'checked' && m === 'DELETE') {
      state.shopping_items = state.shopping_items.filter((i) => i.list_id !== listId || !i.is_checked);
      await saveState();
      return { ok: true };
    }
    if (parts.length === 2 && m === 'PUT') {
      const list = state.shopping_lists.find((l) => l.id === listId);
      if (!list) throw apiError('Not found.', 404);
      list.name = body.name;
      await saveState();
      return { data: list };
    }
    if (parts.length === 2 && m === 'DELETE') {
      state.shopping_lists = state.shopping_lists.filter((l) => l.id !== listId);
      state.shopping_items = state.shopping_items.filter((i) => i.list_id !== listId);
      await saveState();
      return { ok: true };
    }
  }

  if (resource === 'calendar') {
    if (parts[1] === 'holidays' && m === 'GET') return { data: [] };
    if (parts[1] === 'google' && parts[2] === 'calendars' && m === 'GET') return { data: [] };
    if (parts[1] === 'google' && parts[2] === 'status' && m === 'GET') return { data: { connected: false } };
    if (parts[1] === 'caldav' && parts[2] === 'accounts' && m === 'GET') return { data: [] };
    if (parts[1] === 'search' && m === 'GET') {
      const q = String(query.q || '').toLowerCase();
      const data = state.calendar_events.filter((e) => String(e.title || '').toLowerCase().includes(q)).map(enrichEvent);
      return { data };
    }
    if (parts.length === 1 && m === 'GET') {
      const from = query.from || new Date().toISOString().slice(0, 7) + '-01';
      const to = query.to || from.slice(0, 7) + '-31';
      const data = state.calendar_events.filter((e) => eventInRange(e, from, to)).map(enrichEvent);
      return { data, from, to };
    }
    if (parts.length === 1 && m === 'POST') {
      const id = nextId();
      const event = {
        id,
        title: body.title,
        start_datetime: body.start_datetime,
        end_datetime: body.end_datetime ?? body.start_datetime,
        all_day: body.all_day ? 1 : 0,
        location: body.location ?? null,
        notes: body.notes ?? null,
        visibility: body.visibility ?? 'everyone',
        assigned_to: body.assigned_to ?? null,
        created_by: userId,
        external_source: 'local',
        recurrence_rule: body.recurrence_rule ?? null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.calendar_events.push(event);
      await saveState();
      return { data: enrichEvent(event) };
    }
    const eventId = Number(parts[1]);
    if (parts.length === 2 && m === 'GET') {
      const event = state.calendar_events.find((e) => e.id === eventId);
      if (!event) throw apiError('Not found.', 404);
      return { data: enrichEvent(event) };
    }
    if (parts.length === 2 && m === 'PUT') {
      const event = state.calendar_events.find((e) => e.id === eventId);
      if (!event) throw apiError('Not found.', 404);
      Object.assign(event, body, { updated_at: nowIso() });
      await saveState();
      return { data: enrichEvent(event) };
    }
    if (parts.length === 2 && m === 'DELETE') {
      state.calendar_events = state.calendar_events.filter((e) => e.id !== eventId);
      await saveState();
      return { ok: true };
    }
    if (parts[2] === 'exceptions' && m === 'POST') {
      state.calendar_event_exceptions.push({ event_id: eventId, date: body.date });
      await saveState();
      return { ok: true };
    }
    if (parts[2] === 'reset' && m === 'POST') {
      return { ok: true };
    }
  }

  if (resource === 'notes') {
    if (parts.length === 1 && m === 'GET') {
      const notes = [...state.notes].sort((a, b) => (b.pinned - a.pinned) || (b.updated_at > a.updated_at ? 1 : -1));
      return { data: notes.map(enrichNote) };
    }
    if (parts.length === 1 && m === 'POST') {
      const id = nextId();
      const note = {
        id,
        title: body.title ?? null,
        content: body.content,
        color: body.color ?? '#FFEB3B',
        pinned: body.pinned ? 1 : 0,
        created_by: userId,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.notes.push(note);
      await saveState();
      return { data: enrichNote(note) };
    }
    const noteId = Number(parts[1]);
    if (parts[2] === 'pin' && m === 'PATCH') {
      const note = state.notes.find((n) => n.id === noteId);
      if (!note) throw apiError('Not found.', 404);
      note.pinned = note.pinned ? 0 : 1;
      note.updated_at = nowIso();
      await saveState();
      return { data: enrichNote(note) };
    }
    if (parts.length === 2 && m === 'PUT') {
      const note = state.notes.find((n) => n.id === noteId);
      if (!note) throw apiError('Not found.', 404);
      Object.assign(note, {
        title: body.title ?? note.title,
        content: body.content ?? note.content,
        color: body.color ?? note.color,
        pinned: body.pinned !== undefined ? (body.pinned ? 1 : 0) : note.pinned,
        updated_at: nowIso(),
      });
      await saveState();
      return { data: enrichNote(note) };
    }
    if (parts.length === 2 && m === 'DELETE') {
      state.notes = state.notes.filter((n) => n.id !== noteId);
      await saveState();
      return { ok: true };
    }
  }

  if (resource === 'documents') {
    const documentsResult = await handleDocumentsApi(m, parts, query, body, state, userId, findUser);
    if (documentsResult !== null) return documentsResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'contacts') {
    const contactsResult = await handleContactsApi(m, parts, query, body, state, userId);
    if (contactsResult !== null) return contactsResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'meals') {
    const mealsResult = await handleMealsApi(m, parts, query, body, state, userId, findUser);
    if (mealsResult !== null) return mealsResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'recipes') {
    const recipesResult = await handleRecipesApi(m, parts, query, body, state, userId, findUser);
    if (recipesResult !== null) return recipesResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'rewards') {
    const rewardsResult = await handleRewardsApi(m, parts, query, body, state, userId, findUser, state.users);
    if (rewardsResult !== null) return rewardsResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'housekeeping') {
    const hkResult = await handleHousekeepingApi(m, parts, query, body, state, userId, findUser);
    if (hkResult !== null) return hkResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'pantry' && parts[1] === 'locations' && m === 'GET') {
    return { data: state.pantry_locations };
  }

  if (resource === 'search' && m === 'GET') {
    const q = String(query.q || '').toLowerCase();
    const tasks = state.tasks.filter((t) => String(t.title || '').toLowerCase().includes(q)).map((t) => enrichTask(t, userId));
    const contacts = state.contacts.filter((c) =>
      String(c.name || '').toLowerCase().includes(q)
      || String(c.phone || '').toLowerCase().includes(q),
    ).map((c) => ({ id: c.id, name: c.name, phone: c.phone, category: c.category }));
    return { data: { tasks, events: [], notes: [], contacts } };
  }

  if (resource === 'permissions') {
    const permissionsResult = await handlePermissionsApi(m, parts, body, state, userId, findUser);
    if (permissionsResult !== null) return permissionsResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'weather' && m === 'GET') {
    return { data: null, offline: true };
  }

  if (resource === 'push' && parts[1] === 'vapid-public-key' && m === 'GET') {
    return { data: null };
  }

  if (resource === 'notifications') {
    const notificationsResult = await handleNotificationsApi(
      m, parts, body, state, userId, findUser,
    );
    if (notificationsResult !== null) return notificationsResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'budget') {
    const budgetResult = await handleBudgetApi(m, parts, query, body, state, userId, findUser);
    if (budgetResult !== null) return budgetResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'health') {
    const healthResult = await handleHealthApi(m, parts, query, body, state, userId);
    if (healthResult !== null) return healthResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'split-expenses') {
    const splitResult = await handleSplitExpensesApi(m, parts, query, body, state, userId);
    if (splitResult !== null) return splitResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'birthdays') {
    const birthdaysResult = await handleBirthdaysApi(m, parts, query, body, state, userId);
    if (birthdaysResult !== null) return birthdaysResult;
    throw apiError('Not found.', 404);
  }

  if (resource === 'family' && parts[1] === 'members' && m === 'GET') {
    return {
      data: state.users.map((u) => ({
        id: u.id,
        display_name: u.display_name,
        avatar_color: u.avatar_color,
        avatar_data: u.avatar_data ?? null,
        family_role: u.family_role ?? null,
        phone: u.phone ?? null,
        email: u.email ?? null,
        birth_date: u.birth_date ?? null,
        created_at: u.created_at,
      })),
    };
  }

  // Default empty list for unimplemented read endpoints
  if (m === 'GET') {
    return { data: [] };
  }

  throw apiError('Not found.', 404);
}

export async function initLocalStore() {
  await loadState();
  const state = getState();
  const hadCategories = state.budget_categories?.length > 0;
  ensureBudgetState(state);
  if (!hadCategories && state.budget_categories.length > 0) {
    await saveState();
  }
  if (!state.task_categories?.length) {
    const { resetState } = await import('./store.js');
    await resetState(createSeedState());
  }
}
