/**
 * IndexedDB persistence for the GitHub Pages / local-only build.
 */

const DB_NAME = 'yuvomi-local';
const STORE_KEY = 'state';
const SESSION_KEY = 'yuvomi-local-session';

let _state = null;
let _db = null;

function openDb() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
  });
  return _db;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function emptyState() {
  return {
    nextId: 1,
    users: [],
    sync_config: {},
    sync_config_user: {},
    task_categories: [],
    tasks: [],
    task_assignments: [],
    task_documents: [],
    shopping_lists: [],
    shopping_items: [],
    shopping_categories: [],
    calendar_events: [],
    event_assignments: [],
    calendar_event_exceptions: [],
    notes: [],
    reminders: [],
    documents: [],
    meals: [],
    recipes: [],
    pantry_items: [],
    pantry_locations: [],
    budget_entries: [],
    budget_categories: [],
    budget_subcategories: [],
    budget_accounts: [],
    budget_loans: [],
    budget_loan_payments: [],
    budget_plans: [],
  };
}

export async function loadState() {
  if (_state) return _state;
  const stored = await idbGet(STORE_KEY);
  _state = stored && typeof stored === 'object' ? stored : emptyState();
  return _state;
}

export async function saveState() {
  if (!_state) return;
  await idbSet(STORE_KEY, _state);
}

export async function resetState(seed) {
  _state = seed;
  await saveState();
}

export function getState() {
  return _state;
}

export function nextId() {
  const id = _state.nextId;
  _state.nextId += 1;
  return id;
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(session) {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

export function cfgGet(key) {
  return _state.sync_config?.[key] ?? null;
}

export function cfgSet(key, value) {
  if (!_state.sync_config) _state.sync_config = {};
  _state.sync_config[key] = value;
}

export function cfgUserGet(key, userId) {
  const row = _state.sync_config_user?.[userId];
  return row ? row[key] ?? null : null;
}

export function cfgUserSet(key, userId, value) {
  if (!_state.sync_config_user) _state.sync_config_user = {};
  if (!_state.sync_config_user[userId]) _state.sync_config_user[userId] = {};
  _state.sync_config_user[userId][key] = value;
}
