import { useEffect, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'

import { auth } from './firebase'
import ImportExportScreen from './ImportExportScreen'
import Konten from './Konten'
import { waitForInitialAuthState } from './lib/authReady'
import NavShell, { ALL_ITEMS } from './NavShell'
import PlaceholderScreen from './PlaceholderScreen'
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
  const [view, setView] = useState('konten')
  // The single global year selector (§1b.2a) — lives in the shell's own
  // header now, not inside Konten. `years` starts empty until Konten (the
  // one screen that currently loads transactions) reports up what it
  // actually has data for.
  const [year, setYear] = useState(null)
  const [years, setYears] = useState([])

  useEffect(() => {
    let active = true

    waitForInitialAuthState().then(({ user: initialUser, timedOut }) => {
      if (!active) return
      setUser(initialUser)
      setUsingCachedSession(timedOut)
      setCheckingAuth(false)
    })

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!active) return
      setUser(nextUser)
      setUsingCachedSession(false)
      setCheckingAuth(false)
    })

    return () => {
      active = false
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
    <NavShell
      activeView={view}
      onNavigate={setView}
      year={year}
      years={years}
      onYearChange={setYear}
      userEmail={user.email}
      usingCachedSession={usingCachedSession}
      onSignOut={() => signOut(auth)}
    >
      {view === 'konten' && <Konten year={year} onYearChange={setYear} onYearsChange={setYears} />}
      {view === 'verlauf' && <Verlauf year={year} />}
      {view === 'importexport' && <ImportExportScreen userEmail={user.email} usingCachedSession={usingCachedSession} />}
      {/* Every other nav item (Dashboard, Planung, Quickview, Fortschritt,
          Monatsabschluss, Außenstände, Settings) isn't built yet —
          resolved Sept 2026 (Markus): a real nav entry exists for each
          from the start anyway, landing on a plain placeholder rather than
          being left out until its own phase ships. */}
      {!['konten', 'verlauf', 'importexport'].includes(view) && (
        <PlaceholderScreen title={ALL_ITEMS.find((i) => i.id === view)?.label ?? view} />
      )}
    </NavShell>
  )
}
