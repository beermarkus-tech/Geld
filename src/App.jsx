import { useEffect, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'

import { auth } from './firebase'
import ImportScreen from './ImportScreen'
import Konten from './Konten'
import { waitForInitialAuthState } from './lib/authReady'

export default function App() {
  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [usingCachedSession, setUsingCachedSession] = useState(false)
  const [signInError, setSignInError] = useState(null)
  // No real nav shell yet (§1b.2 — that's a later phase). Konten is the
  // main screen now that Phase 1a's data is imported; the import screen
  // stays reachable (kept for later re-use, Markus's call) via this toggle
  // instead of always occupying the main content.
  const [view, setView] = useState('konten')

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
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <h1 className="text-lg font-semibold">Geld</h1>
        <div className="flex items-center gap-4">
          {/* Stopgap until §1b.2's real nav shell exists. Konten (build 27's
              actual deliverable) is the default; the import screen is kept
              reachable rather than deleted, per Markus's call, in case more
              data ever needs (re-)loading the same way. */}
          <button
            type="button"
            onClick={() => setView(view === 'konten' ? 'import' : 'konten')}
            className="text-sm text-[var(--color-text-muted)] underline"
          >
            {view === 'konten' ? 'Datenimport' : 'Zurück zu Konten'}
          </button>
          <button type="button" onClick={() => signOut(auth)} className="text-sm text-[var(--color-text-muted)]">
            Abmelden
          </button>
        </div>
      </header>

      {/* overflow-y-auto, not overflow-hidden: Konten's own content (the
          pinned panel especially, which stacks to four tall blocks on a
          narrow phone screen) can be taller than the viewport, and the page
          itself needs to be able to scroll to reach what's below it —
          overflow-hidden here previously trapped that content unreachably. */}
      <main className="flex flex-1 flex-col overflow-y-auto">
        {view === 'import' && (
          <div>
            <p className="px-6 pt-4 text-center text-sm text-[var(--color-text-muted)]">
              Angemeldet als {user.email}
              {usingCachedSession && ' (aus zwischengespeicherter Sitzung, noch nicht online bestätigt)'}
            </p>
            <ImportScreen />
          </div>
        )}
        {view === 'konten' && <Konten />}
      </main>
    </div>
  )
}
