/**
 * Shared recurring-budget rules (browser + server).
 * Auto-fill: only the single next month after the latest instance, and never
 * beyond the current calendar month (future browsing uses apply-recurring).
 * Planning copy: any due month on demand via apply-recurring.
 */

export const RECURRENCE_INTERVAL_KEYS = ['monthly', 'half_year', 'yearly'];

export function monthsPerInterval(interval) {
  return interval === 'yearly' ? 12 : interval === 'half_year' ? 6 : 1;
}

export function cents(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function effectiveMonthly(amount, interval) {
  return cents(Number(amount || 0) / monthsPerInterval(interval));
}

export function addMonthsYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthsBetweenYm(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function recurringAnchorMonth(parentStartYm, latestInstanceYm) {
  return latestInstanceYm || parentStartYm;
}

export function nextRecurringMonth(anchorYm, interval, virtual) {
  const step = virtual ? 1 : monthsPerInterval(interval);
  return addMonthsYm(anchorYm, step);
}

/** Whether `targetYm` is a due month for the series (planning / copy-recurring). */
export function isRecurringDueInMonth(parentStartYm, targetYm, interval, virtual) {
  const diff = monthsBetweenYm(parentStartYm, targetYm);
  if (diff < 1) return false;
  if (virtual) return true;
  const step = monthsPerInterval(interval);
  return diff % step === 0;
}

/** Lazy auto-materialize: only the immediate next month in the chain. */
export function shouldAutoMaterializeRecurring(entry, requestMonth, latestInstanceYm, nowMonth) {
  const parentStartYm = entry.date.slice(0, 7);
  if (monthsBetweenYm(parentStartYm, requestMonth) < 1) return false;
  if (nowMonth && monthsBetweenYm(nowMonth, requestMonth) > 0) return false;
  const anchor = recurringAnchorMonth(parentStartYm, latestInstanceYm);
  const next = nextRecurringMonth(anchor, entry.recurrence_interval || 'monthly', entry.recurrence_virtual);
  return requestMonth === next;
}

/** On-demand copy: fill any valid due month when the user plans ahead. */
export function shouldPlanMaterializeRecurring(entry, requestMonth) {
  const parentStartYm = entry.date.slice(0, 7);
  return isRecurringDueInMonth(
    parentStartYm,
    requestMonth,
    entry.recurrence_interval || 'monthly',
    entry.recurrence_virtual,
  );
}
