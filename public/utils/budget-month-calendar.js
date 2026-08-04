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
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const monday = new Date(2024, 0, 1); // Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return fmt.format(d);
  });
}

/**
 * @param {string} ym YYYY-MM
 * @param {Record<string, DayTotals>} dayTotals
 * @param {{ selectedDay?: string|null, today?: string, title?: string, clearLabel?: string, locale?: string, runningBalanceByDay?: Record<string, number>, formatBalance?: (n: number) => string }} opts
 */
export function renderMonthCalendarHtml(ym, dayTotals, opts = {}) {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return '';

  const today = opts.today || '';
  const selected = opts.selectedDay || '';
  const lastDate = new Date(y, m, 0).getDate();
  const pad = (new Date(y, m - 1, 1).getDay() + 6) % 7;

  const weekdays = weekdayLabels(opts.locale).map((label) =>
    `<span class="budget-month-calendar__weekday">${esc(label)}</span>`,
  ).join('');

  const cells = [];
  for (let i = 0; i < pad; i++) {
    cells.push('<span class="budget-month-calendar__pad" aria-hidden="true"></span>');
  }

  for (let day = 1; day <= lastDate; day++) {
    const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const totals = dayTotals[dateKey];
    const hasActivity = totals && totals.count > 0;
    const tone = hasActivity
      ? (totals.net >= 0 ? 'income' : 'expense')
      : 'empty';
    const isToday = dateKey === today;
    const isSelected = dateKey === selected;
    const classes = [
      'budget-month-calendar__day',
      isToday ? 'budget-month-calendar__day--today' : '',
      isSelected ? 'budget-month-calendar__day--selected' : '',
      hasActivity ? `budget-month-calendar__day--${tone}` : '',
    ].filter(Boolean).join(' ');

    const ariaBalance = opts.runningBalanceByDay?.[dateKey];
    const balanceHtml = opts.formatBalance && ariaBalance !== undefined
      ? `<span class="budget-month-calendar__balance budget-month-calendar__balance--${ariaBalance >= 0 ? 'pos' : 'neg'}" aria-hidden="true">${esc(formatShortBalance(ariaBalance, opts.formatBalance))}</span>`
      : '';

    const aria = hasActivity
      ? `${day}, ${totals.count} entries, balance ${opts.formatBalance ? opts.formatBalance(ariaBalance ?? 0) : ariaBalance}`
      : (opts.formatBalance && ariaBalance !== undefined
        ? `${day}, balance ${opts.formatBalance(ariaBalance)}`
        : String(day));

    cells.push(`
      <button type="button" class="${classes}" data-budget-day="${esc(dateKey)}"
        aria-label="${esc(aria)}" aria-pressed="${isSelected ? 'true' : 'false'}">
        <span class="budget-month-calendar__day-num">${day}</span>
        ${balanceHtml}
        ${hasActivity ? `<span class="budget-month-calendar__dot" aria-hidden="true"></span>` : ''}
      </button>`);
  }

  const clearBtn = selected && opts.clearLabel
    ? `<button type="button" class="btn btn--ghost btn--sm budget-month-calendar__clear" id="budget-day-clear">${esc(opts.clearLabel)}</button>`
    : '';

  return `
    <section class="budget-month-calendar" aria-label="${esc(opts.title || '')}">
      <div class="budget-month-calendar__head">
        <h3 class="budget-month-calendar__title">${esc(opts.title || '')}</h3>
        ${clearBtn}
      </div>
      <div class="budget-month-calendar__weekdays">${weekdays}</div>
      <div class="budget-month-calendar__grid">${cells.join('')}</div>
    </section>`;
}
