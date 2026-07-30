# Gesundheits-Modul — Implementierungsplan

> Quelle der Anforderung: [Discussion #149 „Health/meds/workouts"](https://github.com/ulsklyc/yuvomi/discussions/149)
> Angefragt: Blutdruck, Blutzucker, Medikamente (mit Erinnerung + „genommen"-Markierung), Sport.
> Erweitert um: Laborwerte/Blutwerte, Gesundheitsstatistiken (aus der Aufgabenstellung).

---

## 0. Recherche — welche Funktionen sind obligatorisch?

Analysiert wurden vergleichbare (teils self-hosted) Apps: **HealthLog** (Gewicht, Blutdruck, Glukose, Medikamente, Stimmung), **MyTherapy** (Meds + Messwerte + Symptome + Adherence-Report), **Medisafe** (Med-Reminder, Refill, Interaktions-Warnungen), **wger** (Workouts/Training), **Fasten/MediLog** (Befund-/Dokumentenablage).

**Feature-Kern, der in praktisch jeder Gesundheits-App vorkommt (Pflicht):**

| Cluster | Pflichtfunktionen | Optional / v2 |
|---|---|---|
| **Vitalwerte** | Blutdruck (sys/dia/Puls), Blutzucker, Gewicht als Zeitreihe; Trend-Chart; Schnell-Erfassung | SpO₂, Temperatur, generische „Custom"-Metrik |
| **Medikamente** | Med-Liste (Name, Dosis, Form), Einnahmeplan (Zeiten/Wochentage), Dosis-Log (genommen/übersprungen), Erinnerungen, Adherence-Quote | Bestand/Refill-Warnung, Interaktions-Hinweis, „bei Bedarf"-Meds |
| **Aktivität/Sport** | Trainings-Log (Typ, Dauer, Datum, Notiz) | Intensität/Kalorien, Serien-Templates, Wochenziel |
| **Laborwerte** | Befund mit mehreren Analyten + Referenzbereich; Trend je Analyt | Foto/PDF-Anhang, Import |
| **Statistik/Export** | Trends, Adherence-%, CSV-Export für Arztbesuch | PDF-Report, Zeitraum-Filter |
| **Personenbezug** | Daten je Familienmitglied getrennt | Sichtbarkeit privat/geteilt |

**Wichtige Rahmenbedingungen aus der Recherche, die ins Design einfließen:**
- Gesundheitsdaten sind **besonders sensibel** → Sichtbarkeits-/Privacy-Modell nötig; DB-Verschlüsselung (`DB_ENCRYPTION_KEY`/SQLCipher) ist bereits vorhanden und sollte in der Doku betont werden.
- **Keine medizinischen Claims / kein Diagnose-Anspruch** → Referenzbereiche neutral darstellen, Disclaimer.
- Adherence & Refill sind die Features, die Med-Reminder-Apps am stärksten differenzieren → nicht weglassen.

---

## 1. Modul-Struktur — „Gesundheit" mit Unterreitern

Analog zum **Küchen-Cluster** (ein Nav-Eintrag „Küche" → Unterreiter Essen/Rezepte/Einkauf via `renderSubTabs`): **ein** Nav-Eintrag **„Gesundheit"** unter Route `/health` mit gemeinsamer Sub-Tab-Leiste. Anders als die Küche (drei eigenständige Top-Level-Module) ist Gesundheit **ein** Seitenmodul (`public/pages/health.js`) mit internen Panels und Deep-Link-Routen — Muster wie der Settings-Bereich (mehrere Routen, ein Seitenmodul, `update()`-Soft-Navigation). Das hält die Modul-Liste (`disabled_modules`, Modul-Reihenfolge, Akzentfarbe) auf **einen** Eintrag begrenzt.

**Sub-Tabs (5):**

| Tab | Route | Inhalt |
|---|---|---|
| **Übersicht** | `/health` | Heute fällige Meds, letzte Vitalwerte-Karten, Adherence-Streak, Schnell-Erfassung, nächste Erinnerungen |
| **Vitalwerte** | `/health/vitals` | Blutdruck, Blutzucker, Gewicht, Puls, (SpO₂/Temp/Custom) + Trend-Charts |
| **Medikamente** | `/health/meds` | Med-Liste, Einnahmeplan, Dosis-Log, Erinnerungen, Bestand/Refill |
| **Laborwerte** | `/health/labs` | Befunde mit Analyten + Referenzbereich, Trend je Analyt |
| **Aktivität** | `/health/activity` | Trainings-/Sport-Log |

**Statistik** wird **nicht** als eigener Tab geführt, sondern erscheint kontextuell (Charts je Vital/Analyt, Adherence in Meds) plus ein Export-Einstieg in der Übersicht — hält die Tab-Zahl mobil handhabbar. (Alternative offen: eigener „Statistik"-Tab wie im Budget-Modul; Default = kontextuell.)

**Personenbezug:** Jede Zeile trägt `user_id` (FK → `users`; Familienmitglieder = Accounts). Ein **Personen-Umschalter** (Chip-Leiste) oben im Modul filtert auf ein Mitglied; Default = eingeloggtes Mitglied. Sichtbarkeit: `visibility` ∈ {`private`, `family`} — `private` nur für den Eigentümer, `family` für alle Accounts. Admin-Sonderrechte nicht nötig (Gesundheit ist bewusst nutzergebunden).

**Akzentfarbe (Design-Entscheidung, final in Phase 8):** Es fehlt ein sauberes Rot-/Crimson-Band (nur semantisch als `--color-danger` belegt) — Kandidat `--module-health` ≈ *Vital-Rosé/Crimson*, klar getrennt von `--module-birthdays` (Rosé) und `--color-danger`. Exakter Token-Wert + WCAG-AA-Kontrast + Hue-Abstand ≥ 20° zu Nachbarn werden in Phase 8 (`/impeccable`) fixiert.

---

## 2. Datenmodell (eine append-only Migration, `version: 65`)

Neu in `server/db.js` → `MIGRATIONS`-Array **anhängen** (nie bestehende Einträge ändern; nächste freie Version = **65**). Alle Zeitstempel `strftime('%Y-%m-%dT%H:%M:%SZ','now')`-Konvention wie bestehend. `updated_at`-Trigger je Tabelle nach vorhandenem Muster (siehe `meal_recurrence_*`).

```
-- Vitalwerte (eine Zeile = eine Messung)
health_vitals(
  id, user_id, type,           -- type: 'bp' | 'glucose' | 'weight' | 'pulse' | 'spo2' | 'temp' | custom-slug
  value_num, value_num2,       -- value_num2 nur für bp (dia); bp: value_num=sys, value_num2=dia, pulse optional in value_num3
  value_num3, unit,
  measured_at, note, visibility, created_at, updated_at)

-- Medikamente (Stammdaten)
medications(
  id, user_id, name, dosage_text, form,   -- form: 'pill'|'liquid'|'injection'|...
  active, prn,                             -- prn = "bei Bedarf"
  stock_qty, stock_unit, refill_threshold, -- Bestand/Refill
  note, visibility, created_at, updated_at)

-- Einnahmeplan (1 Med : n Zeitfenster)
medication_schedules(
  id, medication_id, time_of_day,          -- 'HH:MM' lokal
  days_mask,                               -- Bitmaske Mo–So, NULL = täglich
  dose_qty, start_date, end_date, active, created_at, updated_at)

-- Dosis-Ereignisse (Log)
medication_logs(
  id, medication_id, schedule_id,          -- schedule_id NULL für ad-hoc/prn
  scheduled_at, status,                    -- 'taken'|'skipped'|'pending'
  taken_at, dose_qty, note, created_at)

-- Laborbefund (Kopf)
health_lab_reports(
  id, user_id, report_date, lab_name, note, visibility, created_at, updated_at)

-- Analyt-Werte je Befund
health_lab_results(
  id, report_id, analyte, value_num, unit,
  ref_low, ref_high, flag,                 -- flag: 'low'|'normal'|'high' (abgeleitet/gespeichert)
  created_at)

-- Aktivität/Training
health_activities(
  id, user_id, type,                       -- 'run'|'walk'|'strength'|'cycle'|custom
  duration_min, distance_km, intensity, calories,
  performed_at, note, visibility, created_at, updated_at)
```

**Erinnerungen:** Keine eigene Reminder-Tabelle. Medikamenten-Erinnerungen werden über die **bestehende** Reminder-Infrastruktur erzeugt (`reminders` Tabelle, `server/routes/reminders.js`, `server/services/push-scheduler.js`, `notification-channels.js`). Ein Med-Schedule fungiert als Reminder-Quelle: pro fälligem Zeitfenster erzeugt ein Scheduler-Durchlauf `pending`-Logs und feuert Push/Notification. **Design-Entscheidung Phase 3:** Entweder (a) `reminders` um `source_type='medication'` erweitern, oder (b) ein schlanker eigener `medication-scheduler.js` analog `push-scheduler.js`. Empfehlung: (b), da Med-Zeitpläne (Tagesraster, `days_mask`, Dosis) nicht ins generische Reminder-Schema passen — aber Zustellung über denselben Push-/Channel-Layer.

**Indizes:** je `(user_id, measured_at/performed_at/report_date)`; `medication_logs(medication_id, scheduled_at)`; `medication_schedules(medication_id, active)`.

**Charts:** nativ als SVG rendern (wie `public/pages/budget-stats.js` / `computeStats`) — **keine** Chart-Bibliothek (Hard Constraint: keine externen Frontend-Deps).

---

## 3. Registrierungs-Checkliste (an jeder Stelle nötig)

Ein neues Modul „berührt" mehrere Stellen — diese Liste ist die Definition-of-Done pro Integration:

- [ ] `public/router.js` → `ROUTES` (`/health` + `/health/vitals|meds|labs|activity`, alle `page: '/pages/health.js'`, `module: 'health'`), `ROUTE_ORDER`, `routeTitle`, Keyboard-Shortcut (`g h`), ggf. `topLevelSection` für `/health/*`-Soft-Nav.
- [ ] `public/utils/health-tabs.js` (neu, analog `kitchen-tabs.js`) — Sub-Tab-Definitionen + `renderHealthTabsBar`.
- [ ] `public/pages/health.js` (neu) — `render()` + `update()` (Soft-Navigation zwischen Tabs).
- [ ] `public/styles/health.css` (neu) — `--module-accent` scoped auf Page-Root; alle Werte aus Tokens.
- [ ] `public/styles/tokens.css` → `--module-health` (+ Dark-Variante).
- [ ] `public/nav-icons.js` → Icon (`heart-pulse`).
- [ ] `public/settings/module-order.js` → Sektion (`NAV_SECTION.home`), ggf. Aufnahme in Default-Reihenfolge.
- [ ] Modul-Toggle (`disabled_modules`) — Gesundheit muss abschaltbar sein (sensible Daten).
- [ ] `public/locales/*.json` — **alle** Locales; `de` ist Referenz.
- [ ] `server/index.js` → `healthRouter` importieren + `app.use('/api/v1/health', healthRouter)`.
- [ ] `server/routes/health.js` (neu) — jeder Handler in `try/catch`.
- [ ] `server/openapi.js` → Schemas + Routen-Definitionen.
- [ ] `server/db.js` → Migration `version: 65`.
- [ ] `public/pages/dashboard.js` → optionale Gesundheits-Karte (fällige Meds / letzte Vitalwerte).
- [ ] `server/services/search.js` + `public/…` Suche → Meds/Aktivitäten indexieren (optional).
- [ ] `docs/SPEC.md`, README, `.env.example` (falls neue Env), Installer/Deploy-Targets — via `/docs-sync`.

---

## 4. Phasenplan

Jede Phase ist eigenständig testbar (`npm run test:health-*`), endet grün und mit einem **Continuation-Prompt** für ein frisches Kontextfenster. Reihenfolge maximiert frühe Sichtbarkeit: erst Gerüst, dann je Tab eine vertikale Scheibe (DB → Route → UI → Test).

---

### Phase 0 — Fundament & leeres Modul-Gerüst

**Ziel:** Navigierbares Modul „Gesundheit" mit 5 leeren Tabs, ohne Datenlogik. Sichtbar in Nav (Desktop-Sidebar + Mobile), Deep-Links funktionieren, Soft-Navigation zwischen Tabs, abschaltbar.

**Aufgaben:**
1. `public/utils/health-tabs.js` (analog `kitchen-tabs.js`): `HEALTH_ROUTES`, `TABS()`, `renderHealthTabsBar`, `getLastHealthRoute`.
2. `public/pages/health.js`: `render()` baut Kopf + Sub-Tab-Leiste + 5 Panels (`data-panel`), Skeleton/Empty-States; `update()` für Tab-Soft-Nav.
3. `public/styles/health.css` + `--module-health` in `tokens.css` (Platzhalter-Wert, final in Phase 8).
4. `router.js`: Routen, `ROUTE_ORDER`, `routeTitle`, Shortcut `g h`, `topLevelSection('/health/*')`.
5. `nav-icons.js` (`heart-pulse`), `module-order.js` (Sektion `home`), Modul-Toggle.
6. i18n-Keys `nav.health`, `health.tabs.*`, Empty-State-Texte in **allen** Locales (`/locale-add`).
7. Test `test/test-health-nav.js` (+ `test:health-nav` Script): Routen registriert, Tab-Definitionen, `getLastHealthRoute`-Fallback, Modul abschaltbar.

**DoD:** `npm run test:health-nav` grün; Modul in Nav sichtbar; Tabs wechseln ohne Full-Reload; i18n-Audit sauber (`i18n-auditor`).

> **▶️ Continuation-Prompt (Phase 1):**
> „Yuvomi-Gesundheitsmodul, Phase 1 (Datenmodell + Server-Routen). Phase 0 (Modul-Gerüst `/health` mit 5 leeren Tabs, `health-tabs.js`, `health.js`, Nav/Router-Registrierung, i18n) ist grün gemergt. Lege jetzt die append-only Migration `version: 65` in `server/db.js` an mit den Tabellen `health_vitals`, `medications`, `medication_schedules`, `medication_logs`, `health_lab_reports`, `health_lab_results`, `health_activities` (Schema siehe `docs/health-module-plan.md` §2) inkl. `updated_at`-Trigger und Indizes. Erstelle `server/routes/health.js` mit CRUD für alle Entitäten (jeder Handler in try/catch, `{data:…}`-JSON, `user_id`-Scoping, `visibility`-Filter), mounte es in `server/index.js` unter `/api/v1/health`, und ergänze `server/openapi.js`. Schreibe `test/test-health-api.js` (CRUD, Scoping, Visibility) + `test:health-api`-Script. Halte die Hard Constraints ein (import/export, try/catch, Migration append-only). Führe zuerst `graphify query` zur Orientierung aus."

---

### Phase 1 — Datenmodell & Server-Routen

**Ziel:** Vollständige, getestete API-Schicht für alle Entitäten; noch ohne UI-Anbindung.

**Aufgaben:**
1. Migration `version: 65` (alle 7 Tabellen, Trigger, Indizes) — via `/add-migration`.
2. `server/routes/health.js`: CRUD-Endpunkte
   - `GET/POST/PATCH/DELETE /vitals`
   - `GET/POST/PATCH/DELETE /medications`, `…/medications/:id/schedules`, `…/medications/:id/logs` (+ `POST /logs/:id/take|skip`)
   - `GET/POST/PATCH/DELETE /labs` (+ nested results)
   - `GET/POST/PATCH/DELETE /activities`
   - alle mit `user_id`-Scoping, `visibility`-Filter, Validierung, `try/catch`.
3. `server/openapi.js`: Schemas + Security.
4. `test/test-health-api.js` + Script.

**DoD:** `npm run test:health-api` grün; `npm test` gesamt grün.

> **▶️ Continuation-Prompt (Phase 2):**
> „Yuvomi-Gesundheitsmodul, Phase 2 (Tab „Vitalwerte"). Phasen 0–1 sind grün: Modul-Gerüst steht, Migration 65 + `server/routes/health.js` + Tests existieren. Baue jetzt den **Vitalwerte-Tab** in `public/pages/health.js`: Erfassungs-Modal (Blutdruck sys/dia/Puls, Blutzucker, Gewicht, optional SpO₂/Temp) via `openModal`, Listen-/Karten-Ansicht je Metrik, und **native SVG-Trend-Charts** (kein Chart-Lib, Muster wie `public/pages/budget-stats.js`). Datum-Helfer aus `public/utils/date.js` (`toLocalDateKey`), Anzeige via `formatDate`/`formatTime`, Zahlen/Einheiten lokalisiert. Personen-Umschalter oben. `esc()` für alle Nutzerdaten, kein `innerHTML`. Neue i18n-Keys in allen Locales. Test `test/test-health-vitals.js` (+ Script) für Chart-Datenaufbereitung/Aggregation. `graphify query` zur Orientierung zuerst."

---

### Phase 2 — Tab „Vitalwerte"

**Ziel:** Vollständige Vitalwert-Erfassung, -Liste und -Trends.

**Aufgaben:** Erfassungs-Modal; Karten je Metrik mit letztem Wert + Delta; SVG-Trend-Charts (Zeitraum wählbar); Personen-Umschalter; Empty-States; Aggregations-/Chart-Helfer als testbare Pure-Function (`computeVitalSeries`).

**DoD:** `npm run test:health-vitals` grün; Preview-Verifikation (Erfassen → Chart aktualisiert); Vitalwerte je Person getrennt.

> **▶️ Continuation-Prompt (Phase 3):**
> „Yuvomi-Gesundheitsmodul, Phase 3 (Tab „Medikamente" inkl. Erinnerungen). Phasen 0–2 grün: Modul-Gerüst, API (Migration 65), Vitalwerte-Tab fertig. Baue den **Medikamente-Tab**: Med-Liste (Name, Dosis, Form, aktiv/PRN), Einnahmeplan-Editor (Zeitfenster + Wochentags-Maske + Dosis), Tages-/Wochenansicht der fälligen Dosen mit **„genommen/übersprungen"-Markierung** (`POST /logs/:id/take|skip`), **Adherence-Quote**, sowie **Bestand/Refill-Warnung**. Für Erinnerungen: implementiere `server/services/medication-scheduler.js` analog `server/services/push-scheduler.js`, das fällige Dosen als `pending`-Logs erzeugt und über den bestehenden Push-/Notification-Channel-Layer (`notification-channels.js`) zustellt — reuse, keine Duplikate. Tests `test/test-health-meds.js` + `test/test-medication-scheduler.js` (+ Scripts): Fälligkeits-Berechnung, Adherence, Refill-Schwelle, Reminder-Fan-out (gemockt). i18n alle Locales, Hard Constraints, `graphify query` zuerst."

---

### Phase 3 — Tab „Medikamente" (Plan, Log, Erinnerungen, Bestand)

**Ziel:** Med-Verwaltung mit Einnahmeplan, Dosis-Logging, Adherence, Refill-Warnung und funktionierenden Erinnerungen über den vorhandenen Push-/Channel-Layer.

**Aufgaben:** Med-CRUD-UI + Schedule-Editor; „Heute/Woche fällig"-Ansicht mit Take/Skip; Adherence-Berechnung (Pure-Function); Bestand runterzählen bei „genommen" + Refill-Warnung; `medication-scheduler.js`; Zustellung via bestehende Kanäle.

**DoD:** `npm run test:health-meds` + `test:medication-scheduler` grün; Take/Skip aktualisiert Adherence & Bestand; Reminder feuert (gemockt verifiziert).

> **▶️ Continuation-Prompt (Phase 4):**
> „Yuvomi-Gesundheitsmodul, Phase 4 (Tab „Aktivität"). Phasen 0–3 grün: Gerüst, API, Vitalwerte, Medikamente inkl. Scheduler fertig. Baue den **Aktivität-Tab**: Trainings-Log (Typ aus Preset + Custom, Dauer, Datum, optional Distanz/Intensität/Kalorien, Notiz), Wochenübersicht mit Summen, einfacher Wochen-Balken-Chart (native SVG). Personen-Umschalter, Empty-States, i18n alle Locales. Test `test/test-health-activity.js` (+ Script) für Wochen-Aggregation. Hard Constraints, `graphify query` zuerst."

---

### Phase 4 — Tab „Aktivität"

**Ziel:** Trainings-/Sport-Log mit Wochenübersicht.

**Aufgaben:** Aktivitäts-CRUD-UI; Typ-Presets + Custom; Wochenaggregation + SVG-Balken; Empty-States.

**DoD:** `npm run test:health-activity` grün; Preview-Verifikation.

> **▶️ Continuation-Prompt (Phase 5):**
> „Yuvomi-Gesundheitsmodul, Phase 5 (Tab „Laborwerte"). Phasen 0–4 grün. Baue den **Laborwerte-Tab**: Befund anlegen (Datum, Labor, Notiz) mit n Analyten (Name, Wert, Einheit, Referenz low/high); automatische `flag`-Ableitung (low/normal/high) mit farbcodierter Darstellung (Tokens, nicht hardcoden); Trend je Analyt über mehrere Befunde (native SVG-Chart) mit eingezeichnetem Referenzband; neutraler medizinischer Disclaimer (kein Diagnose-Anspruch). Personen-Umschalter, i18n alle Locales. Test `test/test-health-labs.js` (+ Script) für flag-Ableitung + Analyt-Trend. Hard Constraints, `graphify query` zuerst."

---

### Phase 5 — Tab „Laborwerte"

**Ziel:** Strukturierte Befunde mit Referenzbereichen und Analyt-Trends.

**Aufgaben:** Befund-CRUD mit Analyt-Zeilen; `flag`-Ableitung; farbcodierte Darstellung (Tokens); Analyt-Trend-Chart mit Referenzband; Disclaimer.

**DoD:** `npm run test:health-labs` grün; Preview-Verifikation.

> **▶️ Continuation-Prompt (Phase 6):**
> „Yuvomi-Gesundheitsmodul, Phase 6 (Übersicht + Statistik + Export). Phasen 0–5 grün: alle vier Detail-Tabs fertig. Baue den **Übersichts-Tab** (`/health`): heute fällige Meds mit Inline-Take, Karten der letzten Vitalwerte, Adherence-Streak, Schnell-Erfassungs-Buttons, nächste Erinnerungen. Ergänze **Export** (CSV je Bereich + Zeitraum, Muster wie Budget-Stats-Export). Optional Gesundheits-Karte in `public/pages/dashboard.js`. Test `test/test-health-overview.js` (+ Script). i18n alle Locales, Hard Constraints, `graphify query` zuerst."

---

### Phase 6 — Übersicht, Statistik & Export

**Ziel:** Aggregierte Landing-Ansicht, kontextuelle Statistik, CSV-Export, Dashboard-Integration.

**Aufgaben:** Übersichts-Panel; Inline-Take fälliger Meds; CSV-Export je Bereich/Zeitraum; optionale Dashboard-Karte.

**DoD:** `npm run test:health-overview` grün; `npm test` gesamt grün; Dashboard zeigt Gesundheits-Karte (falls Modul aktiv).

> **▶️ Continuation-Prompt (Phase 7):**
> „Yuvomi-Gesundheitsmodul, Phase 7 (Doku-Sync + Suche + a11y-Pass). Phasen 0–6 grün: Modul funktional vollständig. Führe `/docs-sync` aus (README, `docs/SPEC.md`, `docs/installation.md`, `.env.example`, GitHub-Pages, Installer/Deploy-Targets — nur was das Gesundheitsmodul betrifft). Indexiere Medikamente/Aktivitäten in `server/services/search.js`. Mache einen a11y-/Tastatur-Pass (Fokus, ARIA der Tabs/Modals, Screenreader-Announce). Ergänze Hilfe-Zeilen (`public/utils/help.js`) und ggf. Shortcut-Doku. i18n-Audit final. Danach bereit für Phase 8 (`/impeccable critique`)."

---

### Phase 7 — Doku-Sync, Suche, Accessibility

**Ziel:** Alle nutzerseitigen Docs & Deploy-Targets synchron; Suche & a11y komplett.

**Aufgaben:** `/docs-sync`; Such-Indexierung; a11y/Keyboard-Pass; Hilfe-Zeilen; finaler i18n-Audit (`i18n-auditor`).

**DoD:** Doku vollständig; `i18n-auditor` ohne fehlende Keys; Tab-Navigation/Modals a11y-konform.

> **▶️ Continuation-Prompt (Phase 8):**
> „Yuvomi-Gesundheitsmodul, Phase 8 (Finaler Design-/UX-Feinschliff + Release). Phasen 0–7 grün: Modul funktional & dokumentiert. Führe **`/impeccable critique`** auf das gesamte Gesundheitsmodul aus (alle 5 Tabs, Modals, Charts, Empty-/Error-States, responsive/mobil, Dark Mode, Motion). Fixiere die finale `--module-health`-Akzentfarbe in `tokens.css` (WCAG-AA, Hue-Abstand ≥ 20° zu Nachbarn). Arbeite die Critique-Findings ab (Visual Hierarchy, Spacing, Micro-Interactions, Konsistenz mit Küche/Budget). Danach `/release-prep` (Default `minor` — neues Modul): CHANGELOG, Version-Bump inkl. `public/sw.js APP_RELEASE == package.json`, Commit/Tag/Push/Release. `graphify update .` am Ende."

---

### Phase 8 — `/impeccable` Critique, Design-Feinschliff & Release

**Ziel:** Von Anfang an makelloses Release.

**Aufgaben:** `/impeccable critique` über das gesamte Modul; Findings abarbeiten; finale Akzentfarbe; Konsistenz-Check gegen Küche/Budget; `/release-prep` (`minor`) inkl. SW-Bump; `graphify update .`.

**DoD:** Critique-Findings erledigt; Release getaggt & gepusht; CI grün (inkl. SW-Version).

---

## 5. Offene Entscheidungen (vor/bei Umsetzung zu bestätigen)

1. **Statistik**: kontextuell (Default) vs. eigener Tab wie Budget.
2. **Reminder-Mechanik**: eigener `medication-scheduler.js` (empfohlen) vs. Erweiterung der `reminders`-Tabelle.
3. **Sichtbarkeit**: `private`/`family` — reicht das, oder feinere Freigaben je Mitglied?
4. **Akzentfarbe** `--module-health` (final in Phase 8).
5. **Scope v1**: alle 5 Tabs im ersten Release vs. Labs/Aktivität als Fast-Follow.

---

## 6. Hard-Constraint-Erinnerung (gilt in jeder Phase)

- Kein Framework/Bundler/CSS-Lib; keine externen Frontend-Deps (nur Lucide).
- `import`/`export`, nie `require()`; kein `eval`.
- Jeder UI-Text via `t()`; `de` Referenz; **alle** Locales pflegen.
- Kein `innerHTML` (PostToolUse-Hook blockt); `insertAdjacentHTML`/DOM-API; Nutzerdaten in `esc()`.
- Migrationen append-only; nächste Version **65**.
- Farben/Radii/Shadows/Font-Sizes nur aus `tokens.css`.
- Jeder Route-Handler in `try/catch`.
- Datum für API: `toLocalDateKey()`; Anzeige: `formatDate`/`formatTime`.
