/**
 * Modul: Push-Service
 * Zweck: VAPID-Schlüssel auflösen/persistieren und Web-Push-Nachrichten senden.
 * Abhängigkeiten: web-push, server/db.js
 */
import webpushDefault from 'web-push';
import * as dbModule from '../db.js';
import { createLogger } from '../logger.js';

const log = createLogger('Push');

/** Nur der Host des Endpoints - der volle Endpoint enthält ein Geräte-Token. */
function pushHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}

export function createPushService({ db, webpush = webpushDefault } = {}) {
  const getDb = () => (db || dbModule.get());

  function cfgGet(key) {
    const row = getDb().prepare('SELECT value FROM sync_config WHERE key = ?').get(key);
    return row?.value ?? null;
  }
  function cfgSet(key, value) {
    getDb().prepare(`
      INSERT INTO sync_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  function ensureVapid() {
    let pub  = process.env.VAPID_PUBLIC_KEY  || cfgGet('push_vapid_public');
    let priv = process.env.VAPID_PRIVATE_KEY || cfgGet('push_vapid_private');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      cfgSet('push_vapid_public', pub);
      cfgSet('push_vapid_private', priv);
    }
    const fromAddress = cfgGet('email_from_address');
    const subject = process.env.VAPID_SUBJECT
      || (fromAddress ? `mailto:${fromAddress}` : 'mailto:admin@localhost');
    webpush.setVapidDetails(subject, pub, priv);
    return { publicKey: pub, privateKey: priv, subject };
  }

  function getPublicKey() {
    return ensureVapid().publicKey;
  }

  async function sendPushToUser(userId, payload) {
    ensureVapid();
    const subs = getDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    let sent = 0;
    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        getDb().prepare('UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?')
          .run(new Date().toISOString(), sub.id);
        sent += 1;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          getDb().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          log.info(`Removed gone push subscription ${sub.id} (${pushHost(sub.endpoint)})`);
        } else {
          // Statuscode und Body des Push-Dienstes mitloggen - ohne sie ist ein
          // abgelehnter Push (z. B. Apple 403 BadJwtToken) nicht diagnostizierbar.
          const parts = [
            `host=${pushHost(sub.endpoint)}`,
            err?.statusCode ? `status=${err.statusCode}` : null,
            err?.body ? `body=${String(err.body).slice(0, 300)}` : null,
          ].filter(Boolean);
          log.error(`Push send failed (${parts.join(' ')}):`, err?.message || err);
        }
      }
    }
    return sent;
  }

  return { getPublicKey, sendPushToUser, ensureVapid };
}

export const pushService = createPushService();
