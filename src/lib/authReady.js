import { onAuthStateChanged } from 'firebase/auth'

import { auth } from '../firebase'

const AUTH_INIT_TIMEOUT_MS = 4000

// When that first wait times out with no user yet, the sign-in screen is not
// shown straight away (Oct 2026, Markus: "sometimes the sign-in to Google
// screen appears" on a slow start — the stalled Firebase restore finished a
// moment later and the app came up). The "Lädt…" screen stays until Firebase
// answers, and only after this long is the sign-in button offered.
export const AUTH_GIVE_UP_MS = 30000

// Firebase Auth's own init can silently stall a cold start for 30-90+
// seconds on a flaky or offline connection (its own network calls: a
// redirect-helper iframe, re-validating a restored session) before the
// first onAuthStateChanged callback ever fires. Bounding it means the app
// can render its cached/offline state instead of an indefinite blank
// screen (spec.md §1a).
export function waitForInitialAuthState() {
  return new Promise((resolve) => {
    let settled = false

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve({ user, timedOut: false })
    })

    setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve({ user: auth.currentUser, timedOut: true })
    }, AUTH_INIT_TIMEOUT_MS)
  })
}
