import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { db } from './firebase'
import { EMPTY_USAGE, tagIndex, tagUsage } from './lib/tags'
import TagCleanup from './TagCleanup'

// The one central tag list (PLAN.md Phase 5b, step 1 — Oct 2026, Markus:
// "only one central list that all sheets refer to"). Loaded once for the whole
// app; every screen reads it with useTags(), and how much each tag is used
// with useTagUsage(), instead of keeping its own copy — a change made on any
// screen is the same change everywhere. Also runs the unused-tag cleanup
// (TagCleanup.jsx) on the same data.
//
// Two contexts on purpose: most screens only need the tags, and should not
// redraw on every booking change just because usage counts moved.

const TagsContext = createContext({ tags: [], tagById: {}, tagMap: new Map(), loaded: false })
const UsageContext = createContext(new Map())

export function useTags() {
  return useContext(TagsContext)
}
export function useTagUsage() {
  return useContext(UsageContext)
}
export function usageOf(usage, id) {
  return usage.get(id) ?? EMPTY_USAGE
}

export default function TagsProvider({ children }) {
  // Each collection with whether the server has confirmed it (the offline
  // cache can be incomplete — the cleanup only acts on confirmed data).
  const [data, setData] = useState({})
  const [confirmed, setConfirmed] = useState({})

  useEffect(() => {
    const seen = new Set()
    const listen = (name, key) =>
      onSnapshot(collection(db, name), { includeMetadataChanges: true }, (snap) => {
        const fromServer = !snap.metadata.fromCache
        setConfirmed((c) => (c[key] === fromServer ? c : { ...c, [key]: fromServer }))
        // A metadata-only event (e.g. "now confirmed by the server") changes no
        // document — keep the same array so nothing recomputes for it.
        const changed = typeof snap.docChanges === 'function' ? snap.docChanges().length > 0 : true
        if (changed || !seen.has(key)) setData((d) => ({ ...d, [key]: snap.docs.map((x) => x.data()) }))
        seen.add(key)
      })
    const unsubs = [
      listen('tags', 'tags'),
      listen('transactions', 'transactions'),
      listen('budgets', 'budgets'),
      listen('categoryYearSettings', 'yearSettings'),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const tagsValue = useMemo(() => ({ ...tagIndex(data.tags ?? []), loaded: Boolean(data.tags) }), [data.tags])
  const usage = useMemo(
    () => tagUsage({ transactions: data.transactions, budgets: data.budgets, yearSettings: data.yearSettings }),
    [data.transactions, data.budgets, data.yearSettings],
  )
  const all = (...keys) => keys.every((k) => confirmed[k] && data[k])

  return (
    <TagsContext.Provider value={tagsValue}>
      <UsageContext.Provider value={usage}>
        <TagCleanup
          tags={all('tags') ? data.tags : null}
          transactions={all('transactions') ? data.transactions : null}
          budgets={all('budgets') ? data.budgets : null}
          yearSettings={all('yearSettings') ? data.yearSettings : null}
        />
        {children}
      </UsageContext.Provider>
    </TagsContext.Provider>
  )
}
