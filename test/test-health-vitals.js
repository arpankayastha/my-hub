/**
 * Modul: Vitalwerte-Aggregation-Test
 * Zweck: Reine Funktion computeVitalSeries() + buildVitalBuckets() —
 *        Zeitraum-Bucketing (week/month/year), Aggregation (Mittelwert je
 *        Bucket), Kennzahlen (letzter Wert + Delta zum Vorwert) und
 *        Typ-/Zeitraum-Filter. DOM-frei.
 * Ausführen: node --loader ./test/test-browser-loader.mjs --test test/test-health-vitals.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  computeVitalSeries,
  buildVitalBuckets,
  vitalMetric,
  VITAL_TYPES,
  VITAL_METRICS,
} = await import('../public/utils/health-vitals.js');

// --------------------------------------------------------
// Metrik-Definitionen
// --------------------------------------------------------

test('VITAL_TYPES enthält alle fünf Metriken', () => {
  assert.deepEqual(VITAL_TYPES, ['bp', 'glucose', 'weight', 'spo2', 'temp']);
  assert.equal(VITAL_METRICS.length, 5);
});

test('Blutdruck belegt drei Kanäle, übrige Metriken einen', () => {
  assert.deepEqual(vitalMetric('bp').channels, ['value_num', 'value_num2', 'value_num3']);
  assert.deepEqual(vitalMetric('weight').channels, ['value_num']);
  assert.equal(vitalMetric('unknown'), null);
});

// --------------------------------------------------------
// buildVitalBuckets
// --------------------------------------------------------

test('week → 7 Tages-Buckets, from ≤ to', () => {
  const { buckets, from, to, gran } = buildVitalBuckets('week', '2026-06-15');
  assert.equal(buckets.length, 7);
  assert.equal(gran, 'day');
  assert.ok(from <= to);
  assert.equal(buckets[0].date, from);
  assert.equal(buckets[6].date, to);
});

test('month → ein Bucket je Kalendertag (Schaltjahr-korrekt)', () => {
  assert.equal(buildVitalBuckets('month', '2026-06-15').buckets.length, 30); // Juni
  assert.equal(buildVitalBuckets('month', '2026-02-10').buckets.length, 28); // Feb 2026
  assert.equal(buildVitalBuckets('month', '2024-02-10').buckets.length, 29); // Feb 2024 (Schaltjahr)
});

test('year → 12 Monats-Buckets', () => {
  const { buckets, from, to, gran } = buildVitalBuckets('year', '2026-06-15');
  assert.equal(buckets.length, 12);
  assert.equal(gran, 'month');
  assert.equal(buckets[0].key, '2026-01');
  assert.equal(buckets[11].key, '2026-12');
  assert.equal(from, '2026-01-01');
  assert.equal(to, '2026-12-31');
});

// --------------------------------------------------------
// computeVitalSeries — leer / Filter
// --------------------------------------------------------

test('leere Rohdaten → keine Serie, keine Kennzahlen', () => {
  const s = computeVitalSeries([], { type: 'weight', range: 'month', anchor: '2026-06-15' });
  assert.equal(s.hasData, false);
  assert.equal(s.latest, null);
  assert.equal(s.previous, null);
  assert.equal(s.deltas.value_num, null);
  assert.equal(s.points.length, 30);
  assert.ok(s.points.every((p) => p.count === 0 && p.value_num === null));
});

test('fremde Typen werden ignoriert', () => {
  const rows = [
    { id: 1, type: 'glucose', value_num: 95, measured_at: '2026-06-10T08:00' },
    { id: 2, type: 'weight', value_num: 70, measured_at: '2026-06-10T08:00' },
  ];
  const s = computeVitalSeries(rows, { type: 'weight', range: 'month', anchor: '2026-06-15' });
  assert.equal(s.hasData, true);
  assert.equal(s.latest.value_num, 70);
});

// --------------------------------------------------------
// Aggregation (Mittelwert je Bucket)
// --------------------------------------------------------

test('Tages-Bucket mittelt mehrere Messungen desselben Tages', () => {
  const rows = [
    { id: 1, type: 'weight', value_num: 70, measured_at: '2026-06-01T08:00' },
    { id: 2, type: 'weight', value_num: 72, measured_at: '2026-06-01T20:00' },
    { id: 3, type: 'weight', value_num: 69, measured_at: '2026-06-10T08:00' },
  ];
  const s = computeVitalSeries(rows, { type: 'weight', range: 'month', anchor: '2026-06-15' });
  const day1 = s.points.find((p) => p.key === '2026-06-01');
  const day10 = s.points.find((p) => p.key === '2026-06-10');
  assert.equal(day1.count, 2);
  assert.equal(day1.value_num, 71); // (70 + 72) / 2
  assert.equal(day10.count, 1);
  assert.equal(day10.value_num, 69);
});

test('year → Monats-Buckets mitteln über den Monat', () => {
  const rows = [
    { id: 1, type: 'weight', value_num: 70, measured_at: '2026-06-01T08:00' },
    { id: 2, type: 'weight', value_num: 72, measured_at: '2026-06-01T20:00' },
    { id: 3, type: 'weight', value_num: 69, measured_at: '2026-06-10T08:00' },
    { id: 4, type: 'weight', value_num: 80, measured_at: '2026-05-20T08:00' },
  ];
  const s = computeVitalSeries(rows, { type: 'weight', range: 'year', anchor: '2026-06-15' });
  const june = s.points.find((p) => p.key === '2026-06');
  const may = s.points.find((p) => p.key === '2026-05');
  assert.equal(june.count, 3);
  assert.ok(Math.abs(june.value_num - (70 + 72 + 69) / 3) < 1e-9);
  assert.equal(may.count, 1);
  assert.equal(may.value_num, 80);
});

// --------------------------------------------------------
// Kennzahlen: letzter Wert + Delta zum Vorwert
// --------------------------------------------------------

test('Delta = jüngste Messung minus Vormessung, je Kanal (Blutdruck)', () => {
  const rows = [
    { id: 1, type: 'bp', value_num: 120, value_num2: 80, value_num3: 60, measured_at: '2026-06-05T08:00' },
    { id: 2, type: 'bp', value_num: 130, value_num2: 85, value_num3: 62, measured_at: '2026-06-06T08:00' },
  ];
  const s = computeVitalSeries(rows, { type: 'bp', range: 'month', anchor: '2026-06-15' });
  assert.equal(s.latest.id, 2);
  assert.equal(s.previous.id, 1);
  assert.equal(s.deltas.value_num, 10);
  assert.equal(s.deltas.value_num2, 5);
  assert.equal(s.deltas.value_num3, 2);
});

test('Delta ist zeitraum-unabhängig — Vorwert außerhalb des Zeitraums zählt', () => {
  const rows = [
    { id: 1, type: 'weight', value_num: 80, measured_at: '2026-05-20T08:00' }, // Mai, außerhalb Juni
    { id: 2, type: 'weight', value_num: 78, measured_at: '2026-06-10T08:00' }, // Juni
  ];
  const s = computeVitalSeries(rows, { type: 'weight', range: 'month', anchor: '2026-06-15' });
  // Serie (Juni) enthält nur die Juni-Messung ...
  assert.equal(s.points.find((p) => p.key === '2026-06-10').value_num, 78);
  assert.ok(s.points.every((p) => p.key === '2026-06-10' || p.count === 0));
  // ... das Delta bezieht dennoch den Mai-Vorwert ein.
  assert.equal(s.latest.value_num, 78);
  assert.equal(s.previous.value_num, 80);
  assert.equal(s.deltas.value_num, -2);
});

test('einzelne Messung → letzter Wert, aber kein Delta', () => {
  const rows = [{ id: 1, type: 'glucose', value_num: 95, measured_at: '2026-06-10T08:00' }];
  const s = computeVitalSeries(rows, { type: 'glucose', range: 'week', anchor: '2026-06-10' });
  assert.equal(s.latest.value_num, 95);
  assert.equal(s.previous, null);
  assert.equal(s.deltas.value_num, null);
});
