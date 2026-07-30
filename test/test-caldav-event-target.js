/**
 * Test: CalDAV-Ziel an Events persistieren (Regression Issue #241)
 * Zweck: Stellt sicher, dass POST/PUT auf /calendar die Felder
 *        target_caldav_account_id + target_caldav_calendar_url speichern.
 *        Vor dem Fix wurden sie vom Route-Handler ignoriert -> Auswahl
 *        sprang nach dem Speichern zurück auf "Lokal".
 * Ausführen: node --experimental-sqlite test/test-caldav-event-target.js
 */

// Env vor dem Import der Route setzen (auth.js erwartet SESSION_SECRET,
// db.js initialisiert mit DB_PATH eine In-Memory-DB inkl. aller Migrationen).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Dynamisch importieren, damit die oben gesetzten Env-Vars greifen:
// statische ES-Imports werden gehoistet und würden db.js sonst mit der
// echten DB_PATH initialisieren, bevor die Zuweisungen oben laufen.
const db = await import('../server/db.js');
const { default: calendarRouter } = await import('../server/routes/calendar.js');

describe('CalDAV-Ziel an Events (Issue #241)', () => {
  let server;
  let baseUrl;
  let userId;
  let accountId;
  const calUrl = 'https://caldav.example.com/cal/familie/';

  before(async () => {
    const d = db.get();
    userId = d.prepare(
      `INSERT INTO users (username, display_name, password_hash, role)
       VALUES ('caldav-target-tester', 'Tester', 'x', 'admin')`
    ).run().lastInsertRowid;
    accountId = d.prepare(
      `INSERT INTO caldav_accounts (name, caldav_url, username, password)
       VALUES ('mailbox', 'https://caldav.example.com', 'u', 'p')`
    ).run().lastInsertRowid;

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    // Auth-Middleware aus index.js wird hier durch eine Stub-Injection ersetzt.
    app.use((req, _res, next) => { req.authUserId = userId; req.authRole = 'admin'; next(); });
    app.use('/calendar', calendarRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => { server?.close(); });

  function eventRow(id) {
    return db.get().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
  }

  it('POST /calendar speichert das CalDAV-Ziel', async () => {
    const res = await fetch(`${baseUrl}/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Zahnarzt',
        start_datetime: '2026-06-10T10:00',
        end_datetime: '2026-06-10T11:00',
        target_caldav_account_id: accountId,
        target_caldav_calendar_url: calUrl,
      }),
    });
    assert.strictEqual(res.status, 201, `Status sollte 201 sein, war ${res.status}`);
    const { data } = await res.json();

    const row = eventRow(data.id);
    assert.strictEqual(row.target_caldav_account_id, accountId, 'account_id muss persistiert sein');
    assert.strictEqual(row.target_caldav_calendar_url, calUrl, 'calendar_url muss persistiert sein');
    assert.strictEqual(data.target_caldav_account_id, accountId, 'Response muss account_id enthalten');
    assert.strictEqual(data.target_caldav_calendar_url, calUrl, 'Response muss calendar_url enthalten');
  });

  it('PUT /calendar/:id aktualisiert das CalDAV-Ziel', async () => {
    // Event zunächst ohne Ziel anlegen.
    const id = db.get().prepare(
      `INSERT INTO calendar_events (title, start_datetime, color, created_by)
       VALUES ('Termin', '2026-06-11T09:00', '#007AFF', ?)`
    ).run(userId).lastInsertRowid;

    const res = await fetch(`${baseUrl}/calendar/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_caldav_account_id: accountId,
        target_caldav_calendar_url: calUrl,
      }),
    });
    assert.strictEqual(res.status, 200, `Status sollte 200 sein, war ${res.status}`);

    const row = eventRow(id);
    assert.strictEqual(row.target_caldav_account_id, accountId, 'account_id muss aktualisiert sein');
    assert.strictEqual(row.target_caldav_calendar_url, calUrl, 'calendar_url muss aktualisiert sein');
  });

  it('PUT /calendar/:id kann das CalDAV-Ziel zurück auf Lokal setzen', async () => {
    const id = db.get().prepare(
      `INSERT INTO calendar_events
         (title, start_datetime, color, created_by, target_caldav_account_id, target_caldav_calendar_url)
       VALUES ('Termin2', '2026-06-12T09:00', '#007AFF', ?, ?, ?)`
    ).run(userId, accountId, calUrl).lastInsertRowid;

    const res = await fetch(`${baseUrl}/calendar/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_caldav_account_id: null,
        target_caldav_calendar_url: null,
      }),
    });
    assert.strictEqual(res.status, 200, `Status sollte 200 sein, war ${res.status}`);

    const row = eventRow(id);
    assert.strictEqual(row.target_caldav_account_id, null, 'account_id muss geleert sein');
    assert.strictEqual(row.target_caldav_calendar_url, null, 'calendar_url muss geleert sein');
  });

  it('POST /calendar lehnt ungültige account_id ab', async () => {
    const res = await fetch(`${baseUrl}/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Ungültig',
        start_datetime: '2026-06-13T10:00',
        target_caldav_account_id: 'abc',
        target_caldav_calendar_url: calUrl,
      }),
    });
    assert.strictEqual(res.status, 400, `Status sollte 400 sein, war ${res.status}`);
  });
});
