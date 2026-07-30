// --------------------------------------------------------
// Gezieltes Ändern einzelner Properties in einem bestehenden iCalendar-Objekt (#593).
//
// CalDAV kennt kein PATCH: eine Änderung ist immer ein PUT des kompletten
// Kalenderobjekts. Würde Yuvomi das Objekt aus seinen eigenen Feldern neu bauen,
// verlöre ein importierter Termin auf dem Server alles, was Yuvomi nicht kennt -
// Teilnehmer, Erinnerungen, Kategorien, Organisator, Anhänge. Deshalb wird das
// Original bearbeitet statt ersetzt: nur die gespiegelten Properties werden
// getauscht, jede andere Zeile bleibt Zeichen für Zeichen stehen.
// --------------------------------------------------------

// Properties, die Yuvomi verwaltet und daher ersetzen darf.
const MANAGED = new Set(['SUMMARY', 'DESCRIPTION', 'LOCATION', 'DTSTART', 'DTEND', 'RRULE']);

/** RFC 5545 §3.1: Fortsetzungszeilen beginnen mit Space oder Tab. */
export function unfoldICS(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** Zeilen > 75 Oktette falten, damit strenge Server das Objekt annehmen. */
export function foldICSLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    // Nie mitten in ein Mehrbyte-Zeichen schneiden: rückwärts bis zum Beginn
    // eines UTF-8-Zeichens gehen (Folgebytes sind 10xxxxxx).
    let end = Math.min(start + (parts.length === 0 ? 75 : 74), bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push((parts.length === 0 ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n');
}

function propertyName(line) {
  const cut = line.search(/[;:]/);
  return (cut === -1 ? line : line.slice(0, cut)).toUpperCase();
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Baut die Ersatzzeilen für ein Feld. `null`/`undefined` heißt "Property entfernen".
 * DTSTART/DTEND tragen ihre Parameter selbst (VALUE=DATE bzw. TZID), weil sich
 * Ganztägigkeit und Zone mit dem Wert ändern können.
 */
function buildLines(name, value) {
  if (value === null || value === undefined || value === '') return [];
  if (name === 'DTSTART' || name === 'DTEND') {
    const { value: v, params = '' } = value;
    if (!v) return [];
    return [`${name}${params}:${v}`];
  }
  if (name === 'RRULE') {
    const rule = String(value).replace(/^RRULE:/i, '');
    return [`RRULE:${rule}`];
  }
  return [`${name}:${escapeText(value)}`];
}

/**
 * Ersetzt die verwalteten Properties eines VEVENT in einem iCalendar-Objekt.
 *
 * Angefasst wird ausschließlich das VEVENT mit der passenden UID **ohne**
 * RECURRENCE-ID, also der Serien-Master bzw. der Einzeltermin. Ausnahme-Vorkommen
 * derselben UID (RECURRENCE-ID-Overrides) liegen in derselben Datei und bleiben
 * unberührt - sie tragen eigene Werte, die kein Master-Update überschreiben darf.
 *
 * @param {string} icsText  Originales Kalenderobjekt vom Server
 * @param {string} uid      UID des zu ändernden VEVENT
 * @param {object} fields   { SUMMARY, DESCRIPTION, LOCATION, DTSTART, DTEND, RRULE }
 *                          DTSTART/DTEND als { value, params }, Rest als String.
 *                          null entfernt die Property.
 * @returns {string|null}   Neues Objekt, oder null wenn kein passendes VEVENT existiert.
 */
export function patchICSEvent(icsText, uid, fields = {}) {
  const lines = unfoldICS(icsText).split('\n');

  // VEVENT-Blöcke abgrenzen
  const blocks = [];
  let current = null;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.toUpperCase() === 'BEGIN:VEVENT') {
      current = { start: index, end: -1 };
    } else if (trimmed.toUpperCase() === 'END:VEVENT' && current) {
      current.end = index;
      blocks.push(current);
      current = null;
    }
  });

  const target = blocks.find((block) => {
    let uidMatch = false;
    let isOverride = false;
    for (let i = block.start + 1; i < block.end; i++) {
      const name = propertyName(lines[i]);
      if (name === 'UID' && lines[i].slice(lines[i].indexOf(':') + 1).trim() === uid) uidMatch = true;
      if (name === 'RECURRENCE-ID') isOverride = true;
    }
    return uidMatch && !isOverride;
  });
  if (!target) return null;

  const replacements = new Map();
  for (const [name, value] of Object.entries(fields)) {
    const upper = name.toUpperCase();
    if (MANAGED.has(upper)) replacements.set(upper, buildLines(upper, value));
  }

  // Neue Properties müssen VOR die erste Subkomponente (typischerweise VALARM):
  // RFC 5545 ordnet einem VEVENT erst seine Properties, dann seine Alarme zu, und
  // strenge Parser weisen ein DESCRIPTION hinter END:VALARM zurück.
  let insertAt = target.end;
  for (let i = target.start + 1; i < target.end; i++) {
    if (lines[i].trim().toUpperCase().startsWith('BEGIN:')) { insertAt = i; break; }
  }

  const out = [];
  const written = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (i === insertAt) {
      // Was das Original nicht hatte, hier ergänzen.
      for (const [name, replacement] of replacements) {
        if (!written.has(name) && replacement.length) {
          out.push(...replacement);
          written.add(name);
        }
      }
      if (!written.has('SEQUENCE')) {
        out.push('SEQUENCE:1');
        written.add('SEQUENCE');
      }
    }

    const inTarget = i > target.start && i < target.end;
    if (!inTarget) {
      out.push(lines[i]);
      continue;
    }

    const name = propertyName(lines[i]);

    if (name === 'DTSTAMP') {
      out.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
      written.add('DTSTAMP');
      continue;
    }
    // SEQUENCE hochzählen: Clients erkennen daran, dass ihre Kopie veraltet ist.
    if (name === 'SEQUENCE') {
      const n = parseInt(lines[i].slice(lines[i].indexOf(':') + 1), 10);
      out.push(`SEQUENCE:${Number.isFinite(n) ? n + 1 : 1}`);
      written.add('SEQUENCE');
      continue;
    }

    if (replacements.has(name)) {
      // Erste Fundstelle ersetzen, weitere Duplikate fallen weg.
      if (!written.has(name)) {
        out.push(...replacements.get(name));
        written.add(name);
      }
      continue;
    }

    out.push(lines[i]);
  }

  return out.map(foldICSLine).join('\r\n');
}

/** Zählt die VEVENT-Blöcke eines Objekts (Master + Overrides). */
export function countVEvents(icsText) {
  const matches = unfoldICS(icsText).match(/^BEGIN:VEVENT\s*$/gim);
  return matches ? matches.length : 0;
}
