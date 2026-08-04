/**
 * Modul: Page-FAB — geteilte Primäraktion (Floating Action Button)
 *
 * EINE Quelle für die „Neu erstellen"-Schaltfläche unten rechts. Ersetzt die
 * zuvor pro Seite handgeschriebene `<button class="page-fab">`-Markup und gibt
 * Tab-Modulen einen Kontext-FAB, dessen Aktion dem aktiven Tab folgt.
 *
 * Drei Wege:
 *   - pageFabHtml()      → HTML-String für Template-Literal-Seiten (eigene Klick-Verdrahtung).
 *   - createPageFab()    → DOM-Element mit onClick, für DOM-basierte / dynamische Seiten.
 *   - setPageFabAction() → Aktion/Label/Sichtbarkeit eines Kontext-FAB je Tab aktualisieren.
 *
 * Der FAB muss INNERHALB des Modul-Page-Roots hängen (das `--module-accent`
 * setzt), damit er modulfarben wird. Styling lebt in layout.css (.page-fab).
 * Icon-Default: plus (Lucide rendert 24px). Nach dem Einfügen einmal
 * `lucide.createIcons({ el })` auf dem Container aufrufen.
 */

/** Gemeinsame FAB-Markup als HTML-String (Label kommt aus t(), keine Nutzdaten). */
export function pageFabHtml({ id = 'page-fab', label = '', icon = 'plus' } = {}) {
  return `<button type="button" class="page-fab" id="${id}"${label ? ` aria-label="${label}"` : ''}>
      <i data-lucide="${icon}" aria-hidden="true"></i>
    </button>`;
}

/** Gemeinsamer FAB als DOM-Element, optional an onClick gebunden. */
export function createPageFab({ id = 'page-fab', label = '', icon = 'plus', onClick } = {}) {
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'page-fab';
  fab.id = id;
  if (label) fab.setAttribute('aria-label', label);
  const glyph = document.createElement('i');
  glyph.dataset.lucide = icon;
  glyph.setAttribute('aria-hidden', 'true');
  fab.appendChild(glyph);
  if (onClick) fab.addEventListener('click', onClick);
  return fab;
}

/**
 * Kontext-FAB aktualisieren: Aktion, Label und Sichtbarkeit je aktivem Tab.
 * `hidden: true` blendet den FAB auf Tabs ohne Erstellen-Aktion aus und entfernt
 * die Aktion, sodass auch der `n`-Shortcut (klickt `.page-fab`) dort ins Leere läuft.
 */
export function setPageFabAction(fab, { label = '', onClick = null, hidden = false } = {}) {
  if (!fab) return;
  // `.page-fab { display: flex }` überschreibt das HTML-[hidden]-Attribut, daher
  // zusätzlich inline display togglen. `hidden` bleibt gesetzt (Screenreader).
  fab.hidden = hidden;
  fab.style.display = hidden ? 'none' : '';
  if (label) fab.setAttribute('aria-label', label);
  fab.onclick = hidden ? null : onClick;
}
