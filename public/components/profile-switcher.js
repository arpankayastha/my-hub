/**
 * Sidebar household profile switcher — admin manages members without re-login.
 */

import { api, auth } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { effectiveUserId } from '/utils/profile-context.js';
import {
  webAuthnAvailable,
  verifyPlatformPasskey,
} from '/utils/webauthn.js';

let _members = [];
let _biometricCredentialId = null;
let _biometricEnabled = false;

export async function loadProfileSwitcherState() {
  try {
    const membersRes = await api.get('/family/members');
    _members = membersRes.data || [];
    const bioRes = await api.get('/auth/biometric');
    _biometricEnabled = bioRes.data?.enabled === true;
    if (_biometricEnabled) {
      _biometricCredentialId = localStorage.getItem('myhub.biometric.credential') || null;
    }
  } catch {
    _members = [];
  }
}

async function fetchBiometricCredentialId() {
  try {
    const res = await api.get('/auth/biometric');
    if (!res.data?.enabled || !res.data?.registered) return null;
    const stored = localStorage.getItem('myhub.biometric.credential');
    return stored || null;
  } catch {
    return null;
  }
}

async function maybeVerifyBiometric() {
  if (!_biometricEnabled) return true;
  const credId = _biometricCredentialId || await fetchBiometricCredentialId();
  if (!credId || !webAuthnAvailable()) return true;
  try {
    await verifyPlatformPasskey(credId);
    return true;
  } catch {
    return false;
  }
}

export function profileSwitcherMarkup(user, { variant = 'sidebar' } = {}) {
  if (!user || user.role !== 'admin' || user.access_scope === 'split_guest') return '';
  const activeId = effectiveUserId({ ...user, acting_as: user.acting_as });
  const options = _members.map((m) => {
    const selected = Number(m.id) === Number(activeId);
    return `<option value="${esc(m.id)}"${selected ? ' selected' : ''}>${esc(m.display_name)}</option>`;
  }).join('');
  const acting = user.acting_as && Number(user.acting_as.id) !== Number(user.id);
  const hint = acting
    ? t('nav.profileActingAs', { name: user.acting_as.display_name })
    : t('nav.profileSwitchHint');
  const variantClass = variant === 'sheet' ? ' nav-profile-switch--sheet' : '';
  const hintId = variant === 'sheet' ? 'more-profile-hint' : 'nav-profile-hint';
  return `
    <div class="nav-profile-switch${variantClass}" data-profile-switch>
      <label class="nav-profile-switch__label" for="${hintId}-select">
        <i data-lucide="users" aria-hidden="true"></i>
        <span>${esc(t('nav.profileSwitch'))}</span>
      </label>
      <select id="${hintId}-select" data-profile-select class="nav-profile-switch__select" aria-describedby="${hintId}">
        ${options}
      </select>
      <p id="${hintId}" class="nav-profile-switch__hint">${esc(hint)}</p>
    </div>`;
}

export function wireProfileSwitcher(container, user, onContextChanged) {
  const root = container.querySelector('[data-profile-switch]');
  const select = root?.querySelector('[data-profile-select]');
  if (!select) return;

  select.addEventListener('change', async () => {
    const prev = String(effectiveUserId({ ...user, acting_as: user.acting_as }));
    const next = select.value;
    if (next === prev) return;
    select.disabled = true;
    try {
      if (!await maybeVerifyBiometric()) {
        select.value = prev;
        return;
      }
      const targetId = Number(next);
      const selfId = Number(user.id);
      const res = await auth.switchContext(targetId === selfId ? null : targetId);
      const merged = { ...res.user, acting_as: res.acting_as ?? null };
      localStorage.setItem('myhub.biometric.credential', _biometricCredentialId || '');
      onContextChanged?.(merged);
    } catch (err) {
      console.error('[Profile] context switch failed:', err);
      select.value = prev;
    } finally {
      select.disabled = false;
    }
  });
}

export function setProfileSwitcherCredentialId(id) {
  _biometricCredentialId = id;
  if (id) localStorage.setItem('myhub.biometric.credential', id);
  else localStorage.removeItem('myhub.biometric.credential');
}

export function setProfileSwitcherBiometric(enabled) {
  _biometricEnabled = enabled;
}
