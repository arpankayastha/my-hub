/**
 * Local API handlers for permissions admin UI (IndexedDB-backed).
 */

import { saveState } from './store.js';
import { publicUser } from './seed.js';

import { FAMILY_ROLES, isValidFamilyRole } from '../utils/family-roles.js';

const PERMISSION_MODULES = [
  { key: 'calendar', labelKey: 'nav.calendar', icon: 'calendar' },
  { key: 'tasks', labelKey: 'nav.tasks', icon: 'check-square' },
  { key: 'notes', labelKey: 'nav.notes', icon: 'sticky-note' },
  { key: 'contacts', labelKey: 'nav.contacts', icon: 'book-user' },
  { key: 'meals', labelKey: 'nav.kitchen', icon: 'utensils' },
  { key: 'shopping', labelKey: 'nav.shopping', icon: 'shopping-cart' },
  { key: 'pantry', labelKey: 'nav.pantry', icon: 'archive' },
  { key: 'budget', labelKey: 'nav.budget', icon: 'wallet' },
  { key: 'documents', labelKey: 'nav.documents', icon: 'folder-lock' },
  { key: 'housekeeping', labelKey: 'nav.housekeeping', icon: 'paintbrush' },
  { key: 'rewards', labelKey: 'nav.rewards', icon: 'award' },
  { key: 'health', labelKey: 'nav.health', icon: 'heart-pulse' },
];

const PERMISSION_WIDGETS = [
  { id: 'tasks', module: 'tasks' },
  { id: 'calendar', module: 'calendar' },
  { id: 'meals', module: 'meals' },
  { id: 'shopping', module: 'shopping' },
  { id: 'birthdays', module: 'calendar' },
  { id: 'budget', module: 'budget' },
  { id: 'rewards', module: 'rewards' },
  { id: 'health', module: 'health' },
  { id: 'cycle', module: 'health' },
  { id: 'housekeeping', module: 'housekeeping' },
  { id: 'notes', module: 'notes' },
  { id: 'family', module: null },
  { id: 'weather', module: null },
];

const MODULE_KEY_SET = new Set(PERMISSION_MODULES.map((m) => m.key));
const WIDGET_ID_SET = new Set(PERMISSION_WIDGETS.map((w) => w.id));
const MODULE_DEFAULT = 'write';
const WIDGET_DEFAULT = 'allow';

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function ensurePermissionsState(state) {
  if (!Array.isArray(state.access_permissions)) state.access_permissions = [];
}

function permissionCatalog() {
  return {
    modules: PERMISSION_MODULES.map((m) => ({ key: m.key, labelKey: m.labelKey, icon: m.icon })),
    widgets: PERMISSION_WIDGETS.map((w) => ({ id: w.id, module: w.module })),
    roles: [...FAMILY_ROLES],
    moduleAccessLevels: ['none', 'read', 'write'],
    widgetAccessLevels: ['none', 'allow'],
    defaults: { module: MODULE_DEFAULT, widget: WIDGET_DEFAULT },
  };
}

function loadSubjectRows(state, subjectType, subjectId) {
  const sid = String(subjectId);
  return state.access_permissions.filter(
    (r) => r.subject_type === subjectType && r.subject_id === sid,
  );
}

function getSubjectPermissions(state, subjectType, subjectId) {
  const rows = loadSubjectRows(state, subjectType, subjectId);
  const modules = {};
  const widgets = {};
  for (const r of rows) {
    if (r.resource_type === 'module' && MODULE_KEY_SET.has(r.resource_key)) {
      modules[r.resource_key] = r.access;
    } else if (r.resource_type === 'widget' && WIDGET_ID_SET.has(r.resource_key)) {
      widgets[r.resource_key] = r.access;
    }
  }
  return { modules, widgets };
}

function normalizePermissionInput({ modules = {}, widgets = {} } = {}) {
  const rows = [];
  for (const [key, access] of Object.entries(modules || {})) {
    if (!MODULE_KEY_SET.has(key)) throw apiError(`Unknown module: ${key}`, 400);
    if (!['none', 'read', 'write'].includes(access)) throw apiError(`Invalid module access: ${access}`, 400);
    if (access === MODULE_DEFAULT) continue;
    rows.push({ resource_type: 'module', resource_key: key, access });
  }
  for (const [id, access] of Object.entries(widgets || {})) {
    if (!WIDGET_ID_SET.has(id)) throw apiError(`Unknown widget: ${id}`, 400);
    if (!['none', 'allow'].includes(access)) throw apiError(`Invalid widget access: ${access}`, 400);
    if (access === WIDGET_DEFAULT) continue;
    rows.push({ resource_type: 'widget', resource_key: id, access });
  }
  return rows;
}

function replaceSubjectPermissions(state, subjectType, subjectId, input) {
  const sid = String(subjectId);
  const rows = normalizePermissionInput(input);
  state.access_permissions = state.access_permissions.filter(
    (r) => r.subject_type !== subjectType || r.subject_id !== sid,
  );
  for (const r of rows) {
    state.access_permissions.push({
      subject_type: subjectType,
      subject_id: sid,
      resource_type: r.resource_type,
      resource_key: r.resource_key,
      access: r.access,
    });
  }
  return getSubjectPermissions(state, subjectType, subjectId);
}

function requireAdmin(findUser, userId) {
  const user = findUser(userId);
  if (!user || user.role !== 'admin') throw apiError('Admin access required.', 403);
}

export async function handlePermissionsApi(m, parts, body, state, userId, findUser) {
  if (parts[0] !== 'permissions') return null;

  requireAdmin(findUser, userId);
  ensurePermissionsState(state);

  if (parts[1] === 'catalog' && parts.length === 2 && m === 'GET') {
    const members = state.users.map((u) => publicUser({
      ...u,
      access_scope: u.access_scope ?? 'family',
    }));
    return { data: { ...permissionCatalog(), members } };
  }

  if (parts[1] === 'role' && parts[2] && parts.length === 3) {
    const familyRole = String(parts[2]);
    if (!isValidFamilyRole(familyRole)) throw apiError('Invalid family role.', 400);
    if (m === 'GET') return { data: getSubjectPermissions(state, 'role', familyRole) };
    if (m === 'PUT') {
      const data = replaceSubjectPermissions(state, 'role', familyRole, body);
      await saveState();
      return { data };
    }
  }

  if (parts[1] === 'user' && parts[2] && parts.length === 3) {
    const targetId = Number(parts[2]);
    if (!Number.isFinite(targetId)) throw apiError('Invalid user ID.', 400);
    const target = findUser(targetId);
    if (!target) throw apiError('User not found.', 404);
    if (m === 'GET') return { data: getSubjectPermissions(state, 'user', targetId) };
    if (m === 'PUT') {
      if (target.role === 'admin') {
        throw apiError('Administrators always have full access; per-member restrictions do not apply.', 400);
      }
      const data = replaceSubjectPermissions(state, 'user', targetId, body);
      await saveState();
      return { data };
    }
  }

  return null;
}
