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
  if (!Array.isArray(state.cycle_periods)) state.cycle_periods = [];
  if (!Array.isArray(state.cycle_day_logs)) state.cycle_day_logs = [];
  if (!Array.isArray(state.cycle_settings)) state.cycle_settings = [];
}

const FLOW_LEVELS = ['spotting', 'light', 'medium', 'heavy'];
const VISIBILITIES = ['private', 'family'];

function toBit(val) {
  if (val === undefined || val === null || val === '') return undefined;
  if (val === true || val === 1 || val === '1' || val === 'true') return 1;
  if (val === false || val === 0 || val === '0' || val === 'false') return 0;
  return undefined;
}

function normalizeSymptoms(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const tokens = list
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => /^[a-z0-9_]{1,32}$/.test(s));
  return [...new Set(tokens)].join(',') || null;
}

function defaultCycleSettings(userId) {
  return {
    user_id: userId,
    cycle_length_avg: null,
    period_length_avg: null,
    luteal_length: 14,
    track_fertility: 1,
    pregnancy_mode: 0,
    pregnancy_due_date: null,
    default_visibility: 'private',
  };
}

/** Cycle rows: owner sees all; family sees visibility=family for other users. */
function filterCycleRows(rows, viewerId, query, dateField) {
  const personId = query.user_id ? Number(query.user_id) : null;
  let filtered;
  if (personId) {
    if (personId === viewerId) {
      filtered = rows.filter((r) => r.user_id === viewerId);
    } else {
      filtered = rows.filter((r) => r.user_id === personId && r.visibility === 'family');
    }
  } else {
    filtered = rows.filter((r) => r.user_id === viewerId);
  }
  if (query.from) filtered = filtered.filter((r) => r[dateField] >= query.from);
  if (query.to) filtered = filtered.filter((r) => r[dateField] <= query.to);
  return filtered;
}

async function handleCycleApi(m, parts, query, body, state, userId) {
  const segment = parts[2];

  if (segment === 'periods') {
    const periodId = Number(parts[3]);
    if (m === 'GET' && !parts[3]) {
      const rows = filterCycleRows(state.cycle_periods, userId, query, 'start_date');
      rows.sort((a, b) => (b.start_date > a.start_date ? 1 : b.start_date < a.start_date ? -1 : b.id - a.id));
      return { data: rows };
    }
    if (m === 'POST' && !parts[3]) {
      const startDate = body.start_date;
      const endDate = body.end_date ?? null;
      if (!startDate) throw apiError('start_date is required.', 400);
      if (endDate && endDate < startDate) throw apiError('end_date must not be before start_date.', 400);
      const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : 'private';
      const id = nextId();
      const period = {
        id,
        user_id: userId,
        start_date: startDate,
        end_date: endDate,
        note: body.note ?? null,
        visibility,
      };
      state.cycle_periods.push(period);
      await saveState();
      return { data: period };
    }
    if (m === 'PATCH' && periodId) {
      const period = state.cycle_periods.find((p) => p.id === periodId && p.user_id === userId);
      if (!period) throw apiError('Periode nicht gefunden.', 404);
      if (body.start_date !== undefined) period.start_date = body.start_date;
      if (body.end_date !== undefined) period.end_date = body.end_date;
      if (body.note !== undefined) period.note = body.note;
      if (body.visibility !== undefined && VISIBILITIES.includes(body.visibility)) {
        period.visibility = body.visibility;
      }
      const nextStart = period.start_date;
      const nextEnd = period.end_date;
      if (nextEnd && nextStart && nextEnd < nextStart) {
        throw apiError('end_date must not be before start_date.', 400);
      }
      await saveState();
      return { data: period };
    }
    if (m === 'DELETE' && periodId) {
      const idx = state.cycle_periods.findIndex((p) => p.id === periodId && p.user_id === userId);
      if (idx === -1) throw apiError('Periode nicht gefunden.', 404);
      state.cycle_periods.splice(idx, 1);
      await saveState();
      return { ok: true };
    }
    return null;
  }

  if (segment === 'logs') {
    const logId = Number(parts[3]);
    if (m === 'GET' && !parts[3]) {
      const rows = filterCycleRows(state.cycle_day_logs, userId, query, 'log_date');
      rows.sort((a, b) => (b.log_date > a.log_date ? 1 : b.log_date < a.log_date ? -1 : b.id - a.id));
      return { data: rows };
    }
    if (m === 'POST' && !parts[3]) {
      const logDate = body.log_date;
      if (!logDate) throw apiError('log_date is required.', 400);
      const flow = body.flow ?? null;
      if (flow && !FLOW_LEVELS.includes(flow)) throw apiError('flow must be one of spotting, light, medium, heavy.', 400);
      const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : 'private';
      const symptoms = normalizeSymptoms(body.symptoms);
      const existing = state.cycle_day_logs.find((l) => l.user_id === userId && l.log_date === logDate);
      if (existing) {
        Object.assign(existing, {
          flow,
          symptoms,
          mood: body.mood ?? null,
          note: body.note ?? null,
          visibility,
        });
        await saveState();
        return { data: existing };
      }
      const id = nextId();
      const row = {
        id,
        user_id: userId,
        log_date: logDate,
        flow,
        symptoms,
        mood: body.mood ?? null,
        note: body.note ?? null,
        visibility,
      };
      state.cycle_day_logs.push(row);
      await saveState();
      return { data: row };
    }
    if (m === 'DELETE' && logId) {
      const idx = state.cycle_day_logs.findIndex((l) => l.id === logId && l.user_id === userId);
      if (idx === -1) throw apiError('Eintrag nicht gefunden.', 404);
      state.cycle_day_logs.splice(idx, 1);
      await saveState();
      return { ok: true };
    }
    return null;
  }

  if (segment === 'settings') {
    if (m === 'GET' && !parts[3]) {
      const row = state.cycle_settings.find((s) => s.user_id === userId);
      return { data: row || defaultCycleSettings(userId) };
    }
    if (m === 'PUT' && !parts[3]) {
      const intInRange = (val, field, lo, hi) => {
        if (val === undefined || val === null || val === '') return null;
        const n = Number(val);
        if (!Number.isInteger(n) || n < lo || n > hi) {
          throw apiError(`${field} must be an integer between ${lo} and ${hi}.`, 400);
        }
        return n;
      };
      const cycleLen = body.cycle_length_avg !== undefined
        ? intInRange(body.cycle_length_avg, 'cycle_length_avg', 15, 60)
        : null;
      const periodLen = body.period_length_avg !== undefined
        ? intInRange(body.period_length_avg, 'period_length_avg', 1, 15)
        : null;
      const luteal = body.luteal_length !== undefined
        ? intInRange(body.luteal_length, 'luteal_length', 8, 18)
        : null;
      const track = toBit(body.track_fertility);
      const pregnancy = toBit(body.pregnancy_mode);
      if (body.track_fertility !== undefined && track === undefined) {
        throw apiError('track_fertility must be a boolean.', 400);
      }
      if (body.pregnancy_mode !== undefined && pregnancy === undefined) {
        throw apiError('pregnancy_mode must be a boolean.', 400);
      }
      const dueDate = body.pregnancy_due_date ?? null;
      if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        throw apiError('pregnancy_due_date must be YYYY-MM-DD.', 400);
      }
      const defVis = body.default_visibility;
      if (defVis !== undefined && !VISIBILITIES.includes(defVis)) {
        throw apiError('default_visibility must be private or family.', 400);
      }
      let row = state.cycle_settings.find((s) => s.user_id === userId);
      if (!row) {
        row = defaultCycleSettings(userId);
        state.cycle_settings.push(row);
      }
      if (body.cycle_length_avg !== undefined) row.cycle_length_avg = cycleLen;
      if (body.period_length_avg !== undefined) row.period_length_avg = periodLen;
      if (body.luteal_length !== undefined) row.luteal_length = luteal ?? 14;
      if (body.track_fertility !== undefined) row.track_fertility = track;
      if (body.pregnancy_mode !== undefined) row.pregnancy_mode = pregnancy;
      if (body.pregnancy_due_date !== undefined) row.pregnancy_due_date = dueDate;
      if (body.default_visibility !== undefined) row.default_visibility = defVis;
      await saveState();
      return { data: row };
    }
    return null;
  }

  if (segment === 'visibility' && m === 'PATCH') {
    const vis = body?.visibility;
    if (!VISIBILITIES.includes(vis)) throw apiError('visibility is required.', 400);
    let periods = 0;
    let logs = 0;
    state.cycle_periods.forEach((p) => {
      if (p.user_id === userId) { p.visibility = vis; periods += 1; }
    });
    state.cycle_day_logs.forEach((l) => {
      if (l.user_id === userId) { l.visibility = vis; logs += 1; }
    });
    await saveState();
    return { data: { periods, logs } };
  }

  return null;
}

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const VITAL_TYPES = ['bp', 'glucose', 'weight', 'spo2', 'temp'];

function normalizeMeasuredAt(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[1]}T${m[2]}:${m[3]}` : null;
}

function parseVitalNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function validateVitalBody(body) {
  const type = String(body?.type || '').trim();
  if (!type) throw apiError('type is required.', 400);
  if (!VITAL_TYPES.includes(type)) throw apiError('Invalid vital type.', 400);
  const measuredAt = normalizeMeasuredAt(body?.measured_at);
  if (!measuredAt) throw apiError('measured_at is required.', 400);
  const valueNum = parseVitalNumber(body?.value_num);
  if (valueNum === null) throw apiError('value_num is required.', 400);
  const valueNum2 = parseVitalNumber(body?.value_num2);
  const valueNum3 = parseVitalNumber(body?.value_num3);
  if (type === 'bp' && valueNum2 === null) throw apiError('value_num2 is required for blood pressure.', 400);
  const visibility = String(body?.visibility || 'private');
  if (!VISIBILITIES.includes(visibility)) throw apiError('Invalid visibility.', 400);
  const unit = body?.unit != null && body.unit !== '' ? String(body.unit).trim() : null;
  const note = body?.note != null && body.note !== '' ? String(body.note).trim() : null;
  return {
    type,
    value_num: valueNum,
    value_num2: valueNum2,
    value_num3: valueNum3,
    unit,
    measured_at: measuredAt,
    note,
    visibility,
  };
}

function filterVitals(state, userId, query) {
  let rows = state.health_vitals.filter((v) => v.user_id === userId);
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
      const vitalInput = validateVitalBody(body);
      const id = nextId();
      const vital = {
        id,
        user_id: userId,
        type: vitalInput.type,
        value_num: vitalInput.value_num,
        value_num2: vitalInput.value_num2,
        value_num3: vitalInput.value_num3,
        unit: vitalInput.unit,
        measured_at: vitalInput.measured_at,
        note: vitalInput.note,
        visibility: vitalInput.visibility,
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

  if (sub === 'cycle') {
    const cycleResult = await handleCycleApi(m, parts, query, body, state, userId);
    if (cycleResult !== null) return cycleResult;
  }

  if (sub === 'export' && parts[2] && m === 'GET') {
    const area = parts[2];
    const from = String(query.from || '').trim();
    const to = String(query.to || '').trim();
    const targetUser = query.user_id ? Number(query.user_id) : userId;
    const dateOk = /^\d{4}-\d{2}-\d{2}$/;
    const inRange = (key) => {
      if (!dateOk.test(from) || !dateOk.test(to)) return true;
      const k = String(key || '').slice(0, 10);
      return k >= from && k <= to;
    };
    const csvCell = (value) => {
      let s = value === null || value === undefined ? '' : String(value);
      s = s.replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s}"`;
    };
    const toCsv = (header, rows) => {
      const head = header.map(csvCell).join(',');
      const body = rows.map((r) => r.map(csvCell).join(',')).join('\n');
      return body ? `${head}\n${body}` : head;
    };
    let csv = '';
    if (area === 'vitals') {
      const rows = state.health_vitals
        .filter((v) => v.user_id === targetUser)
        .filter((v) => inRange(v.measured_at))
        .sort((a, b) => String(a.measured_at).localeCompare(String(b.measured_at)));
      csv = toCsv(
        ['measured_at', 'type', 'value_num', 'value_num2', 'value_num3', 'unit', 'note', 'visibility'],
        rows.map((r) => [r.measured_at, r.type, r.value_num, r.value_num2, r.value_num3, r.unit, r.note, r.visibility]),
      );
    } else if (area === 'activities') {
      const rows = state.health_activities
        .filter((a) => a.user_id === targetUser)
        .filter((a) => inRange(a.performed_at))
        .sort((a, b) => String(a.performed_at).localeCompare(String(b.performed_at)));
      csv = toCsv(
        ['performed_at', 'type', 'duration_min', 'distance_km', 'intensity', 'calories', 'note', 'visibility'],
        rows.map((r) => [r.performed_at, r.type, r.duration_min, r.distance_km, r.intensity, r.calories, r.note, r.visibility]),
      );
    } else if (area === 'labs') {
      const rows = state.health_lab_reports
        .filter((r) => r.user_id === targetUser)
        .filter((r) => inRange(r.report_date))
        .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)));
      csv = toCsv(
        ['report_date', 'lab_name', 'note', 'visibility'],
        rows.map((r) => [r.report_date, r.lab_name, r.note, r.visibility]),
      );
    } else if (area === 'meds-logs') {
      const medIds = state.health_medications.filter((m) => m.user_id === targetUser).map((m) => m.id);
      const rows = state.health_medication_logs
        .filter((l) => medIds.includes(l.medication_id))
        .filter((l) => inRange(l.scheduled_at || l.taken_at))
        .sort((a, b) => String(a.scheduled_at || '').localeCompare(String(b.scheduled_at || '')));
      const medName = (id) => state.health_medications.find((m) => m.id === id)?.name || '';
      csv = toCsv(
        ['scheduled_at', 'medication', 'status', 'taken_at', 'dose_qty', 'note'],
        rows.map((r) => [r.scheduled_at, medName(r.medication_id), r.status, r.taken_at, r.dose_qty, r.note]),
      );
    } else if (area === 'cycle') {
      const rows = (state.cycle_periods || [])
        .filter((p) => p.user_id === targetUser)
        .filter((p) => inRange(p.start_date))
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
      csv = toCsv(
        ['start_date', 'end_date', 'note', 'visibility'],
        rows.map((r) => [r.start_date, r.end_date, r.note, r.visibility]),
      );
    } else {
      throw apiError('Not found.', 404);
    }
    const suffix = dateOk.test(from) && dateOk.test(to) ? `-${from}_${to}` : '';
    return {
      __export: {
        body: csv,
        filename: `health-${area}${suffix}.csv`,
        mime: 'text/csv; charset=utf-8',
      },
    };
  }

  return null;
}
