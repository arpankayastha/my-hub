/**
 * Local API handlers for notification channels (IndexedDB-backed).
 * Delivery to Gotify/ntfy is not available in the browser-only build.
 */

import { nextId, nowIso, saveState } from './store.js';

const PROVIDERS = [
  { id: 'gotify', name: 'Gotify' },
  { id: 'ntfy', name: 'ntfy' },
];

function requireAdmin(findUser, userId) {
  const user = findUser(userId);
  if (!user || user.role !== 'admin') throw Object.assign(new Error('Admin access required.'), { status: 403 });
}

function publicChannel(channel) {
  if (!channel) return null;
  const secrets = channel.secrets || {};
  const { secrets: _s, ...safe } = channel;
  void _s;
  safe.secretSet = Object.values(secrets).some((v) => String(v ?? '') !== '');
  return safe;
}

function listChannels(state) {
  return (state.notification_channels || []).map((c) => publicChannel(c));
}

function findChannel(state, id) {
  return (state.notification_channels || []).find((c) => c.id === id) ?? null;
}

function normalizeInput(body, existing = null) {
  const provider = String(body.provider ?? existing?.provider ?? 'gotify').trim().toLowerCase();
  const config = { ...(existing?.config || {}), ...(body.config || {}) };
  const secrets = { ...(existing?.secrets || {}), ...(body.secrets || {}) };
  return {
    provider,
    name: String(body.name ?? existing?.name ?? '').trim(),
    enabled: body.enabled === undefined ? Boolean(existing?.enabled) : Boolean(body.enabled),
    scope: 'household',
    userId: null,
    config,
    secrets,
  };
}

export async function handleNotificationsApi(m, parts, body, state, userId, findUser) {
  if (parts[0] !== 'notifications') return null;

  requireAdmin(findUser, userId);

  if (!state.notification_channels) state.notification_channels = [];

  if (parts[1] === 'providers' && parts.length === 2 && m === 'GET') {
    return { data: PROVIDERS };
  }

  if (parts[1] === 'channels' && parts.length === 2) {
    if (m === 'GET') return { data: listChannels(state) };
    if (m === 'POST') {
      const normalized = normalizeInput(body);
      if (!normalized.name) throw Object.assign(new Error('Notification channel name is required.'), { status: 400 });
      const now = nowIso();
      const channel = {
        id: nextId(),
        ...normalized,
        lastTestAt: null,
        lastSuccessAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      state.notification_channels.push(channel);
      await saveState();
      return { data: publicChannel(channel) };
    }
  }

  if (parts[1] === 'channels' && parts[2]) {
    const id = Number(parts[2]);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid channel id.'), { status: 400 });
    const existing = findChannel(state, id);
    if (!existing) throw Object.assign(new Error('Notification channel not found.'), { status: 404 });

    if (parts.length === 3) {
      if (m === 'PUT') {
        const normalized = normalizeInput(body, existing);
        if (!normalized.name) throw Object.assign(new Error('Notification channel name is required.'), { status: 400 });
        Object.assign(existing, normalized, { updatedAt: nowIso() });
        await saveState();
        return { data: publicChannel(existing) };
      }
      if (m === 'DELETE') {
        state.notification_channels = state.notification_channels.filter((c) => c.id !== id);
        await saveState();
        return { ok: true };
      }
    }

    if (parts[3] === 'test' && parts.length === 4 && m === 'POST') {
      existing.lastTestAt = nowIso();
      existing.lastError = 'Delivery is not available in the browser-only build.';
      existing.updatedAt = nowIso();
      await saveState();
      return { data: { sent: false, localOnly: true } };
    }
  }

  return null;
}
