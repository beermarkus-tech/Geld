// Shared currency formatting — cents to a German-locale euro string, no
// currency sign (callers add "€" themselves where the layout calls for
// it). Pulled out of Konten.jsx (Sept 2026) once Verlauf needed the exact
// same formatting, rather than letting a second copy grow independently.
export function centsToEuro(cents) {
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Whole-euro rounding (Verlauf, Sept 2026, Markus: "round all values to
// full euros") — a display-only rounding for a screen full of budget/plan
// figures where cent precision isn't the point; never used for anything
// that writes back to Firestore, where cents stay exact (§2.1).
export function centsToWholeEuro(cents) {
  return Math.round(cents / 100).toLocaleString('de-DE')
}

// Parses a whole-euro input's typed text back into cents (Verlauf's
// Plan0/Plan1 month cells, Planung's Puffer — moved here Sept 2026 once
// both needed it) — mirrors
// Konten.jsx's own parseEuroInput, but for whole euros only (matching this
// screen's own display rounding, §3b) and treating a cleared cell as 0
// (Verlauf's "0 shows blank" convention runs the other way at display
// time; an edit clearing the box should mean "plan 0 for this month," not
// reject the edit). Strips German thousands-grouping dots first (the edit
// box is pre-filled from centsToWholeEuro's own de-DE formatting, e.g.
// "8.000") — without this, committing an untouched large value back
// unchanged would silently reinterpret "8.000" as 8 (JS parses a bare
// "8.000" as the number 8).
export function parseWholeEuroInput(s) {
  const cleaned = String(s).trim().replace(/[€\s]/g, '')
  if (cleaned === '') return 0
  if (cleaned === '-') return null
  const normalized = cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  const f = Number(normalized)
  return Number.isNaN(f) ? null : Math.round(f) * 100
}
