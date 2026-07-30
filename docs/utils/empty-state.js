/**
 * Geteilter Leerzustands-Renderer.
 *
 * Die `.empty-state`-CSS-Grammatik (layout.css) ist seit langem vollständig:
 * `__icon`, `__title`, `__description`, `__hint`, `__cta`. Was fehlte, war eine
 * Stelle, die die KOMPOSITION erzwingt. Folge: 18 Seiten setzten die Teile frei
 * zusammen, und allein in der Küche entstanden drei Varianten desselben
 * Zustands - Rezepte mit doppelter Aussage in Description und Hint, Einkaufen
 * ganz ohne Hint und vertikal in 787px zentriert statt oben angesetzt, Vorrat
 * als einziger vollständig (Critique 2026-07-29).
 *
 * Der Renderer bleibt absichtlich i18n-frei: Aufrufer übergeben schon
 * aufgelöste Strings aus ihrem eigenen `t()`. Eine zweite Übersetzungsschicht
 * hier würde nur Key-Namen über Modulgrenzen schleppen.
 *
 * Die drei Varianten und ihre ARIA-Rollen sind aus `pantry.js` übernommen, das
 * sie als einziges Modul korrekt unterschieden hat:
 *
 *   'empty'      Noch nichts angelegt. Keine Rolle - das ist gewöhnlicher
 *                Seiteninhalt, keine Meldung. Primärer CTA.
 *   'no-results' Filter/Suche ohne Treffer. `role="status"`, weil der Zustand
 *                als Reaktion auf eine Nutzereingabe erscheint und angesagt
 *                werden muss. Sekundärer CTA (Zurücksetzen).
 *   'error'      Laden fehlgeschlagen. `role="alert"`. Primärer CTA (Erneut).
 */

import { esc } from '/utils/html.js';

const VARIANTS = {
  'empty':      { role: null,     icon: 'inbox',          tone: 'primary'   },
  'no-results': { role: 'status', icon: 'search',         tone: 'secondary' },
  'error':      { role: 'alert',  icon: 'triangle-alert', tone: 'primary'   },
};

/**
 * Baut das Leerzustands-Element, ohne es einzuhängen.
 *
 * @param {object}   opts
 * @param {'empty'|'no-results'|'error'} [opts.variant='empty']
 * @param {string}   [opts.icon]         Lucide-Name; Default je Variante.
 * @param {string}    opts.title         Aufgelöster Titel (Pflicht).
 * @param {string}   [opts.description]  Aufgelöster Beschreibungstext.
 * @param {string}   [opts.hint]         Aufgelöster Hinweis. In der Küche nennt
 *                                       er die nächste Station des Kreislaufs.
 * @param {object}   [opts.action]       { label, onClick, icon?, tone? } - ein
 *                                       CTA. `icon` ist ein Lucide-Name, der
 *                                       dem Label vorangestellt wird.
 * @returns {HTMLDivElement}
 */
export function emptyStateEl({ variant = 'empty', icon, title, description, hint, action } = {}) {
  const spec = VARIANTS[variant] ?? VARIANTS.empty;

  const box = document.createElement('div');
  box.className = 'empty-state';
  if (spec.role) box.setAttribute('role', spec.role);

  // Feste Reihenfolge Icon → Titel → Beschreibung → Hinweis. Genau die
  // Freiheit, hier umzusortieren oder Teile zu überspringen, hat die vier
  // Küchen-Grammatiken erzeugt.
  const parts = [
    `<i data-lucide="${esc(icon || spec.icon)}" class="empty-state__icon" aria-hidden="true"></i>`,
    // <h2>, nicht <div>: der Leerzustand ist auf einer leeren Seite der einzige
    // Inhalt, und ohne Überschriften-Semantik ist der erste Bildschirm des
    // Moduls für einen Screenreader strukturlos (Critique 2026-07-30). h2, weil
    // jede Seite ihr h1 schon als sr-only-Modultitel führt.
    `<h2 class="empty-state__title">${esc(title ?? '')}</h2>`,
  ];
  if (description) parts.push(`<div class="empty-state__description">${esc(description)}</div>`);
  if (hint) parts.push(`<p class="empty-state__hint">${esc(hint)}</p>`);
  box.insertAdjacentHTML('beforeend', parts.join(''));

  if (action?.label) {
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = `btn btn--${action.tone || spec.tone} empty-state__cta`;
    if (action.icon) {
      cta.insertAdjacentHTML('afterbegin',
        `<i data-lucide="${esc(action.icon)}" aria-hidden="true" class="icon-md"></i>`);
    }
    // Label als Textknoten, nicht via textContent: sonst würde ein schon
    // eingefügtes Icon wieder entfernt.
    cta.append(document.createTextNode(action.label));
    if (typeof action.onClick === 'function') cta.addEventListener('click', action.onClick);
    box.appendChild(cta);
  }

  return box;
}

/**
 * Baut den Leerzustand und ersetzt damit den Inhalt von `target`.
 *
 * `lucide.createIcons` muss NACH dem Einhängen laufen, sonst findet es die
 * `<i data-lucide>`-Platzhalter nicht - deshalb dieser Weg statt eines
 * Aufrufs in `emptyStateEl`.
 *
 * @param {HTMLElement} target
 * @param {object} opts  wie `emptyStateEl`
 * @returns {HTMLDivElement|null}
 */
export function mountEmptyState(target, opts) {
  if (!target) return null;
  const box = emptyStateEl(opts);
  target.replaceChildren(box);
  if (window.lucide) window.lucide.createIcons({ el: box });
  return box;
}
