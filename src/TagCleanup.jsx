import { useEffect, useState } from 'react'
import { doc, writeBatch } from 'firebase/firestore'

import { db } from './firebase'
import { unusedTagIds } from './lib/unusedTags'

const GRACE_MS = 10 * 60 * 1000

// Removes tags nothing refers to any more (Oct 2026, Markus; lib/unusedTags.js
// has the rules). Runs in the background for the whole app (renders nothing),
// with live bookings, tags, budgets and year settings from TagsProvider.jsx
// (each null until the server has confirmed it — the offline cache can be
// incomplete) — so a tag freed in Verlauf goes too, not only one freed in
// Konten. It acts 5 s after the last change, and again when a new tag's
// 10-minute grace period runs out.
export default function TagCleanup({ tags, transactions, budgets, yearSettings }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // Only with everything loaded (and real bookings): otherwise every tag would look unused.
    if (!tags || !transactions || !budgets || !yearSettings || transactions.length === 0) return
    const now = Date.now()
    const ids = unusedTagIds({ tags, transactions, budgets, yearSettings, now, graceMs: GRACE_MS })
    const timers = []
    if (ids.length > 0) {
      timers.push(
        setTimeout(async () => {
          try {
            for (let i = 0; i < ids.length; i += 400) {
              const batch = writeBatch(db)
              ids.slice(i, i + 400).forEach((id) => batch.delete(doc(db, 'tags', id)))
              await batch.commit()
            }
          } catch {
            // best effort — tried again on the next change
          }
        }, 5000),
      )
    }
    // Unused but still within the grace period: look again once it ends.
    const waiting = unusedTagIds({ tags, transactions, budgets, yearSettings, now, graceMs: 0 }).filter((id) => !ids.includes(id))
    if (waiting.length > 0) {
      const byId = new Map(tags.map((t) => [t.id, t]))
      const next = Math.min(...waiting.map((id) => byId.get(id)?.createdAt ?? now)) + GRACE_MS + 1000
      timers.push(setTimeout(() => setTick((n) => n + 1), Math.max(1000, next - now)))
    }
    return () => timers.forEach(clearTimeout)
  }, [tags, transactions, budgets, yearSettings, tick])

  return null
}
