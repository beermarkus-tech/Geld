// Shared currency formatting — cents to a German-locale euro string, no
// currency sign (callers add "€" themselves where the layout calls for
// it). Pulled out of Konten.jsx (Sept 2026) once Verlauf needed the exact
// same formatting, rather than letting a second copy grow independently.
export function centsToEuro(cents) {
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
