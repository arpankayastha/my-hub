/**
 * Budget-UI-Verträge (UX/UI-Audit Budget-Modul).
 *
 * Pinnt die Invarianten der Audit-Fixes fest, damit sie nicht stillschweigend
 * zurückfallen: eine Quelle für Monatsnavigation/Neu-Aktion je Untertab, das
 * Datum neuer Einträge folgt dem angezeigten Monat, Tab-Leisten tragen echtes
 * ARIA, Charts haben Textalternativen, keine Farb- oder Textliterale im JS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r/g, '');

const budget = read('../public/pages/budget.js');
const stats = read('../public/pages/budget-stats.js');
const plans = read('../public/pages/budget-plans.js');
const subscriptions = read('../public/pages/subscriptions.js');
const layoutCss = read('../public/styles/layout.css');
const tokensCss = read('../public/styles/tokens.css');
const budgetCss = read('../public/styles/budget.css');

// --------------------------------------------------------
// Monatsnavigation und Neu-Aktion je Untertab
// --------------------------------------------------------

test('TAB_CAPS ist die einzige Quelle für Monatsnavigation und Neu-Aktion', () => {
  const table = budget.match(/const TAB_CAPS = \{[\s\S]*?\n\};/);
  assert.ok(table, 'TAB_CAPS-Tabelle fehlt');

  // Jeder Tab der Leiste muss einen Eintrag haben, sonst fällt er auf den
  // Budget-Default zurück und bekommt stillschweigend fremde Bedienelemente.
  for (const id of ['budget', 'accounts', 'plan', 'subscriptions', 'loans', 'reports', 'split-expenses']) {
    assert.match(table[0], new RegExp(`'${id}':`), `TAB_CAPS ohne Eintrag für '${id}'`);
  }

  // Monatsnavigation nur dort, wo der Monat den Inhalt bestimmt.
  assert.match(table[0], /'budget':\s*\{ month: true/);
  assert.match(table[0], /'plan':\s*\{ month: true/);
  for (const id of ['accounts', 'subscriptions', 'loans', 'reports', 'split-expenses']) {
    assert.match(table[0], new RegExp(`'${id}':\\s*\\{ month: false`), `'${id}' darf keine Monatsnavigation zeigen`);
  }

  // Berichte kennt keine Neu-Aktion — dort bleiben Toolbar-Button und FAB weg.
  assert.match(table[0], /'reports':\s*\{ month: false,\s*add: null/);
});

test('Monatsnavigation per Wischgeste auf dem Monatsinhalt', () => {
  assert.match(budget, /wireHorizontalSwipe/);
  assert.match(budget, /onSwipeLeft: \(\) => goMonth\(1\)/);
  assert.match(budget, /onSwipeRight: \(\) => goMonth\(-1\)/);
  assert.match(budget, /isEnabled: \(\) => tabCaps\(\)\.month/);
  assert.match(budgetCss, /#budget-body[\s\S]{0,160}touch-action:\s*pan-y/);
});

test('Monats-Bedienelemente werden als Block geschaltet, nicht einzeln', () => {
  // Der frühere Bug: prev/next versteckt, Label und "Aktuell" blieben stehen.
  const block = budget.match(/\['#budget-prev', '#budget-next', '#budget-today', '#budget-label'\][\s\S]{0,220}/);
  assert.ok(block, 'Monats-Bedienelemente werden nicht gemeinsam geschaltet');
  assert.match(block[0], /el\.hidden = !caps\.month/);
});

test('Toolbar-Aktion und FAB teilen sich Sichtbarkeit und Label', () => {
  assert.match(budget, /const addLabel = caps\.add \? t\(caps\.add\) : ''/);
  assert.match(budget, /addBtn\.hidden = !caps\.add/);
  assert.match(budget, /fab\.hidden = !caps\.add/);
  // Kein Rückfall auf die alten Ausschluss-Listen.
  assert.doesNotMatch(budget, /splitActive \|\| subscriptionsActive/);
});

test('hidden greift bei geteilten Bedienelementen trotz display-Klasse', () => {
  // `.page-fab { display:flex }` bzw. `.btn { display:inline-flex }` schlagen
  // das UA-`[hidden]` bei gleicher Spezifität — ohne Guard bleibt der FAB auf
  // dem Berichte-Tab sichtbar. Seit UX-Audit R2 deckt der Guard auch
  // `.form-group` ab (RRULE-Endefelder, Audit A1-10).
  assert.match(layoutCss, /\.page-fab\[hidden\][\s\S]{0,120}display:\s*none\s*!important/);
  assert.match(layoutCss, /\.btn\[hidden\][\s\S]{0,120}display:\s*none\s*!important/);
  assert.match(layoutCss, /\.form-group\[hidden\][\s\S]{0,120}display:\s*none\s*!important/);
});

// --------------------------------------------------------
// Datum neuer Einträge
// --------------------------------------------------------

test('neue Einträge landen im angezeigten Monat, nicht im heutigen', () => {
  assert.match(budget, /const defaultDate = state\.month === todayMonth \? today : `\$\{state\.month\}-01`/);
  // Das Datumsfeld muss den abgeleiteten Wert nutzen, nicht mehr `today`.
  assert.match(budget, /id="bm-date"\s*\n?\s*value="\$\{isEdit \? entry\.date : defaultDate\}"/);
  assert.doesNotMatch(budget, /id="bm-date"[\s\S]{0,80}entry\.date : today\}/);
});

// --------------------------------------------------------
// Tab-Leisten und Filter-ARIA
// --------------------------------------------------------

test('alle Tab-Leisten des Moduls nutzen die geteilte Verhaltensschicht', () => {
  // Ohne wireTablist gibt es Roving-Tabindex ohne Pfeiltasten — eine Falle, aus
  // der Tastaturnutzer nicht mehr herauskommen.
  assert.match(budget, /wireTablist\(_container\.querySelector\('\.budget-tabs'\)/);
  assert.match(budget, /wireTablist\(_container\.querySelector\('\.budget-scope'\)/);
  assert.match(stats, /wireTablist\(view\.root\.querySelector\('\.budget-stats__ranges'\)/);
  // Der Scope-Umschalter muss dafür data-tab-id tragen (nicht mehr data-scope).
  assert.doesNotMatch(budget, /data-scope=/);
});

test('Zeitraum-Umschalter der Berichte trägt echtes Tab-ARIA', () => {
  const bar = stats.match(/class="budget-stats__ranges"[\s\S]*?<\/div>/);
  assert.ok(bar, 'Zeitraum-Leiste nicht gefunden');
  assert.match(bar[0], /role="tablist"/);
  assert.match(bar[0], /aria-label=/);
  assert.match(stats, /role="tab"[\s\S]{0,140}aria-selected="\$\{on\}"/);
  assert.match(stats, /tabindex="\$\{on \? '0' : '-1'\}"/);
});

test('Darlehens-Filter melden ihren Zustand über aria-pressed', () => {
  assert.match(budget, /data-loan-status="\$\{id\}" aria-pressed="\$\{on\}"/);
  assert.match(budget, /data-action="loan-filter"[\s\S]{0,160}aria-pressed=/);
});

// --------------------------------------------------------
// Charts: Textalternative, Palette, Achsen
// --------------------------------------------------------

test('Trendkurve und Donut haben eine Textalternative mit Werten', () => {
  // Rein visuelle Diagramme ohne sr-only-Zusammenfassung sind für
  // Screenreader-Nutzer leer — der Budget-Tab macht es mit chartSummary vor.
  assert.match(budget, /class="sr-only">\$\{esc\(chartSummary/);
  assert.match(stats, /statsTrendSummary/);
  assert.match(stats, /statsDonutSummary/);
  assert.match(stats, /<p class="sr-only">\$\{view\.ctx\.esc\(summary\)\}<\/p>/);
  // Die SVGs selbst sind dann dekorativ und dürfen nicht doppelt angesagt werden.
  assert.match(stats, /class="budget-stats__trend"[\s\S]{0,120}aria-hidden="true"/);
  assert.match(stats, /class="budget-stats__donut" aria-hidden="true"/);
});

test('Donut-Palette wiederholt keine Farbe und borgt keine Modul-Akzente', () => {
  const palette = stats.match(/const DONUT_COLORS = \[[\s\S]*?\];/);
  assert.ok(palette, 'DONUT_COLORS fehlt');
  assert.doesNotMatch(palette[0], /--module-/, 'Modul-Akzente tragen eine andere Bedeutung');
  const colors = [...palette[0].matchAll(/--chart-series-\d/g)].map((m) => m[0]);
  assert.equal(new Set(colors).size, colors.length, 'doppelte Farbe in der Palette');
  // Segmente über die Palettengröße hinaus werden gebündelt statt eingefärbt.
  assert.match(stats, /const DONUT_SEGMENTS = DONUT_COLORS\.length/);
  assert.match(stats, /statsOtherCategories/);
  assert.match(stats, /stroke="\$\{DONUT_COLORS\[i\]\}"/, 'kein Modulo-Recycling mehr');
});

test('die Datenreihen-Tokens existieren in beiden Themes', () => {
  for (let i = 1; i <= 7; i++) {
    assert.match(tokensCss, new RegExp(`--chart-series-${i}:\\s*var\\(--_chart-series-${i}\\)`));
  }
  // Basis + zwei Dark-Blöcke (@media und [data-theme="dark"]).
  const defs = [...tokensCss.matchAll(/--_chart-series-1:/g)];
  assert.equal(defs.length, 3, 'Dark-Mode-Variante fehlt in einem der beiden Dark-Blöcke');
});

test('die Trendkurve beschriftet Skala und Zeitraum', () => {
  assert.match(stats, /class="budget-stats__axis-max"/);
  assert.match(stats, /class="budget-stats__axis-x"/);
});

test('die Trendkurve macht Einzelwerte ohne Zeigegerät ablesbar', () => {
  // Eine Kurve ohne Werte sagt nur "irgendwann war es viel". Der Wert muss im
  // aria-label des Punktes stehen, nicht bloß in einem Hover-Tooltip.
  assert.match(stats, /class="budget-stats__point"/);
  assert.match(stats, /aria-label="\$\{view\.ctx\.esc\(label\)\}"/);
  assert.match(stats, /statsPointLabel/);
  assert.match(stats, /role="group" aria-label="\$\{t\('budget\.statsPointsLabel'\)\}"/);
  // Ein Tabstopp für die ganze Kurve statt einem pro Tag: Roving-Tabindex.
  assert.match(stats, /tabindex="\$\{i === s\.length - 1 \? '0' : '-1'\}"/);
  const wiring = stats.match(/function wireTrendPoints[\s\S]*?\n\}/);
  assert.ok(wiring, 'wireTrendPoints fehlt');
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.match(wiring[0], new RegExp(key), `Tastaturnavigation ohne ${key}`);
  }
  // Zeigen und Fokus führen beide zur selben Anzeige (Maus, Touch, Tastatur).
  assert.match(wiring[0], /addEventListener\('focusin'/);
  assert.match(wiring[0], /addEventListener\('pointerover'/);
});

test('die Datenreihen-Farben tragen ≥3:1 gegen den Seitengrund (WCAG 1.4.11)', () => {
  const hex = (value) => value.match(/[\da-f]{2}/gi).map((p) => parseInt(p, 16));
  const luminance = ([r, g, b]) => {
    const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // Erste Definition = Light, alle weiteren = die beiden Dark-Blöcke.
  const backgrounds = [...tokensCss.matchAll(/--_neutral-100:\s*(#[\da-fA-F]{6})/g)].map((m) => m[1]);
  assert.ok(backgrounds.length >= 2, 'Hintergrund-Token für beide Themes erwartet');

  const seriesFor = (themeIndex) => {
    const values = [];
    for (let i = 1; i <= 7; i++) {
      const all = [...tokensCss.matchAll(new RegExp(`--_chart-series-${i}:\\s*(#[\\da-fA-F]{6})`, 'g'))].map((m) => m[1]);
      assert.ok(all[themeIndex], `--_chart-series-${i} fehlt für Theme ${themeIndex}`);
      values.push(all[themeIndex]);
    }
    return values;
  };

  for (const [themeIndex, theme] of [[0, 'light'], [1, 'dark']]) {
    const bg = hex(backgrounds[themeIndex]);
    seriesFor(themeIndex).forEach((color, i) => {
      const ratio = contrast(hex(color), bg);
      assert.ok(ratio >= 3, `${theme}: --chart-series-${i + 1} (${color}) nur ${ratio.toFixed(2)}:1 gegen ${backgrounds[themeIndex]}`);
    });
  }
});

// --------------------------------------------------------
// Hard Constraints: keine Literale
// --------------------------------------------------------

test('keine hartkodierten Anzeigetexte in den Budget-Views', () => {
  assert.doesNotMatch(budget, /Loan repayment:/);
  assert.doesNotMatch(budget, /'Geschenke & Transfers'/);
  // Das Vergleichswort der Trendzeile gehört in den Locale-Key, nicht ins Template.
  assert.doesNotMatch(budget, /\}\s*vs\.\s*\$\{prevLabel\}/);
  assert.match(budget, /t\('budget\.trendDelta'/);
});

test('Trendpfeile sind Icons, keine Textglyphen', () => {
  assert.doesNotMatch(budget, /'▲'/);
  assert.doesNotMatch(budget, /'▼'/);
  assert.match(budget, /trending-up/);
  assert.match(budget, /trending-down/);
});

test('Konto-Farben kommen aus Tokens und tragen sprechende Labels', () => {
  const palette = budget.match(/const ACCOUNT_COLORS = \[[\s\S]*?\];/);
  assert.ok(palette, 'ACCOUNT_COLORS fehlt');
  assert.doesNotMatch(palette[0], /#[0-9a-fA-F]{6}/, 'Hex-Literale gehören in tokens.css');
  assert.match(palette[0], /nameKey: 'budget\.color/);
  // Screenreader lasen vorher den Hexcode vor.
  assert.match(budget, /t\(c\.nameKey\)/);
});

test('kein toter Toast-Typ: nur gestylte Varianten werden verwendet', () => {
  const styled = new Set(['success', 'danger', 'warning', 'default']);
  for (const [file, src] of [['budget.js', budget], ['budget-stats.js', stats], ['budget-plans.js', plans], ['subscriptions.js', subscriptions]]) {
    for (const match of src.matchAll(/showToast\([^)]*?,\s*'([a-z]+)'/g)) {
      assert.ok(styled.has(match[1]), `${file}: showToast-Typ '${match[1]}' hat keine Styles`);
    }
  }
});

// --------------------------------------------------------
// Saldo entdramatisieren bei reinem Ausgaben-Tracking (#504)
// --------------------------------------------------------

test('Saldo wird neutral, wenn keine Einnahmen erfasst sind', () => {
  // Ohne Einnahmen ist balance = -Ausgaben eine Tautologie; die rote Zahl liest
  // sich fälschlich als „im Minus". Bedingung: income === 0 && balance < 0.
  assert.match(budget, /const balanceNeutral = s\.income === 0 && s\.balance < 0;/);
  assert.match(budget, /balanceNeutral[\s\S]{0,80}budget-summary-card--balance-neutral/);
  // Echte Einnahmen behalten die Farbsemantik (grün Überschuss / rot Mehrausgabe).
  assert.match(budget, /budget-summary-card--balance-positive/);
  assert.match(budget, /budget-summary-card--balance-negative/);
});

test('der Saldo-Trend entfällt im neutralen Ausgaben-Fall', () => {
  // Ein farbiger Trendpfeil unter der bewusst neutralisierten Zahl wäre widersprüchlich
  // und ohne echten Saldo ohne Aussage.
  assert.match(budget, /p && !balanceNeutral \? renderTrend\(s\.balance/);
});

test('die neutrale Saldo-Farbe kommt aus einem Token, nicht als Literal', () => {
  const rule = budgetCss.match(/\.budget-summary-card--balance-neutral[^\n]*\{[^}]*\}/);
  assert.ok(rule, '.budget-summary-card--balance-neutral fehlt in budget.css');
  assert.match(rule[0], /var\(--color-text-primary\)/);
  assert.doesNotMatch(rule[0], /var\(--color-danger\)|var\(--color-success\)/);
});

// --------------------------------------------------------
// „Nur Ausgaben"-Umschalter (#504)
// --------------------------------------------------------

test('„Nur Ausgaben" reduziert die Zusammenfassung auf die Ausgaben-Karte', () => {
  // Reines Ausgaben-Tracking soll weder einen (neutralen) Saldo noch eine Dauer-Null
  // bei den Einnahmen zeigen - der Umschalter blendet beide Karten aus.
  assert.match(budget, /expensesOnly \? expensesCard : incomeCard \+ expensesCard \+ balanceCard/);
});

test('der „Nur Ausgaben"-Umschalter meldet seinen Zustand als echter Switch', () => {
  assert.match(budget, /id="budget-expenses-only"[\s\S]{0,120}role="switch"/);
  assert.match(budget, /aria-checked="\$\{expensesOnly \? 'true' : 'false'\}"/);
});

test('der „Nur Ausgaben"-Zustand ist client-persistent und geräte-lokal', () => {
  // Reine Anzeige-Präferenz über localStorage (my-hub-*), kein Server-Roundtrip -
  // Liste, Diagramm und CSV-Export bleiben unberührt.
  assert.match(budget, /const EXPENSES_ONLY_KEY = 'my-hub-budget-expenses-only';/);
  assert.match(budget, /state\.expensesOnly = localStorage\.getItem\(EXPENSES_ONLY_KEY\) === '1';/);
  assert.match(budget, /localStorage\.setItem\(EXPENSES_ONLY_KEY, state\.expensesOnly \? '1' : '0'\)/);
});

test('die Ausgaben-Karte trägt im „Nur Ausgaben"-Modus die volle Breite', () => {
  const rule = budgetCss.match(/\.budget-summary--expenses-only[^\n]*\{[^}]*\}/);
  assert.ok(rule, '.budget-summary--expenses-only fehlt in budget.css');
  assert.match(rule[0], /grid-template-columns:\s*1fr/);
});

test('der „Nur Ausgaben"-Umschalter nutzt Tokens, keine Farbliterale', () => {
  const rule = budgetCss.match(/\.budget-expenses-toggle\s*\{[^}]*\}/);
  assert.ok(rule, '.budget-expenses-toggle fehlt in budget.css');
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}\b/);
});

// --------------------------------------------------------
// Zustand, Fokus, Ladewahrnehmung
// --------------------------------------------------------

test('Filterzustand überlebt den Modulwechsel nicht', () => {
  // `state` ist ein Modul-Singleton: ohne Reset zeigt das Budget beim nächsten
  // Besuch noch den Kontoauszug von damals.
  const enter = budget.match(/export async function render\([\s\S]*?renderBody\(\);/);
  assert.ok(enter);
  for (const field of ['accountFilterId', 'loanFilterId', 'loanStatusFilter', 'accountsShowArchived']) {
    assert.match(enter[0], new RegExp(`state\\.${field} = `), `${field} wird beim Betreten nicht zurückgesetzt`);
  }
});

test('der Konto-Drilldown verliert den Fokus nicht', () => {
  assert.match(budget, /_container\.querySelector\('#budget-body'\)\?\.focus\(\)/);
});

test('das Inline-Kategorie-Overlay ist ein vollwertiger Dialog', () => {
  const overlay = budget.match(/function requestNameInPanel[\s\S]*?\n\}/);
  assert.ok(overlay);
  assert.match(overlay[0], /e\.key === 'Escape'/);
  assert.match(overlay[0], /e\.key !== 'Tab'/, 'Fokus-Trap fehlt');
  assert.match(overlay[0], /opener\?\.isConnected/, 'Fokus kehrt nicht zum Auslöser zurück');
});

test('Berichte und Plan zeigen beim Laden ein Skelett', () => {
  assert.match(stats, /renderSkeletonList/);
  assert.match(plans, /renderSkeletonList/);
});

// --------------------------------------------------------
// Abo-Filterleiste
// --------------------------------------------------------

test('Abo-Filter tragen sichtbare Labels und lassen sich zurücksetzen', () => {
  for (const key of ['filterLabelCategory', 'filterLabelMethod', 'filterLabelStatus', 'filterLabelSort']) {
    assert.match(subscriptions, new RegExp(`subscriptions\\.${key}`), `sichtbares Label ${key} fehlt`);
  }
  assert.match(subscriptions, /function hasActiveFilters/);
  assert.match(subscriptions, /async function resetFilters/);
  // Leere Liste durch Filter ist ein anderer Zustand als "noch keine Abos".
  assert.match(subscriptions, /subscriptions\.noMatchesTitle/);
});

// --------------------------------------------------------
// i18n
// --------------------------------------------------------

test('alle neuen Keys existieren in jeder Locale', () => {
  const keys = [
    'budget.trendDelta', 'budget.statsRangeLabel', 'budget.statsOtherCategories',
    'budget.statsTrendSummary', 'budget.statsDonutSummary',
    'budget.colorTeal', 'budget.colorBlue', 'budget.colorViolet', 'budget.colorMagenta',
    'budget.colorOrange', 'budget.colorGreen', 'budget.colorOcher',
    'budget.statsPointLabel', 'budget.statsPointsLabel',
    'budget.expensesOnly', 'budget.expensesOnlyHint',
    'subscriptions.resetFilters', 'subscriptions.noMatchesTitle', 'subscriptions.noMatchesDescription',
    'subscriptions.filterLabelCategory', 'subscriptions.filterLabelMethod',
    'subscriptions.filterLabelStatus', 'subscriptions.filterLabelSort',
  ];
  const files = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 23, 'unerwartet wenige Locale-Dateien');
  for (const file of files) {
    const data = JSON.parse(read(`../public/locales/${file}`));
    for (const key of keys) {
      const value = key.split('.').reduce((v, part) => (v != null ? v[part] : undefined), data);
      assert.equal(typeof value, 'string', `${file}: ${key} fehlt`);
      assert.ok(value.trim().length > 0, `${file}: ${key} ist leer`);
    }
  }
});

test('die Platzhalter der neuen Sätze bleiben in jeder Locale erhalten', () => {
  const expected = {
    'budget.trendDelta': ['{{amount}}', '{{month}}'],
    'budget.statsTrendSummary': ['{{periods}}', '{{income}}', '{{expenses}}', '{{peak}}'],
    'budget.statsDonutSummary': ['{{count}}', '{{top}}', '{{pct}}', '{{total}}'],
    'budget.statsPointLabel': ['{{period}}', '{{income}}', '{{expenses}}'],
  };
  const files = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const data = JSON.parse(read(`../public/locales/${file}`));
    for (const [key, placeholders] of Object.entries(expected)) {
      const value = key.split('.').reduce((v, part) => v[part], data);
      for (const placeholder of placeholders) {
        assert.ok(value.includes(placeholder), `${file}: ${key} ohne ${placeholder}`);
      }
    }
  }
});

test('liquid glass stylesheet wires for Overview, Budget, and Health', () => {
  const router = read('../public/router.js');
  const lg = read('../public/styles/module-liquid-glass.css');
  assert.match(router, /LIQUID_GLASS_MODULES/);
  assert.match(router, /module-liquid-glass\.css/);
  assert.match(router, /dataset\.lgModule/);
  assert.match(lg, /data-lg-module="dashboard"/);
  assert.match(lg, /data-lg-module="budget"/);
  assert.match(lg, /data-lg-module="health"/);
});
