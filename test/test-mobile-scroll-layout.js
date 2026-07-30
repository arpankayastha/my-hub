/**
 * Modul: Mobile scroll layout regression test
 * Zweck: Verhindert Scrollzeit-Layoutmutationen, die mobile Browser beim Dashboard-Scrollen blanken lassen.
 * Ausführen: node test-mobile-scroll-layout.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routerJs = readFileSync(new URL('../public/router.js', import.meta.url), 'utf8');
const layoutCss = readFileSync(new URL('../public/styles/layout.css', import.meta.url), 'utf8');
const glassCss = readFileSync(new URL('../public/styles/glass.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../public/styles/tokens.css', import.meta.url), 'utf8');

function cssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

test('mobile scrolling keeps navigation and fixed layers stable', () => {
  assert.equal(
    routerJs.includes('document.documentElement.classList.toggle(\'nav-bottom--hidden\''),
    false,
    'Scroll-Handler darf den Bottom-Nav-Status nicht auf <html> spiegeln'
  );

  assert.equal(
    routerJs.includes('setNavHidden'),
    false,
    'Kein Scrollpfad darf die mobile Bottom-Nav ausblenden'
  );

  assert.equal(
    layoutCss.includes('html.nav-bottom--hidden .page-fab'),
    false,
    'FAB darf nicht über eine Root-Klasse während des Scrollens umpositioniert werden'
  );

  const pageFabRule = cssRuleBody(layoutCss, '.page-fab');
  assert.equal(
    /transition\s*:[^;]*\bbottom\b/.test(pageFabRule),
    false,
    'FAB darf bottom nicht animieren; fixed Layer sollen beim Scrollen stabil bleiben'
  );

  assert.equal(
    glassCss.includes('.nav-bottom--hidden'),
    false,
    'Die Glass-Schicht darf keinen versteckten Bottom-Nav-Zustand definieren'
  );
});

test('mobile bottom navigation reserves safe-area space without scroll-time root mutation', () => {
  const navRule = cssRuleBody(layoutCss, '.nav-bottom');
  const rootRule = cssRuleBody(layoutCss, ':root');

  assert.match(navRule, /padding-bottom:\s*var\(--safe-area-inset-bottom\)/);
  assert.match(tokensCss, /--nav-bottom-height:\s*calc\(var\(--nav-height-mobile\)\s*\+\s*var\(--safe-area-inset-bottom\)\)/);
  assert.equal(rootRule.includes('nav-bottom--hidden'), false);
});

test('mobile bottom navigation keeps five equal slots with inset indicator geometry', () => {
  const itemsRule = cssRuleBody(layoutCss, '.nav-bottom__items');
  const itemRule = cssRuleBody(layoutCss, '.nav-bottom .nav-item');
  const baseItemRule = cssRuleBody(layoutCss, '.nav-item');
  const indicatorRule = cssRuleBody(layoutCss, '.nav-bottom__indicator');
  const indicatorSurfaceRule = cssRuleBody(layoutCss, '.nav-bottom__indicator::before');

  assert.match(itemsRule, /display:\s*flex/);
  assert.match(baseItemRule, /flex:\s*1/);
  assert.match(itemRule, /min-width:\s*0/);
  assert.match(indicatorSurfaceRule, /inset-inline:\s*var\(--space-1\)/);
  // Kapsel hinter dem Icon statt über die ganze Bar-Höhe: bar-hoch schnitt sie
  // die Label-Grundlinie an und lief in die Safe-Area (#569-Nachtrag).
  assert.match(indicatorRule, /top:\s*0/);
  assert.match(indicatorRule, /bottom:\s*auto/);
  assert.match(indicatorRule, /height:\s*var\(--target-md\)/);
  assert.doesNotMatch(indicatorRule, /transition:[^;]*\bwidth\b/);
});

test('mobile tab indicator stays a capsule behind the icon, clear of the bar edges', () => {
  // Slot-breite Pille lief im ersten/letzten Tab bis an die Bar-Kante, wo die
  // Rundung gekappt wurde (#569-Nachtrag). Die Geometrie kommt aus dem
  // Icon-Well-Rect plus seitlichem Inset, nicht aus der reinen Slot-Breite.
  const fn = routerJs.slice(routerJs.indexOf('function positionTabIndicator'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);

  assert.match(body, /querySelector\('\.nav-item__icon-well'\)/);
  assert.match(body, /Math\.min\(ar\.width - TAB_INDICATOR_INSET \* 2, TAB_INDICATOR_MAX_WIDTH\)/);
  assert.match(body, /indicator\.style\.height = `\$\{wr\.height\}px`/);
  assert.match(body, /translate\(\$\{left\}px, \$\{top\}px\)/);
  assert.doesNotMatch(body, /indicator\.style\.width = `\$\{ar\.width\}px`/);
  assert.match(routerJs, /const TAB_INDICATOR_INSET = 4;/);
  assert.match(routerJs, /const TAB_INDICATOR_MAX_WIDTH = 64;/);
});

test('cold dashboard load does not transform the scroll surface', () => {
  assert.match(
    routerJs,
    /const shouldAnimate = Boolean\(previousPath\);/,
    'the router must distinguish a cold load from an in-app navigation',
  );
  assert.match(
    routerJs,
    /if \(shouldAnimate\) \{\s*pageWrapper\.classList\.add\(inClass\);/,
    'the slide class must only be applied after an existing route',
  );
});

test('closed dashboard speed dial cannot capture first-scroll gestures', () => {
  const dashboardCss = readFileSync(new URL('../public/styles/dashboard.css', import.meta.url), 'utf8');
  const containerRule = cssRuleBody(dashboardCss, '.fab-container');
  const mainRule = cssRuleBody(dashboardCss, '.fab-main');

  assert.match(containerRule, /pointer-events:\s*none/);
  assert.match(mainRule, /pointer-events:\s*auto/);
  assert.match(dashboardCss, /\.fab-actions--visible\s*\{[^}]*pointer-events:\s*auto/s);
});
