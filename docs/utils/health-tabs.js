import { t } from '/i18n.js';
import { renderSubTabs } from '/utils/sub-tabs.js';

// Gesundheit ist EIN Seitenmodul mit fünf Deep-Link-Routen (Muster wie Settings),
// nicht — wie die Küche — drei eigenständige Top-Level-Module. Die Sub-Tab-Leiste
// navigiert zwischen den Routen; das Seitenmodul tauscht via update() nur das
// aktive Panel aus (Soft-Navigation, kein Full-Reload).
export const HEALTH_ROUTES = Object.freeze([
  '/health',
  '/health/vitals',
  '/health/cycle',
  '/health/meds',
  '/health/labs',
  '/health/activity',
]);
export const HEALTH_STORAGE_KEY = 'yuvomi-health-tab';

// Der Zyklus-Tab ist ein haushaltweiter Opt-in (Settings → Module → Gesundheit).
// Ist er deaktiviert, entfällt der Tab; die Route leitet auf die Übersicht um.
export const HEALTH_TABS = ({ cycleEnabled = true } = {}) => [
  { route: '/health',          labelKey: 'health.tabs.overview', icon: 'heart-pulse'    },
  { route: '/health/vitals',   labelKey: 'health.tabs.vitals',   icon: 'activity'       },
  ...(cycleEnabled ? [{ route: '/health/cycle', labelKey: 'health.tabs.cycle', icon: 'droplet' }] : []),
  { route: '/health/meds',     labelKey: 'health.tabs.meds',     icon: 'pill'           },
  { route: '/health/labs',     labelKey: 'health.tabs.labs',     icon: 'flask-conical'  },
  { route: '/health/activity', labelKey: 'health.tabs.activity', icon: 'dumbbell'       },
];

export function isHealthRoute(path) {
  return HEALTH_ROUTES.includes(path);
}

export function getLastHealthRoute() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem(HEALTH_STORAGE_KEY);
      if (HEALTH_ROUTES.includes(stored)) return stored;
    }
  } catch { /* ignore */ }
  // Fallback: Übersicht. Gesundheit ist ein einziges Modul — wird es deaktiviert,
  // leitet der Router die Route ohnehin auf das Dashboard um.
  return '/health';
}

export function renderHealthTabsBar(container, activeRoute, { cycleEnabled = true } = {}) {
  container.classList.add('has-health-tabs');

  renderSubTabs(container, {
    tabs: HEALTH_TABS({ cycleEnabled }).map(({ route, labelKey, icon }) => ({ id: route, label: t(labelKey), icon })),
    activeId: activeRoute,
    storageKey: HEALTH_STORAGE_KEY,
    extraClass: 'health-tabs-bar',
    ariaLabel: t('nav.health'),
    title: t('nav.health'),
    insertPosition: 'afterbegin',
    onChange: (route) => window.yuvomi?.navigate(route),
  });
}
