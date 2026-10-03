import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, onSnapshot, writeBatch } from 'firebase/firestore'

import { db } from './firebase'
import { planArchive, planFindOrCreate, planMove, planRename, planReplaceInBlock, planSetType } from './lib/tagActions'
import { planPlainTagConversion } from './lib/tagConvert'
import { planMerge } from './lib/tagMerge'
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
const ActionsContext = createContext(null)

export function useTags() {
  return useContext(TagsContext)
}
export function useTagUsage() {
  return useContext(UsageContext)
}
// The one set of tag actions (lib/tagActions.js has the rules):
//   findOrCreate(text, groupingType) → tag id, at once ("Parent:Child" works;
//                                      an existing tag is reused)
//   rename(id, name)                 → { ok } or { ok: false, reason }
//   setType(id, groupingType)
//   move(id, newParentId | null)     → { ok } or { ok: false, reason }
//   setArchived(id, bool)           — the whole family
//   merge(fromId, intoId)            → { ok, done } or { ok: false, reason }
//   previewPlainTags(receivableIds) / convertPlainTags(receivableIds) → old plain-text tags → records
//   replaceInBlock({ year, targetKey, targetId, planVersion, oldTagId,
//                    isHeader, lineTagIds, newTagId })
//                                    → { focusRowId, done: Promise }
export function useTagActions() {
  return useContext(ActionsContext)
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
      listen('cellComments', 'cellComments'),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const tagsValue = useMemo(() => ({ ...tagIndex(data.tags ?? []), loaded: Boolean(data.tags) }), [data.tags])
  const usage = useMemo(
    () => tagUsage({ transactions: data.transactions, budgets: data.budgets, yearSettings: data.yearSettings }),
    [data.transactions, data.budgets, data.yearSettings],
  )
  const all = (...keys) => keys.every((k) => confirmed[k] && data[k])

  // Latest data for the actions (kept stable, so screens' callbacks don't
  // change), plus tags written a moment ago whose snapshot hasn't arrived yet —
  // so two quick creates can't pick the same id.
  const latest = useRef({ data, pending: new Map() })
  latest.current.data = data
  for (const t of data.tags ?? []) latest.current.pending.delete(t.id)
  const actions = useMemo(() => {
    const currentTags = () => {
      const { data: d, pending } = latest.current
      const list = d.tags ?? []
      return pending.size ? [...list, ...[...pending.values()].filter((p) => !list.some((t) => t.id === p.id))] : list
    }
    const write = (sets, deletes = []) => {
      const ops = [...sets.map((w) => ['set', w]), ...deletes.map((w) => ['delete', w])]
      const commits = []
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db)
        for (const [kind, w] of ops.slice(i, i + 400)) {
          if (kind === 'set') batch.set(doc(db, w.col, w.id), w.data)
          else batch.delete(doc(db, w.col, w.id))
        }
        commits.push(batch.commit())
      }
      return Promise.all(commits)
    }
    const remember = (docs) => docs.forEach((d) => latest.current.pending.set(d.id, d))
    return {
      findOrCreate(text, groupingType = null) {
        const { tagId, creates } = planFindOrCreate(currentTags(), text, groupingType)
        if (creates.length) {
          remember(creates)
          write(creates.map((d) => ({ col: 'tags', id: d.id, data: d })))
        }
        return tagId
      },
      rename(tagId, name) {
        const r = planRename(currentTags(), tagId, name)
        if (r.ok) write([{ col: 'tags', id: tagId, data: r.doc }])
        return r
      },
      move(tagId, newParentId) {
        const r = planMove(currentTags(), tagId, newParentId)
        if (r.ok) write([{ col: 'tags', id: tagId, data: r.doc }])
        return r
      },
      // Merge one tag into another (lib/tagMerge.js) → { ok, done } or { ok: false, reason }.
      merge(fromId, intoId) {
        const d = latest.current.data
        const r = planMerge(currentTags(), fromId, intoId, { transactions: d.transactions ?? [], budgets: d.budgets ?? [], cellComments: d.cellComments ?? [] })
        if (!r.ok) return r
        return { ok: true, done: write(r.sets, r.deletes) }
      },
      setArchived(tagId, archived) {
        const docs = planArchive(currentTags(), tagId, archived)
        if (docs.length) write(docs.map((d) => ({ col: 'tags', id: d.id, data: d })))
      },
      setType(tagId, groupingType) {
        const docs = planSetType(currentTags(), tagId, groupingType)
        if (docs.length) write(docs.map((d) => ({ col: 'tags', id: d.id, data: d })))
      },
      // Step 6 of Phase 5b: every old plain-text tag gets a record (lib/tagConvert.js).
      previewPlainTags(receivableIds) {
        const d = latest.current.data
        return planPlainTagConversion({ tags: currentTags(), transactions: d.transactions ?? [], receivableIds })
      },
      convertPlainTags(receivableIds) {
        const d = latest.current.data
        const plan = planPlainTagConversion({ tags: currentTags(), transactions: d.transactions ?? [], receivableIds })
        remember(plan.creates)
        return write([...plan.creates.map((t) => ({ col: 'tags', id: t.id, data: t })), ...plan.rewrites.map((tx) => ({ col: 'transactions', id: tx.id, data: tx }))])
      },
      replaceInBlock(params) {
        const d = latest.current.data
        const plan = planReplaceInBlock({ ...params, tags: currentTags(), budgets: d.budgets ?? [], cellComments: d.cellComments ?? [] })
        remember(plan.creates)
        return { focusRowId: plan.focusRowId, done: write(plan.sets, plan.deletes) }
      },
    }
  }, [])

  // The old flat "Reisekostenart" type (claim-category) was replaced by
  // Dienstreise (Oct 2026, Markus: "leave them, I'll redo"): tags still typed
  // with it lose that type — once, as soon as the server has confirmed the tags.
  useEffect(() => {
    if (!confirmed.tags || !data.tags) return
    const old = data.tags.filter((t) => t.groupingType === 'claim-category')
    if (old.length === 0) return
    const batch = writeBatch(db)
    old.forEach((t) => batch.set(doc(db, 'tags', t.id), { ...t, groupingType: null }))
    batch.commit().catch(() => {})
  }, [confirmed.tags, data.tags])

  return (
    <TagsContext.Provider value={tagsValue}>
      <ActionsContext.Provider value={actions}>
        <UsageContext.Provider value={usage}>
          <TagCleanup
            tags={all('tags') ? data.tags : null}
            transactions={all('transactions') ? data.transactions : null}
            budgets={all('budgets') ? data.budgets : null}
            yearSettings={all('yearSettings') ? data.yearSettings : null}
          />
          {children}
        </UsageContext.Provider>
      </ActionsContext.Provider>
    </TagsContext.Provider>
  )
}
