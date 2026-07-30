/**
 * Preferences parsing/validation for the local IndexedDB API (mirrors server/routes/preferences.js).
 */

import { normalizeMobileNavOrder } from '../settings/module-order.js';

export const TOGGLEABLE_MODULES = new Set([
  'tasks', 'calendar', 'meals', 'recipes', 'shopping', 'pantry',
  'birthdays', 'notes', 'contacts', 'budget', 'documents',
  'housekeeping', 'rewards', 'health',
]);

const MODULE_ORDER_RE = /^(dashboard|tasks|calendar|meals|recipes|shopping|pantry|birthdays|notes|contacts|budget|documents|housekeeping|rewards|health|third-party-[a-z0-9][a-z0-9-]{1,62}[a-z0-9])$/;

export function parseDisabledModules(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => typeof m === 'string' && TOGGLEABLE_MODULES.has(m));
  } catch {
    return [];
  }
}

export function parseModuleOrder(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((id) => typeof id === 'string' && MODULE_ORDER_RE.test(id)))];
    }
  } catch {
    if (typeof raw === 'string') {
      return [...new Set(raw.split(',').filter((id) => MODULE_ORDER_RE.test(id)))];
    }
  }
  return [];
}

export function parseMobileNavOrder(raw) {
  if (!raw) return [];
  try {
    return normalizeMobileNavOrder(JSON.parse(raw));
  } catch {
    if (typeof raw === 'string' && raw) {
      return normalizeMobileNavOrder(raw.split(',').filter(Boolean));
    }
  }
  return [];
}

export function normalizeDisabledModulesInput(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((m) => typeof m === 'string' && TOGGLEABLE_MODULES.has(m)))];
}

export function normalizeModuleOrderInput(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((id) => typeof id === 'string' && MODULE_ORDER_RE.test(id)))];
}
