// Fixed display order for categories and allocation tags — shared by
// Verlauf (§3b) and Planung (§3c) so both screens list rows in exactly the
// same order. Pulled out of Verlauf.jsx (Sept 2026) once Planung needed the
// same lists, rather than letting a second copy drift.

// Category groups in the Gsheet's own order: Einnahmen first, then every
// expense group.
export const GROUP_ORDER = ['Einnahmen', 'Wohnen', 'Kommunikation', 'Mobilität', 'Lebenshaltung', 'Gesundheit', 'Hobbys', 'Sonstiges']

// Fixed subcategory order within each group (spec.md §3b, Sept 2026,
// Markus's own literal list — not alphabetical, an earlier, now-corrected
// assumption). "Erstattungen" is deliberately absent — see spec.md §2.4's
// own note on why it's filtered out everywhere, not just here.
export const SUBCAT_ORDER = [
  'Gehalt Markus', 'Gehalt Julia', 'Sonderzahlungen', 'Kindergeld', 'Sonstige Einnahmen',
  'Hauskredit', 'Nebenkosten', 'Instandhaltung', 'Einrichtung', 'Garten',
  'Internet', 'Fernsehen', 'Telefon',
  'Firmenwagen', 'Autoversicherung', 'Wartung', 'Tanken', 'Gebühren',
  'Lebensmittel & Haushalt', 'Kantine', 'Ausgehen', 'Klamotten Markus', 'Klamotten Julia', 'Klamotten Sophia',
  'Ausstattung Sophia', 'Allgemein', 'Haustiere', 'Versicherungen',
  'Medizin', 'Arztkosten', 'Krankenkasse',
  'Hobbys Julia', 'Hobbys Markus', 'Hobbys Sophia',
  'Urlaube', 'Geschenke', 'Sonderausgaben', 'Steuerausgaben', 'Rente', 'Sonstige Ausgaben',
]

// A category not in SUBCAT_ORDER is filtered out entirely, not shown at an
// arbitrary position — "Erstattungen" (spec.md §2.4) is the deliberate
// case today, but this also means a genuinely new category silently has
// no home here until someone adds it to the list above, rather than
// popping up in a random spot.
export function isKnownSubcat(name) {
  return SUBCAT_ORDER.includes(name)
}

// Same reasoning for the Rücklagen section's own fixed order (spec.md
// §2.5/§3b's own listing) — alphabetical would scramble Sparen Familie/
// Sophia/Julia away from each other.
export const ALLOCATION_TAG_ORDER = [
  'sparen-familie',
  'sparen-sophia',
  'sparen-julia',
  'anlage-familie',
  'anlage-sophia',
  'ruecklagen-steuern',
  'tagesgeld',
]
