/**
 * Budget category label: locale vs custom rename.
 * Run: node --test test/test-budget-category-labels.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetCategoryLabel } from '../public/utils/category-labels.js';

const hiEarned = 'कमाई आय';

test('default income category uses locale, not German stored name', () => {
  const label = budgetCategoryLabel('Erwerbseinkommen', 'Erwerbseinkommen', (key) =>
    key === 'budget.catEarnedIncome' ? hiEarned : key,
  );
  assert.equal(label, hiEarned);
});

test('renamed category keeps custom name', () => {
  const label = budgetCategoryLabel('food', 'Groceries', (key) =>
    key === 'budget.categoryFood' ? 'भोजन' : key,
  );
  assert.equal(label, 'Groceries');
});

test('default expense category uses locale', () => {
  const label = budgetCategoryLabel('food', 'Food', (key) =>
    key === 'budget.categoryFood' ? 'भोजन' : key,
  );
  assert.equal(label, 'भोजन');
});
