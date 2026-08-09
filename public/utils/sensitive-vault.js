/**
 * Client-side vault for concealing sensitive UI (budget amounts, secret notes).
 * WebAuthn platform auth when available; otherwise a device-local PIN.
 * Budget uses a session-wide unlock; secret notes unlock individually.
 */

import { openModal, closeModal } from '/components/modal.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

const UNLOCK_TS_KEY = 'yuvomi-sensitive-unlock-ts';
const SECRET_NOTES_UNLOCK_KEY = 'yuvomi-secret-notes-unlocked';
const PIN_HASH_KEY = 'yuvomi-sensitive-pin-hash';
const WEBAUTHN_ID_KEY = 'yuvomi-sensitive-webauthn-id';
const UNLOCK_TTL_MS = 15 * 60 * 1000;

function showToast(message, type) {
  window.myHub?.showToast?.(message, type) ?? window.yuvomi?.showToast?.(message, type);
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuffer(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 ? '='.repeat(4 - base64.length % 4) : '';
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashPin(pin) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return bufferToBase64url(hash);
}

export function isSensitiveUnlocked() {
  const raw = sessionStorage.getItem(UNLOCK_TS_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts) || Date.now() - ts > UNLOCK_TTL_MS) {
    sessionStorage.removeItem(UNLOCK_TS_KEY);
    return false;
  }
  return true;
}

export function lockSensitive() {
  sessionStorage.removeItem(UNLOCK_TS_KEY);
}

export function markSensitiveUnlocked() {
  sessionStorage.setItem(UNLOCK_TS_KEY, String(Date.now()));
}

function readSecretNoteUnlocks() {
  try {
    const raw = sessionStorage.getItem(SECRET_NOTES_UNLOCK_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw);
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

function writeSecretNoteUnlocks(map) {
  sessionStorage.setItem(SECRET_NOTES_UNLOCK_KEY, JSON.stringify(map));
}

function pruneExpiredSecretUnlocks(map) {
  const now = Date.now();
  for (const [id, ts] of Object.entries(map)) {
    if (!Number.isFinite(ts) || now - ts > UNLOCK_TTL_MS) delete map[id];
  }
  return map;
}

export function isSecretNoteUnlocked(noteId) {
  const map = pruneExpiredSecretUnlocks(readSecretNoteUnlocks());
  writeSecretNoteUnlocks(map);
  return map[String(noteId)] != null;
}

export function hasUnlockedSecretNotes() {
  const map = pruneExpiredSecretUnlocks(readSecretNoteUnlocks());
  writeSecretNoteUnlocks(map);
  return Object.keys(map).length > 0;
}

export function lockAllSecretNotes() {
  sessionStorage.removeItem(SECRET_NOTES_UNLOCK_KEY);
}

export function concealText(text = '') {
  if (!text) return '••••';
  return '•'.repeat(Math.min(8, Math.max(4, text.length)));
}

export function hasVaultPin() {
  return Boolean(localStorage.getItem(PIN_HASH_KEY));
}

export function hasWebAuthnCredential() {
  return Boolean(localStorage.getItem(WEBAUTHN_ID_KEY));
}

export async function isPlatformAuthAvailable() {
  if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function registerWebAuthn() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'My Hub' },
      user: {
        id: userId,
        name: 'vault',
        displayName: 'Sensitive vault',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60000,
    },
  });
  if (!credential?.rawId) return false;
  localStorage.setItem(WEBAUTHN_ID_KEY, bufferToBase64url(credential.rawId));
  return true;
}

async function unlockWithWebAuthn() {
  const id = localStorage.getItem(WEBAUTHN_ID_KEY);
  if (!id || !window.PublicKeyCredential) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: base64urlToBuffer(id), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return true;
  } catch {
    return false;
  }
}

function pinModal({ mode, title, detail }) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      closeModal({ force: true });
      resolve(value);
    };

    const isSetup = mode === 'setup';
    openModal({
      title,
      size: 'sm',
      content: `
        ${detail ? `<p class="modal-confirm__detail">${esc(detail)}</p>` : ''}
        <form id="vault-pin-form" class="form-stack">
          <div class="form-field">
            <label class="form-label" for="vault-pin">${t('sensitive.pinLabel')}</label>
            <input class="form-input" id="vault-pin" type="password" inputmode="numeric"
                   pattern="[0-9]*" autocomplete="off" maxlength="8"
                   placeholder="${esc(t('sensitive.pinPlaceholder'))}">
          </div>
          ${isSetup ? `
          <div class="form-field">
            <label class="form-label" for="vault-pin-confirm">${t('sensitive.pinConfirmLabel')}</label>
            <input class="form-input" id="vault-pin-confirm" type="password" inputmode="numeric"
                   pattern="[0-9]*" autocomplete="off" maxlength="8">
          </div>` : ''}
          <div class="modal-choice-list">
            <button type="submit" class="btn btn--primary modal-choice-list__item">${t('sensitive.unlockAction')}</button>
            <button type="button" class="btn btn--ghost modal-choice-list__item" id="vault-pin-cancel">${t('common.cancel')}</button>
          </div>
        </form>`,
      onClose: () => finish(false),
      onSave(panel) {
        const form = panel.querySelector('#vault-pin-form');
        const pinInput = panel.querySelector('#vault-pin');
        const confirmInput = panel.querySelector('#vault-pin-confirm');
        panel.querySelector('#vault-pin-cancel')?.addEventListener('click', () => finish(false));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const pin = pinInput.value.trim();
          if (!/^\d{4,8}$/.test(pin)) {
            showToast(t('sensitive.pinInvalid'), 'danger');
            return;
          }
          if (isSetup) {
            const confirm = confirmInput?.value?.trim() ?? '';
            if (pin !== confirm) {
              showToast(t('sensitive.pinMismatch'), 'danger');
              return;
            }
            localStorage.setItem(PIN_HASH_KEY, await hashPin(pin));
            finish(true);
            return;
          }
          const stored = localStorage.getItem(PIN_HASH_KEY);
          if (!stored || stored !== await hashPin(pin)) {
            showToast(t('sensitive.unlockFailed'), 'danger');
            return;
          }
          finish(true);
        });
        setTimeout(() => pinInput?.focus(), 50);
      },
    });
  });
}

/**
 * Verifies PIN/fingerprint without granting global or per-note unlock.
 * @returns {Promise<boolean>}
 */
async function verifyVaultAccess({ detail } = {}) {
  const platform = await isPlatformAuthAvailable();

  if (!hasVaultPin() && !hasWebAuthnCredential()) {
    const setupOk = await pinModal({
      mode: 'setup',
      title: t('sensitive.setupPinTitle'),
      detail: t('sensitive.setupPinDetail'),
    });
    if (!setupOk) return false;
    if (platform) {
      try { await registerWebAuthn(); } catch { /* PIN still works */ }
    }
    return true;
  }

  if (hasWebAuthnCredential() && platform) {
    const ok = await unlockWithWebAuthn();
    if (ok) return true;
  }

  if (hasVaultPin()) {
    return await pinModal({
      mode: 'unlock',
      title: t('sensitive.unlockTitle'),
      detail: detail ?? t('sensitive.unlockDetail'),
    });
  }

  return false;
}

/**
 * Budget-wide unlock (masked amounts).
 * @returns {Promise<boolean>}
 */
export async function ensureSensitiveUnlocked() {
  if (isSensitiveUnlocked()) return true;
  const ok = await verifyVaultAccess();
  if (ok) markSensitiveUnlocked();
  return ok;
}

/**
 * Unlock a single secret note (does not reveal other secret notes).
 * @returns {Promise<boolean>}
 */
export async function unlockSecretNote(noteId) {
  if (isSecretNoteUnlocked(noteId)) return true;
  const ok = await verifyVaultAccess({ detail: t('sensitive.unlockNoteDetail') });
  if (!ok) return false;
  const map = pruneExpiredSecretUnlocks(readSecretNoteUnlocks());
  map[String(noteId)] = Date.now();
  writeSecretNoteUnlocks(map);
  return true;
}
