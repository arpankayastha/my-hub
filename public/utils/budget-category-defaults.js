/**
 * Shipped default category/subcategory names (key → name).
 * Used to detect user renames vs defaults for locale display.
 */

export const DEFAULT_BUDGET_CATEGORY_NAMES = {
  housing: 'Housing / Home',
  food: 'Food',
  transport: 'Transport',
  personal_health: 'Personal Care / Health',
  leisure: 'Leisure and Entertainment',
  shopping_clothing: 'Shopping and Clothing',
  education: 'Education',
  financial_other: 'Financial Services and Other',
  Erwerbseinkommen: 'Erwerbseinkommen',
  Kapitalerträge: 'Kapitalerträge',
  'Geschenke & Transfers': 'Geschenke & Transfers',
  Sozialleistungen: 'Sozialleistungen',
  'Sonstiges Einkommen': 'Sonstiges Einkommen',
};

export const DEFAULT_BUDGET_SUBCATEGORY_NAMES = {
  rent_mortgage: 'Rent / Mortgage',
  condominium: 'Condominium fees',
  utilities: 'Electricity / Water / Gas',
  internet_tv_phone: 'Internet / TV / Phone',
  renovation_maintenance: 'Renovation / Maintenance',
  cleaning: 'Cleaning',
  groceries: 'Groceries',
  restaurants_bars: 'Restaurants / Bars',
  snacks_fast_food: 'Snacks / Fast Food',
  bakery: 'Bakery',
  fuel: 'Fuel',
  parking_tolls: 'Parking / Tolls',
  public_transport: 'Public transport',
  apps_taxi: 'Apps / Taxi',
  maintenance_insurance: 'Maintenance / Insurance',
  pharmacy: 'Pharmacy',
  health_insurance: 'Health insurance',
  gym_sports: 'Gym / Sports',
  beauty_cosmetics: 'Beauty / Cosmetics',
  travel: 'Travel',
  streaming: 'Streaming',
  events: 'Events',
  hobbies: 'Hobbies',
  clothes_shoes: 'Clothes / Shoes',
  electronics: 'Electronics',
  gifts: 'Gifts',
  courses_college: 'Courses / College',
  school_supplies: 'School supplies',
  languages: 'Languages',
  loans_interest: 'Loans / Interest',
  bank_fees: 'Bank fees',
  insurance_other: 'Insurance',
  investments: 'Investments',
  taxes: 'Taxes',
};

export function isDefaultBudgetCategoryName(key, name) {
  const defaultName = DEFAULT_BUDGET_CATEGORY_NAMES[key];
  if (!defaultName) return false;
  return String(name || '').trim() === defaultName;
}

export function isDefaultBudgetSubcategoryName(key, name) {
  const defaultName = DEFAULT_BUDGET_SUBCATEGORY_NAMES[key];
  if (!defaultName) return false;
  return String(name || '').trim() === defaultName;
}
