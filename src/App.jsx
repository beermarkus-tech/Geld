import { useEffect, useRef, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'

import { auth } from './firebase'
import ImportExportScreen from './ImportExportScreen'
import Konten from './Konten'
import { AUTH_GIVE_UP_MS, waitForInitialAuthState } from './lib/authReady'
import { focusScreenCursor } from './lib/screenCursor'
import ui from './lib/uiState'
import { useValueWhileVisible } from './lib/useDeferWhileHidden'
import NavShell, { ALL_ITEMS } from './NavShell'
import PlaceholderScreen from './PlaceholderScreen'
import Aussenstaende from './Aussenstaende'
import Urlaube from './Urlaube'
import Planung from './Planung'
import Quickview from './Quickview'
import Settings from './Settings'
import TagsProvider from './TagsProvider'
import Verlauf from './Verlauf'

export default function App() {
  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [usingCachedSession, setUsingCachedSession] = useState(false)
  const [signInError, setSignInError] = useState(null)
  // The real nav shell (spec.md §1b.2), replacing the old flat Konten/
  // Datenimport/Sicherung toggle row — `view` is one of NavShell's own
  // item ids (`ALL_ITEMS`), not tied to a URL (§1b.1: one static page,
  // navigation handled entirely in React state).
  // Restored from the last session (lib/uiState.js; an unknown id falls back to Konten).
  const [view, setView] = useState(() => {
    const saved = ui.get('app', 'view')
    return ALL_ITEMS.some((i) => i.id === saved) ? saved : 'konten'
  })
  // The single global year selector (§1b.2a) — lives in the shell's own
  // header now, not inside Konten. `years` starts empty until Konten (the
  // one screen that currently loads transactions) reports up what it
  // actually has data for.
  // The saved year is checked against the years that really have data once
  // Konten has loaded them (Konten falls back to the latest year otherwise).
  const [year, setYear] = useState(() => ui.get('app', 'year'))
  const [years, setYears] = useState([])
  // Hidden screens keep their last year until shown (see useValueWhileVisible).
  const verlaufYear = useValueWhileVisible(year, view === 'verlauf')
  const planungYear = useValueWhileVisible(year, view === 'planung')
  const quickviewYear = useValueWhileVisible(year, view === 'quickview')
  // The cursor's last known position on each of these two grid screens
  // (Markus: "generally, save the cursor position both in konten and
  // verlauf, and place the cursor there again upon switching") — has to
  // live here, not in Konten/Verlauf's own state, since switching `view`
  // away conditionally unmounts whichever screen isn't active (below),
  // destroying any state/refs it held. Plain in-memory state (not
  // localStorage) is enough — this is about switching screens within one
  // session, not surviving a reload.
  const [kontenFocus, setKontenFocus] = useState(() => ui.get('konten', 'focus'))
  const [verlaufFocus, setVerlaufFocus] = useState(() => ui.get('verlauf', 'focus'))
  useEffect(() => ui.set('app', 'view', view), [view])
  useEffect(() => {
    if (year) ui.set('app', 'year', year)
  }, [year])
  useEffect(() => ui.set('konten', 'focus', kontenFocus), [kontenFocus])
  useEffect(() => ui.set('verlauf', 'focus', verlaufFocus), [verlaufFocus])
  // Quickview's jump into Konten (spec.md §3e): a fresh id per click, so
  // Konten applies each one exactly once.
  const [kontenJump, setKontenJump] = useState(null)
  const [quickviewPreset, setQuickviewPreset] = useState(null)
  // 'verlauf' while Quickview was opened from there — Esc then goes back.
  const [quickviewFrom, setQuickviewFrom] = useState(null)
  const openQuickview = ({ kind, id }) => {
    setQuickviewFrom('verlauf')
    setQuickviewPreset({ kind, targetId: id, id: Date.now() })
    setView('quickview')
  }
  const goBackToVerlauf = () => {
    setQuickviewFrom(null)
    setView('verlauf')
  }
  // The screen Konten was opened from ('quickview'/'aussenstaende') — Esc then goes back.
  const [kontenFrom, setKontenFrom] = useState(null)
  const openInKonten = (j) => {
    setKontenFrom(j.from ?? 'quickview')
    if (j.year) setYear(String(j.year)) // e.g. a booking opened from Settings › Tags
    setKontenJump({ ...j, id: Date.now() })
    setView('konten')
  }
  // Settings › Tags → a plan line in Verlauf (Oct 2026, Markus); Esc in
  // Verlauf then goes back to Settings (see the Esc handler below).
  const [verlaufJump, setVerlaufJump] = useState(null)
  const [verlaufFrom, setVerlaufFrom] = useState(null)
  const openInVerlauf = (j) => {
    setVerlaufFrom(j.from ?? 'settings')
    if (j.year) setYear(String(j.year))
    setVerlaufJump({ ...j, id: Date.now() })
    setView('verlauf')
  }
  const backRef = useRef(null)
  backRef.current = view === 'verlauf' && verlaufFrom ? verlaufFrom : null

  // Tab with nothing focused (right after switching screens or reloading)
  // puts the cursor on the active screen's remembered cell, or its first
  // visible one (Oct 2026, Markus) — so the mouse is never needed just to
  // place the cursor once. Only when real focus is on the page itself, never
  // while a modal is open or focus sits in a control, so ordinary tabbing
  // through controls is untouched. Screens register via lib/screenCursor.js.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return
      const a = document.activeElement
      if (a && a !== document.body && a !== document.documentElement) return
      if (document.querySelector('.fixed.inset-0')) return
      if (focusScreenCursor(view)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [view])

  // Esc in Konten goes back to Quickview/Außenstände when Konten was opened from there
  // (Oct 2026, Markus) — but never while Escape belongs to something else: an
  // open filter popup, a cell being edited, a modal, or a focused field.
  useEffect(() => {
    if (view !== 'konten' || !kontenFrom) return
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const a = document.activeElement
      if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return
      if (document.querySelector('.fixed.inset-0, .ag-popup, .ag-cell-inline-editing')) return
      e.preventDefault() // used up — no sidebar on this Esc
      setKontenFrom(null)
      setView(kontenFrom)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view, kontenFrom])

  // Esc with nothing left to close opens the sidebar on the active screen
  // (Oct 2026, Markus; NavShell.jsx handles the sidebar's own keys). "Nothing
  // left" is judged at the moment the key goes down — before any handler runs
  // — so the Esc that closes a modal, a popup, an editor or a field never also
  // opens the sidebar; and any handler that uses the key (going back to
  // Quickview/Verlauf, disarming a delete) marks it with preventDefault.
  useEffect(() => {
    let busy = false
    // A read-only field (Planung's comment cells while not being edited) is just a cell.
    const before = (e) => {
      if (e.key !== 'Escape') return
      const a = document.activeElement
      busy =
        Boolean(a && ((['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && !a.readOnly) || a.isContentEditable || a.closest?.('[data-sidebar]'))) ||
        Boolean(document.querySelector('.fixed.inset-0, .ag-popup, .ag-cell-inline-editing, [data-quick-filter]'))
    }
    const after = (e) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return
      const wasBusy = busy
      setTimeout(() => {
        if (wasBusy || e.defaultPrevented) return
        // A "back" step first (Verlauf opened from Settings › Tags).
        if (backRef.current) {
          const to = backRef.current
          setVerlaufFrom(null)
          setView(to)
          return
        }
        window.dispatchEvent(new Event('geld-open-nav'))
      }, 0)
    }
    window.addEventListener('keydown', before, true)
    window.addEventListener('keydown', after)
    return () => {
      window.removeEventListener('keydown', before, true)
      window.removeEventListener('keydown', after)
    }
  }, [])

  useEffect(() => {
    let active = true

    let giveUp = null
    waitForInitialAuthState().then(({ user: initialUser, timedOut }) => {
      if (!active) return
      // Timed out and still nobody: Firebase is just slow (the listener below
      // ends the wait when it answers) — keep "Lädt…" instead of flashing the
      // sign-in screen, and only offer it after AUTH_GIVE_UP_MS.
      if (timedOut && !initialUser) {
        giveUp = setTimeout(() => {
          if (!active) return
          setUser(null)
          setCheckingAuth(false)
        }, AUTH_GIVE_UP_MS)
        return
      }
      setUser(initialUser)
      setUsingCachedSession(timedOut)
      setCheckingAuth(false)
    })

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!active) return
      clearTimeout(giveUp)
      setUser(nextUser)
      setUsingCachedSession(false)
      setCheckingAuth(false)
    })

    return () => {
      active = false
      clearTimeout(giveUp)
      unsubscribe()
    }
  }, [])

  async function handleSignIn() {
    setSignInError(null)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (err) {
      setSignInError(err.message)
    }
  }

  if (checkingAuth) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[var(--color-text-muted)]">Lädt…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Geld</h1>
        <button
          type="button"
          onClick={handleSignIn}
          className="rounded-lg bg-[var(--color-computed)] px-5 py-2.5 font-medium text-white"
        >
          Mit Google anmelden
        </button>
        {signInError && <p className="text-sm text-[var(--color-alert)]">{signInError}</p>}
      </div>
    )
  }

  return (
    <TagsProvider>
      <NavShell
        activeView={view}
        onNavigate={(v) => {
          setQuickviewFrom(null)
          setKontenFrom(null)
          setVerlaufFrom(null)
          setView(v)
        }}
        year={year}
        years={years}
        onYearChange={setYear}
        userEmail={user.email}
        photoURL={user.photoURL}
        usingCachedSession={usingCachedSession}
        onSignOut={() => signOut(auth)}
        onLeaveNav={(id) => focusScreenCursor(id)}
      >
        {/* Konten and Verlauf both stay mounted permanently once first
            visited, hidden via plain CSS rather than conditionally rendered
            (Markus: "it seems like the tables are reconstructed every time i
            switch between screens — is this really necessary?"). It wasn't:
            conditionally rendering `{view === 'x' && <X />}` fully unmounts
            whichever screen isn't active, destroying every bit of local
            state/refs it held — including cursor position, which is exactly
            why that got its own elaborate initialFocus/onFocusChange
            plumbing in the first place, and why that plumbing still had
            real gaps (Markus: "saving the cursor position doesn't seem to
            work on all cells"). Keeping both mounted removes the need to
            reconstruct anything (a real, if modest, performance cost too —
            the whole categories×months grid was being rebuilt from scratch
            on every switch) and makes cursor/scroll persistence automatic
            and complete, for free, rather than something to keep patching
            case by case. `hidden` (Tailwind's `display: none`) rather than
            an unmount — AG Grid re-measures its own size via a ResizeObserver
            once its container becomes visible again, so nothing else needs
            to change for the grid to redraw correctly on switching back.
            Both mount immediately, right away, not lazily on first visit —
            simpler than tracking "has this screen ever been opened" for a
            cost (two grids' worth of Firestore listeners instead of one)
            this app's real scale doesn't need to avoid. The wrapper div
            itself needs `flex flex-1 flex-col min-h-0` while visible —
            NavShell's own `<main>` is a flex column, and Verlauf's internal
            layout (`flex-1 min-h-0` on its own root) depends on its direct
            parent actually being one; a plain wrapper div would otherwise
            silently break that. The existing initialFocus/onFocusChange
            props are left in place — harmless now (each screen only ever
            mounts once, so the seed effect fires once and onFocusChange
            keeps mirroring state that no longer needs mirroring for this
            purpose) rather than worth the risk of also ripping out this
            round. */}
        <div className={view === 'konten' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <Konten
            year={year}
            onYearChange={setYear}
            onYearsChange={setYears}
            initialFocus={kontenFocus}
            onFocusChange={setKontenFocus}
            active={view === 'konten'}
            jump={kontenJump}
          />
        </div>
        <div className={view === 'verlauf' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <Verlauf year={verlaufYear} initialFocus={verlaufFocus} onFocusChange={setVerlaufFocus} active={view === 'verlauf'} onOpenQuickview={openQuickview} jump={verlaufJump} />
        </div>
        {/* Planung (spec.md §3c) mounts once and is only hidden, like Konten and
            Verlauf above (Oct 2026, Markus: "planung is being recalculated
            every time i switch screens") — it keeps its state, scroll position
            and cursor cell, and never rebuilds its report on a screen switch. */}
        <div className={view === 'planung' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <Planung year={planungYear} active={view === 'planung'} />
        </div>
        {/* Quickview mounts once and is only hidden, like the screens above
            (Oct 2026, Markus), so its selection and scroll position stay. */}
        <div className={view === 'quickview' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <Quickview year={quickviewYear} onOpenInKonten={openInKonten} active={view === 'quickview'} preset={quickviewPreset}
            onBack={quickviewFrom === 'verlauf' ? goBackToVerlauf : null}
          />
        </div>
        {/* Mounted once, only hidden — like the other data screens (Oct 2026). */}
        <div className={view === 'aussenstaende' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <Aussenstaende onOpenInKonten={openInKonten} active={view === 'aussenstaende'} />
        </div>
        {/* Mounted once, only hidden — like Quickview (Oct 2026). */}
        <div className={view === 'urlaube' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
          <Urlaube onOpenInKonten={openInKonten} onOpenInVerlauf={openInVerlauf} active={view === 'urlaube'} />
        </div>
        {view === 'settings' && <Settings year={year} onOpenInKonten={openInKonten} onOpenInVerlauf={openInVerlauf} />}
        {view === 'importexport' && <ImportExportScreen userEmail={user.email} usingCachedSession={usingCachedSession} />}
        {/* Every other nav item (Dashboard,
            Monatsabschluss, Außenstände, Settings) isn't built yet —
            resolved Sept 2026 (Markus): a real nav entry exists for each
            from the start anyway, landing on a plain placeholder rather than
            being left out until its own phase ships. */}
        {!['konten', 'verlauf', 'planung', 'quickview', 'urlaube', 'aussenstaende', 'importexport', 'settings'].includes(view) && (
          <PlaceholderScreen title={ALL_ITEMS.find((i) => i.id === view)?.label ?? view} />
        )}
      </NavShell>
    </TagsProvider>
  )
}
