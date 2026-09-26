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
