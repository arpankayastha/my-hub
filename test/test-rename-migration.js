/**
 * Test-Suite: Legacy-DB-Migration my-hub.db → myhub.db (Boot-Zeit-Auto-Rename).
 *
 * Deckt den Resolver + die einmalige Dateimigration in server/db.js ab. Jedes
 * Szenario lädt eine frische db.js-Instanz (dynamischer Import mit Cache-Busting-
 * Query), nachdem process.env.DB_PATH gesetzt wurde — denn der effektive Pfad
 * wird beim Modul-Load aus der Env abgeleitet.
 *
 * Lauf: node --experimental-sqlite --test test/test-rename-migration.js
 *   (bzw. npm run test:rename-migration)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

let scenarioCounter = 0;

// Frische db.js-Instanz mit dem gegebenen DB_PATH laden und initialisieren.
async function bootDb(dbPath) {
  if (dbPath === null) {
    delete process.env.DB_PATH;
  } else {
    process.env.DB_PATH = dbPath;
  }
  const mod = await import(`../server/db.js?scenario=${++scenarioCounter}`);
  mod.init();
  return mod;
}

// Eine minimale, gültige SQLite-Datei mit Marker-Zeile als „Legacy-my-hub.db" erzeugen.
function seedLegacyDb(filePath, marker) {
  const seed = new Database(filePath);
  seed.exec('CREATE TABLE rename_marker (note TEXT)');
  seed.prepare('INSERT INTO rename_marker (note) VALUES (?)').run(marker);
  seed.close();
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'my-hub-rename-'));
}

test('Stale Legacy-Sidecars (-wal/-shm) werden nach erfolgreichem Checkpoint entfernt', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'my-hub.db');
  const target = join(dir, 'myhub.db');
  seedLegacyDb(legacy, 'sidecar-cleanup');
  // Verwaiste Sidecars simulieren (z. B. aus einem früheren WAL-Lauf).
  writeFileSync(`${legacy}-wal`, '');
  writeFileSync(`${legacy}-shm`, '');

  const mod = await bootDb(legacy);

  assert.ok(existsSync(target), 'myhub.db muss existieren');
  assert.ok(!existsSync(`${legacy}-wal`), 'Legacy -wal muss entfernt sein');
  assert.ok(!existsSync(`${legacy}-shm`), 'Legacy -shm muss entfernt sein');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'sidecar-cleanup', 'Daten müssen erhalten bleiben');
});

test('Legacy-Default: DB_PATH=…/my-hub.db wird nach myhub.db migriert (Daten erhalten)', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'my-hub.db');
  const target = join(dir, 'myhub.db');
  seedLegacyDb(legacy, 'legacy-default');

  const mod = await bootDb(legacy);

  assert.ok(existsSync(target), 'myhub.db muss nach der Migration existieren');
  assert.ok(!existsSync(legacy), 'my-hub.db darf nach der Migration nicht mehr existieren');
  assert.equal(mod.getPath(), target, 'getPath() muss den neuen Pfad liefern');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'legacy-default', 'Marker-Daten müssen erhalten bleiben');
});

test('Compose-Update-Falle: DB_PATH=…/myhub.db migriert vorhandene my-hub.db trotzdem', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'my-hub.db');
  const target = join(dir, 'myhub.db');
  seedLegacyDb(legacy, 'compose-update');

  // Nutzer hat seine Compose-Datei auf den neuen Default aktualisiert, Daten
  // liegen aber noch in my-hub.db → Migration muss greifen.
  const mod = await bootDb(target);

  assert.ok(existsSync(target), 'myhub.db muss existieren');
  assert.ok(!existsSync(legacy), 'my-hub.db muss migriert worden sein');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'compose-update');
});

test('Custom-Pfad: DB_PATH=…/familie.db wird respektiert, my-hub.db bleibt unangetastet', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'my-hub.db');
  const custom = join(dir, 'familie.db');
  seedLegacyDb(legacy, 'should-stay');

  const mod = await bootDb(custom);

  assert.equal(mod.getPath(), custom, 'Custom-Pfad muss verwendet werden');
  assert.ok(existsSync(custom), 'familie.db muss angelegt sein');
  assert.ok(existsSync(legacy), 'my-hub.db darf NICHT migriert werden (Custom-Layout)');
  // familie.db ist eine frische DB ohne Marker-Tabelle.
  const marker = mod.get()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rename_marker'")
    .get();
  assert.equal(marker, undefined, 'Custom-DB darf die my-hub-Marker-Daten nicht enthalten');
});

test('Doppelzustand: existieren beide, gewinnt myhub.db und my-hub.db bleibt liegen', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'my-hub.db');
  const target = join(dir, 'myhub.db');
  seedLegacyDb(legacy, 'legacy-loser');
  seedLegacyDb(target, 'target-winner');

  const mod = await bootDb(target);

  assert.ok(existsSync(legacy), 'my-hub.db muss im Doppelzustand erhalten bleiben');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'target-winner', 'Die bestehende myhub.db gewinnt');
});

test('Frische Installation: kein Legacy-File → myhub.db wird neu angelegt', async () => {
  const dir = tmpDir();
  const target = join(dir, 'myhub.db');

  const mod = await bootDb(target);

  assert.ok(existsSync(target), 'myhub.db muss frisch angelegt werden');
  assert.ok(!existsSync(join(dir, 'my-hub.db')), 'keine my-hub.db bei frischer Installation');
});

test('Migration ist idempotent: zweiter Boot mit bereits migrierter myhub.db ist ein No-Op', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'my-hub.db');
  const target = join(dir, 'myhub.db');
  seedLegacyDb(legacy, 'idempotent');

  await bootDb(legacy);              // erster Boot migriert
  assert.ok(!existsSync(legacy));

  const mod2 = await bootDb(target); // zweiter Boot: nichts zu migrieren
  const row = mod2.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'idempotent', 'Daten bleiben über mehrere Boots stabil');
});
