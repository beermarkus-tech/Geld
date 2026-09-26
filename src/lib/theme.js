// Manual light/dark override (Sept 2026, Markus: a day/night button in the
// header's top-right) — layered on top of the system-preference default
// that index.css's `prefers-color-scheme` media query already provides.
// `null` means "follow system"; toggling always picks an explicit value
// from here on, the same persist-past-first-change pattern already used by
// NavShell's sidebarCollapsed and Verlauf's showPlan0.
const THEME_KEY = 'geld-theme'

export function readTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function writeTheme(theme) {
  try {
    if (theme) localStorage.setItem(THEME_KEY, theme)
    else localStorage.removeItem(THEME_KEY)
  } catch {
    // Worst case the override doesn't survive a reload — not worth blocking on.
  }
}

export function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function effectiveDark(theme = readTheme()) {
  return theme ? theme === 'dark' : systemPrefersDark()
}

// Sets <html data-theme>, which index.css's :root[data-theme="dark"] and
// :not([data-theme]) selectors key off, and fires a change event so
// gridColorScheme.js's separate AG Grid sync (which needs the same
// effective light/dark decision but can't import a React-facing module
// without a cycle) can react too.
export function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme
  else delete document.documentElement.dataset.theme
  window.dispatchEvent(new CustomEvent('geld-theme-change'))
}

export function toggleTheme() {
  const next = effectiveDark() ? 'light' : 'dark'
  writeTheme(next)
  applyTheme(next)
  return next
}

// Call once at startup, before React mounts, so a previously-chosen
// override takes effect immediately rather than flashing the system default.
export function initTheme() {
  applyTheme(readTheme())
}
