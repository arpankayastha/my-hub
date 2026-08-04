/**
 * Modul: Rezepte (Recipes)
 * Zweck: Gespeicherte Rezepte verwalten und in den Essensplan uebernehmen
 */

import { api } from '/my-hub/api.js';
import { t, formatDate, formatDateInput, parseDateInput, isDateInputValid } from '/my-hub/i18n.js';
import { esc } from '/my-hub/utils/html.js';
import { openModal as openSharedModal, closeModal as closeSharedModal, selectModal, advancedSection, wireBlurValidation, reportFieldError } from '/my-hub/components/modal.js';
import { DEFAULT_CATEGORY_NAME } from '/my-hub/utils/shopping-categories.js';
import { renderKitchenTabsBar } from '/my-hub/utils/kitchen-tabs.js';
import { ingredientRowHTML } from '/my-hub/utils/ingredient-row.js';
import { scheduleUndoableDelete, wireScrollFade } from '/my-hub/utils/ux.js';
import { normalizeRecipeMealTypes, RECIPE_MEAL_TYPE_KEYS } from '/my-hub/utils/recipe-meal-types.js';
import { mealPayloadFromRecipe } from '/my-hub/utils/recipe-to-meal.js';
import { toLocalDateKey } from '/my-hub/utils/date.js';
import '/my-hub/components/datepicker.js';
import { renderSkeletonList } from '/my-hub/utils/skeleton.js';
import { mountEmptyState } from '/my-hub/utils/empty-state.js';

let _container = null;

const state = {
  recipes: [],
  categories: [],
  // Einkaufslisten für „Auf die Einkaufsliste": nur die Auswahl, keine Artikel.
  lists: [],
  query: '',
};

// Client-seitige Suche über Titel, Notizen und Zutaten (Audit A1-21):
// die Rezeptliste ist vollständig geladen, ein Server-Roundtrip wäre Umweg.
function filteredRecipes() {
  const q = state.query.toLowerCase();
  if (!q) return state.recipes;
  return state.recipes.filter((r) =>
    r.title?.toLowerCase().includes(q)
    || r.notes?.toLowerCase().includes(q)
    || (r.ingredients ?? []).some((i) => i.name?.toLowerCase().includes(q)));
}

function mealCategories() {
  return state.categories.filter((c) => c.name !== 'Haushalt' && c.name !== 'Drogerie');
}

function mealTypeOptions() {
  return [
    { key: 'breakfast', label: t('meals.typeBreakfast') },
    { key: 'lunch', label: t('meals.typeLunch') },
    { key: 'dinner', label: t('meals.typeDinner') },
    { key: 'snack', label: t('meals.typeSnack') },
  ];
}

async function loadRecipes() {
  const res = await api.get('/recipes');
  state.recipes = res.data;
}

async function loadCategories() {
  try {
    const res = await api.get('/shopping/categories');
    state.categories = res.data;
  } catch {
    state.categories = [];
  }
}

// Ist das Einkaufsmodul deaktiviert oder gibt es keine Liste, bleibt state.lists
// leer und die Karte zeigt die Übernahme-Aktion gar nicht erst an.
async function loadShoppingLists() {
  if (window.myHub?.isModuleDisabled?.('shopping')) {
    state.lists = [];
    return;
  }
  try {
    const res = await api.get('/shopping');
    state.lists = res.data ?? [];
  } catch {
    state.lists = [];
  }
}

export async function render(container) {
  _container = container;

  const page = document.createElement('div');
  page.className = 'recipes-page';

  // sr-only Titel: die geteilte Kitchen-Tabs-Leiste labelt das Modul bereits
  // sichtbar — konsistent mit Mahlzeiten/Einkauf. Der FAB ist die einzige
  // Create-Affordanz (kein redundanter sichtbarer Kopf-Titel mehr).
  const title = document.createElement('h1');
  title.className = 'sr-only';
  title.textContent = t('recipes.title');

  // Suchfeld über der Liste: Rezepte waren als einziges Kitchen-Modul nicht
  // durchsuchbar (Audit A1-21).
  // Kanonischer Kopf in der Gruppen-Variante: --in-group gibt Akzentstreifen und
  // oberste Sticky-Position an die .kitchen-tabs-bar darüber ab, die beides schon
  // trägt. Genau der Doppelstreifen aus Issue #577 war der Grund, warum diese
  // Zeile vorher als eigene .recipes-toolbar gebaut war - mit dem Ergebnis, dass
  // alle vier Küchen-Tabs eine andere Kopf-Grammatik hatten (Critique
  // 2026-07-29). Die Variante löst den Konflikt, ohne den Kopf zu meiden.
  const toolbar = document.createElement('div');
  toolbar.className = 'page-toolbar page-toolbar--in-group';
  const center = document.createElement('div');
  center.className = 'page-toolbar__center';
  const searchWrap = document.createElement('div');
  searchWrap.className = 'recipes-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'form-input recipes-search__input';
  searchInput.id = 'recipes-search';
  searchInput.placeholder = t('recipes.searchPlaceholder');
  searchInput.setAttribute('aria-label', t('recipes.searchPlaceholder'));
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value.trim();
    renderRecipeList();
  });
  searchWrap.appendChild(searchInput);
  center.appendChild(searchWrap);
  toolbar.appendChild(center);

  const list = document.createElement('div');
  list.className = 'recipes-list';
  list.id = 'recipes-list';
  // Lade-Skeleton bis loadRecipes() aufgelöst ist (Router blendet den Wrapper
  // bereits vor dem Daten-await ein).
  list.setAttribute('aria-busy', 'true');
  list.insertAdjacentHTML('beforeend', renderSkeletonList({ rows: 5, lines: 2 }));
  // Kanten-Anriss: bei 320px passt die 320px-Mindestbreite der Karten nicht
  // mehr neben das Seitenpadding, das Raster ragt 32px über den Container und
  // scrollt still (Critique 2026-07-30). Gleiches Werkzeug wie im Wochenboard.
  wireScrollFade(list);

  const fab = document.createElement('button');
  fab.className = 'page-fab';
  fab.type = 'button';
  fab.id = 'fab-new-recipe';
  fab.setAttribute('aria-label', t('recipes.addRecipe'));
  const fabIcon = document.createElement('i');
  fabIcon.dataset.lucide = 'plus';
  fabIcon.setAttribute('aria-hidden', 'true');
  fab.appendChild(fabIcon);

  page.append(title, toolbar, list, fab);
  container.replaceChildren(page);
  renderKitchenTabsBar(container, '/recipes');

  if (window.lucide) window.lucide.createIcons({ el: container });

  await Promise.all([loadRecipes(), loadCategories(), loadShoppingLists()]);
  renderRecipeList();

  fab.addEventListener('click', () => openRecipeModal('create'));

  list.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) {
      // Klick auf die Kartenfläche öffnet die Nur-Lese-Ansicht: Kochen darf
      // kein Bearbeiten-Formular erzwingen (Audit A1-21). Externe Links in
      // der Karte behalten ihr natives Verhalten.
      if (e.target.closest('a')) return;
      const card = e.target.closest('.recipe-card[data-id]');
      const recipe = card && state.recipes.find((r) => r.id === Number(card.dataset.id));
      if (recipe) openRecipeReadModal(recipe);
      return;
    }

    const recipeId = Number(actionBtn.dataset.id);
    const recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;

    if (actionBtn.dataset.action === 'edit') {
      openRecipeModal('edit', recipe);
      return;
    }

    if (actionBtn.dataset.action === 'delete') {
      await removeRecipe(recipe);
      return;
    }

    if (actionBtn.dataset.action === 'duplicate') {
      await duplicateRecipe(recipe);
      return;
    }

    if (actionBtn.dataset.action === 'to-shopping') {
      await transferRecipe(recipe, actionBtn);
      return;
    }

    if (actionBtn.dataset.action === 'add-to-meals') {
      await planRecipe(recipe, actionBtn);
    }
  });

  // Enter/Space auf der fokussierten Karte öffnet die Lese-Ansicht (die Karte
  // ist role=button; innere Buttons feuern ihren eigenen click).
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.recipe-card[data-id]');
    if (!card || e.target !== card) return;
    e.preventDefault();
    const recipe = state.recipes.find((r) => r.id === Number(card.dataset.id));
    if (recipe) openRecipeReadModal(recipe);
  });
}

function renderRecipeList() {
  const list = _container.querySelector('#recipes-list');
  if (!list) return;
  list.removeAttribute('aria-busy');

  list.replaceChildren();

  if (!state.recipes.length) {
    // Geteilter Renderer (utils/empty-state.js): erzwingt Reihenfolge und
    // ARIA-Rolle. Vorher fehlte hier als einzigem Küchen-Leerzustand das Icon.
    mountEmptyState(list, {
      icon: 'book-text',
      title: t('recipes.emptyTitle'),
      description: t('recipes.emptyDescription'),
      hint: t('emptyHint.recipes'),
      action: {
        label: t('recipes.emptyAction'),
        icon: 'plus',
        onClick: () => document.querySelector('.page-fab')?.click(),
      },
    });
    return;
  }

  const visible = filteredRecipes();
  if (!visible.length) {
    const noHits = document.createElement('p');
    noHits.className = 'recipes-search-empty';
    noHits.setAttribute('role', 'status');
    noHits.textContent = t('recipes.searchNoResults');
    list.appendChild(noHits);
    return;
  }

  for (const recipe of visible) {
    const card = document.createElement('article');
    card.className = 'recipe-card';
    card.dataset.id = String(recipe.id);
    // Die Kartenfläche öffnet die Lese-Ansicht (Audit A1-21) und braucht
    // deshalb Tastaturzugang; die inneren Aktions-Buttons bleiben eigene Stops.
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${t('recipes.viewRecipe')}: ${recipe.title}`);

    const h = document.createElement('h2');
    h.className = 'recipe-card__title';
    h.textContent = recipe.title;

    card.appendChild(h);

    if (recipe.notes) {
      const notes = document.createElement('p');
      notes.className = 'recipe-card__notes';
      notes.textContent = recipe.notes;
      card.appendChild(notes);
    }

    const mealTypes = normalizeRecipeMealTypes(recipe.meal_types);
    // Chips nur, wenn sie unterscheiden: gilt ein Rezept für alle Mahlzeiten,
    // ist die volle Chip-Reihe reine Ornamentik auf jeder Karte (Audit A1-21).
    if (mealTypes.length && mealTypes.length < mealTypeOptions().length) {
      const badges = document.createElement('div');
      badges.className = 'recipe-card__meal-types';
      badges.replaceChildren(...mealTypeOptions()
        .filter((option) => mealTypes.includes(option.key))
        .map((option) => {
          const badge = document.createElement('span');
          badge.className = `meal-type-badge meal-type-badge--${option.key}`;
          badge.textContent = option.label;
          return badge;
        }));
      card.appendChild(badges);
    }

    if (recipe.recipe_url) {
      const link = document.createElement('a');
      link.className = 'btn btn--ghost recipe-card__link';
      link.href = recipe.recipe_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      // Explizites Icon macht die Zeile als externen Link erkennbar, statt wie
      // Fließtext zu wirken (Audit F10).
      link.insertAdjacentHTML('beforeend', '<i data-lucide="external-link" class="icon-sm" aria-hidden="true"></i>');
      const linkLabel = document.createElement('span');
      linkLabel.textContent = t('recipes.openLink');
      link.appendChild(linkLabel);
      card.appendChild(link);
    }

    const ingredients = recipe.ingredients ?? [];
    if (ingredients.length) {
      const ul = document.createElement('ul');
      ul.className = 'recipe-card__ingredients';
      // Auf die ersten 4 kürzen: begrenzt die Kartenhöhe → ruhigeres Raster.
      // Vollständige Liste bleibt über „Bearbeiten" erreichbar.
      const MAX_INGREDIENTS = 4;
      for (const ing of ingredients.slice(0, MAX_INGREDIENTS)) {
        const li = document.createElement('li');
        li.className = 'recipe-card__ingredient';
        const qty = ing.quantity ? `${ing.quantity} · ` : '';
        li.textContent = `${qty}${ing.name}`;
        ul.appendChild(li);
      }
      if (ingredients.length > MAX_INGREDIENTS) {
        const more = document.createElement('li');
        more.className = 'recipe-card__ingredient recipe-card__ingredient--more';
        const rest = ingredients.length - MAX_INGREDIENTS;
        // Sichtbar bleibt der sprachneutrale „+N"-Indikator. Für Hilfsmittel war
        // er bedeutungslos - ein Screenreader las „plus zwei" ohne Bezugswort
        // (Critique 2026-07-29). Das aria-label benennt, worum es sich handelt,
        // und nutzt dafür den vorhandenen geteilten Zähl-Key.
        more.textContent = `+${rest}`;
        more.setAttribute('aria-label', `+${t('meals.ingredientCount', { count: rest })}`);
        ul.appendChild(more);
      }
      card.appendChild(ul);
    }

    const actions = document.createElement('div');
    actions.className = 'recipe-card__actions';

    // Primäraktion sichtbar; die selteneren/gefährlicheren Aktionen als
    // de-emphasierte Icon-Buttons — konsistent mit dem Icon-Action-Muster
    // des Einkaufs (statt vier gleichrangiger Buttons inkl. lautem roten Delete).
    const addToMeals = document.createElement('button');
    addToMeals.className = 'btn recipe-card__primary';
    addToMeals.type = 'button';
    addToMeals.dataset.action = 'add-to-meals';
    addToMeals.dataset.id = String(recipe.id);
    addToMeals.textContent = t('recipes.addToMeals');

    // Zweiter Ausgang aus dem Rezept: „was brauche ich dafür" war bisher nur
    // über Einplanen → Tab wechseln → „Aus Essensplan" erreichbar, also vier
    // Schritte über zwei Module. Sekundär gewichtet, weil Einplanen der
    // häufigere Weg bleibt. Entfällt ohne Einkaufsliste.
    let addToShopping = null;
    if (state.lists.length && ingredients.length) {
      addToShopping = document.createElement('button');
      addToShopping.className = 'btn btn--secondary recipe-card__to-shopping';
      addToShopping.type = 'button';
      addToShopping.dataset.action = 'to-shopping';
      addToShopping.dataset.id = String(recipe.id);
      // Ohne eigenes Icon: der Button steht in derselben Zeile wie die drei
      // Icon-Aktionen, und nur so passt die Zeile in die Kartenbreite (siehe
      // Kommentar an .recipe-card__to-shopping in recipes.css).
      addToShopping.textContent = t('recipes.toShoppingList');
    }

    const iconActions = document.createElement('div');
    iconActions.className = 'row-actions recipe-card__icon-actions';
    const secondaryActions = [
      { action: 'edit',      icon: 'pencil',  label: t('common.edit') },
      { action: 'duplicate', icon: 'copy',    label: t('recipes.duplicate') },
      { action: 'delete',    icon: 'trash-2', label: t('common.delete'), danger: true },
    ];
    for (const a of secondaryActions) {
      const btn = document.createElement('button');
      btn.className = `row-action${a.danger ? ' row-action--danger' : ''}`;
      btn.type = 'button';
      btn.dataset.action = a.action;
      btn.dataset.id = String(recipe.id);
      btn.setAttribute('aria-label', a.label);
      btn.title = a.label;
      const ic = document.createElement('i');
      ic.dataset.lucide = a.icon;
      ic.className = 'icon-md';
      ic.setAttribute('aria-hidden', 'true');
      btn.appendChild(ic);
      iconActions.appendChild(btn);
    }

    actions.append(addToMeals);
    if (addToShopping) actions.append(addToShopping);
    actions.append(iconActions);
    card.appendChild(actions);

    list.appendChild(card);
  }

  if (window.lucide) window.lucide.createIcons({ el: list });
}

// Nur-Lese-Ansicht fürs Kochen (Audit A1-21): volle Zutatenliste und Notizen
// ohne Formular-Chrome; Bearbeiten bleibt eine bewusste Folgeaktion.
function openRecipeReadModal(recipe) {
  const mealTypes = normalizeRecipeMealTypes(recipe.meal_types);
  const showBadges = mealTypes.length && mealTypes.length < mealTypeOptions().length;
  const ingredients = recipe.ingredients ?? [];

  const content = `
    <div class="recipe-read">
      ${showBadges ? `<div class="recipe-card__meal-types">${mealTypeOptions()
        .filter((o) => mealTypes.includes(o.key))
        .map((o) => `<span class="meal-type-badge meal-type-badge--${esc(o.key)}">${esc(o.label)}</span>`)
        .join('')}</div>` : ''}
      ${ingredients.length ? `
        <h3 class="recipe-read__heading">${t('recipes.ingredientsLabel')}</h3>
        <ul class="recipe-read__ingredients">
          ${ingredients.map((i) => `<li>${i.quantity ? `<strong>${esc(i.quantity)}</strong> ` : ''}${esc(i.name)}</li>`).join('')}
        </ul>` : ''}
      ${recipe.notes ? `
        <h3 class="recipe-read__heading">${t('recipes.notesLabel')}</h3>
        <p class="recipe-read__notes">${esc(recipe.notes)}</p>` : ''}
      ${recipe.recipe_url ? `
        <a class="btn btn--ghost recipe-card__link" href="${esc(recipe.recipe_url)}" target="_blank" rel="noopener noreferrer">
          <i data-lucide="external-link" class="icon-sm" aria-hidden="true"></i>
          <span>${t('recipes.openLink')}</span>
        </a>` : ''}
    </div>
    <div class="modal-panel__footer">
      <button type="button" class="btn btn--ghost" data-action="close-modal">${t('common.close')}</button>
      <button type="button" class="btn btn--primary" id="recipe-read-edit">${t('common.edit')}</button>
    </div>`;

  openSharedModal({
    title: recipe.title,
    content,
    size: 'md',
    onSave(panel) {
      panel.querySelector('#recipe-read-edit')?.addEventListener('click', () => {
        openRecipeModal('edit', recipe);
      });
    },
  });
}

function openRecipeModal(mode, recipe = null) {
  const isEdit = mode === 'edit';

  openSharedModal({
    title: isEdit ? t('recipes.editRecipe') : t('recipes.addRecipe'),
    size: 'md',
    content: `
      <div class="form-group">
        <label class="form-label" for="recipe-title">${t('recipes.titleLabel')}</label>
        <input id="recipe-title" class="form-input" type="text" required placeholder="${t('recipes.titlePlaceholder')}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('meals.mealTypeLabel')}</label>
        <div class="recipe-meal-types" id="recipe-meal-types">
          ${mealTypeOptions().map((option) => `
            <label class="recipe-meal-types__option">
              <input type="checkbox" value="${option.key}" checked>
              <span class="meal-type-badge meal-type-badge--${option.key}">${option.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('recipes.ingredientsLabel')}</label>
        <div class="recipe-ingredient-list" id="recipe-ingredient-list"></div>
        <button class="btn btn--secondary recipe-add-ingredient" type="button" id="recipe-add-ingredient">${t('meals.addIngredient')}</button>
      </div>
      ${advancedSection(`
        <div class="form-group">
          <label class="form-label" for="recipe-notes">${t('recipes.notesLabel')}</label>
          <textarea id="recipe-notes" class="form-input" rows="3" placeholder="${t('recipes.notesPlaceholder')}"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label" for="recipe-url">${t('recipes.urlLabel')}</label>
          <input id="recipe-url" class="form-input" type="url" placeholder="${t('recipes.urlPlaceholder')}">
        </div>`,
        { open: isEdit && (!!recipe.notes || !!recipe.recipe_url) })}
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button class="btn btn--secondary" id="recipe-cancel">${t('common.cancel')}</button>
        <button class="btn btn--primary" id="recipe-save">${isEdit ? t('common.save') : t('common.add')}</button>
      </div>
    `,
    onSave(panel) {
      panel.querySelector('#recipe-title').value = isEdit ? recipe.title : '';
      panel.querySelector('#recipe-notes').value = isEdit && recipe.notes ? recipe.notes : '';
      panel.querySelector('#recipe-url').value = isEdit && recipe.recipe_url ? recipe.recipe_url : '';
      const selectedMealTypes = normalizeRecipeMealTypes(isEdit ? recipe.meal_types : RECIPE_MEAL_TYPE_KEYS);
      panel.querySelectorAll('#recipe-meal-types input[type="checkbox"]').forEach((input) => {
        input.checked = selectedMealTypes.includes(input.value);
      });

      const ingList = panel.querySelector('#recipe-ingredient-list');
      if (isEdit && recipe.ingredients?.length) {
        ingList.insertAdjacentHTML('beforeend', recipe.ingredients.map((i) => ingredientRowHTML({
          name: i.name,
          quantity: i.quantity ?? '',
          category: i.category ?? DEFAULT_CATEGORY_NAME,
          categories: mealCategories(),
        })).join(''));
      }

      panel.querySelector('#recipe-add-ingredient')?.addEventListener('click', () => {
        ingList.insertAdjacentHTML('beforeend', ingredientRowHTML({ categories: mealCategories() }));
        if (window.lucide) window.lucide.createIcons({ el: ingList });
      });

      ingList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="remove-ingredient"]');
        if (!btn) return;
        btn.closest('.ingredient-row')?.remove();
      });

      panel.querySelector('#recipe-cancel')?.addEventListener('click', closeModal);
      panel.querySelector('#recipe-save')?.addEventListener('click', () => saveRecipe(panel, mode, recipe));
      // Pflichtfelder melden sich beim Verlassen inline (geteiltes Muster).
      wireBlurValidation(panel);

      if (window.lucide) window.lucide.createIcons({ el: panel });
    },
  });
}

function closeModal({ force = false } = {}) {
  closeSharedModal({ force });
}

async function saveRecipe(panel, mode, recipe) {
  const saveBtn = panel.querySelector('#recipe-save');
  const title = panel.querySelector('#recipe-title')?.value.trim() || '';
  const notes = panel.querySelector('#recipe-notes')?.value.trim() || null;
  const recipe_url = panel.querySelector('#recipe-url')?.value.trim() || null;
  const meal_types = [...panel.querySelectorAll('#recipe-meal-types input[type="checkbox"]:checked')].map((input) => input.value);

  if (!title) {
    // Fehler am Feld statt als ortloser Toast (geteiltes Muster, Critique P1).
    reportFieldError(panel.querySelector('#recipe-title'), t('recipes.titleRequired'));
    return;
  }

  const ingredients = [];
  panel.querySelectorAll('.ingredient-row').forEach((row) => {
    const name = row.querySelector('.ingredient-row__name')?.value.trim() || '';
    const quantity = row.querySelector('.ingredient-row__qty')?.value.trim() || null;
    const category = row.querySelector('.ingredient-row__cat')?.value || DEFAULT_CATEGORY_NAME;
    if (name) ingredients.push({ name, quantity, category });
  });

  saveBtn.disabled = true;

  try {
    if (mode === 'create') {
      const res = await api.post('/recipes', { title, notes, recipe_url, meal_types, ingredients });
      state.recipes.push(res.data);
    } else {
      const res = await api.put(`/recipes/${recipe.id}`, { title, notes, recipe_url, meal_types, ingredients });
      const idx = state.recipes.findIndex((r) => r.id === recipe.id);
      if (idx >= 0) state.recipes[idx] = res.data;
    }

    closeModal({ force: true });
    renderRecipeList();
    window.myHub?.showToast(mode === 'create' ? t('recipes.created') : t('recipes.updated'), 'success');
  } catch (err) {
    saveBtn.disabled = false;
    window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}

// --------------------------------------------------------
// Zutaten → Einkaufsliste
// --------------------------------------------------------

/**
 * Übernimmt die Zutaten eines Rezepts auf eine Einkaufsliste. Bei genau einer
 * Liste ohne Rückfrage, sonst über die geteilte Auswahl - dasselbe Muster wie
 * transferMeal() im Essensplan, damit sich der Weg in beiden Modulen gleich
 * anfühlt. Der Server überspringt Zutaten, die schon unabgehakt auf der Liste
 * liegen; die Rückmeldung nennt beide Zahlen.
 */
/**
 * Rezept in den Essensplan übernehmen: fragt „Für wann?" hier und legt die
 * Mahlzeit direkt an.
 *
 * Vorher navigierte dieser Weg auf `/meals?recipe=<id>`, wo ein Formular mit 27
 * Feldern aufging - Titel „Mahlzeit hinzufügen" ohne das Rezept zu nennen, das
 * Datumsfeld leer, 42 % des Dialogs unter der Sichtkante. Nach Escape blieb
 * `?recipe=` in der URL und ein Reload öffnete das Formular erneut, beliebig oft
 * (Critique 2026-07-29). Als einziger der fünf Transfers folgte er nicht dem
 * Muster der anderen.
 *
 * Jetzt zwei Entscheidungen statt neun Feldern, kein Seitenwechsel, und der
 * Query-Parameter existiert nicht mehr - der Zombie ist damit strukturell weg,
 * nicht per `replaceState` kaschiert. Details lassen sich danach im Essensplan
 * bearbeiten, wie bei jeder anderen Mahlzeit.
 */
async function planRecipe(recipe, btn) {
  const types = normalizeRecipeMealTypes(recipe.meal_types);
  // Vorauswahl: erklärt das Rezept genau einen Typ, ist die Sache klar. Erklärt
  // es mehrere - was der Default ist, wenn niemand etwas gesetzt hat -, dann
  // stand bisher „Frühstück" da, weil es in der Liste zuerst kommt: der Dialog
  // schlug für ein Curry das Frühstück vor (Critique 2026-07-30). Ohne Signal
  // vom Rezept ist das Abendessen die ehrlichere Annahme, es ist die Mahlzeit,
  // die Haushalte am häufigsten planen.
  const vorauswahl = types.length === 1 ? types[0] : (types.includes('dinner') ? 'dinner' : types[0]);
  const typeOpts = mealTypeOptions()
    .filter(({ key }) => types.includes(key))
    .map(({ key, label }) =>
      `<option value="${key}"${key === vorauswahl ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');

  const today = toLocalDateKey(new Date());

  openSharedModal({
    title: t('recipes.planTitle', { name: recipe.title }),
    size: 'sm',
    content: `
      <div class="form-group">
        <label class="form-label" for="plan-date">${t('meals.dateLabel')}</label>
        <my-hub-datepicker type="date" id="plan-date" value="${esc(formatDateInput(today))}"></my-hub-datepicker>
      </div>
      <div class="form-group">
        <label class="form-label" for="plan-type">${t('meals.mealTypeLabel')}</label>
        <select class="form-input" id="plan-type">${typeOpts}</select>
      </div>
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <!-- „Übernehmen", nicht die Wiederholung des Auslöser-Labels: die drei
             anderen Transfer-Dialoge bestätigen genauso, und der Dialogtitel
             nennt Rezept und Ziel bereits (Critique 2026-07-30). -->
        <button type="button" class="btn btn--primary" id="plan-confirm">${esc(t('common.apply'))}</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('#plan-confirm').addEventListener('click', async (e) => {
        const confirmBtn = e.currentTarget;
        const dateField = panel.querySelector('#plan-date');
        if (!isDateInputValid(dateField.value)) {
          reportFieldError(dateField, t('calendar.invalidDate'));
          return;
        }
        const date = parseDateInput(dateField.value);
        const mealType = panel.querySelector('#plan-type').value;

        confirmBtn.disabled = true;
        try {
          await api.post('/meals', mealPayloadFromRecipe(recipe, date, mealType));
          closeSharedModal({ force: true });
          window.myHub?.showToast(
            t('recipes.planSuccess', { name: recipe.title, date: formatDate(date) }),
            'success',
          );
        } catch (err) {
          window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
          confirmBtn.disabled = false;
        }
      });
    },
  });

  if (btn) btn.blur();
}

async function transferRecipe(recipe, btn) {
  if (!state.lists.length) {
    window.myHub?.showToast(t('meals.noShoppingLists'), 'danger');
    return;
  }

  let listId = state.lists[0].id;
  if (state.lists.length > 1) {
    const options = state.lists.map((l) => ({ value: l.id, label: l.name }));
    const choice = await selectModal(t('recipes.toShoppingListTitle'), options);
    if (choice === null) return;
    listId = Number(choice);
  }

  if (btn) btn.disabled = true;
  try {
    const res = await api.post(`/recipes/${recipe.id}/to-shopping-list`, { listId });
    const added = res.data?.transferred ?? 0;
    const skipped = res.data?.skipped ?? 0;

    if (added > 0) {
      // t() wählt die _one-Form selbst, sobald count numerisch ist (i18n.js).
      window.myHub?.showToast(t('recipes.toShoppingSuccess', { count: added }), 'success');
    } else if (skipped > 0) {
      window.myHub?.showToast(t('recipes.toShoppingAllPresent'), 'info');
    } else {
      window.myHub?.showToast(t('recipes.toShoppingNoIngredients'), 'info');
    }
  } catch (err) {
    window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removeRecipe(recipe) {
  const itemEl = _container.querySelector(`.recipe-card[data-id="${recipe.id}"]`);
  if (itemEl) itemEl.style.display = 'none';

  scheduleUndoableDelete({
    message: t('recipes.deleted'),
    commit: async ({ keepalive }) => {
      await api.delete(`/recipes/${recipe.id}`, { keepalive });
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      state.recipes = state.recipes.filter((r) => r.id !== recipe.id);
      renderRecipeList();
    },
    restore: (err) => {
      if (itemEl) itemEl.style.display = '';
      if (err) window.myHub?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}

async function duplicateRecipe(recipe) {
  const copySuffix = t('recipes.copySuffix');
  const title = `${recipe.title} (${copySuffix})`;
  const notes = recipe.notes || null;
  const recipe_url = recipe.recipe_url || null;
  const ingredients = (recipe.ingredients || []).map((ing) => ({
    name: ing.name,
    quantity: ing.quantity || null,
    category: ing.category || DEFAULT_CATEGORY_NAME,
  }));

  try {
    const res = await api.post('/recipes', { title, notes, recipe_url, ingredients });
    state.recipes.push(res.data);
    renderRecipeList();
    window.myHub?.showToast(t('recipes.duplicated'), 'success');
  } catch (err) {
    window.myHub?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}
