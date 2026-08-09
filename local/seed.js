/**
 * Default seed data for a fresh local database.
 */

import { emptyState } from './store.js';
import { ensureBudgetState } from './budget-handlers.js';

const DEFAULT_CATEGORIES = [
  { key: 'misc', name: 'Misc', label_key: 'tasks.category.misc', sort_order: 0 },
  { key: 'home', name: 'Home', label_key: 'tasks.category.home', sort_order: 1 },
  { key: 'work', name: 'Work', label_key: 'tasks.category.work', sort_order: 2 },
];

export function createSeedState() {
  const state = emptyState();
  state.task_categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  state.sync_config = {
    visible_meal_types: 'breakfast,lunch,dinner,snack',
    currency: 'EUR',
    date_format: 'dmy',
    time_format: '24h',
    week_start: 'monday',
    app_name: 'My Hub',
    dashboard_widgets: '[]',
    disabled_modules: '[]',
    module_order: '',
    budget_mode: 'shared',
    calendar_default_duration: '60',
    health_cycle_enabled: '1',
    rewards_require_approval: '1',
    tasks_default_points: '0',
  };
  state.shopping_categories = [
    { id: 1, name: 'Produce', sort_order: 0 },
    { id: 2, name: 'Dairy', sort_order: 1 },
    { id: 3, name: 'Other', sort_order: 2 },
  ];
  ensureBudgetState(state);
  state.nextId = 10;
  return state;
}

export const AVATAR_COLORS = ['#2563eb', '#0f766e', '#059669', '#d97706', '#dc2626', '#db2777'];

export function hashPasswordSimple(password) {
  let h = 0;
  for (let i = 0; i < password.length; i++) h = (Math.imul(31, h) + password.charCodeAt(i)) | 0;
  return `local:${h}`;
}

export function verifyPasswordSimple(password, hash) {
  return hashPasswordSimple(password) === hash;
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    avatar_data: row.avatar_data ?? null,
    role: row.role,
    family_role: row.family_role ?? null,
    access_scope: row.access_scope ?? 'family',
    phone: row.phone ?? null,
    email: row.email ?? null,
    birth_date: row.birth_date ?? null,
    created_at: row.created_at,
  };
}

export function adminPermissions() {
  return { admin: true, modules: {}, widgets: {} };
}
