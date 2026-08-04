/**
 * Run: node --test test/test-budget-month-calendar.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregateEntriesByDay } from '../public/utils/budget-month-calendar.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('aggregateEntriesByDay sums per day', () => {
  const map = aggregateEntriesByDay([
    { date: '2026-08-04', amount: -50 },
    { date: '2026-08-04', amount: 100 },
    { date: '2026-08-05', amount: -20 },
  ]);
  assert.equal(map['2026-08-04'].net, 50);
  assert.equal(map['2026-08-04'].count, 2);
  assert.equal(map['2026-08-05'].expenses, 20);
});

test('renderMonthCalendarHtml marks selected day and wires budget page', () => {
  const cal = read('../public/utils/budget-month-calendar.js');
  const budget = read('../public/pages/budget.js');
  assert.match(cal, /function renderMonthCalendarHtml/);
  assert.match(cal, /budget-month-calendar__day--selected/);
  assert.match(cal, /data-budget-day/);
  assert.match(budget, /renderMonthCalendarSection/);
  assert.match(budget, /wireMonthCalendar/);
  assert.match(budget, /state\.dayFilter/);
});
