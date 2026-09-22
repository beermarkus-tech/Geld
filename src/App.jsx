import { useEffect, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'

import { auth } from './firebase'
import { waitForInitialAuthState } from './lib/authReady'

export default function App() {
  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [usingCachedSession, setUsingCachedSession] = useState(false)
  const [signInError, setSignInError] = useState(null)

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
        <button
          type="button"
          onClick={() => signOut(auth)}
          className="text-sm text-[var(--color-text-muted)]"
        >
          Abmelden
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[var(--color-text-muted)]">
          Angemeldet als {user.email}
          {usingCachedSession && ' (aus zwischengespeicherter Sitzung, noch nicht online bestätigt)'}
        </p>
      </main>
    </div>
  )
}
