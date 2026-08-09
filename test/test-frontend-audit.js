/**
 * Frontend audit regression tests.
 * Guards the accessibility and hard-constraint fixes from the UX audit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { SETTINGS_DOMAINS, SETTINGS_LEAVES } from '../public/settings/registry.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r/g, '');

// Control-IDs stehen seit dem Toggle-Primitiv in zwei Formen im Quelltext:
// literal im Markup (`id="foo"`) und als Option von toggleRowHtml
// (`attrs: { id: 'foo' }`). Beide meinen dasselbe gerenderte Attribut.
const controlIdPattern = (id) => new RegExp(`id="${id}"|id:\\s*['"]${id}['"]`);

function walkJsFiles(dir) {
  const entries = readdirSync(new URL(dir, import.meta.url), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return walkJsFiles(`${path}/`);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

function walkFrontendFiles(dir) {
  const entries = readdirSync(new URL(dir, import.meta.url), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return walkFrontendFiles(`${path}/`);
    return entry.isFile() && /\.(html|js)$/.test(entry.name) ? [path] : [];
  });
}

function resolveLocaleKey(obj, key) {
  return key.split('.').reduce((value, part) => (value != null ? value[part] : undefined), obj);
}

function assertKeysExistInEveryLocale(keys) {
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url))
    .filter((file) => file.endsWith('.json'));
  const locales = localeFiles.map((file) => ({
    file,
    data: JSON.parse(read(`../public/locales/${file}`)),
  }));
  const missing = [];

  for (const key of keys) {
    for (const locale of locales) {
      if (resolveLocaleKey(locale.data, key) === undefined) {
        missing.push(`${key}:${locale.file}`);
      }
    }
  }

  assert.deepEqual(missing, []);
}

function cssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

function assertRuleUsesToken(css, selector, property, token, file) {
  const body = cssRuleBody(css, selector);
  assert.match(body, new RegExp(`${property}:\\s*var\\(${token}\\)`), `${file} ${selector} ${property} should use ${token}`);
}

test('audited frontend files do not assign innerHTML', () => {
  const files = [
    '../public/components/my-hub-install-prompt.js',
    '../public/components/category-manager.js',
    '../public/pages/notes.js',
    '../public/pages/meals.js',
    '../public/pages/contacts.js',
    '../public/pages/documents.js',
    '../public/pages/housekeeping.js',
  ];

  for (const file of files) {
    assert.doesNotMatch(read(file), /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
  }
});

test('static frontend translation keys exist in every locale', () => {
  const keys = new Set();

  for (const file of walkJsFiles('../public/')) {
    const source = read(file);
    [...source.matchAll(/\bt\(\s*(['"])([^'"]+)\1/g)].forEach((match) => keys.add(match[2]));
    [...source.matchAll(/labelKey:\s*['"]([^'"]+)['"]/g)].forEach((match) => keys.add(match[1]));
  }

  for (const file of walkFrontendFiles('../public/')) {
    const source = read(file);
    [...source.matchAll(/data-i18n=["']([^"']+)["']/g)].forEach((match) => keys.add(match[1]));
  }

  assertKeysExistInEveryLocale(keys);
});

test('app locale values do not ship German placeholder markers', () => {
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url))
    .filter((file) => file.endsWith('.json'));
  const violations = [];

  function collect(value, path, file) {
    if (typeof value === 'string') {
      if (value.includes('[de:')) violations.push(`${file}:${path}`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) collect(child, path ? `${path}.${key}` : key, file);
  }

  for (const file of localeFiles) {
    collect(JSON.parse(read(`../public/locales/${file}`)), '', file);
  }

  assert.deepEqual(violations, []);
});

test('English and French user multi-select none labels are localized', () => {
  const en = JSON.parse(read('../public/locales/en.json'));
  const fr = JSON.parse(read('../public/locales/fr.json'));

  assert.equal(en.userMultiSelect.nobody, '- No one -');
  assert.equal(fr.userMultiSelect.nobody, '- Personne -');
});

test('dynamic frontend translation key domains exist in every locale', () => {
  const familyRoles = ['dad', 'mom', 'parent', 'child', 'grandparent', 'relative', 'other'];
  const documentCategories = ['medical', 'school', 'identity', 'insurance', 'finance', 'home', 'vehicle', 'legal', 'travel', 'pets', 'warranty', 'taxes', 'work', 'other'];
  const documentVisibilities = ['family', 'restricted', 'private'];
  const dashboardBudgetLabels = ['catHousing', 'catFood', 'catTransport', 'catPersonalHealth', 'catLeisure', 'catShoppingClothing', 'catEducation', 'catFinancialOther', 'catEarnedIncome', 'catInvestmentIncome', 'catTransferGiftIncome', 'catGovernmentBenefits', 'catOtherIncome'];
  const splitGroupTypes = ['household', 'couple', 'travel', 'event', 'shopping', 'general'];
  const splitMethods = ['equal', 'exact', 'percentage', 'shares'];
  // Handpflege dieser Liste reicht nicht — sie hatte member_removed jahrelang
  // nicht. Der Guard „split activity feed translates every type the backend
  // writes" leitet die Typen direkt aus dem Server-Code ab.
  const splitActivityTypes = ['group_created', 'group_updated', 'group_archived', 'member_added', 'member_removed', 'guest_created', 'expense_created', 'expense_edited', 'expense_deleted', 'comment_added', 'payment_registered', 'recurring_created', 'recurring_paused', 'recurring_resumed', 'recurring_generated'];

  const keys = [
    ...familyRoles.map((role) => `settings.familyRole${role.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`),
    ...documentCategories.map((category) => `documents.category.${category}`),
    ...documentVisibilities.map((visibility) => `documents.visibility.${visibility}`),
    ...dashboardBudgetLabels.map((key) => `budget.${key}`),
    ...splitGroupTypes.map((type) => `splitExpenses.groupType.${type}`),
    ...splitMethods.map((method) => `splitExpenses.splitHint.${method}`),
    ...splitActivityTypes.map((type) => `splitExpenses.activityType.${type}`),
  ];

  assertKeysExistInEveryLocale(keys);
});

test('settings information-architecture keys exist in every locale', () => {
  const keys = new Set();

  // Registry-derived labels/descriptions — the source of truth, never duplicated here.
  for (const domain of SETTINGS_DOMAINS) keys.add(domain.labelKey);
  for (const leaf of SETTINGS_LEAVES) {
    keys.add(leaf.labelKey);
    keys.add(leaf.descriptionKey);
  }

  // Shared Settings-IA copy that lives outside the registry but is part of the same surface.
  [
    // Shell chrome + overview headings.
    'settings.title',
    'settings.navigationLabel',
    'settings.breadcrumbLabel',
    'settings.backToSettings',
    'settings.loadError',
    'settings.retry',
    // Domain + mobile overview labels.
    'settings.mobileOverviewTitle',
    'settings.mobileOverviewDescription',
    'settings.mobileDomainTitle',
    // Status-first integration copy + progressive disclosure.
    'settings.providerSpecific',
    'settings.moreProviders',
    // Apple-legacy copy.
    'settings.legacy',
    'settings.appleLegacyHint',
    // Document backup warning.
    'settings.documentStorageBackupWarning',
    // Kitchen active count.
    'settings.kitchenActiveCount',
    // App navigation section labels.
    'nav.sectionOverview',
    'nav.sectionPlan',
    'nav.sectionHousehold',
    'nav.sectionPeople',
    'nav.sectionFinance',
    'nav.sectionCustomModules',
    // Unauthorized / access-redirected notice.
    'settings.accessRedirected',
  ].forEach((key) => keys.add(key));

  assertKeysExistInEveryLocale([...keys]);
});

test('service worker precaches every supported locale file', () => {
  const i18n = read('../public/i18n.js');
  const sw = read('../public/sw.js');
  const supportedLocales = [...i18n.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]+)\]/)?.[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
  const precachedLocales = [...sw.matchAll(/'\/locales\/([^']+)\.json'/g)].map((match) => match[1]).sort();

  assert.deepEqual(supportedLocales.sort(), localeFiles, 'SUPPORTED_LOCALES must match public/locales/*.json');
  assert.deepEqual(precachedLocales, supportedLocales.sort(), 'Service worker APP_LOCALES must precache every supported locale');
});

test('service worker release caches track package version and include the early locale bootstrap', () => {
  const pkg = JSON.parse(read('../package.json'));
  const sw = read('../public/sw.js');
  const release = sw.match(/const APP_RELEASE\s*=\s*['"]([^'"]+)['"]/)?.[1];

  assert.equal(release, pkg.version, 'Service worker APP_RELEASE must match package.json');
  assert.match(sw, /const SHELL_CACHE\s*=\s*`my-hub-shell-\$\{APP_RELEASE\}`/);
  assert.match(sw, /const PAGES_CACHE\s*=\s*`my-hub-pages-\$\{APP_RELEASE\}`/);
  assert.match(sw, /['"]\/lang-init\.js['"]/, 'early lang/dir bootstrap must be available offline');
});

test('runtime locale changes keep language and writing direction synchronized', () => {
  const i18n = read('../public/i18n.js');
  const router = read('../public/router.js');

  assert.match(i18n, /const RTL_LOCALES\s*=\s*new Set\(\[['"]ar['"],\s*['"]fa['"]\]\)/);
  assert.match(i18n, /function applyDocumentLocale\(locale\)/);
  assert.match(i18n, /document\.documentElement\.lang\s*=\s*locale/);
  assert.match(i18n, /document\.documentElement\.dir\s*=\s*RTL_LOCALES\.has\(locale\)\s*\?\s*['"]rtl['"]\s*:\s*['"]ltr['"]/);
  assert.equal((i18n.match(/applyDocumentLocale\(/g) || []).length, 3);
  assert.match(
    router,
    /window\.addEventListener\(['"]locale-changed['"],\s*\(\)\s*=>\s*\{[\s\S]*rebuildNavigation\(\);[\s\S]*refreshCurrentRoute\(\);[\s\S]*\}\);/
  );
});

test('install prompt waits for initial translations before rendering text', () => {
  const i18n = read('../public/i18n.js');
  const prompt = read('../public/components/my-hub-install-prompt.js');

  assert.match(i18n, /export function whenI18nReady/);
  assert.match(prompt, /import \{ t,\s*whenI18nReady \} from '\/i18n\.js';/);
  assert.match(prompt, /await whenI18nReady\(\)/);
});

test('date helpers produce local YYYY-MM-DD keys without toISOString slicing', async () => {
  const { toLocalDateKey } = await import('../public/utils/date.js');
  const date = new Date(2026, 4, 24, 2, 30, 0);
  assert.equal(toLocalDateKey(date), '2026-05-24');
});

test('meals and budget pages do not slice toISOString for date keys', () => {
  for (const file of ['../public/pages/meals.js', '../public/pages/budget.js']) {
    assert.doesNotMatch(read(file), /toISOString\(\)\.slice\(0,\s*10\)/, `${file} must use local date keys`);
  }
});

test('shared sub-tabs wire tabs to panels with aria-controls and aria-labelledby support', () => {
  const source = read('../public/utils/sub-tabs.js');
  assert.match(source, /btn\.id\s*=/);
  assert.match(source, /aria-controls/);
  assert.match(source, /aria-labelledby/);
});

test('settings theme toggle exposes pressed state', () => {
  const source = read('../public/settings/pages/personal-appearance.js');
  assert.match(source, /aria-pressed/);
  assert.match(source, /setAttribute\('aria-pressed'/);
});

test('personal settings leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/personal-account.js',
    '../public/settings/pages/personal-appearance.js',
    '../public/settings/pages/personal-device.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    assert.match(read(file), /export async function render\(container,\s*\{\s*user\s*\}\)/);
  }
});

test('personal account leaf preserves self-profile, password, and logout contracts', () => {
  const source = read('../public/settings/pages/personal-account.js');

  assert.match(source, /await auth\.me\(\)/);
  assert.match(source, /Object\.assign\(user,\s*.*user/);
  assert.match(source, /auth\.updateProfile\(\{/);
  assert.match(source, /avatar_data:/);
  assert.match(source, /phone:/);
  assert.match(source, /email:/);
  assert.match(source, /birth_date:/);
  assert.match(source, /api\.patch\('\/auth\/me\/password',\s*\{\s*current_password:/);
  assert.match(source, /await auth\.logout\(\)/);
  assert.match(source, /window\.myhub\?\.navigate\('\/login'\)/);
  assert.match(source, /id="profile-avatar-file"[^>]*aria-label=/);
  assert.match(source, /id="profile-avatar-file"[^>]*tabindex="-1"/);
  assert.match(source, /id="profile-avatar-file"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-error"[^>]*role="alert"/);
  assert.match(source, /id="password-error"[^>]*role="alert"/);
  assert.match(source, /id="profile-display-name"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-phone"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-email"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-birth-date"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="current-password"[^>]*aria-describedby="password-error"/);
  assert.match(source, /id="new-password"[^>]*aria-describedby="password-error"/);
  assert.match(source, /id="confirm-password"[^>]*aria-describedby="password-error"/);
  assert.match(source, /role="alert"[^>]*>\$\{t\('settings\.loadError'\)\}/);
});

test('personal appearance leaf owns theme, locale, and regional preferences', () => {
  const source = read('../public/settings/pages/personal-appearance.js');

  assert.match(source, /await getPreferences\(\)/);
  assert.match(source, /getSupportedLocales\(\)/);
  assert.match(source, /setLocale\(/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /setAttribute\('aria-pressed'/);
  assert.match(source, /data-lucide="monitor"/);
  assert.match(source, /data-lucide="sun"/);
  assert.match(source, /data-lucide="moon"/);
  assert.match(source, /date_format/);
  assert.match(source, /time_format/);
  assert.match(source, /savePreferences\(\{/);
  assert.match(source, /function safeStorageGet\(/);
  assert.match(source, /function safeStorageSet\(/);
  assert.match(source, /function safeStorageRemove\(/);
  assert.match(source, /function safeStorageGet[\s\S]*try \{[\s\S]*localStorage\.getItem[\s\S]*catch/);
  assert.match(source, /function safeStorageSet[\s\S]*try \{[\s\S]*localStorage\.setItem[\s\S]*catch/);
  assert.match(source, /function safeStorageRemove[\s\S]*try \{[\s\S]*localStorage\.removeItem[\s\S]*catch/);
  assert.equal([...source.matchAll(/localStorage\.getItem/g)].length, 1);
  assert.equal([...source.matchAll(/localStorage\.setItem/g)].length, 1);
  assert.equal([...source.matchAll(/localStorage\.removeItem/g)].length, 1);
  assert.match(source, /function bindEvents\(container,\s*user\)/);
  assert.match(source, /await setLocale\(locale\);[\s\S]*await render\(container,\s*\{\s*user\s*\}\)/);
  assert.match(source, /if \(localeSelect\.isConnected\)\s*localeSelect\.disabled = false/);
  assert.match(source, /id="locale-error"[^>]*role="alert"/);
  assert.match(source, /id="date-format-error"[^>]*role="alert"/);
  assert.match(source, /id="time-format-error"[^>]*role="alert"/);
  assert.match(source, /id="locale-select"[^>]*aria-describedby="locale-error"/);
  // Datums- und Zeitformat gelten haushaltweit und sind fuer jedes Mitglied
  // aenderbar (server/routes/preferences.js). Der Hinweis muss an beiden
  // Selects haengen, sonst behauptet das Blatt wieder das Gegenteil.
  assert.match(source, /id="formats-household-hint"[^>]*>\$\{t\('settings\.formatsHouseholdHint'\)\}/);
  assert.match(source, /id="date-format-select"[^>]*aria-describedby="formats-household-hint date-format-error"/);
  assert.match(source, /id="time-format-select"[^>]*aria-describedby="formats-household-hint time-format-error"/);
  assert.match(source, /role="alert"[^>]*>\$\{t\('settings\.loadError'\)\}/);
});

test('personal device leaf owns PWA installation state and disconnect cleanup', () => {
  const source = read('../public/settings/pages/personal-device.js');

  assert.match(
    source,
    /import \{\s*getPwaInstallState,\s*onPwaInstallStateChanged,\s*promptPwaInstall\s*\} from '\/utils\/pwa-install\.js';/,
  );
  assert.match(source, /onPwaInstallStateChanged\(/);
  assert.match(source, /promptPwaInstall\(\)/);
  assert.match(source, /!container\.isConnected/);
  assert.match(source, /if \(unsubscribed\) return/);
  assert.match(source, /stopListening\(\)/);
  assert.match(source, /new MutationObserver\(/);
  // Cleanup observes only the router's persistent swap container (#main-content),
  // not the whole document.body subtree (which fires on every app DOM mutation).
  assert.match(source, /getElementById\('main-content'\)/);
  assert.match(source, /observer\.observe\(swapRoot, \{ childList: true \}\)/);
  assert.doesNotMatch(source, /subtree:\s*true/);
  assert.match(source, /observer\?\.disconnect\(\)/);
  assert.match(source, /id="pwa-install-status"[^>]*aria-live=/);
  assert.match(source, /id="pwa-install-error"[^>]*role="alert"/);
  assert.match(source, /id="pwa-install-btn"[^>]*aria-describedby="pwa-install-status pwa-install-error"/);
});

test('module-specific settings leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/modules-kitchen.js',
    '../public/settings/pages/modules-calendar.js',
    '../public/settings/pages/modules-options.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{\s*user\s*\}\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
  }
});

test('module-specific settings leaves only reference their owned preferences and endpoints', () => {
  const ownership = {
    '../public/settings/pages/modules-kitchen.js': {
      endpoints: ['/preferences'],
      preferences: ['visible_meal_types'],
    },
    '../public/settings/pages/modules-calendar.js': {
      endpoints: [
        '/preferences',
        '/preferences/holidays/countries',
        '/preferences/holidays/groups/',
        '/preferences/holidays/subdivisions/',
        '/preferences/holidays/sync',
      ],
      preferences: [
        'calendar_default_duration',
        'week_start',
        'holiday_country',
        'holiday_subdivision',
        'holiday_group',
        'holiday_show_public',
        'holiday_show_school',
        'holiday_public_color',
        'holiday_school_color',
        'holiday_last_sync',
      ],
    },
    '../public/settings/pages/modules-options.js': {
      endpoints: ['/preferences'],
      preferences: ['budget_mode', 'health_cycle_enabled', 'housekeeping_payment_tasks'],
    },
  };

  for (const [file, approved] of Object.entries(ownership)) {
    const source = read(file);
    const endpoints = [
      ...source.matchAll(/\bapi\.(?:get|put|post|patch|delete)\(\s*`([^`$]*)/g),
      ...source.matchAll(/\bapi\.(?:get|put|post|patch|delete)\(\s*['"]([^'"]+)/g),
    ].map((match) => match[1]);
    // getPreferences()/savePreferences() sind `/preferences` - der Cache steht
    // dazwischen, der Endpunkt bleibt derselbe (Critique 2026-07-27).
    if (/\b(?:get|save)Preferences\(/.test(source)) endpoints.push('/preferences');
    const preferenceKeys = new Set(
      [...source.matchAll(/\b(?:preferences|preferenceData)\.([a-z][a-z0-9_]*)/g)]
        .map((match) => match[1]),
    );
    for (const match of source.matchAll(/savePreferences\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      for (const keyMatch of match[1].matchAll(/\b([a-z][a-z0-9_]*)\s*:/g)) {
        preferenceKeys.add(keyMatch[1]);
      }
    }

    assert.deepEqual(
      [...new Set(endpoints)].sort(),
      [...approved.endpoints].sort(),
      `${file} must only call its approved endpoints`,
    );
    assert.deepEqual(
      [...preferenceKeys].sort(),
      [...approved.preferences].sort(),
      `${file} must only reference its owned preference keys`,
    );
  }
});

test('module-specific settings leaves preserve their required controls and behaviors', () => {
  const kitchen = read('../public/settings/pages/modules-kitchen.js');
  assert.match(kitchen, /const MEAL_TYPES = \['breakfast', 'lunch', 'dinner', 'snack'\]/);
  assert.match(kitchen, /await getPreferences\(\)/);
  assert.match(kitchen, /savePreferences\(\{ visible_meal_types: checkedMealTypes \}\)/);
  assert.match(kitchen, /MEAL_TYPES\.map\(/);
  assert.doesNotMatch(kitchen, /\/(?:recipes|shopping)|shopping\/categories|recipe_settings|shopping_settings/);

  const calendar = read('../public/settings/pages/modules-calendar.js');
  for (const id of [
    'holiday-country',
    'holiday-subdivision',
    'holiday-show-public',
    'holiday-public-color',
    'holiday-show-school',
    'holiday-school-color',
    'holiday-sync-btn',
  ]) {
    assert.match(calendar, controlIdPattern(id));
  }
  assert.match(calendar, /api\.get\('\/preferences\/holidays\/countries'\)/);
  assert.match(calendar, /api\.get\(`\/preferences\/holidays\/subdivisions\/\$\{countryCode\}`\)/);
  assert.match(calendar, /api\.post\('\/preferences\/holidays\/sync', \{\}\)/);
  // Die per-user-Vorgaben sind nach personal-calendar gezogen; hier bleibt nur
  // Haushaltweites plus der Verweis dorthin (Critique 2026-07-27).
  assert.doesNotMatch(calendar, /id="calendar-default-assign-me"|js-default-reminder/);
  assert.match(calendar, /\/settings\/personal\/calendar/);
  assert.doesNotMatch(calendar, /caldav|carddav|google|apple|subscriptions|sync accounts/i);
  assert.doesNotMatch(calendar, /#[0-9a-f]{6}/i);
  assert.match(calendar, /id="holiday-country" disabled/);
  assert.ok(
    calendar.indexOf("form.addEventListener('submit'") <
      calendar.indexOf('const countriesResult = await runHolidayDiscovery'),
    'Calendar must bind submit handling before loading holiday discovery data',
  );

  // Budget, Gesundheit und Haushaltshilfe hatten je ein Blatt für je eine
  // Checkbox (Critique 2026-07-27). Sie teilen sich jetzt eines - mit genau
  // diesen drei Schaltern und einem einzigen /preferences-Request statt dreien.
  const options = read('../public/settings/pages/modules-options.js');
  for (const id of ['budget-mode-personal', 'health-cycle-enabled', 'housekeeping-payment-tasks']) {
    assert.match(options, controlIdPattern(id));
  }
  // Drei Schalter, sonst nichts: die Schalter selbst kommen aus dem geteilten
  // Primitiv, deshalb zählt das Blatt keine `<input>`-Literale mehr.
  assert.equal([...options.matchAll(/toggleRowHtml\(\{/g)].length, 3);
  assert.equal([...options.matchAll(/<(?:input|select|textarea)\b/g)].length, 0);
  assert.equal([...options.matchAll(/getPreferences\(\)/g)].length, 1);
  assert.match(options, /budget_mode: checked \? 'personal' : 'shared'/);
  // Die Währung sitzt in der vereinheitlichten Region/Format-Karte; das Blatt
  // trägt nur noch den Verweis dorthin, keine eigene Auswahl.
  assert.doesNotMatch(options, /id="currency-select"/);
  assert.match(options, /\/settings\/personal\/appearance/);
});

test('synchronization-by-data-type leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/sync-calendar.js',
    '../public/settings/pages/sync-contacts.js',
    '../public/settings/pages/sync-reminders.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{[^}]*\}(?:\s*=\s*\{\})?\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
    assert.doesNotMatch(source, /\brequire\(/, `${file} must use import, not require`);
    assert.match(
      source,
      /import \{ api \} from '\/api\.js'/,
      `${file} must import the shared API client`,
    );
  }
});

test('sync-calendar leaf loads CalDAV, ICS, Google, and Apple with independent status', () => {
  const source = read('../public/settings/pages/sync-calendar.js');

  // CalDAV calendar account management + status before forms.
  assert.match(source, /api\.get\('\/calendar\/caldav\/accounts'\)/);
  assert.match(source, /api\.post\('\/calendar\/caldav\/accounts'/);
  assert.match(source, /api\.delete\(`\/calendar\/caldav\/accounts\/\$\{[^}]+\}`\)/);
  assert.match(source, /\/calendar\/caldav\/accounts\/\$\{[^}]+\}\/calendars/);
  assert.match(source, /api\.post\('\/calendar\/caldav\/sync'\)/);
  assert.match(source, /createStatusSummary\(/);
  assert.match(source, /t\('settings\.caldavTitle'\)/);
  assert.match(source, /enabledCalendarCount/);
  assert.match(source, /neverSynced/);

  // Konto-Felder kommen als camelCase aus listAccounts() - snake_case lieferte
  // dauerhaft „Nie synchronisiert" und verschluckte die URL (#534-Nachlauf).
  assert.match(source, /account\.lastSync/);
  assert.match(source, /account\.caldavUrl/);
  assert.doesNotMatch(source, /account\.last_sync|account\.caldav_url/);
  // Checkbox-Toggles geben den Tastaturfokus zurück.
  assert.match(source, /import \{ withBusy \} from '\/utils\/ux\.js'/);
  assert.doesNotMatch(source, /checkbox\.disabled = true/);
  // Gleiche Aufklapp-Grammatik wie Kontakt-Sync (createDisclosure, kein <details>),
  // und die Löschbestätigung nennt das Konto beim Namen.
  assert.match(source, /createDisclosure\(\{[\s\S]*?caldav-calendars-/);
  assert.doesNotMatch(source, /createElement\('details'\)/);
  assert.match(source, /disconnectAccountConfirmTitle', \{ name: account\.name \}/);

  // Webcal / ICS subscriptions.
  assert.match(source, /api\.get\('\/calendar\/subscriptions'\)/);
  assert.match(source, /api\.post\('\/calendar\/subscriptions'/);
  assert.match(source, /api\.patch\(`\/calendar\/subscriptions\/\$\{[^}]+\}`/);
  assert.match(source, /api\.delete\(`\/calendar\/subscriptions\/\$\{[^}]+\}`\)/);

  // Independent fetches so one failure does not hide the others.
  assert.match(source, /Promise\.allSettled/);

  // Reminder-list collections must NOT leak into the calendar leaf.
  assert.doesNotMatch(source, /reminder-lists/);
  assert.doesNotMatch(source, /\/calendar\/caldav\/reminders\/sync/);

  // Google + Apple live behind one accessible "More providers" disclosure.
  assert.match(source, /createDisclosure\(/);
  assert.match(source, /settings\.moreProviders/);

  // Google: provider-specific labelled, all endpoints preserved.
  assert.match(source, /settings\.providerSpecific/);
  assert.match(source, /api\.get\('\/calendar\/google\/status'\)/);
  assert.match(source, /\/api\/v1\/calendar\/google\/auth/);
  assert.match(source, /api\.post\('\/calendar\/google\/sync'/);
  assert.match(source, /api\.get\('\/calendar\/google\/calendars'\)/);
  assert.match(source, /api\.patch\('\/calendar\/google\/calendars'/);
  assert.match(source, /api\.put\('\/calendar\/google\/readonly'/);
  assert.match(source, /api\.delete\('\/calendar\/google\/disconnect'\)/);

  // Apple: legacy badge + hint steering new users to CalDAV, endpoints preserved.
  assert.match(source, /settings\.legacy/);
  assert.match(source, /settings\.appleLegacyHint/);
  assert.match(source, /api\.get\('\/calendar\/apple\/status'\)/);
  assert.match(source, /api\.post\('\/calendar\/apple\/connect'/);
  assert.match(source, /api\.post\('\/calendar\/apple\/sync'/);
  assert.match(source, /api\.delete\('\/calendar\/apple\/disconnect'\)/);

  // OAuth callback handling: localized banner, expand disclosure, scrub only callback params.
  assert.match(source, /sync_ok/);
  assert.match(source, /sync_error/);
  assert.match(source, /history\.replaceState/);
});

test('sync-contacts leaf owns CardDAV account management', () => {
  const source = read('../public/settings/pages/sync-contacts.js');

  assert.match(source, /api\.get\('\/contacts\/cardav\/accounts'\)/);
  assert.match(source, /api\.post\('\/contacts\/cardav\/accounts'/);
  assert.match(source, /api\.delete\(`\/contacts\/cardav\/accounts\/\$\{[^}]+\}`\)/);
  assert.match(source, /\/contacts\/cardav\/accounts\/\$\{[^}]+\}\/addressbooks/);
  // Toggle geht per PUT auf die Adressbuch-ID, nicht auf einen Konto-Unterpfad (#534).
  assert.match(source, /api\.put\(`\/contacts\/cardav\/addressbooks\/\$\{[^}]+\}`/);
  assert.doesNotMatch(source, /addressbooks\/toggle/);
  assert.match(source, /addressbooks\/refresh/);
  assert.match(source, /\/contacts\/cardav\/accounts\/\$\{[^}]+\}\/sync/);
  // Konto-Felder kommen als camelCase aus getAllAccounts (#534).
  assert.match(source, /account\.lastSync/);
  assert.doesNotMatch(source, /account\.last_sync|account\.cardav_url/);

  // Audit-Nachlauf: Toggles und Aktionen laufen über withBusy (Fokus-Rückgabe,
  // aria-busy), zerstörende Aktion ist als danger-outline ausgewiesen, und die
  // Fehlerkarte bietet einen Ausweg statt einer Sackgasse.
  assert.match(source, /import \{ withBusy \} from '\/utils\/ux\.js'/);
  assert.match(source, /withBusy\(checkbox/);
  assert.match(source, /loadingClass: 'btn--loading'/);
  assert.match(source, /btn--danger-outline/);
  assert.match(source, /function buildUnreachableAccount/);
  assert.match(source, /t\('common\.retry'\)/);

  // Critique-Nachlauf: Bestätigung nennt das Konto, Passwortfeld ist ein neues
  // (nicht das App-Passwort), Formularfehler sind feldbezogen, und der Sync
  // meldet keinen Erfolg ohne aktiviertes Adressbuch.
  assert.match(source, /disconnectAccountConfirmTitle', \{ name: account\.name \}/);
  // Fremdserver-Passwort: weder das App-Passwort anbieten (current-password)
  // noch ein generiertes vorschlagen (new-password).
  assert.match(source, /id="cardav-password"[^>]*autocomplete="off"/);
  assert.doesNotMatch(source, /autocomplete="(current|new)-password"/);
  assert.match(source, /cardavCredentialsTrustHint/);
  assert.match(source, /wireBlurValidation\(form\)/);
  assert.match(source, /if \(!validateAll\(form\)\) return;/);
  assert.doesNotMatch(source, /t\('common\.allFieldsRequired'\)/);
  // Inaktiver Sync-Button bleibt tabbar: aria-disabled statt disabled, Klick
  // wird im Handler verworfen, Grund steht sichtbar in der Statuszeile.
  assert.match(source, /syncBtn\.setAttribute\('aria-disabled'/);
  assert.doesNotMatch(source, /syncBtn\.disabled = /);
  assert.doesNotMatch(source, /syncBtn\.title = /);
  assert.match(source, /aria-disabled'\) === 'true'\) return;/);
  assert.match(source, /syncBtn\.setAttribute\('aria-describedby'/);
  assert.match(source, /noAddressbookEnabled/);
  assert.match(source, /notSyncedYet/);
  // Genau eine Zahl je Karte: „N von M", kein zweiter Zähler als Aufzählungspunkt.
  assert.match(source, /addressbooksEnabledOfTotal/);
  assert.doesNotMatch(source, /key: 'addressbook-count'/);

  // Konto bearbeiten (statt löschen + neu anlegen), Sammelschalter und
  // sichtbare Sync-Teilfehler - die drei offenen Punkte aus dem Critique.
  assert.match(source, /api\.put\(`\/contacts\/cardav\/accounts\/\$\{account\.id\}`/);
  assert.match(source, /settings\.cardavEditAccount/);
  assert.match(source, /settings\.enableAll/);
  assert.match(source, /settings\.disableAll/);
  assert.match(source, /account\.lastError/);
  assert.match(source, /settings\.syncErrorDetail/);
  // Geteilte Aufklapp-Komponente statt rohem <details>.
  assert.match(source, /createDisclosure\(\{/);
  assert.doesNotMatch(source, /createElement\('details'\)/);
  assert.doesNotMatch(source, /details = \[t\('settings\.cardavTitle'\)\]/, 'Modultitel nicht als Detailzeile wiederholen');

  // Contacts leaf must not own calendar or reminder concerns.
  assert.doesNotMatch(source, /\/calendar\/caldav/);
  assert.doesNotMatch(source, /\/calendar\/google/);
  assert.doesNotMatch(source, /\/calendar\/apple/);
});

test('sync-reminders leaf maps CalDAV reminder lists and syncs without calendars', () => {
  const source = read('../public/settings/pages/sync-reminders.js');

  // Reuse CalDAV accounts but render only reminder/task collections.
  assert.match(source, /api\.get\('\/calendar\/caldav\/accounts'\)/);
  assert.match(source, /reminder-lists/);
  assert.match(source, /api\.patch\(`\/calendar\/caldav\/accounts\/\$\{[^}]+\}\/reminder-lists`/);
  assert.match(source, /api\.post\('\/calendar\/caldav\/reminders\/sync'\)/);
  assert.match(source, /targetModule/);
  assert.match(source, /settings\.caldavReminderMapTasks/);
  assert.match(source, /settings\.caldavReminderMapShopping/);
  assert.match(source, /settings\.caldavRemindersHint/);

  // Konto-Felder als camelCase, Toggle mit Fokus-Rückgabe (#534-Nachlauf).
  assert.match(source, /account\.lastSync/);
  assert.match(source, /account\.caldavUrl/);
  assert.doesNotMatch(source, /account\.last_sync|account\.caldav_url/);
  assert.match(source, /import \{ withBusy \} from '\/utils\/ux\.js'/);

  // Calendar collections must NOT appear in the reminders leaf.
  assert.doesNotMatch(source, /\/calendars\b/);
  assert.doesNotMatch(source, /\/calendar\/caldav\/sync\b/);
});

test('documents-domain leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/documents-storage.js',
    '../public/settings/pages/documents-dms.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{[^}]*\}(?:\s*=\s*\{\})?\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
    assert.doesNotMatch(source, /\brequire\(/, `${file} must use import, not require`);
    assert.match(
      source,
      /import \{ api \} from (['"])\/api\.js\1/,
      `${file} must import the shared API client`,
    );
  }
});

test('documents-storage leaf owns hybrid document storage with a status-first layout', () => {
  const source = read('../public/settings/pages/documents-storage.js');

  // Storage config + test endpoints preserved unchanged.
  assert.match(source, /api\.get\((['"])\/documents\/storage\/config\1\)/);
  assert.match(source, /api\.put\((['"])\/documents\/storage\/config\1/);
  assert.match(source, /api\.post\((['"])\/documents\/storage\/test\1/);

  // Status-first: render the active backend and target before the connection fields.
  assert.match(source, /createStatusSummary\(/);
  assert.match(source, /active_upload_backend/);
  assert.match(source, /selected_upload_backend/);
  assert.match(source, /webdav_document_count/);
  assert.match(source, /google_drive/);
  assert.match(source, /documentStorageTarget/);

  // Drive uses the shared API client and a normal anchor for OAuth.
  assert.match(source, /\/documents\/storage\/google-drive\/auth/);
  assert.match(source, /api\.post\((['"])\/documents\/storage\/google-drive\/test\1/);
  assert.match(source, /api\.delete\((['"])\/documents\/storage\/google-drive\/disconnect\1/);
  assert.match(source, /createSettingRow\(/);
  assert.match(source, /drive_ok/);
  assert.match(source, /drive_error/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /settings\.documentStorageGoogleDrivePrivacy/);

  // Connection fields live behind an accessible disclosure.
  assert.match(source, /createDisclosure\(/);

  // Protected-change detection + confirm before save.
  assert.match(source, /hasProtectedDocumentStorageChange/);
  assert.match(source, /settings\.documentStorageConfirmExisting/);

  // Env-controlled handling + backup warning preserved.
  assert.match(source, /env_controlled/);
  assert.match(source, /settings\.documentStorageBackupWarning/);

  // Storage leaf must not own DMS concerns.
  assert.doesNotMatch(source, /\/documents\/dms/);
});

test('documents-dms leaf owns DMS account management (Paperless + Papra)', () => {
  const source = read('../public/settings/pages/documents-dms.js');

  assert.match(source, /api\.get\('\/documents\/dms\/accounts'\)/);
  assert.match(source, /api\.post\('\/documents\/dms\/accounts'/);
  assert.match(source, /api\.delete\(`\/documents\/dms\/accounts\/\$\{[^}]+\}`\)/);
  assert.match(source, /\/documents\/dms\/accounts\/\$\{[^}]+\}\/test/);
  assert.match(source, /value="paperless"/);
  assert.match(source, /value="papra"/);

  // DMS leaf must not own storage concerns.
  assert.doesNotMatch(source, /\/documents\/storage/);
});

test('administration-domain leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/admin-family.js',
    '../public/settings/pages/admin-api.js',
    '../public/settings/pages/admin-backup.js',
    '../public/settings/pages/admin-weather.js',
    '../public/settings/pages/admin-system.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{[^}]*\}(?:\s*=\s*\{\})?\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
    assert.doesNotMatch(source, /\brequire\(/, `${file} must use import, not require`);
    // Entweder direkt oder über einen geteilten Settings-Baustein
    // (preferences-cache, weather-location) - nie über rohes fetch.
    assert.match(
      source,
      /import \{ api(?:,\s*auth)? \} from '\/api\.js'|from '\/settings\/(?:preferences-cache|weather-location)\.js'/,
      `${file} must import the shared API client`,
    );
  }
});

test('admin-family leaf owns family member + role management lazily', () => {
  const source = read('../public/settings/pages/admin-family.js');

  // Users are fetched only when the leaf is active, via the auth helper.
  assert.match(source, /auth\.getUsers\(\)/);
  assert.match(source, /auth\.createUser\(/);
  assert.match(source, /auth\.updateUser\(/);
  assert.match(source, /auth\.deleteUser\(/);
  assert.match(source, /buildFamilyRoleOptions/);
  assert.match(source, /family_role/);
  assert.match(source, /birth_date/);

  // Family leaf must not own API token, backup, or version concerns.
  assert.doesNotMatch(source, /\/auth\/api-tokens/);
  assert.doesNotMatch(source, /\/backup\//);
  assert.doesNotMatch(source, /\/version/);
});

test('admin-api leaf owns API token lifecycle with one-time secret display', () => {
  const source = read('../public/settings/pages/admin-api.js');

  assert.match(source, /api\.get\('\/auth\/api-tokens'\)/);
  assert.match(source, /api\.post\('\/auth\/api-tokens'/);
  assert.match(source, /api\.delete\(`\/auth\/api-tokens\/\$\{[^}]+\}`\)/);

  // The raw token is only ever read from the creation response.
  assert.match(source, /res\.token/);

  // API leaf must not own family, backup, or version concerns.
  assert.doesNotMatch(source, /\/auth\/users/);
  assert.doesNotMatch(source, /\/backup\//);
  assert.doesNotMatch(source, /\/version/);
});

test('admin-backup leaf owns database + WebDAV backup without document storage', () => {
  const source = read('../public/settings/pages/admin-backup.js');

  assert.match(source, /\/api\/v1\/backup\/database/);
  assert.match(source, /api\.rawPost\('\/backup\/restore'/);
  assert.match(source, /api\.get\('\/backup\/status'\)/);
  assert.match(source, /api\.post\('\/backup\/trigger'\)/);
  assert.match(source, /api\.get\('\/backup\/webdav\/config'\)/);
  assert.match(source, /api\.put\('\/backup\/webdav\/config'/);
  assert.match(source, /api\.post\('\/backup\/webdav\/test'/);
  assert.match(source, /api\.post\('\/backup\/webdav\/trigger'\)/);

  // CLI recovery guidance lives behind a collapsed disclosure.
  assert.match(source, /createDisclosure\(/);
  assert.match(source, /settings\.backupCliTitle/);

  // Backup leaf must not own document-storage WebDAV or API/version concerns.
  assert.doesNotMatch(source, /\/documents\/storage/);
  assert.doesNotMatch(source, /\/auth\/api-tokens/);
  assert.doesNotMatch(source, /\/version/);
});

test('personal-calendar leaf owns only the per-user event defaults', () => {
  const source = read('../public/settings/pages/personal-calendar.js');

  assert.match(source, controlIdPattern('calendar-default-assign-me'));
  assert.match(source, /id="calendar-default-reminders"/);
  assert.match(source, /savePreferences\(\{ calendar_default_assign_me: value \}\)/);
  assert.match(source, /savePreferences\(\{ calendar_default_reminders: selected \}\)/);
  // Die Grenze muss auf dem Blatt stehen, sonst erklärt nichts, warum
  // Standarddauer und Wochenstart hier fehlen.
  assert.match(source, /settings\.calendarDefaultsScopeHint/);

  // Haushaltweites bleibt im adminOnly-Kalenderblatt.
  assert.doesNotMatch(source, /week_start|calendar_default_duration|holiday_/);
});

// Das Standortformular selbst liegt in weather-location.js: admin-weather und
// personal-weather rendern dieselben fünf Felder mit denselben i18n-Keys, und
// requestLocation samt Koordinatenvalidierung lag zweimal im Baum
// (Critique 2026-07-27).
test('beide Wetter-Blätter rendern dasselbe Standortformular', () => {
  const shared = read('../public/settings/weather-location.js');
  for (const field of ['lat', 'lon', 'city', 'units', 'auto-locate', 'locate-btn']) {
    assert.match(shared, new RegExp(`id="\\$\\{scope\\}-${field}"|id: \`\\$\\{scope\\}-${field}\``));
  }
  assert.match(shared, /latitude >= -90/);
  assert.match(shared, /latitude <= 90/);
  assert.match(shared, /longitude >= -180/);
  assert.match(shared, /longitude <= 180/);
  // Genau ein requestLocation im ganzen Settings-Baum.
  const owners = walkFrontendFiles('../public/settings/')
    .filter((path) => /function requestLocation\(/.test(read(path)));
  assert.deepEqual(owners, ['../public/settings/weather-location.js']);

  for (const leaf of ['admin-weather', 'personal-weather']) {
    const source = read(`../public/settings/pages/${leaf}.js`);
    assert.match(source, /weatherLocationFieldsHtml\(\{/, `${leaf} muss das geteilte Formular rendern`);
    assert.match(source, /bindWeatherLocationEvents\(container, SCOPE\)/);
    assert.match(source, /hasValidWeatherCoords\(location\.lat, location\.lon\)/);
    assert.doesNotMatch(source, /navigator\.geolocation/, `${leaf} darf Geolocation nicht selbst anfassen`);
  }
});

test('admin-weather leaf owns the household default location', () => {
  const source = read('../public/settings/pages/admin-weather.js');

  assert.match(source, /HOUSEHOLD_WEATHER_SCOPE as SCOPE/);
  assert.match(source, /weather_provider: 'open-meteo'/);
  assert.match(source, /weather_provider: null/);
  assert.match(source, /window\.myhub\?\.showToast/);
  assert.match(source, /await render\(container, \{ user \}\)/);
  // Die Vorrangregel muss auf dem Blatt stehen: personal-weather überschreibt
  // diesen Standort, und ohne den Hinweis erklärt das nichts (Critique 2026-07-27).
  assert.match(source, /settings\.householdWeatherOverrideHint/);

  // Der Anwendungsname ist beim IA-Umbau zu admin-system gewandert.
  assert.doesNotMatch(source, /app_name|app-name-input|APP_NAME_STORAGE_KEY/);
  assert.doesNotMatch(source, /\/version/);
});

test('admin-system leaf owns the app name next to the read-only version rows', () => {
  const source = read('../public/settings/pages/admin-system.js');

  assert.match(source, /api\.get\('\/version'\)/);
  assert.match(source, /settings\.systemVersionLabel/);
  assert.match(source, /MIT/);
  assert.match(source, /setup_required/);

  // Der Anwendungsname lag in "Übersicht", während die Description dieses Blatts
  // ihn versprach und nur read-only zeigte (Critique 2026-07-27).
  assert.match(source, /id="app-name-input"/);
  assert.match(source, /savePreferences\(\{ app_name: value \}\)/);
  assert.match(source, /new CustomEvent\('app-name-changed'/);
  assert.match(source, /localStorage\.setItem\(key, value\)/);
  assert.match(source, /localStorage\.removeItem\(key\)/);
  // Die read-only Zeile daneben wäre der gleiche Wert zweimal auf einer Seite.
  assert.doesNotMatch(source, /systemAppNameLabel/);

  // System leaf owns no other backend domain and no secrets.
  assert.doesNotMatch(source, /\/documents\//);
  assert.doesNotMatch(source, /\/backup\//);
  assert.doesNotMatch(source, /\/auth\/api-tokens/);
  assert.doesNotMatch(source, /weather_/);
});

test('Shopping uses the shared category manager component (Audit F-15)', () => {
  const component = read('../public/components/category-manager.js');
  assert.match(component, /customElements\.define\(\s*'my-hub-category-manager'/);
  assert.match(component, /import \{ api \} from '\/api\.js'/);
  assert.match(component, /import \{ t \} from '\/i18n\.js'/);
  assert.match(component, /import \{ esc \} from '\/utils\/html\.js'/);
  // Schlüssel-Helper: Budget/Tasks/Kontakte liefern `key`, Einkauf numerische `id`.
  assert.match(component, /item\.key \?\? item\.id/);
  assert.match(component, /disconnectedCallback\(\)/);
  assert.match(component, /removeEventListener/);
  assert.doesNotMatch(component, /#[0-9a-f]{6}/i);

  const shopping = read('../public/pages/shopping.js');
  assert.match(shopping, /components\/category-manager\.js/);
  assert.match(shopping, /<my-hub-category-manager>/);
  assert.match(shopping, /basePath: '\/shopping\/categories'/);
  assert.match(shopping, /shopping\.manageCategories/);
  assert.match(shopping, /category-manager-changed/);
  // onClose muss den Listener wieder abräumen (kein Leak bei Modal-Reuse).
  const openMgr = shopping.match(/async function openCategoryManager[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(openMgr, /manager\?\.removeEventListener\('category-manager-changed'/);

  // Die frühere Shopping-Sonderkomponente ist entfernt — kein Duplikat mehr.
  assert.equal(existsSync(new URL('../public/components/shopping-category-manager.js', import.meta.url)), false);
});

test('Kitchen settings copy directs Recipes and Shopping content settings to their modules', () => {
  const english = JSON.parse(read('../public/locales/en.json'));
  const german = JSON.parse(read('../public/locales/de.json'));
  const kitchenPage = read('../public/settings/pages/modules-kitchen.js');

  // Der Zeiger stand in der Leaf-Description und machte sie zum einzigen
  // Zweisatz unter 24 (Critique 2026-07-27). Er lebt jetzt als Hinweis auf dem
  // Blatt selbst - dieselbe Information, an der Stelle, wo sie gebraucht wird.
  assert.match(kitchenPage, /t\('settings\.kitchenExternalHint'\)/);
  assert.match(english.settings.kitchenExternalHint, /Recipes/);
  assert.match(english.settings.kitchenExternalHint, /Shopping/);
  assert.match(english.settings.kitchenExternalHint, /modules/);
  assert.match(german.settings.kitchenExternalHint, /Rezepte/);
  assert.match(german.settings.kitchenExternalHint, /Einkauf/);
  assert.match(german.settings.kitchenExternalHint, /Modulen/);
});

test('Recipes expose meal-type suitability controls for planner integrations', () => {
  const recipesPage = read('../public/pages/recipes.js');
  const recipesCss = read('../public/styles/recipes.css');

  assert.match(recipesPage, /normalizeRecipeMealTypes/);
  assertKeysExistInEveryLocale(['recipes.dragToMealsHint']);
  assert.match(recipesPage, /id="recipe-meal-types"/);
  assert.match(recipesPage, /input type="checkbox" value="\$\{option\.key\}" checked/);
  assert.match(recipesPage, /meal_types/);
  assert.match(recipesCss, /\.recipe-meal-types\s*\{/);
  assert.match(recipesCss, /\.recipe-card__meal-types\s*\{/);
});

test('Meals page adds a recipe sidebar and randomize planner controls', () => {
  const mealsPage = read('../public/pages/meals.js');
  const mealsCss = read('../public/styles/meals.css');

  assert.match(mealsPage, /id="week-randomize"/);
  assert.match(mealsPage, /id="recipe-sidebar"/);
  assert.match(mealsPage, /recipes\.dragToMealsHint/);
  assert.match(mealsPage, /function renderRecipeSidebar/);
  assert.match(mealsPage, /function openRandomizeModal/);
  assert.match(mealsPage, /function wireRecipeSidebar/);
  assert.match(mealsPage, /confirmModal\(t\('meals\.replaceExistingConfirm'\)/, 'dropping onto occupied slots should use a dedicated localized confirmation string');
  assert.match(mealsPage, /recipeSupportsMealType/);
  assert.match(mealsCss, /\.meals-layout\s*\{/);
  assert.match(mealsCss, /\.recipe-sidebar\s*\{/);
  assert.match(mealsCss, /\.week-nav__randomize\s*\{/);
  assertKeysExistInEveryLocale([
    'meals.randomizePlan',
    'meals.randomizeTitle',
    'meals.randomizeReplaceExisting',
    'meals.replaceExistingConfirm',
    'meals.randomizeSuccess',
    'meals.randomizeWeekFull',
    'meals.randomizeNoRecipes',
  ]);
});

test('browser loader supports personal settings API and auth imports', () => {
  const source = read('./test-browser-loader.mjs');

  assert.match(source, /patch:\s*async/);
  assert.match(source, /export const auth/);
  assert.match(source, /me:\s*async/);
  assert.match(source, /getUsers:\s*async/);
  assert.match(source, /'\/utils\/pwa-install\.js'/);
  assert.match(source, /getPwaInstallState/);
  assert.match(source, /onPwaInstallStateChanged/);
  assert.match(source, /promptPwaInstall/);
});

test('legacy settings page remains available during the leaf migration', () => {
  assert.equal(existsSync(new URL('../public/pages/settings.js', import.meta.url)), true);
});

test('user multi-select option is the containing block of its hidden checkbox (#483)', () => {
  // The checkbox is position:absolute + opacity:0 (visually hidden but focusable).
  // Without position:relative on the option, it resolves against the overflow:hidden
  // .modal-panel, so tapping a member scrolls the panel instead of the modal body —
  // a large blank block appears and later fields become unreachable on mobile.
  const css = read('../public/styles/user-multi-select.css');
  assert.match(
    css,
    /\.user-ms__option\s*\{[^}]*position:\s*relative/,
    '.user-ms__option must declare position: relative',
  );
  assert.match(
    css,
    /\.user-ms__checkbox\s*\{[^}]*position:\s*absolute/,
    'guard assumes .user-ms__checkbox stays position: absolute',
  );
});

test('responsive settings shell defines desktop and mobile navigation layouts', () => {
  const source = read('../public/styles/settings.css');

  assert.match(
    source,
    /@media \(min-width:\s*1024px\)[\s\S]*\.settings-shell__navigation\s*\{[\s\S]*position:\s*sticky/,
  );
  assert.match(
    source,
    /@media \(max-width:\s*1023px\)[\s\S]*\.settings-mobile-overview\s*\{/,
  );
});

test('settings disclosure exposes its expanded state and controlled panel', () => {
  const source = read('../public/settings/components.js');

  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-controls/);
});

test('settings rows programmatically label form controls and preserve descriptions', () => {
  const source = read('../public/settings/components.js');

  assert.match(source, /let settingRowIdCounter\s*=\s*0/);
  assert.match(source, /control\?\.matches\?\.\(['"]input,\s*select,\s*textarea,\s*button['"]\)/);
  assert.match(source, /control\?\.querySelector\?\.\(['"]input,\s*select,\s*textarea,\s*button['"]\)/);
  assert.match(source, /if \(formControl && !formControl\.id\)/);
  assert.match(source, /document\.createElement\(formControl \? 'label' : 'div'\)/);
  assert.match(source, /title\.htmlFor\s*=\s*formControl\.id/);
  assert.match(source, /detail\.id\s*=/);
  assert.match(source, /formControl\.getAttribute\('aria-describedby'\)/);
  assert.match(source, /describedBy\.push\(detail\.id\)/);
  assert.match(source, /describedBy\.join\(' '\)/);
  assert.match(source, /formControl\.setAttribute\('aria-describedby'/);
});

test('push client re-registers an orphaned subscription', () => {
  const source = read('../public/push.js');

  // App-Start: bestehendes Abo nachregistrieren, sonst bleibt ein serverseitig
  // entferntes Abo (410, DB-Restore) dauerhaft stumm.
  assert.match(source, /if \(st\.subscribed\) await resyncSubscription\(\)/);
  assert.match(source, /async function resyncSubscription\(\)/);
  assert.match(source, /api\.post\('\/push\/subscribe', sub\.toJSON\(\)\)/);
  // Reparatur erkennt ein Abo auf einem veralteten VAPID-Key und legt es neu an.
  assert.match(source, /async function repairPush\(\)/);
  assert.match(source, /!matchesServerKey\(sub, serverKey\)/);
  assert.match(source, /await sub\.unsubscribe\(\)/);
  // Nie ungefragt nachfragen: Reparatur setzt eine erteilte Berechtigung voraus.
  assert.match(source, /Notification\.permission !== 'granted'\) return false/);
});

test('notification settings report real delivery and self-heal once', () => {
  const source = read('../public/settings/pages/notifications.js');

  // Erfolgsmeldung nur bei tatsaechlich zugestelltem Push.
  assert.match(source, /sent = Number\(res\?\.data\?\.sent\) \|\| 0/);
  assert.match(source, /if \(sent > 0\) status\.textContent = t\('settings\.pushTestSent'\)/);
  assert.match(source, /t\('settings\.pushTestFailed'\)/);
  assert.match(source, /t\('settings\.pushTestNoDevice'\)/);
  // Genau ein Reparaturversuch, kein Retry-Loop: ein regulaerer Versand plus
  // hoechstens einer nach der Reparatur.
  assert.match(source, /repaired = await repairPush\(\)/);
  assert.equal(source.match(/await sendTest\(\)/g).length, 2);
  // iOS ohne Home-Screen-Installation bekommt den Grund genannt, nicht "nicht unterstuetzt".
  assert.match(source, /getPwaInstallState\(\)\.ios/);
  assert.match(source, /t\('settings\.pushIosNotInstalled'\)/);
});

test('settings shell marks and focuses the active page', () => {
  const source = read('../public/settings/shell.js');

  assert.match(source, /setAttribute\('aria-current',\s*'page'\)/);
  assert.match(source, /\.tabIndex\s*=\s*-1/);
  assert.match(source, /\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
});

test('settings retry focus only moves to a connected replacement button after retry failure', () => {
  const source = read('../public/settings/shell.js');

  assert.match(source, /const loadAndRender = async \(\{\s*focusRetry = false\s*\} = \{\}\) =>/);
  assert.match(source, /onRetry:\s*\(\) => loadAndRender\(\{\s*focusRetry:\s*true\s*\}\)/);
  assert.match(
    source,
    /if \(focusRetry\)[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*retryButton\?\.isConnected[\s\S]*retryButton\.focus\(\{\s*preventScroll:\s*true\s*\}\)/,
  );
  assert.match(source, /await loadAndRender\(\);/);
});

test('settings shell falls back to the domains overview for orphaned active leaves', () => {
  const source = read('../public/settings/shell.js');

  assert.match(source, /if \(!domain\)\s*\{[\s\S]*console\.error\([\s\S]*renderDomainsOverview\(content,\s*domains(?:,\s*user)?\)/);
  assert.match(source, /else\s*\{[\s\S]*await renderLeafContent\(content,\s*activeLeaf,\s*domain,\s*user,\s*query\)/);
});

test('router hides inactive overlays from keyboard focus', () => {
  const source = read('../public/router.js');
  assert.match(source, /\.inert\s*=/);
  assert.match(source, /returnFocus/);
});

test('mobile More sheet trigger controls its dialog and traps keyboard focus', () => {
  const source = read('../public/router.js');

  assert.match(source, /moreBtn\.setAttribute\('aria-controls',\s*'more-sheet'\)/);
  assert.match(source, /const currentMoreBtn = \(\) => container\.querySelector\('#more-btn'\) \|\| moreBtn/);
  assert.match(source, /currentMoreBtn\(\)\.setAttribute\('aria-expanded',\s*'true'\)/);
  assert.match(source, /currentMoreBtn\(\)\.setAttribute\('aria-expanded',\s*'false'\)/);
  assert.match(source, /function\s+createFocusTrap/);
  assert.match(source, /moreSheetTrap/);
  assert.match(source, /addEventListener\('keydown',\s*moreSheetTrap/);
  assert.match(source, /removeEventListener\('keydown',\s*moreSheetTrap/);
});

test('More button active state keeps visible More identity and accessible active context', () => {
  const source = read('../public/router.js');

  assert.match(source, /function\s+setMoreButtonState/);
  assert.match(source, /moreBtn\.setAttribute\('aria-current',\s*'page'\)/);
  assert.match(source, /moreBtn\.setAttribute\('aria-label',\s*moreLabel\)/);
  assert.match(source, /moreBtn\.setAttribute\('title',\s*t\('nav\.more'\)\)/);
  assert.doesNotMatch(source, /moreBtn\.toggleAttribute\('aria-current',\s*inMoreSheet\)/);
});

test('mobile navigation derives five stable destinations from three favorites', () => {
  const source = read('../public/router.js');

  assert.match(source, /const\s+MOBILE_FAVORITE_COUNT\s*=\s*3/);
  assert.match(source, /resolveMobileNavOrder/);
  assert.match(source, /function\s+mobileFavoriteItems/);
  assert.match(source, /function\s+buildBottomNavItems/);
});

test('jede verwendete btn--Variante ist im Stylesheet definiert', () => {
  // `btn--danger-outline` wurde an zehn Stellen verwendet, war aber nirgends
  // definiert: der Button fiel auf die UA-Farbe `buttontext` zurück (im Dark
  // Mode 1.32:1). Undefinierte Utility-Klassen sind unsichtbare Bugs.
  const css = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((file) => file.endsWith('.css'))
    .map((file) => read(`../public/styles/${file}`))
    .join('\n');
  const defined = new Set([...css.matchAll(/\.(btn--[a-z0-9-]+)/g)].map((m) => m[1]));

  const used = new Set();
  for (const file of walkFrontendFiles('../public/')) {
    if (file.includes('/vendor/') || file.includes('lucide')) continue;
    // Lookbehind grenzt gegen fremde Blöcke ab: `task-status-btn--done` ist
    // keine Variante von `.btn`.
    for (const match of read(file).matchAll(/(?<![\w-])btn--[a-z0-9-]+/g)) used.add(match[0]);
  }

  const missing = [...used].filter((cls) => !defined.has(cls)).sort();
  assert.deepEqual(missing, [], `btn-Varianten ohne CSS-Regel: ${missing.join(', ')}`);
});

test('Sync-Kontolisten decken die Grid-Spalte, damit mobil nichts abgeschnitten wird', () => {
  const settings = read('../public/styles/settings.css');
  // Ohne minmax(0, 1fr) wächst die implizite Spalte auf max-content: eine lange
  // Konto-URL schob die Aktionsleiste bei 375px aus dem Viewport.
  assert.match(
    settings,
    /\.settings-sync-accounts\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    settings,
    /\.settings-status-summary__details li\s*\{[^}]*overflow-wrap:\s*anywhere/,
  );
  assert.match(
    settings,
    /\.caldav-calendars-summary\s*\{[^}]*min-height:\s*var\(--target-lg\)/,
  );
  // Genau EINE Rahmenebene, und zwar um das Konto: die Karte trägt den Rahmen,
  // die Statuszeile darin ist Kopfzeile ohne eigene Fläche. Ohne diese Grenze
  // verliert „Trennen" bei mehreren Konten seinen Besitzer.
  // Rahmenfarbe aus der Tinte gemischt, nicht --color-border: das ist im Dark
  // Mode dunkler als die Kartenfläche und damit unsichtbar (gemessen 1.06:1).
  assert.match(
    settings,
    /\.caldav-account-item\s*\{[\s\S]*?border:\s*var\(--space-px\) solid color-mix\(in srgb, var\(--color-text-primary\)/,
  );
  assert.match(
    settings,
    /\.caldav-account-item \.settings-status-summary\s*\{[^}]*border:\s*0/,
  );
  assert.match(
    settings,
    /\.caldav-account-item \.settings-disclosure\s*\{[^}]*border:\s*0/,
  );
  // Glas-Tokens sind weiß-transparent und auf der weißen Karte unsichtbar -
  // deshalb Flächen-Tokens, oben positiv gepinnt.
  assert.doesNotMatch(
    settings,
    /\.caldav-account-item\s*\{[^}]*border:\s*var\(--space-px\) solid var\(--glass-border-subtle\)/,
  );
});

test('mobile navigation uses neutral inactive wells and one active indicator', () => {
  const layout = read('../public/styles/layout.css');

  assert.match(
    layout,
    /\.nav-item__icon-well\s*\{[\s\S]*?background:\s*var\(--color-surface-elevated\)/,
  );
  assert.match(
    layout,
    /\.nav-item\[aria-current="page"\] \.nav-item__icon-well,[\s\S]*?background:\s*transparent/,
  );
  assert.doesNotMatch(layout, /\.nav-bottom__indicator\s*\{[\s\S]*?width\s+0\.45s/);
});

test('mobile navigation Quiet Precision keeps state feedback stable and accessible', () => {
  const layout = read('../public/styles/layout.css');
  const glass = read('../public/styles/glass.css');
  const indicatorRule = cssRuleBody(layout, '.nav-bottom__indicator');
  const indicatorSurfaceRule = cssRuleBody(layout, '.nav-bottom__indicator::before');
  const indicatorSurfaceGlass = cssRuleBody(glass, '.nav-bottom__indicator::before');
  const focusRule = cssRuleBody(layout, '.nav-bottom .nav-item:focus-visible');
  const pressedWellRule = cssRuleBody(layout, '.nav-bottom .nav-item:active .nav-item__icon-well');

  assert.match(indicatorSurfaceRule, /inset-inline:\s*var\(--space-1\)/);
  assert.doesNotMatch(indicatorRule, /transition:[^;]*\bwidth\b/);
  assert.match(
    layout,
    /\.nav-bottom \.nav-item\[aria-current="page"\] \.nav-item__label,\s*\.nav-bottom \.nav-item--active \.nav-item__label\s*\{[\s\S]*?color:\s*var\(--item-module-accent,\s*var\(--active-module-accent,\s*var\(--color-accent\)\)\)/,
  );
  assert.match(
    layout,
    /\.nav-bottom \.nav-item\[aria-current="page"\] \.nav-item__label,\s*\.nav-bottom \.nav-item--active \.nav-item__label\s*\{[\s\S]*?font-weight:\s*var\(--font-weight-semibold\)/,
  );
  // Fokusring liegt AUSSEN um die Icon-Well (nicht innen ins Item) — so ist er
  // für Tastatur-/Sehbeeinträchtigte klar zu orten statt hinter Icon+Label zu
  // verschwinden.
  assert.match(focusRule, /outline:\s*none/);
  const focusWellRule = cssRuleBody(layout, '.nav-bottom .nav-item:focus-visible .nav-item__icon-well');
  assert.match(focusWellRule, /outline:\s*var\(--space-0h\)\s+solid/);
  assert.match(focusWellRule, /outline-offset:\s*var\(--space-0h\)/);
  assert.match(pressedWellRule, /transform:\s*translateY\(var\(--space-px\)\) scale\(0\.96\)/);
  assert.doesNotMatch(layout, /(^|\n)\.nav-item:active\s*\{[\s\S]*?transform:/);
  assert.doesNotMatch(layout, /\.nav-bottom \.nav-item:active\s*\{[\s\S]*?transform:/);
  // EINE Tint-Schicht: der Akzent-Fill sitzt am Indikator selbst; das ::before
  // trägt nur noch den Specular-Highlight (kein zweiter Tint → keine matschige
  // Kante der gleitenden Pille).
  assert.match(
    glass,
    /\.nav-bottom__indicator\s*\{[\s\S]*?background:\s*color-mix\(in srgb,\s*var\(--active-module-accent,\s*var\(--color-accent\)\)/,
  );
  assert.doesNotMatch(indicatorSurfaceGlass, /background:/);
  assert.match(
    glass,
    /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.nav-bottom__indicator\s*\{[\s\S]*?background:/,
  );
  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.nav-bottom \.nav-item:active \.nav-item__icon-well\s*\{[\s\S]*?transform:\s*none/,
  );
  assert.match(
    layout,
    /@media \(prefers-contrast: more\)[\s\S]*?\.nav-item\[aria-current="page"\],\s*\.nav-item--active\s*\{[\s\S]*?text-decoration:\s*underline/,
  );
  assert.match(
    layout,
    /@media \(forced-colors: active\)[\s\S]*?\.nav-item\[aria-current="page"\],\s*\.nav-item--active\s*\{[\s\S]*?border-bottom:\s*2px solid Highlight/,
  );
});

test('More-Sheet honours prefers-reduced-motion (no vestibular slide-up)', () => {
  const layout = read('../public/styles/layout.css');

  // Normalzustand: der Slide trägt einen transform-Transition.
  assert.match(cssRuleBody(layout, '.more-sheet'), /transition:\s*transform/);

  // Reduced-Motion: der translateY-Slide wird durch einen bewegungsfreien
  // Opacity-Fade ersetzt — der Transform snappt ohne Bewegung.
  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.more-sheet\s*\{[\s\S]*?transition:\s*opacity[\s\S]*?opacity:\s*0/,
  );
  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.more-sheet\[aria-hidden="false"\]\s*\{[\s\S]*?opacity:\s*1/,
  );

  // Das Such-Overlay der More-Sheet teilt denselben Slide und muss ebenfalls
  // bewegungsfrei faden.
  assert.match(cssRuleBody(layout, '.search-overlay'), /transition:\s*transform/);
  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.search-overlay\s*\{[\s\S]*?transition:\s*opacity[\s\S]*?opacity:\s*0/,
  );
});

test('bottom-nav labels wrap to two lines instead of clipping across locales', () => {
  const layout = read('../public/styles/layout.css');
  const labelRule = cssRuleBody(layout, '.nav-bottom .nav-item__label');

  // Zweizeiliges Wrapping statt Single-Line-Ellipsis; Langwörter brechen um.
  assert.match(labelRule, /white-space:\s*normal/);
  assert.match(labelRule, /-webkit-line-clamp:\s*2/);
  assert.match(labelRule, /overflow-wrap:\s*anywhere/);

  // Die Items-Reihe wächst mit dem Inhalt (min-height statt fixer Höhe).
  assert.match(cssRuleBody(layout, '.nav-bottom__items'), /min-height:\s*var\(--nav-height-mobile\)/);
  assert.doesNotMatch(cssRuleBody(layout, '.nav-bottom__items'), /(^|[^-])height:\s*var\(--nav-height-mobile\)/);

  // Longest-String-Guard: kein bottom-bar-Nav-Label darf so lang werden, dass
  // selbst zwei Zeilen in einem ~72px-Slot es nicht mehr fassen.
  const NAV_KEYS = [
    'dashboard', 'calendar', 'tasks', 'notes', 'kitchen', 'contacts', 'birthdays',
    'budget', 'documents', 'housekeeping', 'rewards', 'health', 'settings', 'more',
    'shopping', 'meals', 'recipes',
  ];
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  const offenders = [];
  for (const file of localeFiles) {
    const nav = JSON.parse(read(`../public/locales/${file}`)).nav || {};
    for (const key of NAV_KEYS) {
      const value = nav[key];
      if (typeof value === 'string' && value.length > 24) offenders.push(`${file}:nav.${key} (${value.length}) "${value}"`);
    }
  }
  assert.deepEqual(offenders, [], `bottom-bar nav labels over 24 chars need a shorter canonical label:\n${offenders.join('\n')}`);
});

test('bottom-nav icon-well fills the 44x44 touch-comfort zone', () => {
  const layout = read('../public/styles/layout.css');
  const tokens = read('../public/styles/tokens.css');
  const wellRule = cssRuleBody(layout, '.nav-bottom .nav-item__icon-well');

  // Sichtbares Well: 44 breit × 40 hoch (kein 32px-Streifen mehr).
  assert.match(wellRule, /width:\s*var\(--target-base\)/);
  assert.match(wellRule, /height:\s*var\(--target-md\)/);
  assert.doesNotMatch(wellRule, /height:\s*var\(--target-sm\)/);

  // Bar-Höhe innerhalb der iOS/Android-Norm (≥60px exkl. Safe-Area).
  assert.match(tokens, /--nav-height-mobile:\s*6[0-4]px/);
});

test('bottom nav keeps a navigation landmark with a disclosure button, not a tablist', () => {
  const source = read('../public/router.js');

  // Landmark statt ARIA-Tablist (Navigation, keine Tabs in einem Tabpanel).
  assert.match(source, /bottomNav\.setAttribute\('aria-label', t\('nav\.navigation'\)\)/);
  assert.doesNotMatch(source, /'role',\s*'tablist'/);
  assert.doesNotMatch(source, /setAttribute\('role', 'tab'\)/);

  // More bleibt ein korrekter Disclosure-Button.
  assert.match(source, /moreBtn\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(source, /moreBtn\.setAttribute\('aria-controls', 'more-sheet'\)/);
});

test('kitchen tab discloses its (variable) destination in the accessible name', () => {
  const source = read('../public/router.js');

  // Beide Zustände legen die Sektion offen — inaktiv nicht mehr nur "Küche".
  assert.match(
    source,
    /function kitchenNavAriaLabel\(path\)\s*\{[\s\S]*?nav\.kitchenActiveLabel[\s\S]*?nav\.kitchenGoLabel[\s\S]*?\}/,
  );
  assertKeysExistInEveryLocale(['nav.kitchenGoLabel']);

  // Der Zielhinweis trägt den {{section}}-Platzhalter in jeder Locale.
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  for (const file of localeFiles) {
    const value = JSON.parse(read(`../public/locales/${file}`)).nav?.kitchenGoLabel;
    assert.match(value ?? '', /\{\{section\}\}/, `${file}: nav.kitchenGoLabel must interpolate {{section}}`);
  }
});

test('mobile bottom navigation remains visible while content scrolls', () => {
  const source = read('../public/router.js');
  const layout = read('../public/styles/layout.css');

  assert.doesNotMatch(source, /initNavHideOnScroll/);
  assert.doesNotMatch(layout, /\.nav-bottom--hidden\s*\{/);
});

test('More sheet closes route clicks through delegated handler after rebuilds', () => {
  const source = read('../public/router.js');

  assert.match(source, /sheet\.addEventListener\('click',\s*\(e\) =>/);
  assert.match(source, /e\.target\.closest\('\[data-route\]'\)/);
  assert.doesNotMatch(source, /sheet\.querySelectorAll\('\[data-route\]'\)\.forEach/);
});

test('More sheet search trigger is a native button with visible focus styling', () => {
  const router = read('../public/router.js');
  const layout = read('../public/styles/layout.css');
  const focusRule = cssRuleBody(layout, '.more-sheet__search:focus-visible');

  assert.match(router, /const moreSearchBar = document\.createElement\('button'\)/);
  assert.match(router, /moreSearchBar\.type = 'button'/);
  assert.doesNotMatch(router, /moreSearchBar\.setAttribute\('role',\s*'button'\)/);
  assert.match(focusRule, /outline:/);
  assert.match(focusRule, /box-shadow:/);
});

test('SPA navigation can move focus to main content after route changes', () => {
  const source = read('../public/router.js');

  assert.match(source, /main\.tabIndex\s*=\s*-1/);
  assert.match(source, /function\s+focusMainContentAfterNavigation/);
  assert.match(source, /focusMainContentAfterNavigation\(basePath/);
});

test('bottom navigation labels are constrained against localized overflow', () => {
  const layout = read('../public/styles/layout.css');
  const labelRule = cssRuleBody(layout, '.nav-item__label');

  assert.match(labelRule, /max-width:\s*100%/);
  assert.match(labelRule, /overflow:\s*hidden/);
  assert.match(labelRule, /text-overflow:\s*ellipsis/);
  assert.match(labelRule, /white-space:\s*nowrap/);
});

test('mobile bottom navigation avoids clipped Android labels and sparse icon spacing', () => {
  const layout = read('../public/styles/layout.css');
  const navItemRule = cssRuleBody(layout, '.nav-bottom .nav-item');
  const iconWellRule = cssRuleBody(layout, '.nav-bottom .nav-item__icon-well');
  const labelRule = cssRuleBody(layout, '.nav-item__label');

  assert.match(navItemRule, /padding-block:\s*var\(--space-0h\)/);
  assert.match(iconWellRule, /width:\s*var\(--target-base\)/);
  // Well 44×40 (--target-md) füllt die Komfortzone besser als das alte 44×32.
  assert.match(iconWellRule, /height:\s*var\(--target-md\)/);
  assert.match(iconWellRule, /border-radius:\s*var\(--radius-full\)/);
  assert.match(labelRule, /line-height:\s*1\.2/);
});

/**
 * Verborgene Reveal-Aktionen bleiben nicht klickbar.
 *
 * Ein Element, das im Ruhezustand `opacity: 0` trägt und per :hover/:focus-within
 * eingeblendet wird, ist ohne `pointer-events: none` ein volles Trefferziel, das
 * niemand sieht. Gefunden wurde das Muster in der Küchen-Critique vom
 * 2026-07-30 (18 unsichtbare 146x40-Bänder im Wochenboard); der Guard zeigte,
 * dass es repo-weit auftrat - unter anderem an einem unsichtbaren
 * Löschen-Button in Notizen.
 *
 * Bewusste Ausnahmen: Textbeschriftungen, die INNERHALB eines sichtbaren,
 * klickbaren Elternteils ausblenden. Sie erzeugen kein eigenes Trefferziel, der
 * Elternteil bleibt das Ziel.
 */
test('verborgene Reveal-Aktionen bleiben nicht klickbar', () => {
  const ALLOW = new Set(['nav-item__label', 'nav-section-label']);
  const findings = [];

  for (const file of readdirSync(new URL('../public/styles/', import.meta.url))) {
    if (!file.endsWith('.css')) continue;
    const rules = cssRules(read(`../public/styles/${file}`));

    // Klassen, die im Ruhezustand unsichtbar sind (Keyframe-Schritte ausgenommen).
    const hidden = new Map();
    for (const { selectors, body } of rules) {
      if (selectors.some((s) => /^(from|to|\d+%)$/.test(s))) continue;
      if (!/(^|[\s;])opacity:\s*0\s*;/.test(body)) continue;
      const guarded = /pointer-events/.test(body);
      for (const selector of selectors) {
        // Nur die RECHTESTE Klasse: sie benennt das Element, das versteckt wird.
        // Vorfahren im Selektor (`html.sidebar-collapsed .nav-sidebar .x`) sind
        // selbst nicht unsichtbar und dürfen nicht mitgezählt werden.
        const classes = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
        const subject = classes[classes.length - 1];
        if (subject && !hidden.has(subject)) hidden.set(subject, guarded);
      }
    }

    // Wer davon wird per Hover/Fokus eingeblendet?
    for (const { selectors, body } of rules) {
      if (!selectors.some((s) => /:hover|:focus-within/.test(s))) continue;
      if (!/opacity:\s*1/.test(body)) continue;
      for (const selector of selectors) {
        const classes = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
        const cls = classes[classes.length - 1];
        if (!cls || !hidden.has(cls) || hidden.get(cls) || ALLOW.has(cls)) continue;
        hidden.delete(cls);
        findings.push(`${file} .${cls}`);
      }
    }
  }

  assert.deepEqual(findings, [], `opacity:0 ohne pointer-events:none in Reveal-Regeln:\n${findings.join('\n')}`);
});

/**
 * Die Küche baut Leerzustände nur über den geteilten Renderer.
 *
 * `utils/empty-state.js` erzwingt Reihenfolge (Icon, Titel, Beschreibung,
 * Hinweis, CTA) und die ARIA-Rolle je Variante. Solange Seiten das Markup
 * daneben von Hand zusammensetzen, driften die Zustände wieder auseinander -
 * genau das war der Ausgangsbefund (drei Grammatiken, drei vertikale Achsen).
 *
 * Absichtlich auf die Küche begrenzt: die übrigen 15 Seiten bauen ihre
 * Leerzustände noch von Hand (152 Fundstellen, Stand 2026-07-30). Das ist ein
 * bekannter Rückstand, kein Regressionsrisiko - dieser Guard hält fest, was
 * bereits migriert ist.
 */
test('die Küchen-Seiten bauen Leerzustände nur über den geteilten Renderer', () => {
  for (const page of ['meals', 'recipes', 'shopping', 'pantry']) {
    const src = read(`../public/pages/${page}.js`);
    const handRolled = [...src.matchAll(/class="empty-state|className\s*=\s*['"]empty-state/g)];
    assert.equal(handRolled.length, 0,
      `${page}.js baut .empty-state-Markup von Hand (${handRolled.length}x) statt emptyStateEl()/mountEmptyState() zu rufen`);
    assert.match(src, /\b(mountEmptyState|emptyStateEl)\b/,
      `${page}.js ruft den geteilten Leerzustands-Renderer nicht auf`);
  }
});

test('phase 3 high-frequency controls use tokenized touch targets', () => {
  const tasks = read('../public/styles/tasks.css');
  const shopping = read('../public/styles/shopping.css');
  const notes = read('../public/styles/notes.css');
  const layout = read('../public/styles/layout.css');

  assert.match(tasks, /\.task-status-btn::before[\s\S]*var\(--target-base\)/);
  assert.match(tasks, /\.task-bulk-checkbox[\s\S]*(?:min-width|width):\s*var\(--target-base\)/);
  assert.match(tasks, /\.task-card__inline-action[\s\S]*width:\s*var\(--target-base\)/);
  assert.match(tasks, /\.task-card__inline-action[\s\S]*height:\s*var\(--target-base\)/);
  assert.match(tasks, /\.bulk-actions-bar__actions \.btn[\s\S]*min-height:\s*var\(--target-base\)/);
  assert.match(shopping, /\.item-check[\s\S]*(?:min-width|width):\s*var\(--target-base\)/);
  assert.match(shopping, /\.shopping-item[\s\S]*min-height:\s*var\(--target-base\)/);
  // Die beiden Zeilenaktionen der Einkaufsliste trugen bis zum Audit
  // 2026-07-29 eigene .item-details/.item-delete-Regeln mit --target-base.
  // Sie nutzen jetzt die geteilte .row-action-Komponente aus layout.css, die
  // mit --target-lg (48px) über der alten Größe liegt - die Invariante
  // („tokenisierte Trefferfläche, nicht kleiner als --target-base") gilt
  // dadurch strenger, aber an einer anderen Stelle. Deshalb hier auf die
  // Komponente geprüft statt auf die entfallenen Modul-Klassen.
  const shoppingPage = read('../public/pages/shopping.js');
  assert.match(shoppingPage, /class="row-action"\s+data-action="item-details"/);
  assert.match(shoppingPage, /class="row-action row-action--danger"\s+data-action="delete-item"/);
  assert.match(layout, /\.row-action\s*\{[\s\S]*?width:\s*var\(--target-lg\)/);
  assert.match(layout, /\.row-action\s*\{[\s\S]*?height:\s*var\(--target-lg\)/);
  assert.match(notes, /\.note-card__pin[\s\S]*width:\s*var\(--target-base\)/);
  assert.match(notes, /\.note-card__delete[\s\S]*width:\s*var\(--target-base\)/);
});

test('Tasks toolbar keeps secondary controls visible instead of an overflow slider', () => {
  const tasksPage = read('../public/pages/tasks.js');
  const tasksCss = read('../public/styles/tasks.css');

  // Das frühere <details>-Overflow-Panel versteckte Ansicht/Gruppierung hinter
  // einem Klick und zeigte deren Zustand nicht — dasselbe Muster wurde in
  // Dokumente (#506) verworfen. Aufgaben nutzt jetzt die geteilte Grammatik:
  // umbrechender Kopf plus sichtbare Filterzeile.
  assert.doesNotMatch(tasksPage, /<details class="tasks-toolbar__secondary"/);
  assert.doesNotMatch(tasksCss, /tasks-toolbar__secondary/);
  assert.match(tasksPage, /class="page-toolbar page-toolbar--wrap tasks-toolbar"/);

  // Ansichtswechsel bleibt im Kopf, Gruppierung wandert in die Filterzeile.
  assert.match(tasksPage, /<div class="page-toolbar__actions">[\s\S]*id="view-toggle"[\s\S]*id="btn-bulk-select"/);
  assert.match(tasksPage, /<div class="tasks-filters-row">[\s\S]*id="filter-bar"[\s\S]*id="group-mode-toggle"/);
  assert.match(tasksCss, /\.tasks-filters-row\s*\{[\s\S]*display:\s*flex/);

  // [hidden] muss gegen display:flex/inline-flex gewinnen, sonst bleiben die in
  // der Kanban-Ansicht ausgeblendeten Controls sichtbar.
  assert.match(tasksCss, /\.tasks-filters-row \[hidden\]\s*\{[\s\S]*display:\s*none/);
});

test('Tasks and Notes expose every click target as a real control', () => {
  const tasksPage = read('../public/pages/tasks.js');
  const notesPage = read('../public/pages/notes.js');

  // Filter-Chips waren <span> ohne Tastaturzugang, während Dokumente und
  // Kontakte dieselbe .filter-chip-Klasse als <button aria-pressed> rendern.
  assert.match(tasksPage, /function makeChip\(/);
  assert.match(tasksPage, /chip\s*=\s*document\.createElement\('button'\)/);
  assert.doesNotMatch(tasksPage, /className\s*=\s*'filter-chip[^']*';?[\s\S]{0,80}createElement\('span'\)/);

  // Titel öffnet die Aufgabe, Fortschrittsbalken klappt die Unteraufgaben auf,
  // Kanban-Titel öffnet die Karte — alle drei waren Divs.
  assert.match(tasksPage, /<button type="button" class="task-card__title/);
  assert.match(tasksPage, /<button type="button" class="subtask-progress"[\s\S]*aria-expanded=/);
  assert.match(tasksPage, /<button type="button" class="kanban-card__title/);

  // Notizkarte: der einzige Tastaturweg in die Notiz.
  assert.match(notesPage, /class="note-card__open" data-action="open"/);

  // Umschalter melden ihren Zustand nicht nur über Farbe.
  assert.match(tasksPage, /data-view="list"[\s\S]*aria-pressed=/);
  assert.match(tasksPage, /data-mode="category" aria-pressed="true"/);
});

test('showToast is never called with an unsupported variant', () => {
  // showToast kennt nur default | success | warning | danger. 'error' landete
  // still im polite-Container ohne Fehlerkennzeichnung.
  const files = [
    '../public/router.js',
    '../public/pages/notes.js',
    '../public/pages/tasks.js',
    '../public/pages/budget.js',
    '../public/pages/calendar.js',
    '../public/pages/contacts.js',
    '../public/pages/dashboard.js',
    '../public/pages/meals.js',
    '../public/pages/recipes.js',
    '../public/pages/budget-plans.js',
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /showToast\([^;]*?,\s*'error'\)/s, `${file} uses showToast(..., 'error')`);
  }
});

test('responsive adaptation keeps Notes vertical and prevents intrinsic-width overflow', () => {
  const notes = read('../public/styles/notes.css');
  const dashboard = read('../public/styles/dashboard.css');
  const pageSearch = read('../public/styles/page-search.css');

  // The shared search control guards its own intrinsic-width overflow.
  assert.match(pageSearch, /\.page-search\s*\{[\s\S]*min-width:\s*0/);
  assert.match(notes, /\.notes-toolbar\s+\.page-toolbar__title\s*\{[\s\S]*flex:\s*0\s+0\s+auto/);
  assert.match(notes, /\.notes-grid\s*\{[\s\S]*display:\s*grid/);
  assert.match(notes, /\.notes-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(notes, /\.notes-grid\s*\{[\s\S]*?columns:\s*2/);
  assert.match(
    notes,
    /@container notes-page \(min-width:\s*520px\)[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    notes,
    /@container notes-page \(min-width:\s*720px\)[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    dashboard,
    /\.notes-grid-widget\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(notes, /\.note-card\s*\{[\s\S]*min-width:\s*0/);
  assert.match(notes, /\.note-card__title\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(
    notes,
    /\.note-card__title,[\s\S]*\.note-card__content\s*\{[\s\S]*unicode-bidi:\s*plaintext/
  );
});

test('dashboard weather widget adapts to selected widget size', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const wrapperRule = cssRuleBody(dashboard, '.widget-wrapper');

  assert.match(wrapperRule, /container:\s*dashboard-widget\s*\/\s*inline-size/);
  assert.match(
    dashboard,
    /@container dashboard-widget \(min-width:\s*480px\)[\s\S]*\.weather-widget__inner\s*\{[\s\S]*flex-direction:\s*row/,
    'weather should switch to horizontal layout from its widget width, not viewport width',
  );
  assert.match(
    dashboard,
    /\.widget-size--1x1\s*>\s*\.weather-widget \.weather-widget__meta,[\s\S]*\.widget-size--1x1\s*>\s*\.weather-widget \.weather-forecast\s*\{[\s\S]*display:\s*none/,
    'tiny weather widgets should not force rich forecast content into the tile',
  );
  assert.match(
    dashboard,
    /\.widget-size--2x1\s*>\s*\.weather-widget \.weather-widget__meta,[\s\S]*\.widget-size--4x1\s*>\s*\.weather-widget \.weather-widget__meta\s*\{[\s\S]*display:\s*none/,
    'one-row weather widgets should use a denser summary',
  );
  assert.doesNotMatch(
    dashboard,
    /@media \(min-width:\s*(?:768|1024|1440)px\)\s*\{\s*\.weather-widget\s*\{/,
    'weather layout must not be driven by viewport breakpoints',
  );
  assert.doesNotMatch(dashboard, /\.weather-widget\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});

test('responsive adaptation keeps all four Kitchen tabs readable on narrow phones', () => {
  const kitchenTabs = read('../public/styles/kitchen-tabs.css');

  // Platz für die Labels kommt seit dem vierten Tab (Vorrat) daher, dass der
  // Modultitel mobil entfällt - die Bottom-Nav trägt dasselbe Wort bereits.
  // Vorher fraß er ~70px, wodurch alle drei inaktiven Labels ellipsierten.
  // Ersetzt das frühere padding-inline: var(--space-2), das den Platz nur
  // umverteilt statt geschaffen hat; die Leiste erbt jetzt --page-inline-pad
  // aus .sub-tabs-bar und fluchtet damit mit dem Body-Inhalt.
  assert.match(
    kitchenTabs,
    /@media \(max-width:\s*640px\)[\s\S]*\.kitchen-tabs-bar \.sub-tabs-bar__title\s*\{[\s\S]*display:\s*none/
  );
  assert.doesNotMatch(
    kitchenTabs,
    /@media \(max-width:\s*640px\)[\s\S]*\.kitchen-tabs-bar\s*\{[^}]*padding-inline/,
    'kitchen-tabs-bar darf --page-inline-pad aus .sub-tabs-bar nicht überschreiben',
  );
  assert.match(
    kitchenTabs,
    /\.kitchen-tabs-bar \.sub-tab\s*\{[\s\S]*flex:\s*1 1 0[\s\S]*min-width:\s*0/
  );
  assert.match(
    kitchenTabs,
    /\.kitchen-tabs-bar \.sub-tab__label\s*\{[\s\S]*text-overflow:\s*ellipsis/
  );
});

test('responsive adaptation uses tablet space without crowding module toolbars', () => {
  const documents = read('../public/styles/documents.css');
  const settings = read('../public/styles/settings.css');

  // Der Dokument-Kopf lehnt sich am kanonischen page-toolbar--wrap-Muster an
  // (Titel + Suche + Aktionen brechen bei Bedarf um), die Filter leben in einer
  // eigenen Zeile darunter — kein in die Kopfzeile gequetschter Filter-Block (#506).
  const documentsPageSrc = read('../public/pages/documents.js');
  assert.match(documentsPageSrc, /class="page-toolbar page-toolbar--wrap documents-toolbar"/);
  assert.match(documentsPageSrc, /<div class="documents-filters">/);
  assert.match(
    documents,
    /\.documents-filter-chips\s*\{[^}]*overflow-x:\s*auto/
  );
  assert.match(
    settings,
    /@media \(min-width:\s*768px\) and \(max-width:\s*1023px\)[\s\S]*\.settings-mobile-overview__links\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
});

test('Birthday page exposes a single creation action (FAB), no duplicate toolbar button', () => {
  const birthdays = read('../public/pages/birthdays.js');

  assert.match(birthdays, /class="page-fab" id="fab-new-birthday"/);
  assert.doesNotMatch(birthdays, /toolbar-new-btn/);
});

test('dashboard polish keeps one page heading and native quick-action controls', () => {
  const dashboard = read('../public/pages/dashboard.js');
  const css = read('../public/styles/dashboard.css');

  assert.equal((dashboard.match(/<h1\b/g) || []).length, 1, 'dashboard must expose one h1');
  assert.match(dashboard, /<h2 class="dashboard-overview__title(?: dashboard-overview__title--\$\{greetingPeriod\(\)\})?"/);
  assert.match(dashboard, /<button type="button" class="fab-action"/);
  assert.doesNotMatch(dashboard, /class="fab-action"[^>]*role="button"/);
  assert.doesNotMatch(dashboard, /<button class="fab-action__btn"/);
  assert.match(css, /\.dashboard-icon-btn\s*\{[\s\S]*width:\s*var\(--target-lg\);[\s\S]*height:\s*var\(--target-lg\)/);
  // width/height müssen INNERHALB derselben .dashboard-icon-btn-Regel liegen
  // ([^{}] überschreitet keine Regelgrenze) — sonst matcht die Regex fälschlich
  // ein --target-base aus einer beliebigen späteren Regel (z.B. dem
  // pointer:coarse-Block der Edit-Controls) quer über die Datei.
  assert.doesNotMatch(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.dashboard-icon-btn\s*\{[^{}]*width:\s*var\(--target-base\)[^{}]*height:\s*var\(--target-base\)/,
    'mobile dashboard controls must keep the large touch target through the final cascade'
  );
  assert.match(
    css,
    /@media \(min-width:\s*1024px\)[\s\S]*\.dashboard-icon-btn\s*\{[\s\S]*width:\s*var\(--target-md\);[\s\S]*height:\s*var\(--target-md\)/,
  );
});

test('dashboard today cockpit keeps content visibly below its section heading', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const typography = read('../public/styles/typography.css');
  const valueRule = cssRuleBody(dashboard, '.today-cockpit-card__value');

  assert.match(
    typography,
    /\.today-cockpit__header h2,[\s\S]*?font-size:\s*var\(--type-section-title\)/,
    'Heute wichtig must keep the section-title role',
  );
  // Der Value trägt die Card-Title-Rolle (16px): dominant genug, um den
  // Icon-Chip zu überwiegen (das glanzbare Datum der Karte), aber weiterhin
  // unter der 18px-Section-Heading „Heute wichtig".
  assert.match(
    valueRule,
    /font-size:\s*var\(--type-card-title\)/,
    'cockpit value must carry the 16px card-title role, still below the 18px section heading',
  );
});

test('polished rounded cards use subtle full borders instead of thick accent caps', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const housekeeping = read('../public/styles/housekeeping.css');

  const overview = dashboard.match(/\.dashboard-overview\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  const cockpit = dashboard.match(/\.today-cockpit\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  const widget = dashboard.match(/\.dashboard \.widget::before\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  const housekeepingCard = housekeeping.match(/\.housekeeping-card\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.doesNotMatch(overview, /border-top:\s*(?:3px|var\(--space-1\))/);
  assert.doesNotMatch(cockpit, /border-top:\s*(?:3px|var\(--space-1\))/);
  assert.match(widget, /height:\s*1px/);
  assert.doesNotMatch(housekeepingCard, /border-top:\s*3px/);
});

test('hardening keeps Birthday cards bounded with extreme localized content', () => {
  const birthdays = read('../public/styles/birthdays.css');

  assert.match(birthdays, /\.birthday-item__body\s*\{[\s\S]*min-width:\s*0/);
  assert.match(birthdays, /\.birthday-item__name\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(birthdays, /\.birthday-item__name\s*\{[\s\S]*unicode-bidi:\s*plaintext/);
  assert.match(birthdays, /\.birthday-item__notes\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(birthdays, /\.birthday-item__notes\s*\{[\s\S]*unicode-bidi:\s*plaintext/);
  assert.match(
    birthdays,
    /@media \(max-width:\s*640px\)[\s\S]*\.birthday-item__row\s*\{[\s\S]*flex-wrap:\s*wrap/
  );
});

test('hardening uses logical alignment for RTL-sensitive adapted controls', () => {
  const notes = read('../public/styles/notes.css');
  const tasks = read('../public/styles/tasks.css');
  const pageSearch = read('../public/styles/page-search.css');

  assert.match(notes, /margin-inline-start:\s*auto/);
  // The shared search control's leading icon uses logical inset for RTL.
  assert.match(pageSearch, /\.page-search__icon\s*\{[\s\S]*inset-inline-start:/);
  assert.match(notes, /\.note-card__pin\s*\{[\s\S]*inset-inline-end:/);
  // Das absolut positionierte Overflow-Panel (mit eigenen RTL-Insets) ist
  // entfallen; die Filterzeile richtet ihre Gruppierungswahl jetzt über eine
  // logische Property aus und braucht deshalb keine [dir=rtl]-Sonderregel.
  assert.match(tasks, /\.tasks-filters__end\s*\{[\s\S]*margin-inline-start:\s*auto/);
  assert.doesNotMatch(tasks, /margin-(left|right):\s*auto/);
});

test('route failures expose a localized recoverable alert instead of raw technical errors', () => {
  const router = read('../public/router.js');
  const notesPage = read('../public/pages/notes.js');

  assert.match(router, /function renderError\(container,\s*err\)[\s\S]*state\.setAttribute\(['"]role['"],\s*['"]alert['"]\)/);
  assert.match(router, /desc\.textContent\s*=\s*friendlyError\(err\)/);
  assert.match(router, /copyErrorReport|errorCopy/);
  assert.match(router, /buildErrorReport\(err\)/);
  assert.match(router, /state\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.match(router, /Failed to fetch\|NetworkError\|Load failed/i);
  assert.match(router, /return t\(['"]common\.errorServer['"]\)/);
  assert.match(router, /err\?\.name === ['"]TypeError['"][\s\S]*return t\(['"]common\.unexpectedError['"]\)/);
  assert.match(notesPage, /catch \(err\)\s*\{[\s\S]*console\.error\([\s\S]*throw err;/);
});

test('Notes uses the shared WCAG contrast helper without dimming readable content', () => {
  const notesPage = read('../public/pages/notes.js');
  const notesCss = read('../public/styles/notes.css');

  assert.match(notesPage, /import \{ getReadableTextColor \} from '\/utils\/color\.js'/);
  assert.doesNotMatch(notesPage, /function isLightColor/);
  assert.match(notesPage, /getReadableTextColor\(note\.color\)/);
  assert.match(notesPage, /const avatarColor\s*=\s*note\.creator_color[\s\S]*getReadableTextColor\(avatarColor\)/);
  assert.doesNotMatch(
    notesCss.match(/\.note-card__content\s*\{[\s\S]*?\n\}/)?.[0] ?? '',
    /opacity:/,
  );
  assert.match(
    notesCss.match(/\.note-card__footer\s*\{[\s\S]*?\n\}/)?.[0] ?? '',
    /color:\s*inherit/,
  );
});

test('phase 3 Tasks bulk actions stay de-emphasized until tasks are selected', () => {
  const tasksPage = read('../public/pages/tasks.js');
  const tasksCss = read('../public/styles/tasks.css');

  assert.match(tasksPage, /bar\.hidden\s*=\s*!\(state\.bulkSelectMode && selected > 0\)/);
  assert.match(tasksPage, /bar\.classList\.toggle\('bulk-actions-bar--active',\s*selected > 0\)/);
  assert.match(tasksPage, /toggleBtn\.setAttribute\('aria-pressed',\s*String\(state\.bulkSelectMode\)\)/);
  assert.match(tasksCss, /\.bulk-actions-bar\[hidden\]\s*\{[\s\S]*display:\s*none/);
  assert.match(tasksCss, /\.bulk-actions-bar--active\s*\{/);
});

test('phase 3 mobile Shopping quick-add separates name, quantity, category, and add controls', () => {
  const shoppingPage = read('../public/pages/shopping.js');
  const shoppingCss = read('../public/styles/shopping.css');

  assert.match(shoppingPage, /<div class="quick-add__input-wrap">[\s\S]*id="item-name-input"[\s\S]*id="autocomplete-dropdown" hidden[\s\S]*<\/div>\s*<input class="quick-add__qty"/);
  assert.match(
    shoppingCss,
    /\.quick-add__form\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*var\(--target-base\)/
  );
  assert.match(shoppingCss, /\.quick-add__input-wrap\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(shoppingCss, /\.quick-add__qty\s*\{[\s\S]*position:\s*static[\s\S]*min-height:\s*var\(--target-base\)/);
  assert.match(shoppingCss, /\.quick-add__cat\s*\{[\s\S]*min-width:\s*0[\s\S]*min-height:\s*var\(--target-base\)/);
});

test('phase 6 touched UI files continue using design tokens for target sizes', () => {
  const tasks = read('../public/styles/tasks.css');
  const shopping = read('../public/styles/shopping.css');
  const notes = read('../public/styles/notes.css');
  // Zeilen-Aktionen nutzen jetzt die geteilte .row-action-Grammatik in
  // layout.css (Audit F1) statt pro Modul eigener Klassen (früher
  // .contact-action-btn/.birthday-action-btn/.budget-entry__action).
  const layout = read('../public/styles/layout.css');
  const targetRules = [
    ['../public/styles/tasks.css', tasks, '.task-status-btn'],
    ['../public/styles/shopping.css', shopping, '.quick-add__btn'],
    ['../public/styles/shopping.css', shopping, '.item-check'],
    ['../public/styles/notes.css', notes, '.note-card__pin'],
    ['../public/styles/notes.css', notes, '.note-card__delete'],
    ['../public/styles/layout.css', layout, '.row-action'],
  ];

  for (const [file, source, selector] of targetRules) {
    const body = cssRuleBody(source, selector);
    assert.doesNotMatch(
      body,
      /\b(?:min-)?(?:height|width):\s*(?:[1-9]|[1-3]\d|4[0-3])px\b/,
      `${file} ${selector} should not use sub-44px hardcoded target sizes`
    );
  }

  for (const property of ['width', 'height']) {
    assertRuleUsesToken(tasks, '.task-status-btn', property, '--target-base', '../public/styles/tasks.css');
    assertRuleUsesToken(shopping, '.quick-add__btn', property, '--target-base', '../public/styles/shopping.css');
    assertRuleUsesToken(shopping, '.item-check', property, '--target-base', '../public/styles/shopping.css');
    assertRuleUsesToken(notes, '.note-card__pin', property, '--target-base', '../public/styles/notes.css');
    assertRuleUsesToken(notes, '.note-card__delete', property, '--target-base', '../public/styles/notes.css');
    assertRuleUsesToken(layout, '.row-action', property, '--target-lg', '../public/styles/layout.css');
  }

  assertRuleUsesToken(layout, '.row-action', 'min-height', '--target-lg', '../public/styles/layout.css');
  assertRuleUsesToken(layout, '.row-action', 'min-width', '--target-lg', '../public/styles/layout.css');
});

test('phase 4 keeps Kitchen navigation identity stable', () => {
  const routerSource = read('../public/router.js');

  assert.match(routerSource, /t\('nav\.kitchen'\)/);
  assert.match(routerSource, /t\('nav\.kitchenActiveLabel',\s*\{\s*section/);
  assert.doesNotMatch(routerSource, /kitchenBtnLabel\.textContent\s*=\s*kitchenTarget\.label/);
  assert.doesNotMatch(routerSource, /kitchenBtnIcon\)\s*kitchenBtnIcon\.dataset\.lucide\s*=\s*kitchenTarget\.icon/);
  assert.doesNotMatch(routerSource, /sidebarLabel\)\s*sidebarLabel\.textContent\s*=\s*kitchenTarget\.label/);
  assert.doesNotMatch(routerSource, /sidebarIcon\)\s*sidebarIcon\.dataset\.lucide\s*=\s*kitchenTarget\.icon/);
});

test('global navigation groups domains with translated section labels', () => {
  const routerSource = read('../public/router.js');

  // The grouped main-app navigation references every section label key and
  // resolves section labels through t().
  assert.match(routerSource, /'nav\.sectionOverview'/);
  assert.match(routerSource, /'nav\.sectionPlan'/);
  assert.match(routerSource, /'nav\.sectionHousehold'/);
  assert.match(routerSource, /'nav\.sectionPeople'/);
  assert.match(routerSource, /'nav\.sectionFinance'/);
  assert.match(routerSource, /'nav\.sectionCustomModules'/);
  assert.match(routerSource, /t\(labelKey\)/);

  // The replaced household section label is no longer referenced.
  assert.doesNotMatch(routerSource, /nav\.section\.household/);
});

test('global navigation derives exactly one Kitchen destination', () => {
  const routerSource = read('../public/router.js');

  // Kitchen is inserted once via sidebarKitchenEl(), gated by a single-shot flag.
  // It is appended into the current section group via appendNavEl().
  assert.equal((routerSource.match(/appendNavEl\(sidebarKitchenEl\(\)\)/g) ?? []).length, 1);
  assert.match(routerSource, /if \(!kitchenAdded\)/);
});

test('navigation settings leaf reuses the canonical module-order helpers', () => {
  const leaf = read('../public/settings/pages/modules-navigation.js');

  assert.match(leaf, /import\s*\{[^}]*normalizeModuleOrder[^}]*\}\s*from\s*'\/settings\/module-order\.js'/s);
  assert.match(leaf, /import\s*\{[^}]*expandModuleOrder[^}]*\}\s*from\s*'\/settings\/module-order\.js'/s);
});

test('phase 4 keeps More bottom-nav identity stable while exposing active section accessibly', () => {
  const routerSource = read('../public/router.js');

  assert.match(routerSource, /t\('nav\.moreActiveLabel',\s*\{\s*section:\s*activeSecondary\.label\s*\}\)/);
  assert.match(routerSource, /moreBtnLabel\.textContent\s*=\s*t\('nav\.more'\)/);
  assert.match(routerSource, /replaceNavIcon\(moreBtn,\s*'\.nav-item__icon',\s*'more-horizontal'\)/);
  assert.doesNotMatch(routerSource, /const\s+moreIcon\s*=\s*activeSecondary\s*\?\s*activeSecondary\.icon/);
  assert.doesNotMatch(routerSource, /moreBtnLabel\.textContent\s*=\s*moreLabel/);

  // More nutzt den eindeutigen Overflow-Glyph, nicht das mehrdeutige 3×3-Raster.
  const navIcons = read('../public/nav-icons.js');
  assert.match(navIcons, /'more-horizontal':\s*\(\)\s*=>/);
  assert.match(routerSource, /const iconFactory = NAV_ICONS\['more-horizontal'\]/);
  assert.doesNotMatch(routerSource, /grid-2x2/);
});

test('phase 4 locales include More active accessible label', () => {
  const localesDir = new URL('../public/locales/', import.meta.url);
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'));

  assert.ok(files.length >= 16, 'expected at least 16 locale files');
  for (const file of files) {
    const data = JSON.parse(readFileSync(new URL(file, localesDir), 'utf8'));
    assert.equal(typeof data.nav?.moreActiveLabel, 'string', `${file}: nav.moreActiveLabel must be a string`);
    assert.match(data.nav.moreActiveLabel, /\{\{section\}\}/, `${file}: nav.moreActiveLabel must include {{section}}`);
  }
});

test('phase 4 touched icon markup uses icon classes instead of inline icon sizing', () => {
  const files = [
    '../public/router.js',
    '../public/pages/settings.js',
    '../public/pages/meals.js',
    '../public/pages/recipes.js',
    '../public/pages/shopping.js',
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /<i\s+[^>]*data-lucide=[^>]*style=["'][^"']*(?:width|height):/s, `${file} must not inline-size Lucide placeholders`);
    assert.doesNotMatch(source, /\.style\.cssText\s*=\s*['"][^'"]*(?:width|height):/, `${file} must not assign inline icon dimensions`);
  }
});

test('phase 4 settings theme toggle uses Lucide placeholders instead of inline SVG icons', () => {
  const settings = read('../public/settings/pages/personal-appearance.js');

  assert.doesNotMatch(settings, /<svg\s+width="18"\s+height="18"[\s\S]*?data-theme-value=/);
  assert.match(settings, /data-lucide="monitor"/);
  assert.match(settings, /data-lucide="sun"/);
  assert.match(settings, /data-lucide="moon"/);
});

test('phase 4 opens search from More sheet in a single handoff', () => {
  const routerSource = read('../public/router.js');

  assert.match(routerSource, /closeSheet\(\{\s*restoreFocus:\s*false\s*\}\)/);
  assert.match(routerSource, /requestAnimationFrame\(\(\) => \{\s*openSearch\(\);/);
});

test('settings cutover: the controller is a thin shell delegate without the legacy monolith', () => {
  const settingsPage = read('../public/pages/settings.js');

  assert.match(settingsPage, /renderSettingsShell/, 'controller must delegate rendering to the shell');
  assert.match(settingsPage, /readStoredSettingsDestination/, 'controller must read & migrate stored settings state');
  assert.doesNotMatch(settingsPage, /settings-tab-panel/, 'controller must not render legacy tab panels');
  assert.doesNotMatch(settingsPage, /data-panel=/, 'controller must not render legacy data-panel attributes');
  assert.doesNotMatch(settingsPage, /settings-nav\.js/, 'controller must not import the removed settings-nav helpers');
  assert.doesNotMatch(settingsPage, /extraClass:\s*'settings-tabs'/, 'controller must not render the legacy sub-tab bar');

  const lineCount = settingsPage.split('\n').length;
  assert.ok(lineCount <= 170, `settings controller should be a thin shell (was ${lineCount} lines)`);
});

test('settings cutover: obsolete navigation modules and stylesheet are removed', () => {
  assert.equal(existsSync(new URL('../public/utils/settings-nav.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/styles/settings-nav.css', import.meta.url)), false);
});

test('settings cutover: no obsolete settings-tab / panel references remain in public', () => {
  const offenders = [];
  for (const file of walkFrontendFiles('../public/')) {
    const source = read(file);
    if (/settings-nav\b|settings-tabs\b|settings-tab-panel\b|data-panel=|renderSettingsSidebar\b/.test(source)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `obsolete settings navigation references remain: ${offenders.join(', ')}`);
});

test('settings cutover: the access-redirected notice is consumed once on the account leaf', () => {
  const account = read('../public/settings/pages/personal-account.js');

  assert.match(account, /myhub:settings:notice/, 'account leaf must read the one-time redirect notice');
  assert.match(account, /accessRedirected/, 'account leaf must surface the access-redirected message');
  assert.match(account, /removeItem\(/, 'account leaf must consume the notice once');
});

test('settings cutover: route direction treats settings sub-paths as one section', () => {
  const routerSource = read('../public/router.js');

  assert.match(
    routerSource,
    /startsWith\('\/settings'\)/,
    'router must normalise /settings sub-paths for title and direction handling',
  );
});

test('phase 6 shared sub-tabs support keyboard tab navigation', () => {
  const source = read('../public/utils/sub-tabs.js');

  assert.match(source, /bar\.addEventListener\('keydown'/);
  assert.match(source, /e\.key === 'ArrowRight'/);
  assert.match(source, /e\.key === 'ArrowLeft'/);
  assert.match(source, /e\.key === 'Home'/);
  assert.match(source, /e\.key === 'End'/);
  assert.match(source, /\.focus\(\)/);
});

// --------------------------------------------------------
// Liquid-Glass-Migration: Regressions-Guards (UX-Audit)
// --------------------------------------------------------

test('calendar week-view time labels use a readable text token, not the disabled token', () => {
  const calendar = read('../public/styles/calendar.css');
  const body = cssRuleBody(calendar, '.week-view__time-label');

  assert.match(body, /color:\s*var\(--color-text-tertiary\)/, 'time labels must use --color-text-tertiary for WCAG AA contrast');
  assert.doesNotMatch(body, /color:\s*var\(--color-text-disabled\)/, 'time labels must not reuse the disabled token (insufficient contrast)');
});

test('calendar month view uses tinted event surfaces derived from --ev-color', () => {
  const calendar = read('../public/styles/calendar.css');
  const gridBody = cssRuleBody(calendar, '.month-grid');
  const dayBody = cssRuleBody(calendar, '.month-day');
  const eventBody = cssRuleBody(calendar, '.month-day__event');

  assert.match(gridBody, /background-color:\s*var\(--color-border-subtle\)/, 'month grid should expose clear cell boundaries');
  assert.match(gridBody, /gap:\s*var\(--space-px\)/, 'month grid boundaries should use tokenized one-pixel gaps');
  assert.match(dayBody, /background-color:\s*var\(--color-surface-work\)/, 'month cells should use a stable work surface');
  // Getönte „Ton"-Fläche statt vollgesättigter Füllung: Tönung, lesbare Tinte und
  // Kante werden per color-mix aus --ev-color abgeleitet — theme-korrekt, weil
  // --color-surface-work und --color-text-primary im Dark Mode kippen.
  assert.match(eventBody, /background:\s*color-mix\(in srgb,\s*var\(--ev-color\)\s*\d+%,\s*var\(--color-surface-work\)\)/, 'event chips should sit on a tinted work surface, not a saturated fill');
  assert.match(eventBody, /color:\s*color-mix\(in srgb,\s*var\(--ev-color\)\s*\d+%,\s*var\(--color-text-primary\)\)/, 'event chip text should be a readable ink derived from the event colour');
  assert.match(eventBody, /border:\s*var\(--space-px\)\s+solid\s+color-mix\(in srgb,\s*var\(--ev-color\)/, 'event chips need a visible boundary derived from --ev-color, not color alone');
  assert.doesNotMatch(eventBody, /box-shadow/, 'tinted event chips should read flat, without a drop shadow');
});

test('calendar agenda events and task chips keep readable contrast in mobile agenda', () => {
  const calendar = read('../public/styles/calendar.css');
  const eventBody = cssRuleBody(calendar, '.agenda-event');
  const colorBody = cssRuleBody(calendar, '.agenda-event__color');
  const taskBody = cssRuleBody(calendar, '.cal-task-chip');
  const metaBody = cssRuleBody(calendar, '.agenda-event__meta');

  assert.match(eventBody, /background:\s*var\(--color-surface-work\)/, 'agenda rows need a solid surface for mobile contrast');
  assert.match(eventBody, /border:\s*var\(--space-px\)\s+solid\s+var\(--color-border-subtle\)/, 'agenda rows need a boundary in both themes');
  // Kalenderfarbe ist ein zentrierter Dot (kein vollhoher Seitenstreifen) —
  // tokenisiert und sichtbar, konsistent mit den Status-Dots der Aufgabenliste.
  assert.match(colorBody, /width:\s*var\(--space-2\)/, 'agenda color dot should use a spacing token for its width');
  assert.match(colorBody, /height:\s*var\(--space-2\)/, 'agenda color dot should be a fixed-size dot, not a full-height rail');
  assert.match(colorBody, /border-radius:\s*var\(--radius-full\)/, 'agenda color dot should be round');
  assert.match(taskBody, /background:\s*color-mix\(in srgb,\s*currentColor/, 'task chips should tint from their readable text color');
  assert.match(taskBody, /border-color:\s*color-mix\(in srgb,\s*currentColor/, 'task chips should have more than colored text');
  assert.match(metaBody, /color:\s*var\(--color-text-secondary\)/, 'metadata should remain legible in light and dark themes');
});

test('calendar metadata uses lucide icon markup instead of visible emoji', () => {
  const source = read('../public/pages/calendar.js');

  assert.doesNotMatch(source, /📍|🗓|📅|🎂|👤/, 'calendar metadata must not render visible emoji icons');
  assert.match(source, /calendarMetaIconHtml\('map-pin'\)/, 'location metadata should use the shared metadata icon helper');
  assert.match(source, /class="calendar-meta-icon icon-sm"/, 'metadata icons should use tokenized icon classes');
});

test('desktop Meals and Calendar date-navigation icons use the accent color', () => {
  const meals = read('../public/styles/meals.css');
  const calendar = read('../public/styles/calendar.css');

  // Meals folgt der Module-Accent-Leads-Rule (DESIGN.md §2, 2026-07): innerhalb
  // eines Moduls führt der Modul-Akzent, globales Violett bleibt der Shell
  // vorbehalten. Die Wochennavigation ist Modul-Bedienung, keine Shell-Chrome -
  // vorher stand die violette „Heute"-Pille direkt neben dem orangen
  // Zufallsplan-Button und beide lasen sich wie Controls aus zwei Apps.
  // Calendar zieht bewusst noch nicht mit: eigenes Modul, eigener Durchgang.
  assert.match(cssRuleBody(meals, '.week-nav .btn--icon'), /color:\s*var\(--module-accent\)/);
  assert.match(cssRuleBody(calendar, '.cal-toolbar__nav .btn--icon'), /color:\s*var\(--color-accent\)/);
});

test('calendar attachment removal control honors its hidden state', () => {
  const calendarCss = read('../public/styles/calendar.css');
  assert.match(
    calendarCss,
    /#modal-remove-attachment\[hidden\]\s*\{\s*display:\s*none;/,
    'the remove-attachment button must stay hidden for events without an attachment'
  );
});

test('phase 7 calendar inline polish keeps icons and all-day labels tokenized', () => {
  const source = read('../public/pages/calendar.js');
  const calendar = read('../public/styles/calendar.css');
  const allDayLabel = cssRuleBody(calendar, '.calendar-all-day-label');

  assert.doesNotMatch(source, /data-lucide="(?:x|plus|trash-2|repeat)"\s+style=/, 'Lucide icons should use icon utility classes, not inline sizing');
  assert.doesNotMatch(source, /font-size:10px|color:var\(--color-text-disabled\)/, 'all-day labels should not keep low-contrast inline text styles');
  assert.match(source, /calendarRepeatIconHtml\(\)/, 'recurrence markers should share the tokenized repeat icon helper');
  assert.match(source, /class="calendar-all-day-label"/, 'all-day gutter labels should use the shared label class');
  assert.match(allDayLabel, /font-size:\s*var\(--text-xs\)/, 'all-day labels should use a text token');
  assert.match(allDayLabel, /color:\s*var\(--color-text-secondary\)/, 'all-day labels should use readable secondary text');
  assert.match(allDayLabel, /width:\s*var\(--space-12\)/, 'all-day gutter width should use a spacing token');
});

test('phase 7 Budget row actions stay touch-safe on mobile', () => {
  const source = read('../public/pages/budget.js');
  const layout = read('../public/styles/layout.css');
  // Zeilen-Aktionen (Löschen UND Bearbeiten) teilen die geteilte .row-action-
  // Grammatik (layout.css, Audit F1): 48px-Touch-Fläche, immer sichtbar (kein
  // Hover-Reveal → auch auf Touch nutzbar), Löschen trägt row-action--danger.
  const actionRule = cssRuleBody(layout, '.row-action');

  assert.match(actionRule, /width:\s*var\(--target-lg\)/, 'Row action buttons should use the large touch target width');
  assert.match(actionRule, /height:\s*var\(--target-lg\)/, 'Row action buttons should use the large touch target height');
  assert.doesNotMatch(actionRule, /opacity:\s*0/, 'Row actions stay visible without hover (touch-safe)');
  assert.match(source, /class="row-action row-action--danger"/, 'Budget delete uses the shared danger row action');
  assert.doesNotMatch(source, /data-lucide="(?:plus|trash-2|pencil)"\s+style=/, 'Budget Lucide actions should use icon utility classes');
});

test('sticky section headers stack above glass cards via --z-sticky', () => {
  const stickyHeaders = [
    ['../public/styles/meals.css', '.day-header'],
    ['../public/styles/calendar.css', '.agenda-day__header'],
    ['../public/styles/contacts.css', '.contact-group__header'],
  ];

  for (const [file, selector] of stickyHeaders) {
    const body = cssRuleBody(read(file), selector);
    assert.match(body, /position:\s*sticky/, `${file} ${selector} should be sticky`);
    assert.match(body, /z-index:\s*var\(--z-sticky\)/, `${file} ${selector} must use --z-sticky so glass cards do not scroll over it`);
    assert.doesNotMatch(body, /z-index:\s*var\(--z-base\)/, `${file} ${selector} must not sit on the base layer`);
  }
});

test('every locale resolves the grouped navigation section labels', () => {
  const localesDir = new URL('../public/locales/', import.meta.url);
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'));
  const sectionKeys = ['sectionOverview', 'sectionPlan', 'sectionHousehold', 'sectionPeople', 'sectionFinance', 'sectionCustomModules'];

  assert.ok(files.length >= 16, 'expected at least 16 locale files');
  for (const file of files) {
    const data = JSON.parse(readFileSync(new URL(file, localesDir), 'utf8'));
    for (const key of sectionKeys) {
      assert.equal(typeof data.nav?.[key], 'string', `${file}: nav.${key} must be a string`);
      assert.ok(data.nav[key].length > 0, `${file}: nav.${key} must not be empty`);
    }
    assert.ok(!('section.household' in data.nav), `${file}: nav must not keep the flat "section.household" key (t() cannot resolve it)`);
  }
});

test('Brazilian Portuguese uses localized Help navigation copy', () => {
  const data = JSON.parse(read('../public/locales/pt.json'));

  assert.equal(data.nav?.help, 'Ajuda');
  assert.equal(data.help?.title, 'Ajuda');
  assert.doesNotMatch(JSON.stringify({ nav: data.nav, help: data.help }), /Hilfe/);
});

test('phase 7 locale files keep the de reference key set complete', () => {
  const reference = JSON.parse(readFileSync(new URL('de.json', LOCALE_DIR), 'utf8'));
  const referenceKeys = new Set(flattenLocaleKeys(reference));

  assert.ok(referenceKeys.size > 0, 'de locale should expose reference keys');
  for (const file of LOCALES) {
    const data = JSON.parse(readFileSync(new URL(file, LOCALE_DIR), 'utf8'));
    const keys = new Set(flattenLocaleKeys(data));
    const missing = [...referenceKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !referenceKeys.has(key));

    assert.deepEqual(missing, [], `${file} is missing locale keys`);
    assert.deepEqual(extra, [], `${file} has extra locale keys`);
  }
});

test('dark-mode token blocks stay in sync between @media and [data-theme="dark"]', () => {
  const tokens = read('../public/styles/tokens.css');

  const mediaBlock = tokens.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\n {2}\}\n\}/);
  const attrBlock = tokens.match(/\n\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);

  assert.ok(mediaBlock, 'expected a prefers-color-scheme dark block');
  assert.ok(attrBlock, 'expected a [data-theme="dark"] block');

  const parseVars = (block) => {
    const map = new Map();
    for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      map.set(name, value.trim());
    }
    return map;
  };

  const media = parseVars(mediaBlock[1]);
  const attr = parseVars(attrBlock[1]);

  assert.ok(media.size > 0 && attr.size > 0, 'both dark blocks must declare variables');
  const allKeys = new Set([...media.keys(), ...attr.keys()]);
  const divergent = [...allKeys].filter((k) => media.get(k) !== attr.get(k));
  assert.deepEqual(divergent, [], `dark token blocks diverge for: ${divergent.join(', ')}`);
});

test('phase 1 defines synchronized surface roles for readable work areas', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const mediaBlock = tokens.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\n {2}\}\n\}/);
  const attrBlock = tokens.match(/\n\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);

  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(mediaBlock, 'expected a prefers-color-scheme dark block');
  assert.ok(attrBlock, 'expected a [data-theme="dark"] block');

  const root = parseTokenMap(rootBlock[1]);
  const media = parseTokenMap(mediaBlock[1]);
  const attr = parseTokenMap(attrBlock[1]);
  const publicSurfaceTokens = [
    '--color-surface-work',
    '--color-surface-raised',
    '--color-surface-glass',
    '--app-backdrop-accent-strength',
    '--app-backdrop-secondary-strength',
  ];
  const privateSurfaceTokens = [
    '--_color-surface-work',
    '--_color-surface-raised',
    '--_color-surface-glass',
    '--_app-backdrop-accent-strength',
    '--_app-backdrop-secondary-strength',
  ];

  for (const token of publicSurfaceTokens) {
    assert.ok(root.has(token), `${token} should be available as a public design token`);
    assert.match(root.get(token), /var\(--_/, `${token} should point at a private theme value`);
  }

  for (const token of privateSurfaceTokens) {
    assert.ok(root.has(token), `${token} should have a light-mode value`);
    assert.ok(media.has(token), `${token} should have a system dark-mode override`);
    assert.ok(attr.has(token), `${token} should have an explicit dark-mode override`);
    assert.equal(media.get(token), attr.get(token), `${token} dark values must stay synchronized`);
  }
});

test('phase 1 keeps productive list surfaces opaque instead of high-transparency glass', () => {
  const glass = read('../public/styles/glass.css');
  const productiveRules = [
    ['.tasks-page .task-card', '--color-surface-work'],
    ['.tasks-page .task-card:hover', '--color-surface-raised'],
    ['.shopping-page .shopping-item:hover', '--color-surface-raised'],
    ['.contacts-page .contact-item:hover', '--color-surface-raised'],
  ];

  for (const [selector, token] of productiveRules) {
    const body = cssRuleBody(glass, selector);
    assert.match(body, new RegExp(`var\\(${token}\\)`), `${selector} should use ${token}`);
    assert.doesNotMatch(body, /var\(--glass-bg-card(?:-hover)?\)/, `${selector} should not use translucent card glass`);
    assert.doesNotMatch(body, /backdrop-filter/, `${selector} should not add blur inside productive lists`);
  }
});

test('phase 1 app backdrop uses subtle tokenized tint and opaque scroll content', () => {
  const glass = read('../public/styles/glass.css');
  const layout = read('../public/styles/layout.css');
  const shellRule = cssRuleBody(glass, '.app-shell');
  const glassContentRule = cssRuleBody(glass, '.app-content');
  const layoutContentRule = cssRuleBody(layout, '.app-content');

  assert.match(shellRule, /var\(--app-backdrop-accent-strength\)/, 'app-shell tint strength should be tokenized');
  assert.match(shellRule, /var\(--app-backdrop-secondary-strength\)/, 'secondary backdrop tint should be tokenized');
  assert.match(glassContentRule, /background-color:\s*var\(--color-bg\)/, 'glass.css should keep scroll content on an opaque readable base');
  assert.doesNotMatch(layoutContentRule, /radial-gradient/, 'layout.css should not put decorative radial gradients on the scroll container');
});

test('phase 2 dashboard primary titles do not split words mid-token', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const selectors = [
    '.dashboard-overview__title',
    '.today-cockpit-card__value',
  ];

  for (const selector of selectors) {
    const body = cssRuleBody(dashboard, selector);
    assert.match(body, /overflow-wrap:\s*normal/, `${selector} should prefer natural word wrapping`);
    assert.match(body, /word-break:\s*normal/, `${selector} should not break German words mid-token`);
    assert.doesNotMatch(body, /overflow-wrap:\s*anywhere/, `${selector} must not use anywhere wrapping`);
  }
});

test('phase 2 mobile dashboard cockpit uses a 2x2 glance grid with tokenized stable sizing', () => {
  const dashboard = read('../public/styles/dashboard.css');

  assert.match(
    dashboard,
    /@media \(max-width:\s*640px\)[\s\S]*\.today-cockpit-card\s*\{[\s\S]*min-height:\s*calc\(var\(--target-lg\)\s*\+\s*var\(--space-4\)\)/,
    'mobile cockpit cards should keep stable tokenized min-height'
  );
  // 2×2-Glance-Raster: zwei Spalten auf Mobil, halbe Höhe ggü. 1×4
  assert.match(
    dashboard,
    /@media \(max-width:\s*640px\)[\s\S]*\.today-cockpit__grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'mobile cockpit should use a two-column glance grid'
  );
  // Karten erzwingen keine Vollbreite mehr — sonst entsteht wieder ein 1×4-Stapel
  assert.doesNotMatch(
    dashboard,
    /\.today-cockpit-card--task,\s*\n\s*\.today-cockpit-card--event\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/,
    'task/event cards must not force full-width on mobile (breaks the 2×2 grid)'
  );
  // Sehr schmale Container fallen auf eine Spalte zurück (Container-Query, kein Viewport-BP)
  assert.match(
    dashboard,
    /@container today-cockpit \(max-width:\s*270px\)[\s\S]*grid-template-columns:\s*1fr/,
    'very narrow cockpit container should fall back to a single column'
  );
});

test('phase 2 dashboard FAB uses tokenized position and reserved mobile scroll room', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const fabRule = cssRuleBody(dashboard, '.fab-container');

  assert.match(fabRule, /bottom:\s*calc\(var\(--nav-bottom-height\)\s*\+\s*var\(--space-6\)\)/);
  assert.doesNotMatch(fabRule, /\b24px\b/, 'FAB position should use spacing tokens');
  // Die Scroll-Reserve traegt .dashboard selbst (FAB-Clearance); eine zweite
  // Reserve auf .dashboard-shell stapelte sich zu ~200px totem Raum (Audit A1-16).
  assert.match(
    dashboard,
    /\.dashboard\s*\{[\s\S]*?padding-bottom:\s*calc\(52px \+ var\(--space-6\) \* 2 \+ var\(--space-4\)\)/,
    'mobile dashboard should reserve scroll room for the fixed FAB'
  );
  assert.doesNotMatch(
    dashboard,
    /@media \(max-width:\s*640px\)[\s\S]*\.dashboard-shell\s*\{[^}]*padding-bottom/,
    'the mobile shell must not stack a second FAB clearance (Audit A1-16)'
  );
});

test('calendar draws its gutter from the shared page token and compacts weekday headers', () => {
  const calendar = read('../public/styles/calendar.css');

  // Bis #577 holte der Kalender seinen Seitenrand aus einem modul-eigenen
  // `padding: var(--space-6) var(--space-8)` plus `padding-inline: var(--space-10)`
  // ab 1440px. Das machte ihn mit 1200px zum schmalsten Modul und setzte den
  // sticky Kopf 24px vom oberen Rand ab, obwohl er top:0 klebt. Der Rand kommt
  // jetzt aus derselben Quelle wie überall.
  assert.match(
    calendar,
    /#cal-body\s*\{[^}]*padding-inline:\s*var\(--page-inline-pad\)/,
    'calendar body should take its gutter from the shared --page-inline-pad',
  );
  assert.doesNotMatch(
    calendar,
    /\.calendar-page\s*\{[^}]*padding(-inline)?:\s*var\(--space-/,
    'calendar must not reintroduce a module-specific page gutter (#577)',
  );
  assert.match(
    calendar,
    /@media \(min-width:\s*1024px\)[\s\S]*?\.week-view__day-header\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center/,
    'desktop weekday and date should sit side by side',
  );
  assert.match(
    calendar,
    /@media \(min-width:\s*1024px\)[\s\S]*?\.week-view__day-num\s*\{[\s\S]*?width:\s*var\(--target-sm\);[\s\S]*?height:\s*var\(--target-sm\)/,
    'desktop date markers should use the compact touch-size token',
  );
});

test('dashboard and calendar keep distinct navigation accents in light and dark themes', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = tokens.match(/\n\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);

  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(darkBlock, 'expected a [data-theme="dark"] block');

  for (const [theme, block] of [['light', rootBlock[1]], ['dark', darkBlock[1]]]) {
    const values = parseTokenMap(block);
    assert.notEqual(
      values.get('--_module-dashboard')?.toLowerCase(),
      values.get('--_module-calendar')?.toLowerCase(),
      `${theme} dashboard and calendar accents must be visually distinct`,
    );
  }
});

// ============================================================
// UX-Audit Mai 2026 — P2/P3 (docs/UI-UX-AUDIT-2026-05.md)
// ============================================================

const LOCALE_DIR = new URL('../public/locales/', import.meta.url);
const LOCALES = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));

function flattenLocaleKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenLocaleKeys(value, fullKey);
    }
    return [fullKey];
  });
}

// --- Kontrast-Helfer (WCAG 2.x relative luminance) ---
function parseTokenMap(block) {
  const map = new Map();
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return map;
}

function resolveColor(name, map) {
  let value = map.get(name);
  let guard = 0;
  while (value && /^var\(/.test(value) && guard++ < 12) {
    const ref = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (!ref) break;
    value = map.get(ref[1]);
  }
  return value;
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#([0-9a-f]{6})$/i);
  assert.ok(m, `expected a 6-digit hex color, got: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

function relLum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const l1 = relLum(hexToRgb(a));
  const l2 = relLum(hexToRgb(b));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseCssRgb(value) {
  const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return [...hexToRgb(value), 1];

  const rgba = String(value).trim().match(/^rgba?\(([^)]+)\)$/i);
  assert.ok(rgba, `expected a hex, rgb, or rgba color, got: ${value}`);
  const parts = rgba[1].split(',').map((part) => Number(part.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function compositeColor(foreground, background) {
  const [fr, fg, fb, fa] = parseCssRgb(foreground);
  const [br, bg, bb] = parseCssRgb(background);
  const channels = [
    fr * fa + br * (1 - fa),
    fg * fa + bg * (1 - fa),
    fb * fa + bb * (1 - fa),
  ];
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

test('text/surface token pairs meet WCAG AA 4.5:1 in both themes', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = tokens.match(/\n\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(darkBlock, 'expected a [data-theme="dark"] block');

  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [k, v] of parseTokenMap(darkBlock[1])) dark.set(k, v);

  // Normaltext-Paare, die laut Design AA erfüllen müssen.
  const pairs = [
    ['--color-text-primary', '--color-surface'],
    ['--color-text-primary', '--color-bg'],
    ['--color-text-secondary', '--color-surface'],
    ['--color-text-secondary', '--color-bg'],
    ['--color-text-tertiary', '--color-bg'],
    ['--color-accent', '--color-surface'],
  ];

  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of pairs) {
      const fgHex = resolveColor(fg, map);
      const bgHex = resolveColor(bg, map);
      const ratio = contrastRatio(fgHex, bgHex);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${fg} (${fgHex}) on ${bg} (${bgHex}) is ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1`,
      );
    }
  }
});

test('module accents stay readable as text on the page background in both themes', () => {
  // `.btn--secondary` faerbt seine Beschriftung mit --active-module-accent
  // (layout.css). Steht so ein Button auf dem Seitenhintergrund statt in einer
  // Karte, entscheidet allein die Modulfarbe ueber die Lesbarkeit - im Light-
  // Theme lagen sechs Farben darunter (Settings-Audit 2026-07-27: 4.13:1 bei
  // "Kanal hinzufuegen", 4.20:1 bei "Aus Kontakten importieren").
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = tokens.match(/\n\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootBlock && darkBlock, 'expected :root and [data-theme="dark"] token blocks');

  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [k, v] of parseTokenMap(darkBlock[1])) dark.set(k, v);

  const moduleTokens = [...light.keys()].filter((name) => /^--module-[\w-]+$/.test(name));
  assert.ok(moduleTokens.length >= 15, `expected the module palette, found ${moduleTokens.length}`);

  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    const background = resolveColor('--color-bg', map);
    for (const token of moduleTokens) {
      const accent = resolveColor(token, map);
      const ratio = contrastRatio(accent, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${token} (${accent}) on --color-bg (${background}) is ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1`,
      );
    }
  }
});

test('modal Enter submits the form instead of advancing to the next field (audit 1.4)', () => {
  const src = read('../public/components/modal.js');
  const enterBlock = src.match(/if \(e\.key === 'Enter'\) \{[\s\S]*?\n {4}\}/);
  assert.ok(enterBlock, 'expected an Enter keydown handler');
  assert.match(enterBlock[0], /submitBtn\.click\(\)/, 'Enter must trigger the submit button');
  assert.doesNotMatch(enterBlock[0], /next\.focus\(\)/, 'Enter must not advance focus to the next field');
});

test('shared modal centrally escapes title and select labels (audit 1.8)', () => {
  const src = read('../public/components/modal.js');
  assert.match(src, /id="shared-modal-title">\$\{esc\(title\)\}/, 'modal title must be escaped');
  assert.match(src, /<option value="\$\{esc\(o\.value\)\}">\$\{esc\(o\.label\)\}/, 'select options must be escaped');
  assert.match(src, /import \{ esc \} from '\/utils\/html\.js'/, 'modal must import esc');
});

test('shared prompt and select dialogs expose persistent form labels', () => {
  const src = read('../public/components/modal.js');

  assert.match(
    src,
    /<label class="sr-only" for="prompt-modal-input">\$\{esc\(label\)\}<\/label>/,
    'promptModal input needs a connected label',
  );
  assert.match(
    src,
    /<label class="sr-only" for="select-modal-input">\$\{esc\(label\)\}<\/label>/,
    'selectModal control needs a connected label',
  );
});

test('modal lifecycle uses an explicit state machine, not the old _isClosing flag (audit 1.5)', () => {
  const src = read('../public/components/modal.js');
  assert.match(src, /let modalState = 'idle';/, 'expected an explicit modalState variable');
  assert.match(src, /modalState === 'closing'/, 'close guard must key off modalState');
  assert.doesNotMatch(src, /_isClosing/, 'legacy _isClosing flag must be removed');
});

test('budget chart exposes a screen-reader summary (audit 1.7)', () => {
  const src = read('../public/pages/budget.js');
  assert.match(src, /<p class="sr-only">\$\{esc\(chartSummary\(/, 'chart must render an .sr-only summary');
  assert.match(src, /function chartSummary\(byCategory\)/, 'expected a chartSummary helper');

  for (const file of LOCALES) {
    const json = JSON.parse(read(`../public/locales/${file}`));
    assert.ok(json.budget?.chartSummary, `${file} must define budget.chartSummary`);
    assert.match(json.budget.chartSummary, /\{\{count\}\}/, `${file} chartSummary must interpolate count`);
    assert.match(json.budget.chartSummary, /\{\{top\}\}/, `${file} chartSummary must interpolate top`);
    assert.match(json.budget.chartSummary, /\{\{pct\}\}/, `${file} chartSummary must interpolate pct`);
  }
});

test('Budget places Subscriptions between Budget and Loans with secure rendering', () => {
  const budget = read('../public/pages/budget.js');
  const subscriptions = read('../public/pages/subscriptions.js');
  // Tab-Reihenfolge liegt in der Definitionsliste (data-tab-id wird daraus
  // generiert): Abonnements müssen zwischen Budget und Darlehen stehen.
  const budgetTab = budget.indexOf("['budget',");
  const subscriptionsTab = budget.indexOf("['subscriptions',");
  const loansTab = budget.indexOf("['loans',");

  assert.ok(budgetTab >= 0 && subscriptionsTab > budgetTab && loansTab > subscriptionsTab);
  assert.match(budget, /renderSubscriptions/);
  assert.doesNotMatch(subscriptions, /\.innerHTML\s*=/);
  assert.match(subscriptions, /replaceChildren\(\)/);
  assert.match(subscriptions, /insertAdjacentHTML\(/);
});

test('search fields keep visible labels after users enter a query', () => {
  // The shared page-search building block renders the label+input pair once;
  // page-toolbar modules opt in by calling renderPageSearch with their field id.
  // Split-expenses keeps its own sidebar-filter markup (visible label above the
  // control, server-side reload) as a documented, distinct pattern.
  const pageSearch = read('../public/utils/page-search.js');
  assert.match(pageSearch, /<label[^>]*for="\$\{esc\(id\)\}"/);
  assert.match(pageSearch, /<input[^>]*id="\$\{esc\(id\)\}"/);

  const viaComponent = [
    ['../public/pages/birthdays.js', 'birthdays-search'],
    ['../public/pages/contacts.js', 'contacts-search'],
    ['../public/pages/notes.js', 'notes-search'],
    ['../public/pages/documents.js', 'documents-search'],
  ];
  for (const [file, id] of viaComponent) {
    const source = read(file);
    assert.match(
      source,
      new RegExp(`renderPageSearch\\(\\{[^}]*id:\\s*['"]${id}['"]`),
      `${file} must render #${id} via the shared page-search component`,
    );
  }

  const inlineLabel = [
    ['../public/pages/split-expenses.js', 'split-group-search'],
  ];
  for (const [file, id] of inlineLabel) {
    const source = read(file);
    assert.match(
      source,
      new RegExp(`<label[^>]*for="${id}"[^>]*>[\\s\\S]*?<input[^>]*id="${id}"|<label[^>]*>[\\s\\S]*?<input[^>]*id="${id}"`),
      `${file} must expose a persistent visible label for #${id}`,
    );
  }
});

test('split-expenses archive is reachable and offers a way back (#574)', () => {
  // Archivieren war eine Einbahnstraße: die API kannte ?status=archived, die
  // Oberfläche hatte weder Filter noch Wiederherstellen.
  const page = read('../public/pages/split-expenses.js');
  assert.match(page, /data-status="active"/, 'group list needs an active filter chip');
  assert.match(page, /data-status="archived"/, 'group list needs an archived filter chip');
  assert.match(
    page,
    /\/split-expenses\/groups\?status=\$\{state\.groupStatus\}/,
    'group list must load the selected status, not only active groups',
  );
  assert.match(page, /groups\/\$\{groupId\}\/unarchive/, 'archived groups need a restore action');

  // Das Gruppen-Panel ist ein Grid-Item: ohne min-width:0 wächst es auf die
  // Breite der breitesten Gruppenkarte und schiebt Suche und Filter aus dem
  // Viewport (auf 375px war das Suchfeld rechts abgeschnitten).
  const css = read('../public/styles/split-expenses.css');
  const panelRules = [...css.matchAll(/\.split-groups-panel\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(
    panelRules.some((body) => /min-width:\s*0/.test(body)),
    '.split-groups-panel must not stretch past its grid track',
  );

  assertKeysExistInEveryLocale([
    'splitExpenses.statusLabel',
    'splitExpenses.statusActive',
    'splitExpenses.statusArchived',
    'splitExpenses.restoreGroup',
    'splitExpenses.emptyArchivedTitle',
    // Dynamisch gerendert (activityType.${item.type}), deshalb hier explizit.
    'splitExpenses.activityType.group_unarchived',
  ]);
});

test('German housekeeping visit copy contains no English fallback strings', () => {
  const locale = JSON.parse(read('../public/locales/de.json'));
  const expected = {
    reports: 'Berichte',
    visitRecordedAt: 'Einsatz erfasst um',
    checkedInToday: 'Heute erfasst',
    editVisit: 'Einsatz bearbeiten',
    paymentPaid: 'Bezahlt',
    paymentPending: 'Ausstehend',
    filterMonth: 'Monat',
  };

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(locale.housekeeping[key], value, `housekeeping.${key} must be German`);
  }

  const housekeepingCss = read('../public/styles/housekeeping.css');
  assert.match(
    housekeepingCss,
    /\.housekeeping-worker-strip__identity\s*\{[\s\S]*gap:\s*var\(--space-1\)/,
    'housekeeper name and status need an explicit visual gap',
  );
});

test('holiday chips derive readable ink from each configured color', () => {
  const calendarPage = read('../public/pages/calendar.js');
  const calendarCss = read('../public/styles/calendar.css');

  assert.match(calendarPage, /import \{ getReadableTextColor \} from '\/utils\/color\.js'/);
  assert.match(calendarPage, /--holi-ink:\$\{esc\(getReadableTextColor\(h\.color\)\)\}/);
  for (const selector of ['.month-day__holiday', '.allday-holiday']) {
    const body = cssRuleBody(calendarCss, selector);
    assert.match(body, /color:\s*var\(--holi-ink,\s*var\(--color-text-on-accent\)\)/);
    assert.doesNotMatch(body, /color:\s*#fff/);
  }
});

test('user-selected avatar colors derive readable text ink', () => {
  const dashboard = read('../public/pages/dashboard.js');
  const multiSelect = read('../public/components/user-multi-select.js');
  const color = read('../public/utils/color.js');

  // Single source of truth for the neutral avatar fallback (concrete hex —
  // getReadableTextColor needs a value it can measure luminance on).
  assert.match(color, /export const AVATAR_FALLBACK_COLOR = '#[0-9a-fA-F]{6}';/);

  assert.match(dashboard, /import \{ getReadableTextColor, AVATAR_FALLBACK_COLOR \} from '\/utils\/color\.js'/);
  assert.match(
    dashboard,
    /color:\$\{getReadableTextColor\(u\.avatar_color \|\| AVATAR_FALLBACK_COLOR\)\}/,
  );
  assert.match(multiSelect, /import \{ getReadableTextColor, AVATAR_FALLBACK_COLOR \} from '\/utils\/color\.js'/);
  assert.match(
    multiSelect,
    /color:\$\{getReadableTextColor\(u\.color \?\? AVATAR_FALLBACK_COLOR\)\}/,
  );
  assert.match(
    multiSelect,
    /color:\$\{getReadableTextColor\(u\.avatar_color \?\? AVATAR_FALLBACK_COLOR\)\}/,
  );
});

test('mobile meal actions remain visible and touch-safe after the full cascade', () => {
  const meals = read('../public/styles/meals.css');

  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*640px\)[\s\S]*?\.meal-card__actions\s*\{[\s\S]*?opacity:\s*1/,
  );
  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*640px\)[\s\S]*?\.meal-card__action-btn\s*\{[\s\S]*?width:\s*var\(--target-lg\)[\s\S]*?height:\s*var\(--target-lg\)/,
  );
  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*640px\)[\s\S]*?\.week-nav__today,[\s\S]*?\.meal-slot__add-more-btn\s*\{[\s\S]*?min-height:\s*var\(--target-lg\)/,
  );
  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*640px\)[\s\S]*?\.meal-card__action-btn\s*\{[\s\S]*?color:\s*var\(--color-text-secondary\)/,
  );
});

test('audited profile, birthday, navigation, and budget controls meet mobile touch targets', () => {
  const settings = read('../public/styles/settings.css');
  const layout = read('../public/styles/layout.css');
  const budget = read('../public/styles/budget.css');
  const contacts = read('../public/styles/contacts.css');
  const housekeeping = read('../public/styles/housekeeping.css');
  const subTabs = read('../public/styles/sub-tabs.css');

  assert.match(settings, /\.settings-avatar-action\s*\{[\s\S]*width:\s*var\(--target-md\)[\s\S]*height:\s*var\(--target-md\)/);
  assert.match(
    settings,
    /@media \(max-width:\s*640px\)[\s\S]*\.settings-avatar-action\s*\{[\s\S]*width:\s*var\(--target-lg\)[\s\S]*height:\s*var\(--target-lg\)/,
  );
  assert.match(settings, /\.settings-module-move\s*\{[\s\S]*width:\s*var\(--target-base\)[\s\S]*height:\s*var\(--target-base\)/);
  // Zeilen-Aktionen (Bearbeiten/Löschen in Geburtstags-/Budget-/Kontakt-Karten)
  // teilen jetzt .row-action mit 48px-Touch-Fläche (Audit F1).
  assert.match(layout, /\.row-action\s*\{[\s\S]*width:\s*var\(--target-lg\)[\s\S]*height:\s*var\(--target-lg\)/);
  // Budget-Tabs nutzen jetzt das geteilte .sub-tab (sub-tabs.css) statt eigener
  // .budget-tab-Buttons — Touch-Target dort prüfen (44px, iOS-Minimum, wie alle
  // Sub-Tab-Module: Belohnungen/Haushaltshilfe/Küche/Gesundheit).
  assert.match(subTabs, /\.sub-tab\s*\{[\s\S]*height:\s*var\(--target-base\)/);
  assert.match(budget, /\.budget-nav__today\s*\{[\s\S]*min-height:\s*var\(--target-lg\)/);
  assert.match(
    contacts,
    /@media \(max-width:\s*767px\)[\s\S]*\.contact-filter-chip\s*\{[\s\S]*min-height:\s*var\(--target-lg\)/,
  );
  assert.match(housekeeping, /\.housekeeping-log-action\s*\{[\s\S]*min-height:\s*var\(--target-lg\)/);
});

test('remaining audited mobile controls use 48px touch targets', () => {
  const tasks = read('../public/styles/tasks.css');
  const calendar = read('../public/styles/calendar.css');
  const budget = read('../public/styles/budget.css');
  const settings = read('../public/styles/settings.css');

  assertRuleUsesToken(tasks, '.filter-toggle-btn', 'min-height', '--target-lg', '../public/styles/tasks.css');
  assertRuleUsesToken(calendar, '.cal-toolbar__today', 'min-height', '--target-lg', '../public/styles/calendar.css');
  assertRuleUsesToken(budget, '.budget-loans__filter', 'min-height', '--target-lg', '../public/styles/budget.css');
  assertRuleUsesToken(budget, '.budget-loan-card__filter', 'width', '--target-lg', '../public/styles/budget.css');
  assertRuleUsesToken(budget, '.budget-loan-card__filter', 'height', '--target-lg', '../public/styles/budget.css');
  assert.match(
    settings,
    /@media \(max-width:\s*767px\)[\s\S]*\.settings-breadcrumb__link\s*\{[\s\S]*min-height:\s*var\(--target-lg\)/,
  );
});

test('contacts keep one primary call action and disclose the rest through a labeled More menu', () => {
  const contactsPage = read('../public/pages/contacts.js');
  const contactsCss = read('../public/styles/contacts.css');

  // Genau eine stets sichtbare Primäraktion pro Zeile: Anrufen (falls Telefon da).
  // Nutzt die geteilte .row-action-Grammatik mit semantischer Erfolgs-Färbung
  // (grün) über row-action--success (Audit F1).
  assert.match(contactsPage, /href="tel:[\s\S]*class="row-action row-action--success"/);
  // Sekundäraktionen leben im „Mehr"-Menü als BESCHRIFTETE Einträge (Icon + Text),
  // identisch auf Desktop und Mobile — behebt das „nackte Icons"-Problem.
  assert.match(contactsPage, /class="contact-menu-item"[\s\S]*contact-menu-item__icon[\s\S]*<span>/);
  // Löschen ist ein abgesetzter Danger-Eintrag im selben Menü.
  assert.match(contactsPage, /contact-menu-item contact-menu-item--danger[\s\S]*data-action="delete"/);
  // Menü-Eintrag trägt Textlabel (kein reines Icon mehr).
  assert.match(contactsCss, /\.contact-menu-item\s*\{[\s\S]*min-height:\s*var\(--target-md\)/);
  // Das Panel ist ein Popover (Top-Layer) statt eines absolut positionierten
  // Menüs im Scroll-Container.
  assert.match(contactsCss, /\.contact-more-menu__panel\s*\{[\s\S]*position:\s*fixed/);
  assert.match(contactsPage, /popovertarget="\$\{menuId\}"/);
  assert.match(contactsPage, /id="\$\{menuId\}" popover/);
});

test('contacts keyboard shortcut and aria-live result count are wired', () => {
  const contactsPage = read('../public/pages/contacts.js');

  // sr-only Live-Region sagt die Trefferzahl an
  assert.match(contactsPage, /id="contacts-status"[^>]*role="status"[^>]*aria-live="polite"/);
  // „/" fokussiert die Suche; document-Listener meldet sich bei Teardown selbst ab
  assert.match(contactsPage, /e\.key === '\/'/);
  assert.match(contactsPage, /pageRoot\.isConnected/);
});

test('contacts bulk selection is opt-in and hidden by default', () => {
  const contactsPage = read('../public/pages/contacts.js');
  const contactsCss = read('../public/styles/contacts.css');

  // Toggle in der Toolbar + Auswahl-Leiste, die per hidden startet (Default clean)
  assert.match(contactsPage, /id="contacts-select-btn"/);
  assert.match(contactsPage, /id="contacts-selectbar"[\s\S]*?hidden>/);
  // Sammel-Löschen mit Undo-Toast
  assert.match(contactsPage, /async function deleteSelected/);
  assert.match(contactsPage, /bulkDeletedToast/);
  // Familien-Kontakte bleiben nicht wählbar (deaktivierte Checkbox)
  assert.match(contactsPage, /c\.family_user_id \? ' disabled' : ''/);
  assert.match(contactsCss, /\.contacts-selectbar\s*\{/);
  // display:flex würde das hidden-Attribut schlagen — der [hidden]-Guard hält die
  // Leiste im Default-Zustand wirklich unsichtbar.
  assert.match(contactsCss, /\.contacts-selectbar\[hidden\]\s*\{[\s\S]*display:\s*none/);
});

test('documents and navigation settings use progressive disclosure instead of stacked control cards', () => {
  const documentsPage = read('../public/pages/documents.js');
  const documentsCss = read('../public/styles/documents.css');
  const navigationPage = read('../public/settings/pages/modules-navigation.js');
  const settingsCss = read('../public/styles/settings.css');

  // Dokumente folgen dem Kontakte-Muster (Issue #506): Filter leben in einer
  // eigenen, horizontal scrollenden Zeile unter dem Kopf — nicht mehr hinter
  // einem <details>-Slider in die Kopfzeile gequetscht.
  assert.doesNotMatch(documentsPage, /documents-secondary-controls/);
  assert.match(documentsPage, /<div class="documents-filters">/);
  assert.match(documentsPage, /class="documents-filter-group" id="documents-status"/);
  assert.match(documentsPage, /class="documents-filter-chips" id="documents-category"/);
  // Nur die Kategorie-Facette scrollt; die Filterzeile selbst nicht. Das hält
  // Status, Sortierung und Auswahl immer sichtbar und verhindert verschachtelte
  // Scroller. Vorher brach die Facette um und wuchs unbegrenzt in die Höhe.
  assert.match(
    documentsCss,
    /\.documents-filter-chips\s*\{[^}]*overflow-x:\s*auto/,
  );
  assert.match(documentsCss, /\.documents-filters\s*\{[^}]*overflow:\s*hidden/);
  assert.doesNotMatch(documentsCss, /documents-secondary-controls/);
  assert.match(navigationPage, /class="settings-navigation-panel"/);
  assert.doesNotMatch(navigationPage, /<div class="settings-card">/);
  assert.match(settingsCss, /\.settings-navigation-panel\s*\{[\s\S]*border-bottom:\s*var\(--space-px\)\s+solid\s+var\(--color-border-subtle\)/);
  assert.match(
    settingsCss,
    /@media \(max-width:\s*640px\)[\s\S]*\.settings-module-drag\s*\{[\s\S]*display:\s*none/,
  );
});

test('birthday and navigation headings keep a sequential hierarchy', () => {
  const birthdays = read('../public/pages/birthdays.js');
  const navigation = read('../public/settings/pages/modules-navigation.js');

  assert.match(birthdays, /<h1 class="page-toolbar__title">/);
  assert.doesNotMatch(birthdays, /<h3>/);
  assert.match(navigation, /<h2 class="settings-navigation-panel__title"/);
  assert.match(navigation, /<h3 class="settings-navigation-group__title"/);
  assert.doesNotMatch(navigation, /<h4 class="settings-navigation-group__title"/);
});

test('housekeeping exposes its page title as the primary heading', () => {
  const housekeeping = read('../public/pages/housekeeping.js');

  assert.match(housekeeping, /<h1 class="page-toolbar__title" id="housekeeping-title">/);
  assert.doesNotMatch(housekeeping, /<div class="page-toolbar__title" id="housekeeping-title">/);
});

// Modulkopf-Familien (R2/F4): Es gibt ZWEI bewusste, in utils/tablist.js
// dokumentierte Kopf-Muster, kein Ausreißer:
//   (1) In-Page-Tabs  — Tabs leben im kanonischen `.page-toolbar` mit sichtbarem
//       `<h1 class="page-toolbar__title">`, verdrahtet via wireTablist. Der Tab-
//       wechsel tauscht Inhalt INNERHALB einer Route (budget/housekeeping/rewards).
//   (2) Routen-Cluster — geteilte sticky `.sub-tabs-bar` via renderSubTabs mit
//       dekorativem Inline-Titel + separater `sr-only` <h1>; die Leiste NAVIGIERT
//       zwischen Deep-Link-Routen (health, kitchen: meals/recipes/shopping).
// Der Web-Audit flaggte health als Kopf-Ausreißer; tatsächlich teilt es exakt das
// Muster von kitchen. health auf ein page-toolbar zu zwingen würde es von seinen
// vier Geschwister-Modulen wegbrechen. Dieser Guard pinnt die Grenze, damit ein
// künftiges „Köpfe vereinheitlichen"-Refactor die Routen-Cluster-Familie nicht
// still zerlegt.
// Issue #577: Die Kopf-FAMILIEN (in-page tabs vs. route clusters, Test unten)
// sind bewusst verschieden — die Kopf-BREITEN waren es nie. Bis v1.45.14 trug
// jeder Modul-Root sein eigenes max-width, wodurch der Kopf mit im gedeckelten
// Container saß: der 3px-Akzentstreifen endete 210px vor der Shell-Kante, und
// die Module drifteten auf vier verschiedene Breiten (1700/1280/1200/720).
// Dieser Guard hält die eine Regel fest, die damals nirgends aufgeschrieben war.
// Kommentare VOR jeder Prüfung entfernen: ein Regex über rohen CSS-Text matcht
// sonst auch in /* ... */ und die halbe Vertragsprüfung wäre durch eine
// Erwähnung im Fließtext erfüllbar.
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Flacher Regelblock-Scanner. At-Rule-Präludien (@media, @supports, @container)
// fallen automatisch weg, weil [^{}]* kein '{' fressen kann und der Selektor
// dann mit '@' beginnt.
function cssRules(css) {
  const rules = [];
  for (const [, rawSelector, body] of stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.replace(/\s+/g, ' ').trim();
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selectors: selector.split(',').map((s) => s.trim()), body });
  }
  return rules;
}

// Horizontale Padding-Werte einer Regel. padding-block/-top/-bottom sind bewusst
// NICHT enthalten - die vertikale Achse darf jedes Modul frei setzen.
function horizontalPaddings(body) {
  const values = [];
  for (const [, prop, raw] of body.matchAll(/(?:^|;)\s*(padding(?:-inline(?:-start|-end)?|-left|-right)?)\s*:\s*([^;]+)/g)) {
    const value = raw.trim();
    if (prop !== 'padding') { values.push(value); continue; }
    // Shorthand: die horizontale Achse ist der zweite Wert (bzw. der erste,
    // wenn nur einer angegeben ist). var(--x) und calc(...) zählen als ein Wert.
    const parts = value.match(/(?:[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)|\S)+/gi) || [];
    values.push(parts.length === 1 ? parts[0] : parts[1]);
  }
  return values.filter(Boolean);
}

const ALLOWED_INLINE = /^(0|0px|var\(--page-inline-pad\))$/;

// Dokumentierte Ausnahmen. Bewusst als Liste MIT Begründung statt als stille
// Lücke im Scan: wer hier etwas einträgt, muss den Grund hinschreiben.
const RAIL_PAD_EXCEPTIONS = [
  {
    file: 'kitchen-tabs.css',
    selector: '.kitchen-tabs-bar .sub-tab',
    // Der Tab-Button liegt IN der Rail, er ist nicht die Rail: sein
    // padding-inline ist Innenabstand zwischen Icon und Pill-Rand, nicht die
    // Einrückung der Content-Spalte. Vorher stand hier die Rail selbst
    // (.kitchen-tabs-bar mit padding-inline: var(--space-2)) und deckte diesen
    // Selektor per Substring-Match versehentlich mit ab. Seit der Modultitel
    // mobil entfällt (Critique 2026-07-29), braucht die Rail keinen Override
    // mehr und erbt --page-inline-pad - der 8px-Versatz zum Body ist damit weg.
    reason: 'Button-Innenabstand des Tabs, keine Rail-Einrückung',
  },
];

const isException = (file, selector) => RAIL_PAD_EXCEPTIONS.some(
  (e) => file === e.file && selector.includes(e.selector),
);

// Issue #577: Die Kopf-FAMILIEN (in-page tabs vs. route clusters, Test unten)
// sind bewusst verschieden - die Kopf-BREITEN waren es nie. Bis v1.45.14 trug
// jeder Modul-Root sein eigenes max-width, wodurch der Kopf mit im gedeckelten
// Container saß: der 3px-Akzentstreifen endete 210px vor der Shell-Kante, und
// die Module drifteten auf vier verschiedene Breiten (1700/1280/1200/720).
//
// Der erste Anlauf dieses Guards prüfte nur, ob das Token je Datei VORKOMMT.
// Das fing weder den glass.css-Override (andere Datei, Co-Klassen-Selektor)
// noch den health.css-Mobil-Override (dieselbe Datei, zusätzliche Regel) -
// also genau die beiden Fälle, deretwegen er geschrieben wurde. Jetzt wird
// jeder Regelblock jedes Stylesheets geprüft.
//
// Gegenverifiziert: rot bei (1) Rail-Override in fremder Datei, (2) Mobil-
// Override in derselben Datei, (3) max-width auf einem Modul-Root, (4) Token
// nur noch im Kommentar.
//
// BEKANNTE GRENZE: Ein Textscan sieht keine Verschachtelung. Polstert ein
// NACHFAHRE eines Spaltenträgers noch einmal horizontal (z. B. .budget-summary
// unterhalb von #budget-body), addieren sich die Ränder, ohne dass hier etwas
// anschlägt - der Selektor ist weder ein Rail noch selbst ein Träger. Genau so
// entstand der 16px-Versatz im Budget-Modul nach dem ersten #577-Anlauf.
// Dagegen hilft nur echte Geometrie: ein Playwright-Durchlauf über alle
// Modulrouten, der die Kopf-Kante gegen die erste Inhaltskante vergleicht.
// Der gehört nicht in npm test (braucht Server und DB), sondern in die
// Screenshot-Pipeline.
test('page-inline-pad contract holds across every stylesheet (#577)', () => {
  // Dashboard und Settings sind dokumentierte Ausnahmen: beide haben keinen
  // Canonical Page Head und behalten ihren zentrierten Block.
  const bleedModules = [
    'tasks', 'notes', 'contacts', 'documents', 'housekeeping', 'rewards',
    'budget', 'calendar', 'birthdays', 'meals', 'shopping', 'recipes', 'health',
  ];

  // Rail-Aliasse aus dem Markup lesen. glass.css traf `.tasks-toolbar`, nicht
  // `.page-toolbar` - ein Scan, der nur den Basisnamen kennt, ist dafür blind.
  const rails = new Set(['.page-toolbar', '.sub-tabs-bar']);
  for (const file of walkJsFiles('../public/pages/')) {
    const src = stripCssComments(read(file));
    for (const [, classList] of src.matchAll(/class="([^"]*\bpage-toolbar\b[^"]*)"/g)) {
      classList.split(/\s+/).filter(Boolean).forEach((c) => rails.add(`.${c}`));
    }
    for (const [, classList] of src.matchAll(/className\s*=\s*'([^']*\bpage-toolbar\b[^']*)'/g)) {
      classList.split(/\s+/).filter(Boolean).forEach((c) => rails.add(`.${c}`));
    }
  }
  for (const util of ['kitchen-tabs', 'health-tabs']) {
    for (const [, cls] of read(`../public/utils/${util}.js`).matchAll(/extraClass:\s*'([^']+)'/g)) {
      cls.split(/\s+/).filter(Boolean).forEach((c) => rails.add(`.${c}`));
    }
  }
  assert.ok(rails.size >= 4, 'Rail-Aliasse konnten nicht aus dem Markup gelesen werden');

  const styleFiles = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((f) => f.endsWith('.css'));

  // (1) Kein Stylesheet darf ein Rail horizontal umpolstern - egal welche Datei,
  //     welcher Breakpoint, welche Spezifität.
  for (const file of styleFiles) {
    for (const rule of cssRules(read(`../public/styles/${file}`))) {
      const hitsRail = rule.selectors.some((sel) => [...rails].some(
        (rail) => new RegExp(`${rail.replace('.', '\\.')}(?![\\w-])`).test(sel),
      ));
      if (!hitsRail) continue;
      for (const value of horizontalPaddings(rule.body)) {
        if (isException(file, rule.selectors.join(', '))) continue;
        assert.ok(
          ALLOWED_INLINE.test(value),
          `${file}: "${rule.selectors.join(', ')}" setzt horizontales Padding "${value}" auf einem Full-bleed-Rail. `
          + 'Erlaubt sind nur 0 und var(--page-inline-pad) (#577)',
        );
      }
    }
  }

  // (2) Wer die Content-Spalte trägt, darf sie nirgends mit einem Festwert
  //     überschreiben - auch nicht in einem späteren @media-Block derselben Datei.
  for (const mod of bleedModules) {
    const css = read(`../public/styles/${mod}.css`);
    const rules = cssRules(css);
    const carriers = new Set(
      rules.filter((r) => /padding-inline:\s*var\(--page-inline-pad\)|margin-inline:\s*var\(--page-inline-pad\)/.test(r.body))
        .flatMap((r) => r.selectors),
    );
    assert.ok(carriers.size > 0, `${mod}: kein Träger der Content-Spalte (--page-inline-pad) gefunden (#577)`);

    for (const rule of rules) {
      for (const sel of rule.selectors.filter((s) => carriers.has(s))) {
        for (const value of horizontalPaddings(rule.body)) {
          assert.ok(
            ALLOWED_INLINE.test(value),
            `${mod}.css: "${sel}" trägt die Content-Spalte, überschreibt sie aber mit "${value}" (#577)`,
          );
        }
      }
    }

    // (3) Kein Modul-Root deckelt sich selbst - das war die Ursache von #577.
    for (const rule of rules) {
      if (!rule.selectors.some((s) => new RegExp(`\\.${mod === 'split-expenses' ? 'split' : '[a-z-]+'}-page$`).test(s))) continue;
      assert.doesNotMatch(
        rule.body,
        /(?:^|;)\s*(?:max-)?(?:width|inline-size)\s*:/,
        `${mod}: Modul-Root darf sich nicht selbst deckeln — die Content-Spalte kommt aus --page-inline-pad (#577)`,
      );
    }
  }

  // (4) Die Token-Definition selbst.
  const tokens = stripCssComments(read('../public/styles/tokens.css'));
  assert.match(
    tokens,
    /--page-inline-pad:\s*max\(\s*var\(--page-gutter\),\s*calc\(\(100% - var\(--content-max-width\)\) \/ 2\)\s*\)/,
    'tokens.css muss --page-inline-pad aus --page-gutter und --content-max-width ableiten',
  );
  assert.match(
    tokens,
    /@media \(min-width:\s*1024px\)\s*\{\s*:root\s*\{\s*--page-gutter:\s*var\(--space-8\)/,
    '--page-gutter muss ab 1024px auf --space-8 gehen (eine Quelle für Kopf und Body)',
  );
});

test('module-head families stay split: in-page tabs vs route clusters', () => {
  // Familie 1: page-toolbar-Kopf + wireTablist, keine sub-tabs-bar.
  for (const mod of ['budget', 'housekeeping', 'rewards']) {
    const src = read(`../public/pages/${mod}.js`);
    assert.match(src, /wireTablist/, `${mod}: erwartet wireTablist (In-Page-Tab-Familie)`);
    assert.match(src, /<h1 class="page-toolbar__title"/, `${mod}: erwartet sichtbares <h1 page-toolbar__title>`);
    assert.match(src, /role="tablist"/, `${mod}: Tabs tragen role="tablist" im page-toolbar`);
    assert.doesNotMatch(src, /renderSubTabs\b/, `${mod}: In-Page-Tab-Familie nutzt keine sub-tabs-bar`);
  }

  // Familie 2: geteilte sub-tabs-bar via renderSubTabs, sichtbarer Titel in der
  // Leiste, separates sr-only <h1> als semantische Überschrift.
  const healthTabs = read('../public/utils/health-tabs.js');
  const kitchenTabs = read('../public/utils/kitchen-tabs.js');
  assert.match(healthTabs, /renderSubTabs/, 'health-tabs.js: erwartet renderSubTabs');
  assert.match(healthTabs, /title:\s*t\('nav\.health'\)/, 'health-tabs.js: sichtbarer Inline-Titel in der Leiste');
  assert.match(kitchenTabs, /renderSubTabs/, 'kitchen-tabs.js: erwartet renderSubTabs');

  const health = read('../public/pages/health.js');
  assert.match(health, /renderHealthTabsBar/, 'health: erwartet renderHealthTabsBar');
  assert.match(health, /<h1 class="sr-only">/, 'health: sr-only <h1> (die sub-tabs-bar trägt den sichtbaren Titel)');
  // Präzise auf den Import des geteilten wireTablist-Utils prüfen — der lokale
  // Helfer `wireTablistKeys` (Panel-interne Pfeiltasten) ist bewusst unberührt.
  assert.doesNotMatch(health, /from '\/utils\/tablist\.js'/, 'health bleibt Routen-Cluster (kein wireTablist-Util-Import)');

  // Der Interaktions-Baustein dokumentiert den bewussten Split (eine Grammatik,
  // zwei Layout-Familien) — damit der Guard eine benannte Quelle hat.
  const tablist = read('../public/utils/tablist.js');
  assert.match(tablist, /renderSubTabs/, 'tablist.js dokumentiert die Abgrenzung zu renderSubTabs');
});

// #565: Element.scrollIntoView() beim aktiven Tab scrollt jeden scrollbaren
// Vorfahren mit — auch overflow:hidden-Container wie .calendar-page, die per JS
// scrollbar bleiben, aber weder Scrollbar noch Touch zum Zurückscrollen bieten.
// Auf schmalen Viewports kippte das die ganze Kalenderseite horizontal weg.
// Der Guard hält die Leiste beim reinen Container-Scroll (nur scrollLeft).
test('wireTablist scrolls only its own bar, never via scrollIntoView (#565)', () => {
  const tablist = read('../public/utils/tablist.js');
  assert.doesNotMatch(
    tablist,
    /\.scrollIntoView\(/,
    'tablist.js darf scrollIntoView() nicht nutzen — es scrollt overflow:hidden-Vorfahren mit (#565)',
  );
  assert.match(
    tablist,
    /container\.scrollLeft/,
    'tablist.js muss den aktiven Tab durch container-eigenes scrollLeft ins Bild holen',
  );
});

test('priority badges and meal labels meet WCAG AA contrast in both themes', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = tokens.match(/\n\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(darkBlock, 'expected a [data-theme="dark"] block');

  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [key, value] of parseTokenMap(darkBlock[1])) dark.set(key, value);

  const pairs = [
    ['--color-priority-low', '--color-priority-low-bg'],
    ['--color-priority-medium', '--color-priority-medium-bg'],
    ['--color-priority-high', '--color-priority-high-bg'],
    ['--color-priority-urgent', '--color-priority-urgent-bg'],
  ];

  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    const surface = resolveColor('--color-surface-work', map);
    for (const [foregroundToken, backgroundToken] of pairs) {
      const foreground = resolveColor(foregroundToken, map);
      const background = compositeColor(resolveColor(backgroundToken, map), surface);
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${foregroundToken} on ${backgroundToken} is ${ratio.toFixed(2)}:1`,
      );
    }

    for (const mealToken of ['--meal-breakfast', '--meal-lunch', '--meal-dinner', '--meal-snack']) {
      const mealColor = resolveColor(mealToken, map);
      const mealRatio = contrastRatio(mealColor, surface);
      assert.ok(mealRatio >= 4.5, `${theme}: ${mealToken} is ${mealRatio.toFixed(2)}:1`);
    }
  }
});

test('budget bars animate with transforms instead of layout-driving widths', () => {
  const budgetPage = read('../public/pages/budget.js');
  const budgetCss = read('../public/styles/budget.css');

  assert.doesNotMatch(budgetCss, /transition:\s*width/);
  assert.match(budgetCss, /\.budget-bar-row__fill\s*\{[\s\S]*transform:\s*scaleX\(var\(--bar-scale,\s*0\)\)[\s\S]*transition:\s*transform/);
  assert.match(budgetCss, /\.budget-loan-card__progress span\s*\{[\s\S]*transform:\s*scaleX\(var\(--bar-scale,\s*0\)\)/);
  assert.match(budgetPage, /style="--bar-scale:\$\{pct\s*\/\s*100\}"/);
  assert.match(budgetPage, /style="--bar-scale:\$\{paidPct\s*\/\s*100\}"/);
  assert.doesNotMatch(budgetPage, /style="width:\$\{(?:pct|paidPct)\}%/);
});

test('dashboard and task progress bars animate with transforms instead of widths', () => {
  const dashboardPage = read('../public/pages/dashboard.js');
  const dashboardCss = read('../public/styles/dashboard.css');
  const tasksPage = read('../public/pages/tasks.js');
  const tasksCss = read('../public/styles/tasks.css');

  assert.match(
    dashboardCss,
    /\.shopping-widget-list__bar\s*\{[\s\S]*transform-origin:\s*left[\s\S]*transform:\s*scaleX\(var\(--progress-scale,\s*0\)\)[\s\S]*transition:\s*transform/,
  );
  assert.doesNotMatch(cssRuleBody(dashboardCss, '.shopping-widget-list__bar'), /transition:\s*width/);
  assert.match(dashboardPage, /style="--progress-scale:\$\{progress\s*\/\s*100\}"/);
  assert.doesNotMatch(dashboardPage, /shopping-widget-list__bar" style="width:/);

  assert.match(
    tasksCss,
    /\.subtask-progress__bar-fill\s*\{[\s\S]*transform-origin:\s*left[\s\S]*transform:\s*scaleX\(var\(--progress-scale,\s*0\)\)[\s\S]*transition:\s*transform/,
  );
  assert.doesNotMatch(cssRuleBody(tasksCss, '.subtask-progress__bar-fill'), /transition:\s*width/);
  assert.match(tasksPage, /style="--progress-scale:\$\{progress\s*\/\s*100\}"/);
  assert.doesNotMatch(tasksPage, /subtask-progress__bar-fill" style="width:/);
});

test('toolbar "new" buttons are hidden via a shared class, not an ID list (audit 1.9)', () => {
  const layout = read('../public/styles/layout.css');
  assert.match(layout, /\.toolbar-new-btn\s*\{\s*display:\s*none\s*!important;/, 'expected .toolbar-new-btn rule');
  assert.doesNotMatch(layout, /#btn-new-task,\s*\n\s*#notes-add-btn/, 'legacy ID-list selector must be gone');

  const pages = {
    '../public/pages/tasks.js': 'btn-new-task',
    '../public/pages/notes.js': 'notes-add-btn',
    '../public/pages/contacts.js': 'contacts-add-btn',
    '../public/pages/budget.js': 'budget-add',
    '../public/pages/calendar.js': 'cal-add',
  };
  for (const [file, id] of Object.entries(pages)) {
    const src = read(file);
    const btn = src.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    assert.ok(btn, `${file} must keep #${id}`);
    assert.match(btn[0], /toolbar-new-btn/, `${file} #${id} must carry the .toolbar-new-btn class`);
  }
});

test('login keeps username-style input hints, not email (audit 1.6 — login is by username)', () => {
  const src = read('../public/pages/login.js');
  const input = src.match(/<input[\s\S]*?id="username"[\s\S]*?\/>/);
  assert.ok(input, 'expected a username input');
  assert.match(input[0], /type="text"/, 'username field stays type=text (login is by username, not email)');
  assert.match(input[0], /autocomplete="username"/);
  assert.match(input[0], /autocapitalize="none"/);
  assert.match(input[0], /autocorrect="off"/);
  assert.doesNotMatch(input[0], /type="email"|inputmode="email"/, 'must not use email keyboard for username login');
});

// Der Split-Tab lebt eingebettet im Budget: die ausgeklappte Sidebar zieht rund
// 345px ab, sodass bei 1024px Viewport nur ~680px übrig bleiben. Eine
// Viewport-Query bei 1023px hielt das Kartenraster dort zweispaltig, die
// Salden-Karte schrumpfte auf 120px und „vereinfachte Schulden" schob sich über
// die Nachbarkarte. Der Guard pinnt beide Container-Ebenen (die Seite steuert
// das Panel-Layout, der Hauptbereich das Kartenraster) und hält die verbleibenden
// Viewport-Queries auf echte Geräte-Entscheidungen begrenzt.
test('split expenses reflows from container width, not viewport width', () => {
  const split = read('../public/styles/split-expenses.css');

  assert.match(
    cssRuleBody(split, '.split-page'),
    /container:\s*split-page\s*\/\s*inline-size/,
    '.split-page muss ein inline-size-Container sein (Gast-Route und Budget-Tab teilen die Regeln)',
  );
  assert.match(
    cssRuleBody(split, '.split-main'),
    /container:\s*split-main\s*\/\s*inline-size/,
    '.split-main braucht eine eigene Ebene — es steht hinter dem Gruppen-Panel und hat weniger Platz als .split-page',
  );

  assert.match(
    split,
    /@container split-page \(max-width:\s*719px\)[\s\S]*\.split-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    '.split-layout stapelt nach eigener Breite; minmax(0, 1fr) verhindert, dass die 240px-Gruppenkachel die Spalte aufbläht',
  );
  assert.match(
    split,
    /@container split-main \(max-width:\s*639px\)[\s\S]*\.split-content-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'das Kartenraster stapelt nach der Breite von .split-main, nicht nach dem Viewport',
  );
  // cssRuleBody träfe die geteilte Glass-Regel weiter oben; hier ist die
  // eigenständige .split-groups-panel-Regel gemeint.
  assert.match(
    split,
    /\n\.split-groups-panel\s*\{[^}]*min-width:\s*0/,
    'Grid-Items haben min-width: auto — ohne 0 schiebt die Gruppen-Leiste die Seite über ihren Rand',
  );
  assert.match(
    cssRuleBody(split, '.split-card-head'),
    /flex-wrap:\s*wrap/,
    'Titel und Zusatz der Kartenköpfe brechen um, statt in die Nachbarkarte zu laufen',
  );

  assert.doesNotMatch(
    split,
    /@media \(max-width:\s*1023px\)/,
    'Spaltenumbrüche gehören in @container-Queries — der 1023px-Breakpoint misst den Viewport statt den verfügbaren Platz',
  );
  // Was an @media bleiben darf: Seitengutter und Bottom-Nav-Freiraum sind echte
  // Geräte-Entscheidungen, keine Reflows nach verfügbarer Breite.
  assert.doesNotMatch(
    split,
    /@media[^{]*\{[\s\S]*grid-template-columns/,
    'kein Raster darf mehr an einer Viewport-Query hängen',
  );
});

// Der Aktivitäts-Feed übersetzt über `splitExpenses.activityType.<type>`, wobei
// <type> ungeprüft aus der DB-Spalte kommt. Fehlt der Key, rendert t() den Key
// selbst (i18n.js: `?? key`) — im Feed stand so sichtbar
// „splitExpenses.activityType.expense_added". Ursache waren zwei Typen, die nur
// scripts/seed-demo.js erfand (expense_added, settlement_added), plus eine echte
// Lücke: member_removed schreibt der Server seit jeher, übersetzt war es nie.
// Handgepflegte Listen haben das nicht gefunden — dieser Guard leitet die Typen
// aus dem Quellcode ab, damit jeder neue activity()-Aufruf seinen Key erzwingt.
test('split activity feed translates every type the backend writes', () => {
  const sources = {
    'server/routes/split-expenses.js': read('../server/routes/split-expenses.js'),
    'server/services/split-expenses-scheduler.js': read('../server/services/split-expenses-scheduler.js'),
    'scripts/seed-demo.js': read('../scripts/seed-demo.js'),
  };

  // activity(groupId, actor, 'type', …) bzw. insertActivity(db, …, 'type', …).
  // Der Typ ist das String-Literal vor dem entity_type-Argument; ein Aufruf
  // wählt ihn per Ternary (recurring_resumed/recurring_paused), daher der
  // optionale Vorlauf-Zweig.
  const ENTITY_TYPES = String.raw`'(?:expense|group|member|settlement|recurring_expense)'`;
  const found = new Map();
  for (const [file, src] of Object.entries(sources)) {
    const pattern = new RegExp(String.raw`(?:'([a-z_]+)'\s*:\s*)?'([a-z_]+)',\s*${ENTITY_TYPES}`, 'g');
    for (const [, ternaryBranch, type] of src.matchAll(pattern)) {
      for (const found_type of [ternaryBranch, type]) {
        if (found_type && !found.has(found_type)) found.set(found_type, file);
      }
    }
  }

  // Ein zu kleiner Treffersatz hieße, das Regex passt nicht mehr auf den
  // Quellcode — der Guard wäre dann still wirkungslos statt rot.
  assert.ok(found.size >= 15, `erwartet mindestens 15 Aktivitätstypen, gefunden: ${[...found.keys()].join(', ')}`);

  const de = JSON.parse(read('../public/locales/de.json'));
  const translated = Object.keys(de.splitExpenses.activityType);

  const untranslated = [...found].filter(([type]) => !translated.includes(type));
  assert.deepEqual(
    untranslated.map(([type, file]) => `${type} (${file})`),
    [],
    'jeder geschriebene Aktivitätstyp braucht splitExpenses.activityType.<type> — sonst rendert der Feed den rohen Key',
  );

  // Gegenrichtung: übersetzte Typen, die niemand schreibt, sind entweder tot
  // oder ein Tippfehler gegenüber dem, was der Server tatsächlich einträgt.
  const unwritten = translated.filter((type) => !found.has(type));
  assert.deepEqual(unwritten, [], 'verwaiste activityType-Keys — kein Codepfad schreibt diesen Typ');
});

// ============================================================
// Konsistenz-Audit (UX/UI): Invarianten, die der Audit hergestellt hat.
// Jeder Guard hier hält genau einen Befund geschlossen — die Befunde
// entstanden alle in Bereichen, in denen vorher kein Test hinsah.
// ============================================================

function stylesheetFiles() {
  return readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((file) => file.endsWith('.css'))
    .map((file) => ({ file, css: read(`../public/styles/${file}`) }));
}

test('Viewport-Breakpoints halten den Kontrakt aus tokens.css §11c', () => {
  // Vier strukturelle Grenzen plus ihre max-width-Komplemente. Alles andere
  // ist eine private Schwelle, an der genau ein Modul anders umbricht als der
  // Rest der App. Komponenten-interne Umbrüche gehören in @container-Queries
  // (die dieser Guard bewusst nicht anfasst) oder in fluide clamp()-Werte.
  const allowed = new Set([639, 640, 767, 768, 1023, 1024, 1439, 1440]);
  const offenders = [];

  for (const { file, css } of stylesheetFiles()) {
    for (const match of css.matchAll(/@media[^{]*?\((?:min|max)-width:\s*(\d+)px\)/g)) {
      const px = Number(match[1]);
      if (!allowed.has(px)) {
        const line = css.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} → ${px}px`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'nicht-kanonischer Viewport-Breakpoint — erlaubt sind nur 640/768/1024/1440 (+ Komplemente)',
  );
});

test('Icon-Größen kommen aus der Utility-Skala, nie aus Inline-Styles', () => {
  const offenders = [];
  for (const path of walkFrontendFiles('../public/pages/')
    .concat(walkFrontendFiles('../public/settings/'))
    .concat(walkFrontendFiles('../public/components/'))
    .concat(walkFrontendFiles('../public/utils/'))) {
    const src = read(path);
    // <i data-lucide="…"> mit inline gesetzter Breite/Höhe im selben Tag
    for (const match of src.matchAll(/<i\b[^>]*data-lucide[^>]*>/g)) {
      if (/(?:style="[^"]*(?:width|height)|(?:^|\s)(?:width|height)=)/.test(match[0])) {
        const line = src.slice(0, match.index).split('\n').length;
        offenders.push(`${path}:${line}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Icon-Größe inline gesetzt — icon-sm/md/lg/xl verwenden (Werte: --icon-* in tokens.css)',
  );
});

test('die Icon-Skala hat genau einen Namen pro Stufe', () => {
  const layout = read('../public/styles/layout.css');
  const tokens = read('../public/styles/tokens.css');

  const sizes = new Map();
  for (const match of layout.matchAll(/^\.(icon-[a-z0-9]+)\s*\{([^}]*)\}/gm)) {
    const width = match[2].match(/width:\s*var\((--icon-[a-z]+)\)/);
    assert.ok(width, `${match[1]} muss seine Breite aus einem --icon-*-Token ziehen`);
    sizes.set(match[1], width[1]);
  }

  assert.deepEqual(
    [...sizes.keys()].sort(),
    ['icon-lg', 'icon-md', 'icon-sm', 'icon-xl'],
    'genau vier Icon-Klassen — frühere Aliase (.icon-xs/.icon-11/.icon-base/.icon-2xl) trugen dieselben Werte',
  );

  // Kein Token doppelt belegt: sonst sind zwei Klassennamen wieder dieselbe Größe.
  const used = [...sizes.values()];
  assert.equal(new Set(used).size, used.length, 'zwei Icon-Klassen zeigen auf dasselbe --icon-*-Token');

  const values = used.map((token) => {
    const declared = tokens.match(new RegExp(`\\${token}:\\s*(\\d+)px`));
    assert.ok(declared, `${token} fehlt in tokens.css`);
    return Number(declared[1]);
  });
  assert.equal(new Set(values).size, values.length, 'zwei --icon-*-Tokens haben denselben px-Wert');
});

test('Dialoge laufen über die Modal-Komponente, nicht über native Browser-Dialoge', () => {
  // window.confirm blockiert den Thread, ignoriert das Design-System, hat
  // keinen Fokus-Trap und keine Danger-Farbe. confirmModal/promptModal/
  // selectModal aus components/modal.js decken alle Fälle ab.
  const native = /(?:\bwindow\.(?:confirm|alert|prompt)\s*\(|(?:^|[^.\w])(?:confirm|alert|prompt)\s*\()/;
  const offenders = [];

  for (const path of walkFrontendFiles('../public/pages/')
    .concat(walkFrontendFiles('../public/settings/'))
    .concat(walkFrontendFiles('../public/components/'))
    .concat(walkFrontendFiles('../public/utils/'))) {
    read(path).split('\n').forEach((line, index) => {
      if (native.test(line)) offenders.push(`${path}:${index + 1}`);
    });
  }

  assert.deepEqual(offenders, [], 'nativer Browser-Dialog — confirmModal/promptModal aus components/modal.js verwenden');
});

test('border-radius wird ausschließlich über Radius-Tokens gesetzt', () => {
  const offenders = [];
  for (const { file, css } of stylesheetFiles()) {
    if (file === 'tokens.css') continue;
    for (const match of css.matchAll(/border-radius(?:-[a-z-]+)?:\s*([^;}]+)/g)) {
      const value = match[1].trim();
      if (/^(0|none|inherit|initial|unset)$/.test(value)) continue;
      if (/%|var\(--radius|var\(--lg-card-radius/.test(value)) continue;
      const line = css.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${line} → ${value}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'roher border-radius — --radius-* aus tokens.css verwenden (calc(var(--radius-x) ± Npx) ist erlaubt)',
  );
});

test('der neutralisierte Modal-Footer ist eine Klasse, kein Inline-Style', () => {
  // Zwanzig Stellen bauten border/padding/margin desselben Footers inline nach —
  // mit drei verschiedenen Abständen (space-4/5/6) für dieselbe Rolle.
  const offenders = [];
  for (const path of walkFrontendFiles('../public/pages/')
    .concat(walkFrontendFiles('../public/settings/'))
    .concat(walkFrontendFiles('../public/components/'))) {
    const src = read(path);
    for (const match of src.matchAll(/<div[^>]*modal-panel__footer[^>]*>/g)) {
      if (/style="/.test(match[0])) {
        offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'Modal-Footer inline neutralisiert — modal-panel__footer--plain verwenden');

  const layout = read('../public/styles/layout.css');
  const modalJs = read('../public/components/modal.js');
  assert.match(
    layout,
    /\.modal-panel__footer\.modal-panel__footer--plain\s*\{/,
    'die --plain-Variante braucht Spezifität (0,2,0), sonst gewinnt die Basisregel',
  );
  assert.match(modalJs, /modal-panel__footer--actions/);
  assert.match(modalJs, /modal-actions.*pop\(\)/);
});

// Vier Primitives standen für dieselbe Boolean-Entscheidung nebeneinander:
// `toggle-row`, `settings-toggle`, der iOS-Switch aus `toggle`/`toggle__track`
// und nackte Checkboxen (Critique 2026-07-27). Ursache war die Lücke im
// Komponenten-Set - solange `components.js` keinen Schalter anbot, erfand jedes
// neue Blatt eine weitere Variante.
test('Settings-Schalter kommen aus createToggleRow, nicht aus handgeschriebenem Markup', () => {
  const components = read('../public/settings/components.js');
  assert.match(components, /export function toggleRowHtml\(/);
  assert.match(components, /export function createToggleRow\(/);

  const offenders = [];
  for (const path of walkFrontendFiles('../public/settings/')) {
    if (path.endsWith('components.js')) continue;
    const src = read(path);

    // Handgeschriebenes `<label class="toggle-row">` und die drei Ausweich-
    // Primitives sind ab hier Bugs.
    for (const pattern of [
      /<label[^>]*class="[^"]*\btoggle-row\b/g,
      /class="[^"]*\bsettings-toggle\b/g,
      /class="[^"]*\btoggle__track\b/g,
    ]) {
      for (const match of src.matchAll(pattern)) {
        offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'Schalter über toggleRowHtml()/createToggleRow() bauen');

  // Und die tote Klasse darf nicht zurückkommen: `settings-notice` stand in
  // admin-email im Markup, ohne je in public/styles/ definiert zu sein.
  const styles = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((file) => file.endsWith('.css'))
    .map((file) => read(`../public/styles/${file}`))
    .join('\n');
  assert.ok(!styles.includes('.settings-notice'), 'settings-notice ist keine echte Klasse');
  for (const path of walkFrontendFiles('../public/settings/')) {
    assert.ok(
      !/class(Name)?\s*=\s*["'][^"']*\bsettings-notice\b/.test(read(path)),
      `${path} referenziert die klassenlose settings-notice`,
    );
  }
});

// Neun Blätter holten `GET /preferences` jeweils selbst; fünf Blattwechsel
// kosteten fünf identische Requests (Critique 2026-07-27).
test('Settings-Blätter lesen und schreiben Preferences über den geteilten Cache', () => {
  const offenders = [];
  for (const path of walkFrontendFiles('../public/settings/')) {
    if (path.endsWith('preferences-cache.js')) continue;
    const src = read(path);
    for (const match of src.matchAll(/api\.(get|put)\(\s*['"]\/preferences['"]/g)) {
      offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(offenders, [], 'getPreferences()/savePreferences() aus preferences-cache.js verwenden');

  const cache = read('../public/settings/preferences-cache.js');
  assert.match(cache, /export function resetPreferencesCache\(/);
  // Der Cache muss beim Schreiben fallen, sonst rendert das nächste Blatt einen
  // Stand, den der Server nicht mehr hat.
  assert.match(cache, /finally\s*\{\s*pending = null;/);

  // Und die Shell muss ihn beim Mounten einer frischen Shell verwerfen.
  assert.match(read('../public/settings/shell.js'), /resetPreferencesCache\(\)/);
});

// Ein fehlender Import ist im Blatt ein ReferenceError zur Render-Zeit, den
// keine Quelltext-Assertion sieht: das Blatt landet im Retry-State, die Suite
// bleibt grün. Genau so ist toggleRowHtml in modules-navigation durchgerutscht.
test('jedes Settings-Blatt importiert die geteilten Helfer, die es aufruft', () => {
  const sharedModules = [
    'components.js',
    'preferences-cache.js',
    'weather-location.js',
    'module-order.js',
    'currency.js',
    'region-presets.js',
  ];
  const owners = new Map();
  for (const mod of sharedModules) {
    const src = read(`../public/settings/${mod}`);
    for (const match of src.matchAll(/export (?:async )?function (\w+)|export const (\w+)/g)) {
      owners.set(match[1] ?? match[2], mod);
    }
  }
  assert.ok(owners.has('toggleRowHtml'), 'Der Guard braucht die Export-Liste, sonst prüft er nichts');

  const missing = [];
  for (const path of walkFrontendFiles('../public/settings/')) {
    if (sharedModules.some((mod) => path.endsWith(mod))) continue;
    const src = read(path);
    const imported = new Set(
      [...src.matchAll(/import\s*\{([^}]*)\}\s*from/gs)]
        .flatMap((match) => match[1].split(','))
        .map((part) => part.trim().split(/\s+as\s+/).pop().trim())
        .filter(Boolean),
    );
    for (const [name, mod] of owners) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(src) && !imported.has(name)) {
        missing.push(`${path}: ruft ${name}() aus ${mod}, importiert es aber nicht`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

// Rechtevergabe war bei 390px die schlechteste Flaeche in Settings, ausgerechnet
// bei der Aufgabe mit den groessten sozialen Folgen: 32px-Chips, 32px-Modus-
// umschalter und 34x30px-Zugriffsstufen, deren Klartext nur im `title` stand -
// und `title` erscheint auf Touch nie (Critique 2026-07-27).
test('Rechtevergabe ist auf dem Telefon beschriftet und mit dem Finger bedienbar', () => {
  const source = read('../public/settings/pages/admin-permissions.js');
  // Der Klartext muss im Markup stehen, nicht nur in title/aria-label.
  assert.match(source, /<span class="perm-seg__label">\$\{esc\(o\.label\)\}<\/span>/);
  // aria-label bleibt der spezifischere Name ("Kalender: Kein Zugriff") und
  // enthaelt den sichtbaren Text - sonst bricht WCAG 2.5.3 (Label in Name).
  assert.match(source, /aria-label="\$\{esc\(label \|\| group\)\}: \$\{esc\(o\.label\)\}"/);

  const css = read('../public/styles/settings.css');
  // Die Grenze ist NICHT der Mobile-Breakpoint: iPad Portrait ist 768px, dort
  // galt die kompakte Icon-Variante wieder (gemessen bei 820px: 59 Segmente
  // à 34x30px). `pointer: coarse` deckt das Tablet im Querformat.
  const touchQuery = '@media (max-width: 1023px), (pointer: coarse)';
  assert.ok(css.includes(touchQuery), 'Touch endet nicht bei 767px');
  const mobile = css.slice(css.indexOf(touchQuery, css.indexOf('.perm-modeswitch {')));
  assert.ok(mobile.includes('.perm-seg__label'), 'Der Touch-Block muss das Label sichtbar schalten');
  assert.match(mobile, /\.perm-modeswitch__btn,\s*\.perm-chip \{ min-height: var\(--target-base\); \}/);
  assert.match(mobile, /\.perm-seg__opt \{[^}]*min-height: var\(--target-base\);/s);
  // Gestapelt statt segmentiert: vier Stufen mit Wort passen bei 390px nicht
  // neben den Modulnamen.
  assert.match(mobile, /\.perm-row \{[^}]*flex-direction: column;/s);
  assert.match(mobile, /\.perm-seg \{[^}]*grid-template-columns: repeat\(var\(--seg-count, 3\), 1fr\);/s);

  // Am Zeiger bleibt es kompakt: das Label ist dort ausgeblendet.
  assert.match(css, /\.perm-seg__label \{ display: none; \}/);
});

// "Automatische Backups" mit Titel, Hinweis und leerem Inhalt liest sich als
// "es gibt keine" - die gefaehrlichste Fehldeutung auf einer Backup-Seite.
// Beide Ladepfade schrieben den Fehler nur in die Konsole (Critique
// 2026-07-27), waehrend admin-system es nebenan richtig machte.
test('admin-backup sagt bei Ladefehlern, dass der Stand unbekannt ist', () => {
  const source = read('../public/settings/pages/admin-backup.js');
  assert.match(source, /import \{[\s\S]*?createRetryState[\s\S]*?\} from '\/settings\/components\.js'/);

  // Kein catch darf nur noch loggen.
  const silentCatches = [...source.matchAll(/catch \((\w+)\) \{\s*console\.error\([^)]*\);?\s*\}/g)];
  assert.deepEqual(
    silentCatches.map((m) => m[0].slice(0, 60)),
    [],
    'Ladefehler brauchen einen sichtbaren Zustand, nicht nur console.error',
  );
  assert.equal([...source.matchAll(/createRetryState\(\{/g)].length, 2);

  // Das WebDAV-Formular verschwindet im Fehlerfall: ein leeres Formular sieht
  // aus wie "nichts konfiguriert" und wuerde beim Speichern eine bestehende
  // Verbindung ueberschreiben.
  assert.match(source, /form\.hidden = true;/);

  // ... und `hidden` muss auf der Settings-Flaeche auch wirken: `.settings-form`
  // setzt display:flex mit derselben Spezifitaet wie das UA-`[hidden]` und
  // stand spaeter im Stylesheet, also blieb das Formular sichtbar.
  assert.match(
    read('../public/styles/settings.css'),
    /\.settings-page \[hidden\] \{ display: none !important; \}/,
  );
});

// Das API-Token ist genau einmal sichtbar und stand in einem readonly Input,
// aus dem es von Hand markiert werden musste - der riskanteste Moment der
// Oberflaeche hatte die schwaechste Behandlung (Critique 2026-07-27).
test('das einmalig sichtbare API-Token laesst sich kopieren', () => {
  const source = read('../public/settings/pages/admin-api.js');
  assert.match(source, /id="api-token-copy"/);
  assert.match(source, /settings\.apiTokenCopy/);
  assert.match(source, /navigator\.clipboard\?\.writeText\(value\)/);
  assert.match(source, /settings\.apiTokenCopied/);
  // Der Lucide-Platzhalter im erst spaeter eingeblendeten Block braucht seinen
  // eigenen createIcons-Aufruf.
  assert.match(source, /window\.lucide\?\.createIcons\(\{ el: output \}\)/);
  assertKeysExistInEveryLocale(['settings.apiTokenCopy', 'settings.apiTokenCopied', 'email.saveFailed']);
});

// `housekeeping.deleteTaskConfirm` schrieb `{name}` statt `{{name}}` - in allen
// 23 Locales. Der Loesch-Dialog der Haushaltshilfe zeigte woertlich
// `Aufgabe "{name}" wirklich loeschen?` (public/pages/housekeeping.js:507).
// Der Guard prueft die ganze Klasse, nicht den einen Key.
test('kein Locale-String traegt einen einfach geklammerten Platzhalter', () => {
  const offenders = [];
  for (const file of readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(read(`../public/locales/${file}`));
    const walk = (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        const at = path ? `${path}.${key}` : key;
        if (typeof value === 'string') {
          // `{x}` ohne doppelte Klammern - t() interpoliert nur `{{x}}`.
          const single = value.match(/(?<!\{)\{[a-zA-Z_][a-zA-Z0-9_]*\}(?!\})/g);
          if (single) offenders.push(`${file}: ${at} -> ${single.join(', ')}`);
        } else if (value && typeof value === 'object') {
          walk(value, at);
        }
      }
    };
    walk(data, '');
  }
  assert.deepEqual(offenders, []);
});

test('settings.css haelt Zeilenlaenge, Token-Disziplin und keine toten Regeln', () => {
  const css = read('../public/styles/settings.css');

  // Fließtext lief ueber die volle Content-Spalte (gemessene 794-896px bei
  // 1440px). Der Wert ist an echtem Satztext kalibriert, siehe Kommentar dort.
  assert.match(
    css,
    /\.settings-page \.form-hint,\s*\.settings-page \.settings-card-description,\s*\.settings-page \.settings-leaf-header__description \{\s*max-width: 50ch;/,
  );

  // 23x `1px solid` gegen 21x `var(--space-px) solid` in derselben Datei.
  assert.equal([...css.matchAll(/\b1px solid\b/g)].length, 0, 'Rahmenbreite kommt aus --space-px');

  // Tote Regeln: der Mobile-Override auf einen Breadcrumb, der unter 768px
  // `display: none` ist, und eine Klasse, die shell.js nie erzeugt.
  // Auf den Selektor prüfen, nicht auf das Wort: der Kommentar an der Fundstelle
  // nennt die entfernte Klasse absichtlich.
  assert.ok(
    !/^\s*\.settings-breadcrumb__current\b/m.test(css),
    'shell.js erzeugt settings-breadcrumb__item--current, nicht __current',
  );
  const shell = read('../public/settings/shell.js');
  for (const cls of ['settings-breadcrumb__item--current', 'settings-breadcrumb__link']) {
    assert.ok(shell.includes(cls), `${cls} muss im Markup vorkommen, sonst ist die CSS-Regel tot`);
  }

  // Design-Werte gehoeren nicht ins JS.
  const backup = read('../public/settings/pages/admin-backup.js');
  assert.ok(!/\.style\.(opacity|color)\s*=/.test(backup), 'Tone/Opazitaet ueber Klassen, nicht inline');
  assert.match(css, /\.form-hint--success \{ color: var\(--color-success\); \}/);
  assert.match(css, /\.settings-page \.form-input:disabled \{/);
});

// Avatare tragen die Farbe, die sich das Mitglied selbst aussucht; die
// Initialen standen darauf immer in Weiss. Gemessen 3,5:1 auf #ec4899 und
// 2,8:1 auf #f97316 - noetig sind 4,5:1 (Critique 2026-07-27).
test('Avatar-Initialen waehlen die lesbare Textfarbe', async () => {
  const { contrastRatio, prefersInkText } = await import('../public/utils/contrast.js');

  // Die beiden Befund-Farben wechseln auf dunkle Tinte und halten die Schwelle.
  for (const bg of ['#ec4899', '#f97316']) {
    assert.equal(prefersInkText(bg), true, `${bg} traegt Weiss nicht`);
    assert.ok(contrastRatio(bg, '#000000') >= 4.5);
  }

  // Wo Weiss reicht, bleibt es Weiss: kein flaechendeckendes Umfaerben.
  for (const bg of ['#7c3aed', '#2563eb']) {
    assert.equal(prefersInkText(bg), false, `${bg} haelt die Schwelle mit Weiss`);
    assert.ok(contrastRatio(bg, '#ffffff') >= 4.5);
  }

  // Nicht auswertbare Werte fallen auf die Standardfarbe der Komponente zurueck.
  assert.equal(prefersInkText('var(--color-accent)'), false);
  assert.equal(prefersInkText(null), false);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  // Kurzform-Hex muss dasselbe ergeben wie die Langform.
  assert.equal(contrastRatio('#fff', '#000000'), contrastRatio('#ffffff', '#000000'));

  // Und die Blaetter muessen die Utility auch benutzen.
  for (const leaf of ['admin-family', 'personal-account', 'admin-permissions']) {
    const source = read(`../public/settings/pages/${leaf}.js`);
    assert.match(source, /import \{ prefersInkText \} from '\/utils\/contrast\.js'/, `${leaf} importiert sie nicht`);
    assert.match(source, /prefersInkText\(/, `${leaf} ruft sie nicht auf`);
  }
  assert.match(read('../public/styles/settings.css'), /\.settings-avatar--ink,\s*\.perm-chip__avatar--ink \{\s*color: var\(--color-ink-on-bright\);/);
});


// In einer selbstgehosteten Familieninstanz gibt es weder Support noch Undo.
// Wer die Folgen nicht im Dialog liest, liest sie nie - und "{{name}} wirklich
// loeschen?" loeschte einen Menschen, ohne eine davon zu nennen, waehrend der
// harmlosere Budget-Dialog "Zugeordnete Buchungen bleiben erhalten" sagt
// (Critique 2026-07-27, zweiter Lauf).
test('destruktive Settings-Dialoge nennen ihre Folgen und sind als gefaehrlich markiert', () => {
  const dialoge = [
    ['admin-family.js', 'settings.deleteMemberConfirm', 'settings.deleteMemberConfirmDetail'],
    ['admin-api.js', 'settings.apiTokenRevokeConfirm', 'settings.apiTokenRevokeDetail'],
    ['admin-permissions.js', 'settings.permResetConfirm', 'settings.permResetConfirmDetail'],
    ['admin-backup.js', 'settings.backupRestoreConfirm', 'settings.backupRestoreDetail'],
  ];

  for (const [datei, confirmKey, detailKey] of dialoge) {
    const source = read(`../public/settings/pages/${datei}`);
    // Fenster fester Laenge statt bis `})`: der Confirm-Text interpoliert
    // selbst (`{ name }`) und wuerde den Block zu frueh abschneiden.
    const block = source.slice(source.indexOf(confirmKey), source.indexOf(confirmKey) + 320);
    assert.ok(block.includes('danger: true'), `${datei}: ${confirmKey} braucht danger: true`);
    assert.ok(block.includes(detailKey), `${datei}: ${confirmKey} braucht den Folgen-Text ${detailKey}`);
  }

  assertKeysExistInEveryLocale(dialoge.map(([, , detailKey]) => detailKey));

  // Der Text muss die Folgen benennen, nicht nur warnen: Mindestlaenge als
  // grober Schutz gegen ein spaeteres "Wirklich?" als Detail.
  const de = JSON.parse(read('../public/locales/de.json'));
  for (const [, , detailKey] of dialoge) {
    const value = detailKey.split('.').reduce((o, k) => o?.[k], de);
    assert.ok(value.length >= 80, `${detailKey} ist zu knapp fuer eine Folgenbeschreibung`);
  }
});
