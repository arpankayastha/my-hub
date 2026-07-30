/**
 * Test: Geburtstags-Lokalisierung im Kalender (Issue #524)
 * Zweck: Geburtstags-Termine werden serverseitig mit einem sprachneutralen Titel
 *        („Birthday: <Name>") gespeichert, weil die Anzeigesprache nur clientseitig
 *        bekannt ist. Damit das Frontend lokalisieren kann, MUSS der Kalender-Read
 *        bei solchen Terminen birthday_name (+ birthday_date) über den LEFT JOIN
 *        auf birthdays mitliefern - und bei Nicht-Geburtstagen NICHT.
 *
 *        Geprüft wird der echte Vertrag über den Birthdays- und Kalender-Router
 *        auf der migrierten DB: POST /birthdays materialisiert via Sync ein
 *        calendar_events-Event; GET /calendar liefert es mit birthday_name zurück.
 *        Zusätzlich: die de-Referenz-Locale trägt beide neuen Keys mit {{name}}.
 * Ausführen: node --experimental-sqlite --test test/test-birthday-localization.js
 */

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';

const dbmod = await import('../server/db.js');
const { default: birthdaysRouter } = await import('../server/routes/birthdays.js');
const { default: calendarRouter } = await import('../server/routes/calendar.js');
const db = dbmod.get();

const USER = db.prepare(
  `INSERT INTO users (username, display_name, password_hash, role) VALUES ('u','U','x','member')`
).run().lastInsertRowid;

const actor = { id: USER, role: 'member' };
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use((req, _res, next) => {
  req.authUserId = actor.id;
  req.authRole = actor.role;
  req.session = { userId: actor.id, role: actor.role };
  next();
});
app.use('/birthdays', birthdaysRouter);
app.use('/calendar', calendarRouter);
const server = app.listen(0);
const baseUrl = await new Promise((r) =>
  server.on('listening', () => r(`http://127.0.0.1:${server.address().port}`)));
test.after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204/leer */ }
  return { status: res.status, body: json };
}

test('GET /calendar liefert birthday_name+birthday_date für Geburtstags-Termine', async () => {
  const created = await call('POST', '/birthdays', { name: 'Lina Müller', birth_date: '1990-05-12' });
  assert.equal(created.status, 201);

  // Serie startet am Geburtsdatum; ein weites Fenster fängt die nächste Instanz.
  const res = await call('GET', '/calendar?from=1990-01-01&to=2100-12-31');
  assert.equal(res.status, 200);

  const bday = res.body.data.find((e) => e.birthday_name);
  assert.ok(bday, 'ein Event trägt birthday_name');
  assert.equal(bday.birthday_name, 'Lina Müller');
  assert.equal(bday.birthday_date, '1990-05-12');
  // Der gespeicherte Titel bleibt sprachneutral (englisch) - Lokalisierung ist Client-Sache.
  assert.equal(bday.title, 'Birthday: Lina Müller');
});

test('Nicht-Geburtstags-Termine tragen KEIN birthday_name-Feld', async () => {
  db.prepare(`
    INSERT INTO calendar_events (title, start_datetime, all_day, created_by, external_source)
    VALUES ('Zahnarzt', '2026-07-20', 1, ?, 'local')
  `).run(USER);

  const res = await call('GET', '/calendar?from=2026-07-01&to=2026-07-31');
  assert.equal(res.status, 200);
  const plain = res.body.data.find((e) => e.title === 'Zahnarzt');
  assert.ok(plain, 'Nicht-Geburtstags-Termin ist enthalten');
  assert.ok(!('birthday_name' in plain), 'kein birthday_name-Schlüssel bei Nicht-Geburtstagen');
});

test('de-Referenz-Locale trägt alle neuen Keys mit {{name}}-Platzhalter', () => {
  const de = JSON.parse(readFileSync(new URL('../public/locales/de.json', import.meta.url)));
  assert.match(de.birthdays.calendarEventTitle, /\{\{name\}\}/);
  assert.match(de.birthdays.calendarEventDescription, /\{\{name\}\}/);
  assert.match(de.birthdays.calendarEventDescription, /\{\{date\}\}/);
  // Fallback ohne Datum: {{name}}, aber kein {{date}} (keine leere Klammer).
  assert.match(de.birthdays.calendarEventDescriptionNoDate, /\{\{name\}\}/);
  assert.doesNotMatch(de.birthdays.calendarEventDescriptionNoDate, /\{\{date\}\}/);
});
