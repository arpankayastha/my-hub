import {
  isDefaultBudgetCategoryName,
} from './budget-category-defaults.js';

const BUDGET_CATEGORY_LABEL_KEYS = {
  income: 'budget.categoryIncome',
  housing: 'budget.categoryHousing',
  food: 'budget.categoryFood',
  insurance: 'budget.categoryInsurance',
  utilities: 'budget.categoryUtilities',
  health: 'budget.categoryHealth',
  family: 'budget.categoryFamily',
  home: 'budget.categoryHome',
  clothing: 'budget.categoryClothing',
  transport: 'budget.catTransport',
  personal_health: 'budget.catPersonalHealth',
  leisure: 'budget.catLeisure',
  shopping_clothing: 'budget.catShoppingClothing',
  education: 'budget.catEducation',
  financial_other: 'budget.catFinancialOther',
  subscriptions: 'budget.catSubscriptions',
  Erwerbseinkommen: 'budget.catEarnedIncome',
  Kapitalerträge: 'budget.catInvestmentIncome',
  'Geschenke & Transfers': 'budget.catTransferGiftIncome',
  Sozialleistungen: 'budget.catGovernmentBenefits',
  'Sonstiges Einkommen': 'budget.catOtherIncome',
};

export function budgetCategoryLabelKey(category) {
  const key = String(category || '').trim();
  return BUDGET_CATEGORY_LABEL_KEYS[key] ?? null;
}

export function budgetCategoryLabel(category, fallback = '', translate = null) {
  const key = String(category || '').trim();
  const customName = String(fallback || '').trim();
  const labelKey = budgetCategoryLabelKey(category);
  if (labelKey && typeof translate === 'function') {
    const localized = translate(labelKey);
    if (customName && !isDefaultBudgetCategoryName(key, customName)) return customName;
    return localized;
  }
  return customName || key;
}
