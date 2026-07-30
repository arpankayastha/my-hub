/**
 * Modul: Vitalwerte-Aggregation (Health)
 * Zweck: Reine, DOM-freie Logik für den Vitalwerte-Tab — Metrik-Definitionen
 *        plus die testbare Kernfunktion computeVitalSeries(), die Rohmessungen
 *        in ein zeitraum-gebucketetes Trend-Serien-Objekt (fürs SVG-Chart) und
 *        Kennzahlen (letzter Wert + Delta zum Vorwert, fürs Karten-Grid)
 *        überführt.
 * Abhängigkeiten: /utils/date.js (ebenfalls DOM-frei) — bewusst KEINE i18n/DOM,
 *        damit die Funktion in Node ohne Browser-Umgebung getestet werden kann.
 */

import {
  toLocalDateKey,
  parseLocalDateKey,
  addLocalDays,
  startOfLocalWeekKey,
} from '/utils/date.js';

// --------------------------------------------------------
// Metrik-Definitionen
// --------------------------------------------------------
// `channels` beschreibt die genutzten numerischen Kanäle (value_num,
// value_num2, value_num3). Blutdruck belegt drei (Systole/Diastole/Puls),
// alle übrigen Metriken genau einen. `units` listet die im Erfassungs-Dialog
// wählbaren Einheiten; die erste ist der Default.
export const VITAL_METRICS = Object.freeze([
  {
    type: 'bp',
    icon: 'heart-pulse',
    labelKey: 'health.vitals.metric.bp',
    channels: ['value_num', 'value_num2', 'value_num3'],
    channelLabelKeys: [
      'health.vitals.channel.systolic',
      'health.vitals.channel.diastolic',
      'health.vitals.channel.pulse',
    ],
    units: ['mmHg'],
  },
  {
    type: 'glucose',
    icon: 'droplet',
    labelKey: 'health.vitals.metric.glucose',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.glucose'],
    units: ['mg/dL', 'mmol/L'],
  },
  {
    type: 'weight',
    icon: 'scale',
    labelKey: 'health.vitals.metric.weight',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.weight'],
    units: ['kg', 'lb'],
  },
  {
    type: 'spo2',
    icon: 'activity',
    labelKey: 'health.vitals.metric.spo2',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.spo2'],
    units: ['%'],
  },
  {
    type: 'temp',
    icon: 'thermometer',
    labelKey: 'health.vitals.metric.temp',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.temp'],
    units: ['°C', '°F'],
  },
]);

export const VITAL_TYPES = Object.freeze(VITAL_METRICS.map((m) => m.type));

export function vitalMetric(type) {
  return VITAL_METRICS.find((m) => m.type === type) || null;
}

const CHANNEL_KEYS = ['value_num', 'value_num2', 'value_num3'];

/** Datums-Anteil (YYYY-MM-DD) eines measured_at-Zeitstempels ohne UTC-Shift. */
function dateKeyOf(measuredAt) {
  return String(measuredAt).slice(0, 10);
}

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Baut die Bucket-Achse für einen Zeitraum.
 * - week:  7 Tages-Buckets ab Wochenanfang (weekStartsOn, Default Montag=1)
 * - month: ein Tages-Bucket je Kalendertag des Anker-Monats
 * - year:  12 Monats-Buckets (Jan–Dez) des Anker-Jahres
 * @returns {{ buckets: Array<{key,date,gran}>, from: string, to: string, gran: string }}
 */
export function buildVitalBuckets(range, anchorKey, weekStartsOn = 1) {
  const anchor = anchorKey || toLocalDateKey(new Date());

  if (range === 'year') {
    const year = parseLocalDateKey(anchor).getFullYear();
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      const first = toLocalDateKey(new Date(year, m, 1));
      buckets.push({ key: first.slice(0, 7), date: first, gran: 'month' });
    }
    return { buckets, from: buckets[0].date, to: toLocalDateKey(new Date(year, 11, 31)), gran: 'month' };
  }

  if (range === 'week') {
    const start = startOfLocalWeekKey(anchor, weekStartsOn);
    const buckets = [];
    for (let i = 0; i < 7; i++) {
      const d = addLocalDays(start, i);
      buckets.push({ key: d, date: d, gran: 'day' });
    }
    return { buckets, from: start, to: buckets[6].date, gran: 'day' };
  }

  // month (Default)
  const d = parseLocalDateKey(anchor);
  const year = d.getFullYear();
  const month = d.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const buckets = [];
  for (let i = 1; i <= days; i++) {
    const key = toLocalDateKey(new Date(year, month, i));
    buckets.push({ key, date: key, gran: 'day' });
  }
  return { buckets, from: buckets[0].date, to: buckets[days - 1].date, gran: 'day' };
}

/**
 * Aggregiert Rohmessungen zu einer Trend-Serie plus Kennzahlen.
 *
 * @param {Array<Object>} rows  - Vitalwerte-Zeilen (beliebige Typen; wird intern
 *                                 nach `type` gefiltert). Erwartete Felder:
 *                                 type, value_num, value_num2, value_num3,
 *                                 unit, measured_at.
 * @param {Object} opts
 * @param {string} opts.type            - Metrik-Typ (bp|glucose|weight|spo2|temp)
 * @param {'week'|'month'|'year'} [opts.range='month']
 * @param {string} [opts.anchor]        - Anker-Datum (YYYY-MM-DD) im Zeitraum
 * @param {number} [opts.weekStartsOn=1]
 * @returns {{
 *   type: string, range: string, from: string, to: string, gran: string,
 *   channels: string[],
 *   points: Array<{ key:string, date:string, count:number,
 *                   value_num:number|null, value_num2:number|null, value_num3:number|null }>,
 *   hasData: boolean,
 *   latest: Object|null, previous: Object|null,
 *   deltas: { value_num:number|null, value_num2:number|null, value_num3:number|null }
 * }}
 */
export function computeVitalSeries(rows, opts = {}) {
  const { type, range = 'month', anchor, weekStartsOn = 1 } = opts;
  const metric = vitalMetric(type);
  const channels = metric ? metric.channels : ['value_num'];

  const typeRows = (Array.isArray(rows) ? rows : []).filter((r) => r && r.type === type);

  // Kennzahlen: letzter + vorletzter Wert über ALLE Messungen dieses Typs,
  // unabhängig vom gewählten Zeitraum (das Delta zeigt die jüngste Änderung).
  const sorted = [...typeRows].sort((a, b) => {
    const ka = String(a.measured_at);
    const kb = String(b.measured_at);
    if (ka === kb) return (b.id || 0) - (a.id || 0);
    return ka < kb ? 1 : -1;
  });
  const latest = sorted[0] || null;
  const previous = sorted[1] || null;

  const deltas = { value_num: null, value_num2: null, value_num3: null };
  if (latest && previous) {
    for (const key of CHANNEL_KEYS) {
      const cur = toFiniteOrNull(latest[key]);
      const prev = toFiniteOrNull(previous[key]);
      if (cur !== null && prev !== null) deltas[key] = cur - prev;
    }
  }

  // Zeitraum-Serie: Buckets aufbauen und Messungen einsortieren.
  const { buckets, from, to, gran } = buildVitalBuckets(range, anchor, weekStartsOn);
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const acc = buckets.map(() => ({
    count: 0,
    sums: { value_num: 0, value_num2: 0, value_num3: 0 },
    counts: { value_num: 0, value_num2: 0, value_num3: 0 },
  }));

  for (const row of typeRows) {
    const dk = dateKeyOf(row.measured_at);
    if (dk < from || dk > to) continue;
    const bucketKey = gran === 'month' ? dk.slice(0, 7) : dk;
    const i = index.get(bucketKey);
    if (i === undefined) continue;
    acc[i].count += 1;
    for (const key of CHANNEL_KEYS) {
      const val = toFiniteOrNull(row[key]);
      if (val !== null) { acc[i].sums[key] += val; acc[i].counts[key] += 1; }
    }
  }

  const points = buckets.map((b, i) => {
    const a = acc[i];
    const avg = (key) => (a.counts[key] > 0 ? a.sums[key] / a.counts[key] : null);
    return {
      key: b.key,
      date: b.date,
      count: a.count,
      value_num: avg('value_num'),
      value_num2: avg('value_num2'),
      value_num3: avg('value_num3'),
    };
  });

  return {
    type,
    range,
    from,
    to,
    gran,
    channels,
    points,
    hasData: points.some((p) => p.count > 0),
    latest,
    previous,
    deltas,
  };
}
