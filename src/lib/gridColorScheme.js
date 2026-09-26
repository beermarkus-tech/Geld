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
//
// Tracks the same effective light/dark decision as index.css (system
// preference, unless the header's day/night button set an explicit
// override via theme.js's data-theme attribute on <html>) — read directly
// here rather than importing theme.js, and reacts to it via a
// 'geld-theme-change' event theme.js fires on every toggle.
export function syncAgGridColorScheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    document.documentElement.dataset.agThemeMode = effectiveDark() ? 'dark' : 'light'
  }
  apply()
  query.addEventListener('change', apply)
  window.addEventListener('geld-theme-change', apply)
}

function effectiveDark() {
  const override = document.documentElement.dataset.theme
  if (override === 'dark') return true
  if (override === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
