/**
 * Local API handlers for birthdays (IndexedDB-backed).
 */

import { saveState, nextId, nowIso } from './store.js';

const BIRTHDAY_COLOR = '#E11D48';
const BIRTHDAY_RRULE = 'FREQ=YEARLY;INTERVAL=1';
const MAX_PHOTO_LENGTH = 6_990_507;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function leapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizedMonthDay(birthDate, year) {
  const [, monthStr, dayStr] = String(birthDate).split('-');
  const month = parseInt(monthStr, 10);
  let day = parseInt(dayStr, 10);
  if (month === 2 && day === 29 && !leapYear(year)) day = 28;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function nextBirthdayDate(birthDate, from = new Date()) {
  const now = from instanceof Date ? from : new Date(from);
  const thisYear = normalizedMonthDay(birthDate, now.getFullYear());
  const today = now.toISOString().slice(0, 10);
  return thisYear >= today
    ? thisYear
    : normalizedMonthDay(birthDate, now.getFullYear() + 1);
}

function nextBirthdayAge(birthDate, from = new Date()) {
  const next = nextBirthdayDate(birthDate, from);
  return parseInt(next.slice(0, 4), 10) - parseInt(String(birthDate).slice(0, 4), 10);
}

function daysUntilBirthday(birthDate, from = new Date()) {
  const now = from instanceof Date ? from : new Date(from);
  const next = nextBirthdayDate(birthDate, now);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const nextUtc = Date.UTC(
    parseInt(next.slice(0, 4), 10),
    parseInt(next.slice(5, 7), 10) - 1,
    parseInt(next.slice(8, 10), 10),
  );
  return Math.round((nextUtc - todayUtc) / 86400000);
}

export function hydrateBirthday(row, from = new Date()) {
  const next_birthday = nextBirthdayDate(row.birth_date, from);
  return {
    ...row,
    next_birthday,
    next_age: nextBirthdayAge(row.birth_date, from),
    days_until: daysUntilBirthday(row.birth_date, from),
  };
}

function sortHydrated(rows, from = new Date()) {
  return rows
    .map((row) => hydrateBirthday(row, from))
    .sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name));
}

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validatePhotoData(val) {
  if (val === undefined) return null;
  if (val === null || val === '') return null;
  const s = String(val).trim();
  if (s.length > MAX_PHOTO_LENGTH) throw apiError('Profile picture is too large.', 400);
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) {
    throw apiError('Profile picture must be a valid image data URL.', 400);
  }
  return s;
}

function getOffsetMinutes(birthday) {
  if (birthday.reminder_offset === 'custom') {
    const amount = parseInt(birthday.reminder_custom_amount, 10) || 1;
    const unit = birthday.reminder_custom_unit || 'days';
    if (unit === 'weeks') return amount * 10080;
    if (unit === 'days') return amount * 1440;
    if (unit === 'hours') return amount * 60;
    return amount;
  }
  return parseInt(birthday.reminder_offset, 10) || 0;
}

function birthdayReminderAt(birthDate, offsetMin = 0, from = new Date()) {
  const next = nextBirthdayDate(birthDate, from);
  const baseTime = new Date(`${next}T12:00:00Z`).getTime();
  return new Date(baseTime - (offsetMin || 0) * 60000).toISOString();
}

function eventTitle(name) {
  return `Birthday: ${name}`;
}

function eventDescription(name, birthDate) {
  return `Birthday reminder for ${name} (${birthDate}).`;
}

function deleteBirthdayArtifacts(state, birthday) {
  if (birthday.calendar_event_id) {
    state.reminders = state.reminders.filter(
      (r) => r.entity_type !== 'event' || r.entity_id !== birthday.calendar_event_id,
    );
    state.calendar_events = state.calendar_events.filter((e) => e.id !== birthday.calendar_event_id);
    birthday.calendar_event_id = null;
  }
}

function syncBirthdayCalendarEvent(state, birthday) {
  if (birthday.reminder_offset === '' || birthday.reminder_offset === null) {
    if (birthday.calendar_event_id) {
      state.calendar_events = state.calendar_events.filter((e) => e.id !== birthday.calendar_event_id);
      birthday.calendar_event_id = null;
    }
    return null;
  }

  const payload = {
    title: eventTitle(birthday.name),
    description: eventDescription(birthday.name, birthday.birth_date),
    start_datetime: birthday.birth_date,
    end_datetime: null,
    all_day: 1,
    location: null,
    color: BIRTHDAY_COLOR,
    icon: 'cake',
    assigned_to: null,
    recurrence_rule: BIRTHDAY_RRULE,
    created_by: birthday.created_by,
    external_source: 'local',
  };

  if (birthday.calendar_event_id) {
    const existing = state.calendar_events.find((e) => e.id === birthday.calendar_event_id);
    if (existing) {
      Object.assign(existing, payload, { updated_at: nowIso() });
      return birthday.calendar_event_id;
    }
  }

  const id = nextId();
  state.calendar_events.push({
    id,
    ...payload,
    notes: null,
    visibility: 'everyone',
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  birthday.calendar_event_id = id;
  return id;
}

function syncBirthdayReminder(state, birthday, from = new Date()) {
  if (!birthday.calendar_event_id) return null;

  if (birthday.reminder_offset === '' || birthday.reminder_offset === null) {
    state.reminders = state.reminders.filter(
      (r) => r.entity_type !== 'event' || r.entity_id !== birthday.calendar_event_id,
    );
    return null;
  }

  const offsetMin = getOffsetMinutes(birthday);
  const desired = birthdayReminderAt(birthday.birth_date, offsetMin, from);
  const existing = state.reminders.filter(
    (r) => r.entity_type === 'event'
      && r.entity_id === birthday.calendar_event_id
      && r.created_by === birthday.created_by,
  );
  const active = existing.find((row) => !row.dismissed);
  if (active && active.remind_at === desired) return active.id;

  state.reminders = state.reminders.filter(
    (r) => r.entity_type !== 'event' || r.entity_id !== birthday.calendar_event_id,
  );
  const id = nextId();
  state.reminders.push({
    id,
    entity_type: 'event',
    entity_id: birthday.calendar_event_id,
    remind_at: desired,
    created_by: birthday.created_by,
    dismissed: 0,
    created_at: nowIso(),
  });
  return id;
}

function syncBirthdayArtifacts(state, birthday, from = new Date()) {
  syncBirthdayCalendarEvent(state, birthday);
  syncBirthdayReminder(state, birthday, from);
  return birthday;
}

export function ensureBirthdaysState(state) {
  if (!Array.isArray(state.birthdays)) state.birthdays = [];
  if (!Array.isArray(state.reminders)) state.reminders = [];
}

/**
 * @returns {object|null}
 */
export async function handleBirthdaysApi(method, parts, query, body, state, userId) {
  ensureBirthdaysState(state);
  const m = method.toUpperCase();
  const now = new Date();

  if (parts[1] === 'import' && parts[2] === 'candidates' && m === 'GET') {
    return { data: { withBirthday: [], withoutBirthday: [] } };
  }

  if (parts[1] === 'import' && m === 'POST') {
    const ids = Array.isArray(body?.contact_ids) ? body.contact_ids : [];
    if (!ids.length) throw apiError('contact_ids must be a non-empty array.', 400);
    return { data: { imported: 0, skipped: ids.length } };
  }

  if (parts[1] === 'upcoming' && m === 'GET') {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 5, 1), 50);
    const rows = sortHydrated(state.birthdays, now);
    return { data: rows.slice(0, limit) };
  }

  if (parts[1] === 'meta' && parts[2] === 'options' && m === 'GET') {
    return {
      data: {
        photoMaxBytes: MAX_PHOTO_LENGTH,
        acceptedImageTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
    };
  }

  if (parts.length === 1 && m === 'GET') {
    let rows = [...state.birthdays];
    if (query.q) {
      const q = String(query.q).trim().toLowerCase();
      rows = rows.filter((b) => b.name.toLowerCase().includes(q));
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { data: sortHydrated(rows, now) };
  }

  if (parts.length === 1 && m === 'POST') {
    const name = String(body?.name || '').trim();
    const birthDate = body?.birth_date;
    if (!name) throw apiError('Name is required.', 400);
    if (!birthDate) throw apiError('Birth date is required.', 400);
    const photoData = body.photo_data !== undefined ? validatePhotoData(body.photo_data) : null;

    const id = nextId();
    const birthday = {
      id,
      name,
      birth_date: birthDate,
      notes: body.notes?.trim() || null,
      photo_data: photoData,
      created_by: userId,
      reminder_offset: body.reminder_offset ?? null,
      reminder_custom_amount: body.reminder_custom_amount ?? null,
      reminder_custom_unit: body.reminder_custom_unit ?? null,
      calendar_event_id: null,
      contact_id: null,
      family_user_id: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.birthdays.push(birthday);
    syncBirthdayArtifacts(state, birthday, now);
    await saveState();
    return { data: hydrateBirthday(birthday, now) };
  }

  const birthdayId = Number(parts[1]);
  if (!birthdayId) return null;

  if (parts.length === 2 && m === 'PUT') {
    const birthday = state.birthdays.find((b) => b.id === birthdayId);
    if (!birthday) throw apiError('Birthday not found.', 404);

    if (body.name !== undefined) birthday.name = String(body.name).trim() || birthday.name;
    if (body.birth_date !== undefined) birthday.birth_date = body.birth_date;
    if (body.notes !== undefined) birthday.notes = body.notes?.trim() || null;
    if (body.photo_data !== undefined) birthday.photo_data = validatePhotoData(body.photo_data);
    if (body.reminder_offset !== undefined) birthday.reminder_offset = body.reminder_offset;
    if (body.reminder_custom_amount !== undefined) birthday.reminder_custom_amount = body.reminder_custom_amount;
    if (body.reminder_custom_unit !== undefined) birthday.reminder_custom_unit = body.reminder_custom_unit;
    birthday.updated_at = nowIso();

    syncBirthdayArtifacts(state, birthday, now);
    await saveState();
    return { data: hydrateBirthday(birthday, now) };
  }

  if (parts.length === 2 && m === 'DELETE') {
    const idx = state.birthdays.findIndex((b) => b.id === birthdayId);
    if (idx === -1) throw apiError('Birthday not found.', 404);
    const birthday = state.birthdays[idx];
    deleteBirthdayArtifacts(state, birthday);
    state.birthdays.splice(idx, 1);
    await saveState();
    return { ok: true };
  }

  return null;
}
