/**
 * Local API handlers for health module (IndexedDB-backed).
 */

import { saveState, nextId, nowIso } from './store.js';

export function ensureHealthState(state) {
  if (!Array.isArray(state.health_vitals)) state.health_vitals = [];
  if (!Array.isArray(state.health_medications)) state.health_medications = [];
  if (!Array.isArray(state.health_medication_schedules)) state.health_medication_schedules = [];
  if (!Array.isArray(state.health_medication_logs)) state.health_medication_logs = [];
  if (!Array.isArray(state.health_lab_reports)) state.health_lab_reports = [];
  if (!Array.isArray(state.health_lab_results)) state.health_lab_results = [];
  if (!Array.isArray(state.health_activities)) state.health_activities = [];
}

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function filterVitals(state, userId, query) {
  let rows = state.health_vitals.filter((v) => v.user_id === userId || v.visibility === 'family');
  if (query.user_id) {
    const pid = Number(query.user_id);
    rows = rows.filter((v) => v.user_id === pid);
  }
  if (query.type) rows = rows.filter((v) => v.type === query.type);
  if (query.from) rows = rows.filter((v) => v.measured_at >= query.from);
  if (query.to) rows = rows.filter((v) => v.measured_at <= query.to);
  return rows.sort((a, b) => (b.measured_at > a.measured_at ? 1 : -1));
}

/**
 * @returns {object|null}
 */
export async function handleHealthApi(method, parts, query, body, state, userId) {
  ensureHealthState(state);
  const m = method.toUpperCase();
  const sub = parts[1];

  if (sub === 'vitals') {
    const vitalId = Number(parts[2]);
    if (m === 'GET' && !parts[2]) {
      return { data: filterVitals(state, userId, query) };
    }
    if (m === 'POST' && !parts[2]) {
      const id = nextId();
      const vital = {
        id,
        user_id: userId,
        type: body.type,
        value_num: body.value_num ?? null,
        value_num2: body.value_num2 ?? null,
        value_num3: body.value_num3 ?? null,
        unit: body.unit ?? null,
        measured_at: body.measured_at,
        note: body.note ?? null,
        visibility: body.visibility || 'private',
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.health_vitals.push(vital);
      await saveState();
      return { data: vital };
    }
    if (parts[3] === 'take' || parts[3] === 'skip') {
      throw apiError('Not found.', 404);
    }
    if (m === 'PATCH' && vitalId) {
      const vital = state.health_vitals.find((v) => v.id === vitalId && v.user_id === userId);
      if (!vital) throw apiError('Vitalwert nicht gefunden.', 404);
      Object.assign(vital, {
        type: body.type ?? vital.type,
        value_num: body.value_num ?? vital.value_num,
        value_num2: body.value_num2 ?? vital.value_num2,
        value_num3: body.value_num3 ?? vital.value_num3,
        unit: body.unit ?? vital.unit,
        measured_at: body.measured_at ?? vital.measured_at,
        note: body.note ?? vital.note,
        visibility: body.visibility ?? vital.visibility,
        updated_at: nowIso(),
      });
      await saveState();
      return { data: vital };
    }
    if (m === 'DELETE' && vitalId) {
      const idx = state.health_vitals.findIndex((v) => v.id === vitalId && v.user_id === userId);
      if (idx === -1) throw apiError('Vitalwert nicht gefunden.', 404);
      state.health_vitals.splice(idx, 1);
      await saveState();
      return { ok: true };
    }
  }

  if (sub === 'medications') {
    if (m === 'GET' && !parts[2]) return { data: state.health_medications.filter((x) => x.user_id === userId) };
    if (m === 'POST' && !parts[2]) {
      const id = nextId();
      const med = { id, user_id: userId, ...body, created_at: nowIso() };
      state.health_medications.push(med);
      await saveState();
      return { data: med };
    }
    const medId = Number(parts[2]);
    if (parts[3] === 'schedules' && m === 'GET') return { data: state.health_medication_schedules.filter((s) => s.medication_id === medId) };
    if (parts[3] === 'schedules' && m === 'POST') {
      const id = nextId();
      const row = { id, medication_id: medId, ...body };
      state.health_medication_schedules.push(row);
      await saveState();
      return { data: row };
    }
    if (parts[3] === 'logs' && m === 'GET') return { data: state.health_medication_logs.filter((l) => l.medication_id === medId) };
    if (parts[3] === 'logs' && m === 'POST') {
      const id = nextId();
      const row = { id, medication_id: medId, ...body };
      state.health_medication_logs.push(row);
      await saveState();
      return { data: row };
    }
    if (m === 'PATCH') {
      const med = state.health_medications.find((x) => x.id === medId);
      if (!med) throw apiError('Not found.', 404);
      Object.assign(med, body);
      await saveState();
      return { data: med };
    }
    if (m === 'DELETE') {
      state.health_medications = state.health_medications.filter((x) => x.id !== medId);
      await saveState();
      return { ok: true };
    }
  }

  if (sub === 'schedules' && m === 'DELETE') {
    const id = Number(parts[2]);
    state.health_medication_schedules = state.health_medication_schedules.filter((s) => s.id !== id);
    await saveState();
    return { ok: true };
  }

  if (sub === 'logs') {
    const logId = Number(parts[2]);
    if (parts[3] === 'take' || parts[3] === 'skip') {
      const log = state.health_medication_logs.find((l) => l.id === logId);
      if (log) Object.assign(log, body || {}, { status: parts[3] });
      await saveState();
      return { data: log };
    }
  }

  if (sub === 'labs') {
    if (m === 'GET' && !parts[2]) return { data: state.health_lab_reports.filter((r) => r.user_id === userId) };
    if (m === 'POST' && !parts[2]) {
      const id = nextId();
      const report = { id, user_id: userId, ...body, created_at: nowIso() };
      state.health_lab_reports.push(report);
      await saveState();
      return { data: report };
    }
    const reportId = Number(parts[2]);
    if (parts[3] === 'results' && m === 'POST') {
      const id = nextId();
      const result = { id, report_id: reportId, ...body };
      state.health_lab_results.push(result);
      await saveState();
      return { data: result };
    }
    if (m === 'PATCH') {
      const report = state.health_lab_reports.find((r) => r.id === reportId);
      if (!report) throw apiError('Not found.', 404);
      Object.assign(report, body);
      await saveState();
      return { data: report };
    }
    if (m === 'DELETE') {
      state.health_lab_reports = state.health_lab_reports.filter((r) => r.id !== reportId);
      await saveState();
      return { ok: true };
    }
  }

  if (sub === 'results' && m === 'DELETE') {
    const id = Number(parts[2]);
    state.health_lab_results = state.health_lab_results.filter((r) => r.id !== id);
    await saveState();
    return { ok: true };
  }

  if (sub === 'activities') {
    if (m === 'GET' && !parts[2]) return { data: state.health_activities.filter((a) => a.user_id === userId) };
    if (m === 'POST' && !parts[2]) {
      const id = nextId();
      const row = { id, user_id: userId, ...body, created_at: nowIso() };
      state.health_activities.push(row);
      await saveState();
      return { data: row };
    }
    const actId = Number(parts[2]);
    if (m === 'PATCH') {
      const row = state.health_activities.find((a) => a.id === actId);
      if (!row) throw apiError('Not found.', 404);
      Object.assign(row, body);
      await saveState();
      return { data: row };
    }
    if (m === 'DELETE') {
      state.health_activities = state.health_activities.filter((a) => a.id !== actId);
      await saveState();
      return { ok: true };
    }
  }

  return null;
}
