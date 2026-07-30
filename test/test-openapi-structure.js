/**
 * OpenAPI structure guard.
 *
 * Sichert die modulare Aufteilung von server/openapi.js: jede
 * server/openapi/paths/<modul>.js muss in paths/index.js importiert und in
 * buildPaths() gespreadet sein, jedes Fragment nicht leer, und kein Pfad-Key
 * darf über zwei Modul-Dateien kollidieren. Verhindert, dass eine kuenftig
 * angelegte Modul-Datei still aus der Spec faellt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildPaths } from '../server/openapi/paths/index.js';
import { buildOpenApiSpec } from '../server/openapi.js';

const pathsDir = new URL('../server/openapi/paths/', import.meta.url);
const indexSrc = readFileSync(new URL('index.js', pathsDir), 'utf8');
const moduleFiles = readdirSync(pathsDir)
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .sort();

async function fragmentOf(file) {
  const mod = await import(new URL(file, pathsDir));
  const fnNames = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
  assert.equal(fnNames.length, 1, `${file} muss genau eine Pfad-Funktion exportieren`);
  return { fn: fnNames[0], frag: mod[fnNames[0]]() };
}

test('es existiert eine plausible Zahl an Modul-Dateien', () => {
  assert.ok(moduleFiles.length >= 20, `unerwartet wenige Modul-Dateien: ${moduleFiles.length}`);
});

test('jede Modul-Datei ist importiert, gespreadet und liefert gueltige Pfade', async () => {
  for (const file of moduleFiles) {
    const { fn, frag } = await fragmentOf(file);
    assert.ok(indexSrc.includes(`from './${file}'`), `${file} wird in paths/index.js nicht importiert`);
    assert.ok(indexSrc.includes(`...${fn}()`), `${fn}() wird in buildPaths() nicht gespreadet`);
    const keys = Object.keys(frag);
    assert.ok(keys.length > 0, `${file} liefert ein leeres Pfad-Fragment`);
    for (const key of keys) {
      assert.ok(key.startsWith('/'), `${file}: ungueltiger Pfad-Key ${key}`);
    }
  }
});

test('keine Pfad-Kollision ueber Modul-Dateien (keine still verlorenen Routen)', async () => {
  let fragTotal = 0;
  const seen = new Set();
  for (const file of moduleFiles) {
    const { frag } = await fragmentOf(file);
    for (const key of Object.keys(frag)) {
      assert.ok(!seen.has(key), `Pfad ${key} kommt in mehreren Modul-Dateien vor`);
      seen.add(key);
      fragTotal += 1;
    }
  }
  const combined = Object.keys(buildPaths()).length;
  assert.equal(combined, fragTotal, 'buildPaths() Pfad-Zahl weicht von der Summe der Fragmente ab');
});

test('buildOpenApiSpec spiegelt buildPaths() vollstaendig', () => {
  const spec = buildOpenApiSpec({}, 'test');
  assert.deepEqual(Object.keys(spec.paths), Object.keys(buildPaths()));
  assert.ok(spec.tags.length > 0, 'tags fehlen in der Spec');
  assert.ok(Object.keys(spec.components.schemas).length > 0, 'schemas fehlen in der Spec');
});
