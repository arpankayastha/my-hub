/**
 * Sidebar household profile switcher — admin manages members without re-login.
 */

import { api, auth } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { effectiveUserId, isActingAsOther } from '/utils/profile-context.js';
import { openModal, closeModal } from '/components/modal.js';
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
      const targetId = Number(next);
      const ok = await switchProfileTo(user, targetId, onContextChanged);
      if (!ok) select.value = prev;
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

/** Compact users icon beside dashboard customize — admin only. */
export function dashboardProfileToolMarkup(user) {
  if (!user || user.role !== 'admin' || user.access_scope === 'split_guest') return '';
  const acting = isActingAsOther(user);
  const activeName = acting ? user.acting_as.display_name : user.display_name;
  return `
    <button type="button" class="dashboard-icon-btn dashboard-icon-btn--profile${acting ? ' dashboard-icon-btn--profile-active' : ''}"
      id="dashboard-profile-btn"
      aria-label="${esc(t('nav.profileSwitch'))}: ${esc(activeName)}"
      title="${esc(acting ? t('nav.profileActingAs', { name: activeName }) : t('nav.profileSwitch'))}">
      <i data-lucide="users" aria-hidden="true"></i>
    </button>`;
}

export function wireDashboardProfileTool(container, user, onContextChanged) {
  const btn = container.querySelector('#dashboard-profile-btn');
  if (!btn || !user) return;
  btn.addEventListener('click', () => openProfilePicker(user, onContextChanged));
}

async function switchProfileTo(user, targetId, onContextChanged) {
  const selfId = Number(user.id);
  if (!await maybeVerifyBiometric()) return false;
  try {
    const res = await auth.switchContext(targetId);
    const merged = { ...res.user, acting_as: res.acting_as ?? null };
    localStorage.setItem('myhub.biometric.credential', _biometricCredentialId || '');
    onContextChanged?.(merged);
    return true;
  } catch (err) {
    console.error('[Profile] context switch failed:', err);
    return false;
  }
}

export async function openProfilePicker(user, onContextChanged) {
  await loadProfileSwitcherState();
  const activeId = effectiveUserId({ ...user, acting_as: user.acting_as });
  const rows = _members.map((m) => {
    const active = Number(m.id) === Number(activeId);
    const dot = esc(m.avatar_color || 'var(--color-accent)');
    return `
      <button type="button" class="profile-picker__item${active ? ' is-active' : ''}"
        data-member-id="${esc(m.id)}">
        <span class="profile-picker__dot" style="background:${dot}" aria-hidden="true"></span>
        <span class="profile-picker__name">${esc(m.display_name)}</span>
        ${active ? '<i data-lucide="check" class="profile-picker__check" aria-hidden="true"></i>' : ''}
      </button>`;
  }).join('');

  openModal({
    title: t('nav.profileSwitch'),
    content: `
      <p class="profile-picker__hint">${esc(t('nav.profileSwitchHint'))}</p>
      <div class="profile-picker" role="listbox" aria-label="${esc(t('nav.profileSwitch'))}">
        ${rows}
      </div>`,
    size: 'sm',
    onSave: (panel) => {
      if (window.lucide) window.lucide.createIcons({ el: panel });
      panel.querySelectorAll('[data-member-id]').forEach((item) => {
        item.addEventListener('click', async () => {
          const id = Number(item.dataset.memberId);
          if (id === activeId) {
            closeModal();
            return;
          }
          item.disabled = true;
          const ok = await switchProfileTo(user, id, (merged) => {
            closeModal();
            onContextChanged?.(merged);
          });
          if (!ok) item.disabled = false;
        });
      });
    },
  });
}
