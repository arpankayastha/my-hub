/**
 * Household relationship roles (users.family_role). Shared between browser and server.
 */

export const FAMILY_ROLES = Object.freeze([
  'dad',
  'mom',
  'parent',
  'child',
  'grandparent',
  'relative',
  'other',
  'spouse',
  'husband',
  'wife',
  'father',
  'mother',
  'son',
  'daughter',
  'sibling',
]);

export function isValidFamilyRole(role) {
  return FAMILY_ROLES.includes(role);
}
