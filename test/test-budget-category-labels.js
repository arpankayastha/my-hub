/**
 * Budget category label: English defaults, custom renames preserved.
 * Run: node --test test/test-budget-category-labels.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetCategoryLabel } from '../public/utils/category-labels.js';

test('default income category shows English, not German stored name', () => {
  const label = budgetCategoryLabel('Erwerbseinkommen', 'Erwerbseinkommen');
  assert.equal(label, 'Earned Income');
});

test('default income is English even when translate would return Hindi', () => {
  const label = budgetCategoryLabel('Erwerbseinkommen', 'Erwerbseinkommen', (key) =>
    key === 'budget.catEarnedIncome' ? 'कमाई आय' : key,
  );
  assert.equal(label, 'Earned Income');
});

test('renamed category keeps custom name', () => {
  const label = budgetCategoryLabel('food', 'Groceries');
  assert.equal(label, 'Groceries');
});

test('default expense category is English', () => {
  assert.equal(budgetCategoryLabel('food', 'Food'), 'Food');
  assert.equal(budgetCategoryLabel('housing', 'Housing / Home'), 'Housing / Home');
});
