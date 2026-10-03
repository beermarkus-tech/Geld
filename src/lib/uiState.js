// "Everything back as I left it" (Oct 2026, Markus): the small amount of
// display state — current screen, year, filters, sort order, cursor, scroll,
// expanded rows/blocks, Quickview selection — kept in this device's browser
// storage (not synced; booked data and the ticked-off months stay in the
// database). Saved a moment after every change (and when the page is hidden),
// because a tablet never tells a web app that it is being closed.
//
// Safety rules (the restore must never be able to break the app):
//  * every storage access is wrapped — a failure means "no saved state";
//  * the saved blob is versioned and ignored when it doesn't match;
//  * a crash guard: when the app really crashes (a render error — the white
//    screen, caught by ErrorBoundary.jsx) it calls markCrashed(); the next
//    start then drops the saved state once and begins clean. (An earlier
//    version dropped the state after any reload within 5 s of a start, which
//    lost it whenever Markus pressed Ctrl+R a few times in a row.)
//  * writes are debounced and skipped when nothing changed.

const KEY = 'geld-ui-state'
const CRASH_KEY = 'geld-ui-crashed'
const VERSION = 1
const WRITE_DELAY_MS = 400

export function createUiState(storage, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const safe = {
    get: (k) => {
      try {
        return storage.getItem(k)
      } catch {
        return null
      }
    },
    set: (k, v) => {
      try {
        storage.setItem(k, v)
      } catch {
        /* quota / private mode — state just isn't remembered */
      }
    },
    remove: (k) => {
      try {
        storage.removeItem(k)
      } catch {
        /* ignore */
      }
    },
  }

  let state = {}
  const crashed = safe.get(CRASH_KEY) !== null
  if (crashed) {
    safe.remove(KEY)
    safe.remove(CRASH_KEY)
  } else {
    try {
      const parsed = JSON.parse(safe.get(KEY) ?? 'null')
      if (parsed && parsed.v === VERSION && typeof parsed === 'object') state = parsed
    } catch {
      state = {}
    }
  }

  let lastWritten = JSON.stringify(state)
  let timer = null
  function flush() {
    clearTimer(timer)
    timer = null
    const json = JSON.stringify({ ...state, v: VERSION })
    if (json === lastWritten) return
    lastWritten = json
    safe.set(KEY, json)
  }

  return {
    /** The value saved for `section.key` in the previous session, or `fallback`. */
    get(section, key, fallback = null) {
      const v = state?.[section]?.[key]
      return v === undefined ? fallback : v
    },
    /** Remember `value` for `section.key` (written shortly after the last change). */
    set(section, key, value) {
      const current = state[section]?.[key]
      if (JSON.stringify(current) === JSON.stringify(value)) return
      state = { ...state, [section]: { ...state[section], [key]: value } }
      if (timer === null) timer = setTimer(flush, WRITE_DELAY_MS)
    },
    flush,
    /** Call when the app crashed: the next start ignores the saved state (once). */
    markCrashed() {
      clearTimer(timer)
      timer = null
      safe.set(CRASH_KEY, String(Date.now()))
    },
    /** True when the previous run crashed (the saved state was dropped). */
    crashed,
  }
}

const ui = createUiState(typeof localStorage === 'undefined' ? { getItem: () => null, setItem() {}, removeItem() {} } : localStorage)

if (typeof document !== 'undefined') {
  // Closing, switching away or reloading: write at once.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') ui.flush()
  })
  window.addEventListener('pagehide', () => ui.flush())
}

export default ui
