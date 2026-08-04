/**
 * Month calendar grid for budget (Forecast-style day markers).
 */

import { esc } from './html.js';

/** @typedef {{ income: number, expenses: number, net: number, count: number }} DayTotals */

/**
 * Aggregate budget entries by calendar day (YYYY-MM-DD).
 * @param {Array<{ date?: string, amount?: number }>} entries
 * @returns {Record<string, DayTotals>}
 */
export function aggregateEntriesByDay(entries) {
  const map = {};
  for (const entry of entries) {
    const day = String(entry?.date || '').slice(0, 10);
    if (!day || day.length < 10) continue;
    if (!map[day]) map[day] = { income: 0, expenses: 0, net: 0, count: 0 };
    const amt = Number(entry.amount) || 0;
    map[day].net += amt;
    map[day].count += 1;
    if (amt >= 0) map[day].income += amt;
    else map[day].expenses += Math.abs(amt);
  }
  return map;
}

/**
 * Cumulative month-to-date balance per calendar day (end-of-day).
 * @param {Array<{ date?: string, amount?: number }>} entries
 * @param {string} ym YYYY-MM
 * @returns {Record<string, number>}
 */
export function computeRunningBalanceByDay(entries, ym) {
  const dayTotals = aggregateEntriesByDay(entries);
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return {};
  const lastDate = new Date(y, m, 0).getDate();
  const map = {};
  let running = 0;
  for (let day = 1; day <= lastDate; day++) {
    const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    running += dayTotals[dateKey]?.net || 0;
    map[dateKey] = running;
  }
  return map;
}

/**
 * Linear pace forecast for remaining days in the current month.
 * @returns {{ projectedByDay: Record<string, number>, projectedEnd: number, forecastable: boolean }}
 */
export function computeProjectedBalanceByDay(entries, ym, today) {
  const actual = computeRunningBalanceByDay(entries, ym);
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m || !today) {
    const last = new Date(y, m, 0).getDate();
    const endKey = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { projectedByDay: { ...actual }, projectedEnd: actual[endKey] ?? 0, forecastable: false };
  }
  const prefix = `${y}-${String(m).padStart(2, '0')}-`;
  if (!today.startsWith(prefix.slice(0, 8))) {
    const last = new Date(y, m, 0).getDate();
    const endKey = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { projectedByDay: { ...actual }, projectedEnd: actual[endKey] ?? 0, forecastable: false };
  }

  const lastDate = new Date(y, m, 0).getDate();
  const todayDay = parseInt(today.slice(8, 10), 10);
  const balanceToday = actual[today] ?? 0;
  const dailyAvg = todayDay > 0 ? balanceToday / todayDay : 0;
  const projectedByDay = { ...actual };

  for (let day = todayDay + 1; day <= lastDate; day++) {
    const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    projectedByDay[dateKey] = balanceToday + dailyAvg * (day - todayDay);
  }

  const endKey = `${y}-${String(m).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
  return {
    projectedByDay,
    projectedEnd: projectedByDay[endKey] ?? balanceToday,
    forecastable: todayDay < lastDate,
  };
}

/** @param {number[]} values */
export function renderBalanceTrajectorySvg(values, { forecastFromIndex = -1 } = {}) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return '';
  const W = 200;
  const H = 48;
  const PAD = 4;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) { min -= 1; max += 1; }
  const n = values.length;
  const x = (i) => PAD + (i * (W - 2 * PAD)) / (n - 1);
  const y = (v) => H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD);

  const split = forecastFromIndex >= 0 && forecastFromIndex < n
    ? forecastFromIndex
    : n;

  const actualPts = values.slice(0, split + 1)
    .map((v, i) => (Number.isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null))
    .filter(Boolean).join(' ');
  const forecastPts = values.slice(split)
    .map((v, j) => {
      const i = split + j;
      return Number.isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null;
    })
    .filter(Boolean).join(' ');

  const actualLine = actualPts
    ? `<polyline points="${actualPts}" fill="none" stroke="var(--module-accent)" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" />`
    : '';
  const forecastLine = forecastPts && split < n - 1
    ? `<polyline points="${forecastPts}" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5" stroke-dasharray="4 3" stroke-linecap="round" vector-effect="non-scaling-stroke" />`
    : '';

  return `<svg class="budget-month-calendar__trajectory" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${actualLine}${forecastLine}</svg>`;
}

function weekdayLabels(locale = 'en') {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return fmt.format(d);
  });
}

function formatShortBalance(amount, formatBalance) {
  if (!formatBalance) return '';
  const full = formatBalance(amount);
  if (full.length <= 8) return full;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return full;
}

/**
 * @param {string} ym YYYY-MM
 * @param {Record<string, DayTotals>} dayTotals
 * @param {{ selectedDay?: string|null, today?: string, title?: string, clearLabel?: string, locale?: string, runningBalanceByDay?: Record<string, number>, projectedByDay?: Record<string, number>, projectedEnd?: number, forecastable?: boolean, projectedEndLabel?: string, formatBalance?: (n: number) => string }} opts
 */
export function renderMonthCalendarHtml(ym, dayTotals, opts = {}) {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return '';

  const today = opts.today || '';
  const selected = opts.selectedDay || '';
  const lastDate = new Date(y, m, 0).getDate();
  const pad = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const projected = opts.projectedByDay || opts.runningBalanceByDay || {};
  const actual = opts.runningBalanceByDay || {};
  const todayDay = today.startsWith(`${y}-${String(m).padStart(2, '0')}-`)
    ? parseInt(today.slice(8, 10), 10)
    : -1;

  const weekdays = weekdayLabels(opts.locale).map((label) =>
    `<span class="budget-month-calendar__weekday">${esc(label)}</span>`,
  ).join('');

  const trajectoryValues = [];
  let forecastFromIndex = -1;
  for (let day = 1; day <= lastDate; day++) {
    const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isFuture = todayDay > 0 && day > todayDay;
    const bal = isFuture && opts.forecastable
      ? projected[dateKey]
      : actual[dateKey];
    trajectoryValues.push(bal ?? (trajectoryValues.length ? trajectoryValues[trajectoryValues.length - 1] : 0));
    if (isFuture && forecastFromIndex < 0) forecastFromIndex = day - 2;
  }
  if (forecastFromIndex < 0 && opts.forecastable && todayDay > 0) {
    forecastFromIndex = todayDay - 1;
  }

  const cells = [];
  for (let i = 0; i < pad; i++) {
    cells.push('<span class="budget-month-calendar__pad" aria-hidden="true"></span>');
  }

  for (let day = 1; day <= lastDate; day++) {
    const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const totals = dayTotals[dateKey];
    const hasActivity = totals && totals.count > 0;
    const isFuture = todayDay > 0 && day > todayDay && opts.forecastable;
    const tone = hasActivity && !isFuture
      ? (totals.net >= 0 ? 'income' : 'expense')
      : 'empty';
    const isToday = dateKey === today;
    const isSelected = dateKey === selected;
    const classes = [
      'budget-month-calendar__day',
      isToday ? 'budget-month-calendar__day--today' : '',
      isSelected ? 'budget-month-calendar__day--selected' : '',
      isFuture ? 'budget-month-calendar__day--forecast' : '',
      hasActivity && !isFuture ? `budget-month-calendar__day--${tone}` : '',
    ].filter(Boolean).join(' ');

    const ariaBalance = isFuture ? projected[dateKey] : actual[dateKey];
    const balanceHtml = opts.formatBalance && ariaBalance !== undefined
      ? `<span class="budget-month-calendar__balance budget-month-calendar__balance--${ariaBalance >= 0 ? 'pos' : 'neg'}${isFuture ? ' budget-month-calendar__balance--forecast' : ''}" aria-hidden="true">${esc(formatShortBalance(ariaBalance, opts.formatBalance))}</span>`
      : '';

    const aria = isFuture
      ? `${day}, projected ${opts.formatBalance ? opts.formatBalance(ariaBalance ?? 0) : ariaBalance}`
      : (hasActivity
        ? `${day}, ${totals.count} entries, balance ${opts.formatBalance ? opts.formatBalance(ariaBalance ?? 0) : ariaBalance}`
        : (opts.formatBalance && ariaBalance !== undefined
          ? `${day}, balance ${opts.formatBalance(ariaBalance)}`
          : String(day)));

    cells.push(`
      <button type="button" class="${classes}" data-budget-day="${esc(dateKey)}"
        aria-label="${esc(aria)}" aria-pressed="${isSelected ? 'true' : 'false'}"${isFuture ? ' disabled' : ''}>
        <span class="budget-month-calendar__day-num">${day}</span>
        ${balanceHtml}
        ${hasActivity && !isFuture ? `<span class="budget-month-calendar__dot" aria-hidden="true"></span>` : ''}
      </button>`);
  }

  const clearBtn = selected && opts.clearLabel
    ? `<button type="button" class="btn btn--ghost btn--sm budget-month-calendar__clear" id="budget-day-clear">${esc(opts.clearLabel)}</button>`
    : '';

  const forecastHtml = opts.forecastable && opts.formatBalance && opts.projectedEndLabel
    ? `<p class="budget-month-calendar__forecast">${esc(opts.projectedEndLabel)}: <strong>${esc(opts.formatBalance(opts.projectedEnd ?? 0))}</strong></p>`
    : '';

  const trajectoryHtml = renderBalanceTrajectorySvg(trajectoryValues, { forecastFromIndex });

  return `
    <section class="budget-month-calendar" aria-label="${esc(opts.title || '')}">
      <div class="budget-month-calendar__head">
        <h3 class="budget-month-calendar__title">${esc(opts.title || '')}</h3>
        ${clearBtn}
      </div>
      ${forecastHtml}
      ${trajectoryHtml}
      <div class="budget-month-calendar__weekdays">${weekdays}</div>
      <div class="budget-month-calendar__grid">${cells.join('')}</div>
    </section>`;
}
