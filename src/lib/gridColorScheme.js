// AG Grid's own Theming API (Quartz, and every other built-in theme) ships
// light/dark params out of the box via its colorSchemeVariable part — but
// they're gated behind a `data-ag-theme-mode` attribute on <html>/<body>
// that AG Grid never sets itself, and nothing in this app was setting it
// either. The grid always rendered in its light-mode default regardless of
// the rest of the app correctly following system dark mode (index.css's
// own `prefers-color-scheme` media query) — illegible against a dark app
// shell (Markus, screenshot).
//
// Call once, as early as possible. Safe to call again from a later screen
// that also uses AG Grid (Verlauf, per spec.md §1b.3's shared grid engine)
// — idempotent, just adds one more no-op-if-unchanged listener.
export function syncAgGridColorScheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (isDark) => {
    document.documentElement.dataset.agThemeMode = isDark ? 'dark' : 'light'
  }
  apply(query.matches)
  query.addEventListener('change', (e) => apply(e.matches))
}
