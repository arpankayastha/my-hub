/**
 * Modul: Vorrat (Pantry)
 * Zweck: Bestand, Lagerort und Mindesthaltbarkeit der Vorräte verwalten (#596)
 * Abhängigkeiten: /api.js
 *
 * Die vierte Seite des Küchen-Kreislaufs: Mahlzeiten planen, Rezepte kochen,
 * Einkauf besorgen - und hier steht, was tatsächlich im Haus ist.
 */

import { api } from '/api.js';
import { t, getFormatLocale, formatDate } from '/i18n.js';
import { esc } from '/utils/html.js';
import {
  openModal as openSharedModal,
  closeModal as closeSharedModal,
  selectModal,
  advancedSection,
  wireBlurValidation,
  reportFieldError,
} from '/components/modal.js';
import { renderKitchenTabsBar } from '/utils/kitchen-tabs.js';
import { renderSkeletonList } from '/utils/skeleton.js';
// Alias, weil dieses Modul selbst eine `emptyStateEl()`-Funktion hat, die den
// Renderer mit den Vorrats-Texten füllt.
import { emptyStateEl as emptyStateComponentEl, mountEmptyState } from '/utils/empty-state.js';
import { scheduleUndoableDelete, vibrate, wireScrollFade } from '/utils/ux.js';
import { toLocalDateKey } from '/utils/date.js';
import { DEFAULT_CATEGORY_NAME, categoryLabel } from '/utils/shopping-categories.js';
import { locationLabel } from '/utils/pantry-locations.js';
import { PANTRY_UNITS, normalizePantryQuantity, pantryUnitStep } from '/utils/pantry-units.js';
import {
  PANTRY_FILTERS,
  daysUntil,
  matchesPantryFilter,
  pantryFilterCounts,
  pantryItemStatus,
} from '/utils/pantry-status.js';

let _container = null;

const state = {
  items: [],
  locations: [],
  categories: [],
  /** Einkaufslisten - erst beim ersten „Auf die Einkaufsliste" nachgeladen. */
  lists: null,
  query: '',
  filter: 'all',
  /** Einmal pro Render eingefroren: sonst könnte ein über Mitternacht offener
   *  Tab Zeilen unterschiedlich bewerten, je nachdem wann sie gezeichnet wurden. */
  todayKey: toLocalDateKey(),
};

/** Ausstehende Mengen-PATCHes je Artikel (Stepper-Entprellung). */
const pendingQuantity = new Map();
const QUANTITY_DEBOUNCE_MS = 450;
/** Monotone Folgenummer, die überholte PATCH-Antworten erkennbar macht. */
let _quantitySeq = 0;

// --------------------------------------------------------
// Formatierung
// --------------------------------------------------------

/**
 * Menge ohne überflüssige Nachkommastellen: 2 bleibt "2", 2,5 wird lokalisiert.
 * getFormatLocale() statt getLocale() - die Zahlenformat-Präferenz ist von der
 * UI-Sprache entkoppelt (#521).
 */
function formatQuantity(value) {
  return new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

/**
 * Einheit übersetzen, mit Rückfall auf den Rohwert. Alle Schreibpfade der App
 * normalisieren über normalizePantryUnit() auf die zehn kanonischen Einheiten,
 * ein unbekannter Wert ist also nicht über die Oberfläche erreichbar - wohl
 * aber über einen direkten Datenbankzugriff, einen Fremdimport oder eine
 * künftige Einheit, deren Locale-Key noch fehlt. Ohne diesen Rückfall stünde
 * dann der nackte Schlüssel in der Zeile („1 pantry.units.Stk"), und zwar an
 * der Stelle, an der die Menge steht. Der Rohwert ist immer noch lesbar.
 */
function unitLabel(unit) {
  const key = `pantry.units.${unit}`;
  const label = t(key);
  return label === key ? String(unit ?? '') : label;
}

function quantityText(item) {
  return `${formatQuantity(item.quantity)} ${unitLabel(item.unit)}`;
}

/**
 * Ablauf-Badge als { text, tone } oder null. Bewusst nur für abgelaufen/bald:
 * ein Badge auf jeder Zeile wäre Ornament und würde genau die Zeilen entwerten,
 * die wirklich Aufmerksamkeit brauchen.
 */
function expiryBadge(item) {
  const { expiry } = pantryItemStatus(item, state.todayKey);
  if (!expiry) return null;

  const days = daysUntil(item.expires_on, state.todayKey);
  if (expiry === 'expired') {
    return {
      tone: 'danger',
      text: days === -1 ? t('pantry.badgeExpiredYesterday') : t('pantry.badgeExpiredDays', { count: Math.abs(days) }),
    };
  }
  if (days === 0) return { tone: 'warning', text: t('pantry.badgeExpiresToday') };
  if (days === 1) return { tone: 'warning', text: t('pantry.badgeExpiresTomorrow') };
  return { tone: 'warning', text: t('pantry.badgeExpiresDays', { count: days }) };
}

function stockBadge(item) {
  const { out, low } = pantryItemStatus(item, state.todayKey);
  if (out) return { tone: 'danger', text: t('pantry.badgeOut') };
  if (low) return { tone: 'warning', text: t('pantry.badgeLow') };
  return null;
}

// --------------------------------------------------------
// Laden
// --------------------------------------------------------

async function loadPantry() {
  const res = await api.get('/pantry');
  state.items = res.data ?? [];
  state.locations = res.locations ?? [];
  state.categories = res.categories ?? [];
}

/** Einkaufslisten nachladen (erst wenn eine Übergabe ansteht). */
async function ensureLists() {
  if (state.lists) return state.lists;
  const res = await api.get('/shopping');
  state.lists = res.data ?? [];
  return state.lists;
}

// --------------------------------------------------------
// Auswahl / Gruppierung
// --------------------------------------------------------

function visibleItems() {
  const q = state.query.toLowerCase();
  return state.items.filter((item) => {
    if (!matchesPantryFilter(item, state.filter, state.todayKey)) return false;
    if (!q) return true;
    return item.name?.toLowerCase().includes(q)
      || item.notes?.toLowerCase().includes(q)
      || (item.location_name && locationLabel(item.location_name).toLowerCase().includes(q));
  });
}

/**
 * Ohne Filter nach Lagerort gruppiert („wo liegt was?"). Sobald ein Filter
 * aktiv ist, ist der Ort nicht mehr die Frage - dann ist eine flache, nach
 * Dringlichkeit sortierte Liste die ehrlichere Antwort. Der Ort wandert in
 * die Meta-Zeile und geht dabei nicht verloren.
 */
function groupedItems(items) {
  if (state.filter !== 'all') {
    const flat = [...items];
    if (state.filter === 'expired' || state.filter === 'soon') {
      flat.sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)));
    } else {
      flat.sort((a, b) => Number(a.quantity) - Number(b.quantity));
    }
    return [{ key: 'flat', label: null, items: flat }];
  }

  const byLocation = new Map();
  for (const item of items) {
    const key = item.location_id ?? 'none';
    if (!byLocation.has(key)) byLocation.set(key, []);
    byLocation.get(key).push(item);
  }

  const groups = [];
  for (const loc of state.locations) {
    const rows = byLocation.get(loc.id);
    if (rows?.length) groups.push({ key: loc.id, label: locationLabel(loc.name), icon: loc.icon, items: rows });
  }
  const orphans = byLocation.get('none');
  if (orphans?.length) {
    groups.push({ key: 'none', label: t('pantry.unlocated'), icon: 'package', items: orphans });
  }
  return groups;
}

// --------------------------------------------------------
// Render
// --------------------------------------------------------

export async function render(container) {
  _container = container;
  state.todayKey = toLocalDateKey();
  // Frische Seite: die Chip-Leiste darf beim ersten Zeichnen wieder scrollen.
  _scrolledFilter = null;

  const page = document.createElement('div');
  page.className = 'pantry-page';

  // sr-only: die Küchen-Tab-Leiste benennt das Modul bereits sichtbar -
  // dieselbe Kopf-Grammatik wie Mahlzeiten/Rezepte/Einkauf.
  const title = document.createElement('h1');
  title.className = 'sr-only';
  title.textContent = t('pantry.title');

  // Eine geteilte Live-Region für die ganze Seite statt einer je Zeile.
  const live = document.createElement('div');
  live.id = 'pantry-live';
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  // Kanonischer Kopf, Gruppen-Variante (siehe .page-toolbar--in-group in
  // layout.css): Suche im __center-Slot, Lagerort-Verwaltung im __actions-Slot -
  // dieselbe Slot-Ordnung wie in den drei Geschwister-Tabs.
  const toolbar = document.createElement('div');
  toolbar.className = 'page-toolbar page-toolbar--in-group';
  toolbar.insertAdjacentHTML('beforeend', `
    <div class="page-toolbar__center">
      <div class="pantry-search">
        <input type="search" class="form-input pantry-search__input" id="pantry-search"
               placeholder="${esc(t('pantry.searchPlaceholder'))}"
               aria-label="${esc(t('pantry.searchPlaceholder'))}">
      </div>
    </div>
    <div class="page-toolbar__actions">
      <button class="btn btn--ghost btn--icon" data-action="manage-locations"
              aria-label="${esc(t('pantry.manageLocations'))}" title="${esc(t('pantry.manageLocations'))}">
        <i data-lucide="archive" class="icon-md" aria-hidden="true"></i>
      </button>
    </div>`);

  const filters = document.createElement('div');
  filters.className = 'pantry-filters';
  filters.id = 'pantry-filters';

  const list = document.createElement('div');
  list.className = 'pantry-list';
  list.id = 'pantry-list';
  list.setAttribute('aria-busy', 'true');
  list.insertAdjacentHTML('beforeend', renderSkeletonList({ rows: 6, lines: 2 }));

  const fab = document.createElement('button');
  fab.className = 'page-fab';
  fab.type = 'button';
  fab.id = 'fab-new-pantry-item';
  fab.setAttribute('aria-label', t('pantry.addItem'));
  fab.insertAdjacentHTML('beforeend', '<i data-lucide="plus" aria-hidden="true"></i>');

  page.append(title, live, toolbar, filters, list, fab);
  container.replaceChildren(page);
  renderKitchenTabsBar(container, '/pantry');

  if (window.lucide) window.lucide.createIcons({ el: container });

  toolbar.querySelector('#pantry-search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    renderList();
  });

  toolbar.querySelector('[data-action="manage-locations"]').addEventListener('click', openLocationManager);
  fab.addEventListener('click', () => openItemModal('create'));

  filters.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    renderFilters();
    renderList();
  });

  list.addEventListener('click', onListClick);

  try {
    await loadPantry();
  } catch (err) {
    renderLoadError(list, err);
    return;
  }

  renderFilters();
  renderList();
}

function renderLoadError(list, err) {
  list.removeAttribute('aria-busy');
  mountEmptyState(list, {
    variant: 'error',
    title: t('pantry.loadErrorTitle'),
    description: err?.data?.error ?? t('pantry.loadErrorDescription'),
    action: { label: t('common.retry'), onClick: () => render(_container) },
  });
}

/**
 * Filter-Chips. Ein Zustand ohne Treffer bekommt keine Chip: eine Chip, die
 * garantiert auf eine leere Liste führt, ist eine Sackgasse. Bleibt nur „Alle"
 * übrig, entfällt die Zeile ganz - eine einzelne Chip filtert nichts.
 */
/**
 * Zuletzt ins Sichtfeld geholter Filter. Ohne dieses Gedächtnis rief jeder
 * Re-Render `scrollIntoView` auf - und weil `adjustQuantity` die Leiste bei
 * jedem ±-Tap neu zeichnet, riss ein einziger Tap die manuell zurückgescrollte
 * Leiste wieder weg und schob den „Alle"-Ausgang aus dem Bild (Critique P1).
 */
let _scrolledFilter = null;

/**
 * @returns {{ wasReset: boolean }} `wasReset` ist true, wenn der aktive Filter
 * seinen letzten Treffer verloren hat und automatisch auf „Alle" zurückfiel -
 * dann muss der Aufrufer auch die Liste neu zeichnen, sonst zeigen die Chips
 * „Alle" und die Liste weiter die alte gefilterte Teilmenge.
 */
function renderFilters() {
  const bar = _container?.querySelector('#pantry-filters');
  if (!bar) return { wasReset: false };

  // Kanten-Anriss der Chip-Leiste. Sie scrollt horizontal (gemessen 135px
  // Überhang bei 393px, 208px bei 320px), blendet ihre Scrollbar per CSS aus
  // und hatte damit NULL Affordanz: der vierte Filter „Fast leer" begann bei
  // x=394 in einem 393px-Viewport und existierte für Mobilnutzer nicht
  // (Critique 2026-07-30). wireScrollFade setzt die geteilten has-fade-*-
  // Klassen aus filter-chip.css - dasselbe Werkzeug, das das Wochenboard und
  // die Kontakte-Filter schon nutzen. Einmal binden; der MutationObserver
  // deckt die replaceChildren-Rerenders darunter ab.
  if (!bar.dataset.fadeWired) {
    bar.dataset.fadeWired = 'true';
    wireScrollFade(bar);
  }

  const counts = pantryFilterCounts(state.items, state.todayKey);
  const active = PANTRY_FILTERS.filter((key) => counts[key] > 0);

  // Der aktive Filter hat gerade seinen letzten Treffer verloren → zurück auf Alle.
  const previousFilter = state.filter;
  if (state.filter !== 'all' && !active.includes(state.filter)) state.filter = 'all';
  const wasReset = state.filter !== previousFilter;

  // replaceChildren zerstört den fokussierten Chip; ohne Rettung landet der
  // Tastatur-Fokus auf <body> und der Tab-Weg beginnt wieder ganz oben.
  const hadFocus = bar.contains(document.activeElement);

  bar.replaceChildren();
  if (!active.length || !state.items.length) {
    bar.hidden = true;
    return { wasReset };
  }
  bar.hidden = false;

  const labels = {
    expired: { key: 'pantry.filterExpired', icon: 'circle-alert' },
    soon: { key: 'pantry.filterSoon', icon: 'clock' },
    low: { key: 'pantry.filterLow', icon: 'package-open' },
  };

  const chips = [{ id: 'all', label: t('pantry.filterAll'), icon: 'boxes', count: null }];
  for (const key of active) {
    chips.push({ id: key, label: t(labels[key].key), icon: labels[key].icon, count: counts[key] });
  }

  bar.insertAdjacentHTML('beforeend', chips.map((chip) => `
    <button type="button" class="filter-chip${chip.id === state.filter ? ' filter-chip--active' : ''}"
            data-filter="${esc(chip.id)}" aria-pressed="${chip.id === state.filter}">
      <i data-lucide="${esc(chip.icon)}" class="icon-sm" aria-hidden="true"></i>
      <span>${esc(chip.label)}</span>
      ${chip.count != null ? `<span class="filter-chip__count">${chip.count}</span>` : ''}
    </button>`).join(''));

  if (window.lucide) window.lucide.createIcons({ el: bar });

  const activeChip = bar.querySelector('.filter-chip--active');
  if (hadFocus) activeChip?.focus({ preventScroll: true });

  // Die Chip-Leiste scrollt horizontal; ein aktiver Chip außerhalb des
  // Sichtfelds nimmt der Liste ihre wichtigste Erklärung ("warum sehe ich nur
  // drei Artikel?"). Aber NUR beim echten Wechsel - sonst kämpft jeder ±-Tap
  // gegen die Scrollposition, die der Nutzer gerade selbst gesetzt hat.
  if (_scrolledFilter !== state.filter) {
    activeChip?.scrollIntoView({ inline: 'center', block: 'nearest' });
    _scrolledFilter = state.filter;
  }

  return { wasReset };
}

/**
 * Sammelaktion des „Fast leer"-Filters. Bewusst eine eigene Zeile über der
 * Liste statt als letztes Element der Chip-Leiste: dort lag sie hinter dem
 * horizontalen Scroll und war faktisch unsichtbar.
 */
function bulkBarEl() {
  const bar = document.createElement('div');
  bar.className = 'pantry-bulkbar';

  const label = document.createElement('span');
  label.className = 'pantry-bulkbar__label';
  label.textContent = t('pantry.bulkHint');

  const bulk = document.createElement('button');
  bulk.type = 'button';
  bulk.className = 'btn btn--secondary pantry-bulkbar__action';
  bulk.insertAdjacentHTML('beforeend', '<i data-lucide="shopping-cart" class="icon-sm" aria-hidden="true"></i>');
  bulk.append(document.createTextNode(t('pantry.toShoppingAll')));
  bulk.addEventListener('click', () => sendToShopping(visibleItems()));

  bar.append(label, bulk);
  return bar;
}

function renderList() {
  const list = _container?.querySelector('#pantry-list');
  if (!list) return;
  list.removeAttribute('aria-busy');
  list.replaceChildren();

  if (!state.items.length) {
    list.appendChild(emptyStateEl());
    if (window.lucide) window.lucide.createIcons({ el: list });
    return;
  }

  const items = visibleItems();
  // Filtern und Suchen ändern die Liste, ohne dass sich der Fokus bewegt -
  // ohne Ansage bleibt die neue Trefferzahl für Screenreader unsichtbar.
  if (state.filter !== 'all' || state.query) {
    announce(t('pantry.resultCount', { count: items.length }));
  }

  if (!items.length) {
    // Dieselbe .empty-state-Grammatik wie der leere Vorrat: davor stand hier ein
    // nackter Satz in einer großen Leere, direkt neben einem reich gestalteten
    // Nachbarzustand - und ohne Ausweg (Critique P2).
    list.appendChild(noResultsEl());
    if (window.lucide) window.lucide.createIcons({ el: list });
    return;
  }

  if (state.filter === 'low') list.appendChild(bulkBarEl());

  for (const group of groupedItems(items)) {
    const section = document.createElement('section');
    section.className = 'pantry-group';

    if (group.label) {
      const heading = document.createElement('h2');
      heading.className = 'pantry-group__title';
      heading.insertAdjacentHTML('beforeend',
        `<i data-lucide="${esc(group.icon || 'package')}" class="icon-sm" aria-hidden="true"></i>`);
      const name = document.createElement('span');
      name.textContent = group.label;
      const count = document.createElement('span');
      count.className = 'pantry-group__count';
      count.textContent = String(group.items.length);
      heading.append(name, count);
      section.appendChild(heading);
    }

    const rows = document.createElement('ul');
    rows.className = 'pantry-rows';
    for (const item of group.items) rows.appendChild(rowEl(item));
    section.appendChild(rows);
    list.appendChild(section);
  }

  if (window.lucide) window.lucide.createIcons({ el: list });
}

/**
 * Kein Treffer für Suche und/oder Filter. Benennt beide Ursachen, statt nur die
 * Suche zu erwähnen: war zusätzlich ein Filter aktiv, blieb er vorher unsichtbar
 * und der Nutzer suchte den Fehler beim Suchbegriff.
 */
function noResultsEl() {
  const active = [];
  if (state.query) active.push(`„${state.query}"`);
  if (state.filter !== 'all') {
    active.push(t({ expired: 'pantry.filterExpired', soon: 'pantry.filterSoon', low: 'pantry.filterLow' }[state.filter]));
  }

  return emptyStateComponentEl({
    variant: 'no-results',
    title: t('pantry.noResultsTitle'),
    description: t('pantry.noResultsDescription'),
    hint: active.length ? active.join(' · ') : undefined,
    action: {
      label: t('pantry.resetFilters'),
      onClick: () => {
        state.query = '';
        state.filter = 'all';
        const search = _container?.querySelector('#pantry-search');
        if (search) search.value = '';
        renderFilters();
        renderList();
        search?.focus();
      },
    },
  });
}

function emptyStateEl() {
  return emptyStateComponentEl({
    icon: 'archive',
    title: t('pantry.emptyTitle'),
    description: t('pantry.emptyDescription'),
    hint: t('emptyHint.pantry'),
    action: {
      label: t('pantry.emptyAction'),
      icon: 'plus',
      onClick: () => openItemModal('create'),
    },
  });
}

/** Eine Vorratszeile. */
function rowEl(item) {
  const status = pantryItemStatus(item, state.todayKey);

  const li = document.createElement('li');
  li.className = 'pantry-row';
  li.dataset.id = String(item.id);
  if (status.out) li.classList.add('pantry-row--out');

  // Klickfläche: öffnet das Bearbeiten-Formular. Die Stepper-Buttons daneben
  // sind eigene Stops und dürfen nicht durchschlagen.
  // BEWUSST kein aria-label: es hätte den Namen aus dem Inhalt überschrieben
  // und damit genau die Information verschluckt, die sehende Nutzer auf einen
  // Blick bekommen - „Vor 2 Tagen abgelaufen", „Fast leer", das MHD. Ein
  // Screenreader hörte nur „Bearbeiten: Milch" (Critique P1, WCAG 1.3.1/4.1.2).
  // Stattdessen trägt der Inhalt den Namen, und die Aktion kommt als sr-only
  // Zusatz ans Ende.
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'pantry-row__main';
  main.dataset.action = 'edit';

  // Name und Status in EINER Zeile: das Badge qualifiziert den Artikel, es ist
  // keine eigene Information. Auf einer eigenen Zeile wuchs jede betroffene
  // Zeile um ~25px, während rechts neben dem Namen Platz frei blieb.
  const headline = document.createElement('span');
  headline.className = 'pantry-row__headline';

  const name = document.createElement('span');
  name.className = 'pantry-row__name';
  name.textContent = item.name;
  headline.appendChild(name);

  for (const badge of [expiryBadge(item), stockBadge(item)].filter(Boolean)) {
    const el = document.createElement('span');
    el.className = `pantry-badge pantry-badge--${badge.tone}`;
    el.textContent = badge.text;
    headline.appendChild(el);
  }
  main.appendChild(headline);

  // Meta-Zeile trägt nur, was hier orientiert. Die Kategorie steht bewusst NICHT
  // darin: sie ordnet die Einkaufsliste nach Supermarkt-Gängen, für "was habe
  // ich und wie lange noch" sagt sie nichts - und als dritter Teil kürzte sie
  // das MHD weg ("MHD 24.02.2027 · Ba…"). Sie bleibt im Formular sichtbar.
  // Das MHD steht VOR dem Lagerort: die Zeile ellipsiert am Ende, und bei einem
  // langen Ortsnamen fiel sonst genau das Kerndatum weg - dieselbe Trunkierung,
  // gegen die die Kategorie hier schon gewichen ist (Critique, Riley-Fund).
  const metaParts = [];
  if (item.expires_on) {
    metaParts.push(t('pantry.bestBefore', { date: formatDate(item.expires_on) }));
  }
  // Im gefilterten (flachen) Modus trägt die Meta-Zeile den Lagerort, den sonst
  // die Gruppen-Überschrift zeigt.
  if (state.filter !== 'all') {
    metaParts.push(item.location_name ? locationLabel(item.location_name) : t('pantry.unlocated'));
  }
  if (metaParts.length) {
    const meta = document.createElement('span');
    meta.className = 'pantry-row__meta';
    meta.textContent = metaParts.join(' · ');
    main.appendChild(meta);
  }

  // Was der Button tut - nur für Screenreader, am Ende des Namens.
  const action = document.createElement('span');
  action.className = 'sr-only';
  action.textContent = t('common.edit');
  main.appendChild(action);

  // Warenkorb und Stepper bilden EINE Gruppe: als getrennte Flex-Kinder brach
  // nur der Stepper um und der Warenkorb blieb allein oben rechts stehen - der
  // Umbruch sah nach Fehler aus statt nach Absicht. Als Gruppe wandert die
  // ganze Bedienung geschlossen in die zweite Zeile.
  //
  // Die Gruppe steht VOR dem Namen - im DOM wie visuell. Rechts unten sitzt der
  // FAB, und dort lagen zuvor sämtliche „+"-Buttons in seiner Spalte: ein
  // Fehltap öffnete das Anlegen-Formular statt die Menge zu erhöhen (Critique).
  // Nur die CSS-Reihenfolge zu drehen hätte Lese- und Fokusabfolge entkoppelt,
  // deshalb wandert der Knoten selbst. Jeder Button trägt den Artikelnamen im
  // Label, die Tab-Folge bleibt also auch ohne vorangehenden Namen eindeutig.
  const actions = document.createElement('div');
  actions.className = 'pantry-row__actions';

  const stepper = document.createElement('div');
  stepper.className = 'pantry-stepper';
  const step = pantryUnitStep(item.unit);

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'pantry-stepper__btn';
  minus.dataset.action = 'decrease';
  minus.disabled = Number(item.quantity) <= 0;
  minus.setAttribute('aria-label', `${t('pantry.decrease')}: ${item.name}`);
  minus.insertAdjacentHTML('beforeend', '<i data-lucide="minus" class="icon-sm" aria-hidden="true"></i>');

  const value = document.createElement('span');
  value.className = 'pantry-stepper__value';
  value.textContent = quantityText(item);
  // BEWUSST keine eigene Live-Region je Zeile: bei 60 Artikeln wären das 60
  // Live-Regionen, und Screenreader behandeln eine solche Wolke unzuverlässig.
  // Die Ansage übernimmt die eine geteilte Region der Seite (#pantry-live).

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'pantry-stepper__btn';
  plus.dataset.action = 'increase';
  plus.setAttribute('aria-label', `${t('pantry.increase')}: ${item.name}`);
  plus.insertAdjacentHTML('beforeend', '<i data-lucide="plus" class="icon-sm" aria-hidden="true"></i>');

  stepper.dataset.step = String(step);
  stepper.append(minus, value, plus);
  actions.appendChild(stepper);

  // Name zuerst, Bedienung danach: eine Vorratsliste wird nach Namen gescannt,
  // nicht nach Zahlen. Vorher las sich die Zeile „− 500 g + Naturjoghurt" und
  // damit gegen die Leserichtung und gegen alle drei Geschwistermodule, die
  // ausnahmslos mit dem Namen führen. Nebeneffekt: die Namenskante steht jetzt
  // von selbst, statt mit der Stepper-Breite zu wandern (Critique 2026-07-29).
  li.append(main, actions);

  // Kontextuelle Einkaufs-Aktion ans ZEILENENDE, nicht in die Aktionsgruppe:
  // dort verbreiterte sie die Gruppe um 52px, schob den Namen aus der Spalte
  // der übrigen Zeilen und trieb ihn in den Umbruch. Am Ende schrumpft
  // stattdessen der Name, und alle Namen starten an derselben Kante.
  //
  // Dass sie damit wieder in der FAB-Spalte liegt, ist bewusst in Kauf
  // genommen: sie erscheint nur bei leeren/knappen Artikeln und ist zusätzlich
  // über den „Fast leer"-Filter und dessen Sammelaktion erreichbar - anders
  // als „+", das die ständige Hauptbedienung ist.
  if (status.out || status.low) {
    const cart = document.createElement('button');
    cart.type = 'button';
    cart.className = 'row-action pantry-row__cart';
    cart.dataset.action = 'to-shopping';
    cart.setAttribute('aria-label', `${t('pantry.toShopping')}: ${item.name}`);
    cart.title = t('pantry.toShopping');
    cart.insertAdjacentHTML('beforeend', '<i data-lucide="shopping-cart" class="icon-md" aria-hidden="true"></i>');
    li.appendChild(cart);
  }

  return li;
}

// --------------------------------------------------------
// Interaktion
// --------------------------------------------------------

function onListClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const row = btn.closest('.pantry-row[data-id]');
  if (!row) return;
  const item = state.items.find((i) => i.id === Number(row.dataset.id));
  if (!item) return;

  if (btn.dataset.action === 'edit') { openItemModal('edit', item); return; }
  if (btn.dataset.action === 'to-shopping') { sendToShopping([item]); return; }
  if (btn.dataset.action === 'increase') { adjustQuantity(item, +1, row); return; }
  if (btn.dataset.action === 'decrease') { adjustQuantity(item, -1, row); }
}

/**
 * Optimistischer ±-Schritt. Der PATCH wird entprellt, damit mehrfaches Tippen
 * einen Request auslöst statt fünf; beim Fehlschlag kehrt die Zeile auf den
 * Serverstand zurück.
 *
 * Die Zeile wird bewusst NICHT neu gefiltert: verschwände ein Artikel unter
 * dem Finger, sobald er den aktiven Filter verlässt, wäre der nächste Tap ein
 * Fehltap. Die Auswahl aktualisiert sich beim nächsten vollen Render.
 */
function adjustQuantity(item, direction, row) {
  const step = Number(row.querySelector('.pantry-stepper')?.dataset.step) || 1;
  const previous = Number(item.quantity);
  const next = normalizePantryQuantity(previous + direction * step, { fallback: previous });
  if (next === previous) return;

  item.quantity = next;
  vibrate(8);
  refreshRowQuantity(row, item);
  if (renderFilters().wasReset) renderList();

  const pending = pendingQuantity.get(item.id);
  if (pending) clearTimeout(pending.timer);
  // Rollback ist der letzte serverbestätigte Wert, nicht der letzte optimistische:
  // der Eintrag bleibt bis zum Settle in der Map, deshalb überlebt er auch einen
  // Tap während des laufenden Requests.
  const rollback = pending?.rollback ?? previous;
  const seq = ++_quantitySeq;

  const timer = setTimeout(async () => {
    try {
      const res = await api.patch(`/pantry/${item.id}`, { quantity: item.quantity });
      // Überholte Antwort verwerfen. Ohne diese Prüfung überschrieb eine
      // langsame Antwort den neueren optimistischen Stand, die Menge sprang
      // sichtbar zurück und der nächste PATCH schrieb die veraltete Zahl fest.
      if (pendingQuantity.get(item.id)?.seq !== seq) return;
      pendingQuantity.delete(item.id);
      Object.assign(item, res.data);
      refreshRowQuantity(row, item);
    } catch (err) {
      if (pendingQuantity.get(item.id)?.seq !== seq) return;
      pendingQuantity.delete(item.id);
      item.quantity = rollback;
      // Die Seite wurde inzwischen verlassen: kein Zurückzeichnen einer
      // abgehängten Zeile und kein Vorrats-Toast auf einer fremden Seite.
      if (!row.isConnected) return;
      refreshRowQuantity(row, item);
      if (renderFilters().wasReset) renderList();
      window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    }
  }, QUANTITY_DEBOUNCE_MS);

  // `flush` schickt den gedebouncten Wert sofort ab, wenn die Seite verschwindet.
  pendingQuantity.set(item.id, {
    timer,
    rollback,
    seq,
    flush: () => {
      clearTimeout(timer);
      pendingQuantity.delete(item.id);
      // keepalive: der Request muss den Seitenwechsel überleben. Ohne ihn
      // bricht der Browser ihn mit dem Dokument ab.
      api.patch(`/pantry/${item.id}`, { quantity: item.quantity }, { keepalive: true })
        .catch(() => { /* Die Seite ist weg; ein Toast hätte kein Ziel mehr. */ });
    },
  });
  bindQuantityFlush();
}

let _quantityFlushBound = false;

/**
 * Offene Mengenänderungen beim Verschwinden der Seite noch abschicken.
 *
 * Der Stepper schreibt 450ms gedebounced. Genau in diesem Fenster ist der
 * typische Ablauf: am Vorratsschrank stehen, „+" tippen, Telefon sperren. Der
 * Timer feuerte dann nie, die UI hatte den neuen Wert aber schon optimistisch
 * gezeigt - beim nächsten Öffnen stand der alte Bestand da, ohne jede Meldung.
 *
 * Dasselbe Muster wie `bindDeleteFlush` in utils/ux.js (Audit F-13): einmal
 * global gebunden, `pagehide` deckt Tab-Schließen, Reload und den
 * App-Wechsel auf iOS ab.
 */
function bindQuantityFlush() {
  if (_quantityFlushBound) return;
  _quantityFlushBound = true;
  window.addEventListener('pagehide', () => {
    for (const entry of [...pendingQuantity.values()]) entry.flush?.();
  });
}

/** Sagt eine Bestandsänderung über die eine geteilte Live-Region der Seite an. */
function announce(message) {
  const region = _container?.querySelector('#pantry-live');
  if (region) region.textContent = message;
}

/** Aktualisiert Menge, Badges und Leer-Zustand einer Zeile ohne Listen-Rebuild. */
function refreshRowQuantity(row, item) {
  const value = row.querySelector('.pantry-stepper__value');
  if (value) value.textContent = quantityText(item);
  announce(`${item.name}: ${quantityText(item)}`);

  const minus = row.querySelector('[data-action="decrease"]');
  if (minus) {
    const willDisable = Number(item.quantity) <= 0;
    // Einen fokussierten Button zu deaktivieren wirft den Fokus auf <body>.
    // Vorher auf „+" ausweichen - das ist ohnehin die einzige Aktion, die auf
    // einem leeren Artikel noch sinnvoll ist.
    if (willDisable && !minus.disabled && document.activeElement === minus) {
      row.querySelector('[data-action="increase"]')?.focus();
    }
    minus.disabled = willDisable;
  }

  const status = pantryItemStatus(item, state.todayKey);
  row.classList.toggle('pantry-row--out', status.out);

  // Bestands-Badge und Einkaufs-Aktion hängen an der Menge und müssen mitgehen.
  const fresh = rowEl(item);
  row.querySelector('.pantry-row__main')?.replaceWith(fresh.querySelector('.pantry-row__main'));
  const oldCart = row.querySelector('.pantry-row__cart');
  const newCart = fresh.querySelector('.pantry-row__cart');
  if (oldCart && !newCart) oldCart.remove();
  else if (!oldCart && newCart) row.appendChild(newCart);

  if (window.lucide) window.lucide.createIcons({ el: row });
}

// --------------------------------------------------------
// Einkaufsliste
// --------------------------------------------------------

/**
 * Fehlmenge als Anzeigetext: bis zum Mindestbestand auffüllen. Ohne
 * Mindestbestand bleibt die Menge offen - im Laden entscheidet man selbst.
 */
function shortfallText(item) {
  if (item.min_quantity == null) return null;
  const missing = normalizePantryQuantity(Number(item.min_quantity) - Number(item.quantity), { fallback: 0 });
  if (missing <= 0) return null;
  return `${formatQuantity(missing)} ${unitLabel(item.unit)}`;
}

async function sendToShopping(items) {
  if (!items.length) return;

  let lists;
  try {
    lists = await ensureLists();
  } catch (err) {
    window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    return;
  }

  if (!lists.length) {
    window.myHub?.showToast(t('pantry.noLists'), 'warning');
    return;
  }

  // Eine Liste → keine Rückfrage. Mehrere → einmal fragen.
  let listId = lists[0].id;
  if (lists.length > 1) {
    const chosen = await selectModal(
      t('pantry.chooseList'),
      lists.map((l) => ({ value: String(l.id), label: l.name }))
    );
    if (!chosen) return;
    listId = Number(chosen);
  }

  try {
    const res = await api.post(`/shopping/${listId}/import-pantry`, {
      items: items.map((item) => ({ pantry_item_id: item.id, quantity: shortfallText(item) })),
    });
    const { added = 0, skipped = 0 } = res.data ?? {};
    if (!added) {
      window.myHub?.showToast(t('pantry.toShoppingNone'), 'info');
      return;
    }
    // Zwei vollständige Sätze, mit Leerzeichen verbunden. Vorher stand ein
    // Interpunkt dazwischen: das ergab einen zusammengesetzten Satz, der in
    // Sprachen mit anderer Satzstellung bricht, und ein Screenreader liest das
    // Zeichen mit (Critique 2026-07-29). Ein einziger Key mit beiden Zahlen
    // wäre die Alternative - der müsste dann aber zwei Plurale in einem String
    // beugen, was Intl.PluralRules nicht kann.
    const message = skipped
      ? `${t('pantry.toShoppingDone', { count: added })} ${t('pantry.toShoppingSkipped', { count: skipped })}`
      : t('pantry.toShoppingDone', { count: added });
    window.myHub?.showToast(message, 'success');
  } catch (err) {
    window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}

// --------------------------------------------------------
// Artikel-Formular
// --------------------------------------------------------

function openItemModal(mode, item = null) {
  const isEdit = mode === 'edit';
  const locations = state.locations;
  const categories = state.categories;

  const unitOptions = PANTRY_UNITS
    .map((unit) => `<option value="${esc(unit)}">${esc(unitLabel(unit))}</option>`)
    .join('');
  const locationOptions = [
    `<option value="">${esc(t('pantry.unlocated'))}</option>`,
    ...locations.map((loc) => `<option value="${loc.id}">${esc(locationLabel(loc.name))}</option>`),
  ].join('');
  const categoryOptions = categories
    .map((cat) => `<option value="${esc(cat.name)}">${esc(categoryLabel(cat.name))}</option>`)
    .join('');

  openSharedModal({
    title: isEdit ? t('pantry.editItem') : t('pantry.addItem'),
    size: 'md',
    content: `
      <div class="form-group">
        <label class="form-label" for="pantry-name">${esc(t('pantry.nameLabel'))}</label>
        <input id="pantry-name" class="form-input" type="text" required
               placeholder="${esc(t('pantry.namePlaceholder'))}">
      </div>
      <div class="pantry-form-row">
        <div class="form-group">
          <label class="form-label" for="pantry-quantity">${esc(t('pantry.quantityLabel'))}</label>
          <input id="pantry-quantity" class="form-input" type="number" min="0" step="any" inputmode="decimal">
        </div>
        <div class="form-group">
          <label class="form-label" for="pantry-unit">${esc(t('pantry.unitLabel'))}</label>
          <select id="pantry-unit" class="form-input">${unitOptions}</select>
        </div>
      </div>
      <div class="pantry-form-row">
        <div class="form-group">
          <label class="form-label" for="pantry-location">${esc(t('pantry.locationLabel'))}</label>
          <select id="pantry-location" class="form-input">${locationOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="pantry-category">${esc(t('pantry.categoryLabel'))}</label>
          <select id="pantry-category" class="form-input">${categoryOptions}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="pantry-expires">${esc(t('pantry.expiresLabel'))}</label>
        <my-hub-datepicker id="pantry-expires" type="date"
                           value="${esc(isEdit && item.expires_on ? item.expires_on : '')}"></my-hub-datepicker>
        <p class="form-hint">${esc(t('pantry.expiresHint'))}</p>
      </div>
      ${advancedSection(`
        <div class="form-group">
          <label class="form-label" for="pantry-min">${esc(t('pantry.minQuantityLabel'))}</label>
          <input id="pantry-min" class="form-input" type="number" min="0" step="any" inputmode="decimal">
          <p class="form-hint">${esc(t('pantry.minQuantityHint'))}</p>
        </div>
        <div class="form-group">
          <label class="form-label" for="pantry-notes">${esc(t('pantry.notesLabel'))}</label>
          <textarea id="pantry-notes" class="form-input" rows="3"
                    placeholder="${esc(t('pantry.notesPlaceholder'))}"></textarea>
        </div>`,
      { open: isEdit && (item.min_quantity != null || !!item.notes) })}
      <div class="modal-panel__footer modal-panel__footer--plain">
        ${isEdit ? `<button type="button" class="btn btn--danger-ghost pantry-form__delete" id="pantry-delete">${esc(t('common.delete'))}</button>` : ''}
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn--primary" id="pantry-save">${esc(isEdit ? t('common.save') : t('common.add'))}</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('#pantry-name').value = isEdit ? item.name : '';
      panel.querySelector('#pantry-quantity').value = isEdit ? String(item.quantity) : '1';
      panel.querySelector('#pantry-unit').value = isEdit ? item.unit : 'pcs';
      panel.querySelector('#pantry-location').value = isEdit && item.location_id ? String(item.location_id) : '';
      panel.querySelector('#pantry-category').value = isEdit
        ? item.category
        : (categories.find((c) => c.name === DEFAULT_CATEGORY_NAME)?.name ?? categories[0]?.name ?? DEFAULT_CATEGORY_NAME);
      panel.querySelector('#pantry-min').value = isEdit && item.min_quantity != null ? String(item.min_quantity) : '';
      panel.querySelector('#pantry-notes').value = isEdit && item.notes ? item.notes : '';

      panel.querySelector('#pantry-save').addEventListener('click', () => saveItem(panel, mode, item));
      panel.querySelector('#pantry-delete')?.addEventListener('click', async () => {
        closeSharedModal({ force: true });
        await removeItem(item);
      });

      wireBlurValidation(panel);
      if (window.lucide) window.lucide.createIcons({ el: panel });
    },
  });
}

async function saveItem(panel, mode, item) {
  const saveBtn = panel.querySelector('#pantry-save');
  const nameInput = panel.querySelector('#pantry-name');
  const name = nameInput.value.trim();

  if (!name) {
    reportFieldError(nameInput, t('pantry.nameRequired'));
    return;
  }

  const minRaw = panel.querySelector('#pantry-min').value.trim();
  const payload = {
    name,
    quantity: normalizePantryQuantity(panel.querySelector('#pantry-quantity').value, { fallback: 1 }),
    unit: panel.querySelector('#pantry-unit').value,
    location_id: panel.querySelector('#pantry-location').value || null,
    category: panel.querySelector('#pantry-category').value,
    expires_on: panel.querySelector('#pantry-expires').value || null,
    min_quantity: minRaw === '' ? null : normalizePantryQuantity(minRaw, { fallback: 0 }),
    notes: panel.querySelector('#pantry-notes').value.trim() || null,
  };

  saveBtn.disabled = true;
  try {
    if (mode === 'create') {
      const res = await api.post('/pantry', payload);
      state.items.push(res.data);
    } else {
      const res = await api.put(`/pantry/${item.id}`, payload);
      const idx = state.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) state.items[idx] = res.data;
    }
    // location_name/location_icon kommen aus dem JOIN der Liste, nicht aus der
    // Einzel-Antwort - deshalb nach dem Speichern einmal frisch laden, damit
    // Gruppierung und Meta-Zeile stimmen.
    await loadPantry();
    closeSharedModal({ force: true });
    renderFilters();
    renderList();
    window.myHub?.showToast(mode === 'create' ? t('pantry.created') : t('pantry.updated'), 'success');
  } catch (err) {
    saveBtn.disabled = false;
    window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}

async function removeItem(item) {
  const rowEl_ = _container?.querySelector(`.pantry-row[data-id="${item.id}"]`);
  if (rowEl_) rowEl_.style.display = 'none';

  scheduleUndoableDelete({
    message: t('pantry.deleted'),
    commit: async ({ keepalive }) => {
      await api.delete(`/pantry/${item.id}`, { keepalive });
      if (keepalive) return;
      state.items = state.items.filter((i) => i.id !== item.id);
      renderFilters();
      renderList();
    },
    restore: (err) => {
      if (rowEl_) rowEl_.style.display = '';
      if (err) window.myHub?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}

// --------------------------------------------------------
// Lagerort-Verwaltung
// --------------------------------------------------------

async function openLocationManager() {
  await import('/components/category-manager.js');

  let changed = false;
  const onChanged = async () => {
    changed = true;
    try {
      await loadPantry();
    } catch { /* Fehler meldet der Manager selbst */ }
  };

  let manager = null;
  openSharedModal({
    title: t('pantry.manageLocations'),
    content: '<my-hub-category-manager></my-hub-category-manager>',
    onSave: (panel) => {
      manager = panel.querySelector('my-hub-category-manager');
      if (!manager) return;
      manager.addEventListener('category-manager-changed', onChanged);
      // Dieselbe geteilte Komponente wie Einkaufskategorien: die Lagerort-API
      // bietet exakt deren CRUD-Vertrag (GET/POST basePath, PUT/DELETE :id,
      // PATCH /reorder).
      manager.configure({
        basePath: '/pantry/locations',
        labelResolver: (loc) => locationLabel(loc.name),
        titleKey: 'pantry.manageLocations',
        hintKey: 'pantry.manageLocationsHint',
        addPlaceholderKey: 'pantry.addLocation',
        groups: [{ key: '', labelKey: '', addLabelKey: 'common.add' }],
      });
    },
    onClose: () => {
      manager?.removeEventListener('category-manager-changed', onChanged);
      manager = null;
      if (changed) {
        renderFilters();
        renderList();
      }
    },
  });
}
