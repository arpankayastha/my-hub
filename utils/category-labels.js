import {
  englishBudgetCategoryLabel,
  englishBudgetSubcategoryLabel,
  isDefaultBudgetCategoryName,
  isDefaultBudgetSubcategoryName,
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

const BUDGET_SUBCATEGORY_LABEL_KEYS = {
  rent_mortgage: 'budget.subcatRentMortgage',
  condominium: 'budget.subcatCondominium',
  utilities: 'budget.subcatUtilities',
  internet_tv_phone: 'budget.subcatInternetTvPhone',
  renovation_maintenance: 'budget.subcatRenovationMaintenance',
  cleaning: 'budget.subcatCleaning',
  groceries: 'budget.subcatGroceries',
  restaurants_bars: 'budget.subcatRestaurantsBars',
  snacks_fast_food: 'budget.subcatSnacksFastFood',
  bakery: 'budget.subcatBakery',
  fuel: 'budget.subcatFuel',
  parking_tolls: 'budget.subcatParkingTolls',
  public_transport: 'budget.subcatPublicTransport',
  apps_taxi: 'budget.subcatAppsTaxi',
  maintenance_insurance: 'budget.subcatMaintenanceInsurance',
  pharmacy: 'budget.subcatPharmacy',
  health_insurance: 'budget.subcatHealthInsurance',
  gym_sports: 'budget.subcatGymSports',
  beauty_cosmetics: 'budget.subcatBeautyCosmetics',
  travel: 'budget.subcatTravel',
  streaming: 'budget.subcatStreaming',
  events: 'budget.subcatEvents',
  hobbies: 'budget.subcatHobbies',
  clothes_shoes: 'budget.subcatClothesShoes',
  electronics: 'budget.subcatElectronics',
  gifts: 'budget.subcatGifts',
  courses_college: 'budget.subcatCoursesCollege',
  school_supplies: 'budget.subcatSchoolSupplies',
  languages: 'budget.subcatLanguages',
  loans_interest: 'budget.subcatLoansInterest',
  bank_fees: 'budget.subcatBankFees',
  insurance_other: 'budget.subcatInsuranceOther',
  investments: 'budget.subcatInvestments',
  taxes: 'budget.subcatTaxes',
  subscription_entertainment: 'budget.subcatSubscriptionEntertainment',
  subscription_productivity: 'budget.subcatSubscriptionProductivity',
  subscription_utilities: 'budget.subcatSubscriptionUtilities',
  subscription_health: 'budget.subcatSubscriptionHealth',
  subscription_education: 'budget.subcatSubscriptionEducation',
  subscription_other: 'budget.subcatSubscriptionOther',
};

export function budgetCategoryLabelKey(category) {
  const key = String(category || '').trim();
  return BUDGET_CATEGORY_LABEL_KEYS[key] ?? null;
}

export function budgetSubcategoryLabelKey(subcategory) {
  const key = String(subcategory || '').trim();
  return BUDGET_SUBCATEGORY_LABEL_KEYS[key] ?? null;
}

/**
 * Budget category display name. Default categories use the app locale when
 * `translate` is provided; custom renames keep the stored name.
 */
export function budgetCategoryLabel(category, fallback = '', translate = null) {
  const key = String(category || '').trim();
  const name = String(fallback || '').trim();
  const labelKey = BUDGET_CATEGORY_LABEL_KEYS[key];
  if (labelKey && translate && isDefaultBudgetCategoryName(key, name)) {
    const translated = translate(labelKey);
    if (translated && translated !== labelKey) return translated;
  }
  return englishBudgetCategoryLabel(key, name);
}

/** Budget subcategory display name (same locale rules as categories). */
export function budgetSubcategoryLabel(subcategory, fallback = '', translate = null) {
  const key = String(subcategory || '').trim();
  const name = String(fallback || '').trim();
  const labelKey = BUDGET_SUBCATEGORY_LABEL_KEYS[key];
  if (labelKey && translate && isDefaultBudgetSubcategoryName(key, name)) {
    const translated = translate(labelKey);
    if (translated && translated !== labelKey) return translated;
  }
  return englishBudgetSubcategoryLabel(key, name);
}
