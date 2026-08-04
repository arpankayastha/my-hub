/**
 * Local API handlers for housekeeping (IndexedDB-backed).
 */

import { saveState, nextId, nowIso } from './store.js';
import { hashPasswordSimple } from './seed.js';

const TASK_TEMPLATES = [
  { key: 'cleanBathrooms', name: 'Clean bathrooms', area: 'Bathrooms', frequency_days: 7 },
  { key: 'mopKitchenFloor', name: 'Mop kitchen floor', area: 'Kitchen', frequency_days: 7 },
  { key: 'dustLivingRoom', name: 'Dust living room', area: 'Living room', frequency_days: 14 },
  { key: 'changeBedLinens', name: 'Change bed linens', area: 'Bedrooms', frequency_days: 14 },
  { key: 'cleanRefrigerator', name: 'Clean refrigerator', area: 'Kitchen', frequency_days: 30 },
  { key: 'cleanWindows', name: 'Clean windows', area: 'Whole house', frequency_days: 30 },
  { key: 'deepCleanOven', name: 'Deep clean oven', area: 'Kitchen', frequency_days: 60 },
  { key: 'washOutdoor', name: 'Wash balcony/patio', area: 'Outdoor', frequency_days: 30 },
];

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function localDateString() {
  return new Date().toISOString().slice(0, 10);
}

function publicSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    worker_id: row.worker_id,
    calendar_event_id: row.calendar_event_id ?? null,
    payment_task_id: row.payment_task_id ?? null,
    receipt_document_id: row.receipt_document_id ?? null,
    check_in: row.check_in,
    check_out: row.check_out ?? null,
    daily_rate: Number(row.daily_rate || 0),
    extras: Number(row.extras || 0),
    paid_at: row.paid_at ?? null,
    rate_type: row.rate_type || 'daily',
    hourly_rate: Number(row.hourly_rate || 0),
    minutes_worked: row.minutes_worked ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function taskUrgency(row) {
  const frequencyDays = Math.max(1, Number(row.frequency_days || 1));
  const completed = row.last_completed ? new Date(row.last_completed) : null;
  if (!completed || Number.isNaN(completed.getTime())) {
    return { urgency: null, status: 'overdue', due_date: null };
  }
  const due = new Date(completed);
  due.setDate(due.getDate() + frequencyDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  let status = 'ok';
  if (today > dueDay) status = 'overdue';
  else if (today.getTime() === dueDay.getTime()) status = 'today';
  return { urgency: null, status, due_date: due.toISOString() };
}

function publicDecayTask(row) {
  const computed = taskUrgency(row);
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    frequency_days: row.frequency_days,
    last_completed: row.last_completed,
    urgency: computed.urgency,
    urgency_status: computed.status,
    due_date: computed.due_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicWorker(row, state, findUser, todaySession) {
  const user = findUser(row.user_id);
  return {
    id: row.id,
    user_id: row.user_id,
    username: user?.username ?? null,
    display_name: user?.display_name ?? null,
    avatar_color: user?.avatar_color ?? null,
    avatar_data: user?.avatar_data ?? null,
    phone: user?.phone ?? null,
    email: user?.email ?? null,
    birth_date: user?.birth_date ?? null,
    daily_rate: Number(row.daily_rate || 0),
    rate_type: row.rate_type || 'daily',
    hourly_rate: Number(row.hourly_rate || 0),
    payment_schedule: row.payment_schedule || 'monthly',
    calendar_color: row.calendar_color || '#7C3AED',
    current_session: publicSession(todaySession),
    today_session: publicSession(todaySession),
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function todaySessionForWorker(state, workerId) {
  const day = localDateString();
  return state.housekeeping_sessions.find(
    (s) => s.worker_id === workerId && s.check_in?.slice(0, 10) === day,
  );
}

export function ensureHousekeepingState(state) {
  if (!Array.isArray(state.housekeeping_workers)) state.housekeeping_workers = [];
  if (!Array.isArray(state.housekeeping_sessions)) state.housekeeping_sessions = [];
  if (!Array.isArray(state.housekeeping_decay_tasks)) state.housekeeping_decay_tasks = [];
}

/**
 * @returns {object|null}
 */
export async function handleHousekeepingApi(m, parts, query, body, state, userId, findUser) {
  ensureHousekeepingState(state);
  const method = m.toUpperCase();

  if (parts[1] === 'dashboard' && method === 'GET') {
    const monthValue = currentMonth();
    const workers = state.housekeeping_workers.map((w) =>
      publicWorker(w, state, findUser, todaySessionForWorker(state, w.id)),
    );
    const lastVisit = state.housekeeping_sessions.sort((a, b) => b.check_in.localeCompare(a.check_in))[0];
    const monthSessions = state.housekeeping_sessions.filter((s) => s.check_in?.slice(0, 7) === monthValue);
    let pending = 0;
    let paid = 0;
    monthSessions.forEach((s) => {
      const amt = Number(s.daily_rate || 0) + Number(s.extras || 0);
      if (s.paid_at) paid += amt;
      else pending += amt;
    });
    const tasks = state.housekeeping_decay_tasks.map(publicDecayTask);
    return {
      data: {
        worker: workers[0] ?? null,
        workers,
        current_session: null,
        visits_this_month: monthSessions.length,
        last_visit: publicSession(lastVisit),
        pending_tasks: tasks.filter((t) => t.urgency_status !== 'ok').length,
        finished_tasks_this_month: tasks.filter((t) => t.last_completed?.slice(0, 7) === monthValue).length,
        pending_payments: pending,
        paid_this_month: paid,
        monthly_payments: [],
      },
    };
  }

  if (parts[1] === 'task-templates' && method === 'GET') {
    return { data: TASK_TEMPLATES };
  }

  if (parts[1] === 'workers' && method === 'GET') {
    const data = state.housekeeping_workers.map((w) =>
      publicWorker(w, state, findUser, todaySessionForWorker(state, w.id)),
    );
    return { data };
  }

  if (parts[1] === 'worker' && method === 'POST') {
    const existingId = body?.id ? Number(body.id) : null;
    let worker = existingId ? state.housekeeping_workers.find((w) => w.id === existingId) : null;
    let targetUserId = worker?.user_id;

    if (!worker) {
      const uid = nextId();
      const username = body.username || `housekeeper_${uid}`;
      state.users.push({
        id: uid,
        username,
        display_name: String(body.display_name || '').trim() || username,
        password_hash: hashPasswordSimple(`hk-${uid}-${Date.now()}`),
        avatar_color: body.avatar_color || '#7C3AED',
        avatar_data: body.avatar_data ?? null,
        role: 'member',
        family_role: 'other',
        phone: body.phone ?? null,
        email: body.email ?? null,
        birth_date: body.birth_date ?? null,
        created_at: nowIso(),
      });
      const wid = nextId();
      worker = {
        id: wid,
        user_id: uid,
        daily_rate: Number(body.daily_rate) || 0,
        hourly_rate: Number(body.hourly_rate) || 0,
        rate_type: body.rate_type || 'daily',
        payment_schedule: body.payment_schedule || 'monthly',
        calendar_color: body.calendar_color || '#7C3AED',
        notes: body.notes ?? null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.housekeeping_workers.push(worker);
      targetUserId = uid;
    } else {
      const user = findUser(worker.user_id);
      if (user) {
        if (body.display_name) user.display_name = body.display_name;
        if (body.username) user.username = body.username;
        if (body.phone !== undefined) user.phone = body.phone;
        if (body.email !== undefined) user.email = body.email;
        if (body.birth_date !== undefined) user.birth_date = body.birth_date;
        if (body.avatar_color) user.avatar_color = body.avatar_color;
        if (body.avatar_data !== undefined) user.avatar_data = body.avatar_data;
      }
      worker.daily_rate = Number(body.daily_rate) ?? worker.daily_rate;
      worker.hourly_rate = Number(body.hourly_rate) ?? worker.hourly_rate;
      worker.rate_type = body.rate_type ?? worker.rate_type;
      worker.payment_schedule = body.payment_schedule ?? worker.payment_schedule;
      worker.calendar_color = body.calendar_color ?? worker.calendar_color;
      worker.notes = body.notes ?? worker.notes;
      worker.updated_at = nowIso();
    }

    await saveState();
    return { data: publicWorker(worker, state, findUser, todaySessionForWorker(state, worker.id)) };
  }

  if (parts[1] === 'visits' && !parts[2] && method === 'GET') {
    const month = query.month || currentMonth();
    const workerFilter = query.worker_id ? Number(query.worker_id) : null;
    let visits = state.housekeeping_sessions.filter((s) => s.check_in?.slice(0, 7) === month);
    if (workerFilter) visits = visits.filter((s) => s.worker_id === workerFilter);
    visits = visits.map((row) => {
      const worker = state.housekeeping_workers.find((w) => w.id === row.worker_id);
      const user = worker ? findUser(worker.user_id) : null;
      const total_amount = Number(row.daily_rate || 0) + Number(row.extras || 0);
      return {
        ...publicSession(row),
        worker_name: user?.display_name ?? null,
        worker_avatar_color: user?.avatar_color ?? null,
        worker_avatar_data: user?.avatar_data ?? null,
        payment_schedule: worker?.payment_schedule ?? 'monthly',
        payment_task_status: null,
        payment_task_title: null,
        receipt_document_name: null,
        total_amount,
      };
    });
    const totals = visits.reduce((acc, v) => {
      acc.total += v.total_amount;
      if (v.paid_at) acc.paid += v.total_amount;
      else acc.pending += v.total_amount;
      return acc;
    }, { total: 0, paid: 0, pending: 0 });
    return { data: { month, visits, totals } };
  }

  const visitId = Number(parts[2]);
  if (parts[1] === 'visits' && visitId && parts[3] === 'pay' && method === 'POST') {
    const session = state.housekeeping_sessions.find((s) => s.id === visitId);
    if (!session) throw apiError('Visit not found.', 404);
    session.paid_at = nowIso();
    session.updated_at = nowIso();
    await saveState();
    return { data: publicSession(session) };
  }

  if (parts[1] === 'visits' && visitId && method === 'GET') {
    const row = state.housekeeping_sessions.find((s) => s.id === visitId);
    if (!row) throw apiError('Visit not found.', 404);
    return { data: publicSession(row) };
  }

  if (parts[1] === 'visits' && visitId && method === 'PUT') {
    const session = state.housekeeping_sessions.find((s) => s.id === visitId);
    if (!session) throw apiError('Visit not found.', 404);
    if (body.daily_rate !== undefined) session.daily_rate = body.daily_rate;
    if (body.extras !== undefined) session.extras = body.extras;
    if (body.minutes_worked !== undefined) session.minutes_worked = body.minutes_worked;
    if (body.receipt_document_id !== undefined) session.receipt_document_id = body.receipt_document_id;
    session.updated_at = nowIso();
    await saveState();
    return { data: publicSession(session) };
  }

  if (parts[1] === 'visits' && visitId && method === 'DELETE') {
    state.housekeeping_sessions = state.housekeeping_sessions.filter((s) => s.id !== visitId);
    await saveState();
    return { ok: true };
  }

  if (parts[1] === 'work-sessions' && parts[2] === 'check-in' && method === 'POST') {
    const workerId = Number(body.worker_id);
    const worker = state.housekeeping_workers.find((w) => w.id === workerId);
    if (!worker) throw apiError('Housekeeper not found.', 404);
    if (todaySessionForWorker(state, workerId)) throw apiError('Visit already recorded today.', 409);
    const id = nextId();
    const session = {
      id,
      worker_id: workerId,
      check_in: nowIso(),
      check_out: null,
      daily_rate: Number(body.daily_rate) || worker.daily_rate || 0,
      extras: Number(body.extras) || 0,
      paid_at: null,
      calendar_event_id: null,
      payment_task_id: null,
      receipt_document_id: null,
      rate_type: worker.rate_type || 'daily',
      hourly_rate: worker.hourly_rate || 0,
      minutes_worked: null,
      created_by: userId,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.housekeeping_sessions.push(session);
    await saveState();
    return { data: publicSession(session) };
  }

  if (parts[1] === 'work-sessions' && parts[2] === 'check-out' && method === 'POST') {
    const workerId = Number(body.worker_id);
    const session = todaySessionForWorker(state, workerId);
    if (!session) throw apiError('No active visit.', 404);
    session.check_out = nowIso();
    if (body.extras !== undefined) session.extras = body.extras;
    session.updated_at = nowIso();
    await saveState();
    return { data: publicSession(session) };
  }

  if (parts[1] === 'decay-tasks' && !parts[2] && method === 'GET') {
    return { data: state.housekeeping_decay_tasks.map(publicDecayTask) };
  }

  if (parts[1] === 'decay-tasks' && !parts[2] && method === 'POST') {
    const id = nextId();
    const task = {
      id,
      name: String(body.name || '').trim(),
      area: body.area || 'General',
      frequency_days: Number(body.frequency_days) || 7,
      last_completed: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    if (!task.name) throw apiError('Name is required.', 400);
    state.housekeeping_decay_tasks.push(task);
    await saveState();
    return { data: publicDecayTask(task) };
  }

  const taskId = Number(parts[2]);
  if (parts[1] === 'decay-tasks' && taskId && parts[3] === 'complete' && method === 'POST') {
    const task = state.housekeeping_decay_tasks.find((t) => t.id === taskId);
    if (!task) throw apiError('Task not found.', 404);
    task.last_completed = nowIso();
    task.updated_at = nowIso();
    await saveState();
    return { data: publicDecayTask(task) };
  }

  if (parts[1] === 'decay-tasks' && taskId && method === 'PATCH') {
    const task = state.housekeeping_decay_tasks.find((t) => t.id === taskId);
    if (!task) throw apiError('Task not found.', 404);
    if (body.name !== undefined) task.name = body.name;
    if (body.area !== undefined) task.area = body.area;
    if (body.frequency_days !== undefined) task.frequency_days = body.frequency_days;
    if (body.last_completed !== undefined) task.last_completed = body.last_completed;
    task.updated_at = nowIso();
    await saveState();
    return { data: publicDecayTask(task) };
  }

  if (parts[1] === 'decay-tasks' && taskId && method === 'DELETE') {
    state.housekeeping_decay_tasks = state.housekeeping_decay_tasks.filter((t) => t.id !== taskId);
    await saveState();
    return { ok: true };
  }

  return null;
}
