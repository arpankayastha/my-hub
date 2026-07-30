import { t } from '/i18n.js';
import { toggleRowHtml } from '/settings/components.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

export async function persistMealTypeSelection(
  inputs,
  checkedMealTypes,
  persistedMealTypes,
  save,
) {
  inputs.forEach((input) => {
    input.disabled = true;
  });

  try {
    await save();
  } catch (error) {
    inputs.forEach((input) => {
      input.checked = persistedMealTypes.includes(input.value);
    });
    throw error;
  } finally {
    inputs.forEach((input) => {
      input.disabled = false;
    });
  }

  return checkedMealTypes;
}

function renderPage(container, preferences) {
  const visibleMealTypes = Array.isArray(preferences.visible_meal_types)
    ? preferences.visible_meal_types
    : MEAL_TYPES;

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.sectionMeals')}</h2>
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.mealTypesLabel')}</h3>
        <p class="form-hint">${t('settings.mealTypesHint')}</p>
        <div class="meal-type-toggles" id="meal-type-toggles">
          ${MEAL_TYPES.map((mealType) => toggleRowHtml({
            label: t(`meals.type${mealType[0].toUpperCase()}${mealType.slice(1)}`),
            checked: visibleMealTypes.includes(mealType),
            attrs: { value: mealType },
          })).join('')}
        </div>
        <p class="form-hint">${t('settings.kitchenExternalHint')}</p>
      </div>
    </section>
  `);
}

function bindEvents(container) {
  const mealToggles = container.querySelector('#meal-type-toggles');
  const inputs = [...(mealToggles?.querySelectorAll('input') ?? [])];
  let persistedMealTypes = inputs
    .filter((input) => input.checked)
    .map((input) => input.value);

  mealToggles?.addEventListener('change', async () => {
    if (inputs.some((input) => input.disabled)) return;

    const checkedMealTypes = inputs
      .filter((input) => input.checked)
      .map((checkbox) => checkbox.value);

    if (checkedMealTypes.length === 0) {
      inputs.forEach((input) => {
        input.checked = persistedMealTypes.includes(input.value);
      });
      window.yuvomi?.showToast(t('settings.mealTypesMinOne'), 'danger');
      return;
    }

    try {
      persistedMealTypes = await persistMealTypeSelection(
        inputs,
        checkedMealTypes,
        persistedMealTypes,
        () => savePreferences({ visible_meal_types: checkedMealTypes }),
      );
      window.yuvomi?.showToast(t('settings.mealTypesSaved'), 'success');
    } catch (error) {
      window.yuvomi?.showToast(error.message || t('common.errorGeneric'), 'danger');
    }
  });
}

export async function render(container, { user }) {
  void user;
  const preferences = await getPreferences();
  renderPage(container, preferences);
  bindEvents(container);
}
