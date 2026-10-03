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
//  * a crash guard: the app marks "restoring" at start and clears the mark
//    5 s later; if the mark is still there at the next start the previous run
//    died during/after a restore, so the saved state is dropped;
//  * writes are debounced and skipped when nothing changed.

const KEY = 'geld-ui-state'
const GUARD_KEY = 'geld-ui-restoring'
const VERSION = 1
const WRITE_DELAY_MS = 400
const GUARD_MS = 5000

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
  const crashed = safe.get(GUARD_KEY) !== null
  if (crashed) {
    safe.remove(KEY)
    safe.remove(GUARD_KEY)
  } else {
    try {
      const parsed = JSON.parse(safe.get(KEY) ?? 'null')
      if (parsed && parsed.v === VERSION && typeof parsed === 'object') state = parsed
    } catch {
      state = {}
    }
  }
  safe.set(GUARD_KEY, String(Date.now()))
  setTimer(() => safe.remove(GUARD_KEY), GUARD_MS)

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
    /** True when the previous run did not survive its restore (state was dropped). */
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
