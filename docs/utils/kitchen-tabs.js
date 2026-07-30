import { t } from '/i18n.js';
import { renderSubTabs } from '/utils/sub-tabs.js';

// Reihenfolge = Küchen-Kreislauf: planen → kochen → einkaufen → lagern.
export const KITCHEN_ROUTES = Object.freeze(['/meals', '/recipes', '/shopping', '/pantry']);
export const KITCHEN_STORAGE_KEY = 'yuvomi-kitchen-tab';

// Modul-Namen der Gruppe, aus den Routen abgeleitet (`route.slice(1)`) - dieselbe
// Konvention, die `isModuleDisabled` unten schon nutzt. Einzige Quelle für die
// Frage „gehört dieses Modul zur Küche?", damit der geteilte Akzent nicht über
// eine zweite, driftende Liste läuft.
export const KITCHEN_MODULES = Object.freeze(KITCHEN_ROUTES.map((route) => route.slice(1)));

const TABS = () => [
  { route: '/meals',    labelKey: 'nav.meals',    icon: 'utensils'      },
  { route: '/recipes',  labelKey: 'nav.recipes',  icon: 'book-text'     },
  { route: '/shopping', labelKey: 'nav.shopping', icon: 'shopping-cart' },
  { route: '/pantry',   labelKey: 'nav.pantry',   icon: 'archive'       },
].filter(({ route }) => !window.yuvomi?.isModuleDisabled(route.slice(1)));

export function getLastKitchenRoute() {
  try {
    const stored = sessionStorage.getItem(KITCHEN_STORAGE_KEY);
    if (KITCHEN_ROUTES.includes(stored) && !window.yuvomi?.isModuleDisabled(stored.slice(1))) {
      return stored;
    }
  } catch { /* ignore */ }
  const first = ['meals', 'recipes', 'shopping', 'pantry'].find((m) => !window.yuvomi?.isModuleDisabled(m));
  return first ? `/${first}` : '/meals';
}

export function isKitchenRoute(path) {
  return KITCHEN_ROUTES.includes(path);
}

export function isKitchenModule(mod) {
  return !!mod && KITCHEN_MODULES.includes(mod);
}

export function renderKitchenTabsBar(container, activeRoute) {
  container.classList.add('has-kitchen-tabs');

  renderSubTabs(container, {
    tabs: TABS().map(({ route, labelKey, icon }) => ({ id: route, label: t(labelKey), icon })),
    activeId: activeRoute,
    storageKey: KITCHEN_STORAGE_KEY,
    extraClass: 'kitchen-tabs-bar',
    ariaLabel: t('nav.kitchen'),
    title: t('nav.kitchen'),
    insertPosition: 'afterbegin',
    onChange: (route) => window.yuvomi?.navigate(route),
  });
}
