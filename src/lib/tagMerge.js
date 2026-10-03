// Merging duplicate tags (Oct 2026, Markus: "we have two sets of tags under
// the same parent: one in konten and one in verlauf"). The migration created
// the Verlauf breakdown tags separately from the booking tags, so the same
// name can exist twice under one parent (or twice at top level). Two grouping
// tags with the same parent and the same name (ignoring case and outer
// spaces) are one tag: the one used by more booking lines survives (ties: the
// older, then the smaller id), and everything pointing at the other is
// rewritten to it.

const keyOf = (t) => `${t.parentTag ?? ''}|${String(t.name ?? '').trim().toLowerCase()}`

// @returns {Map<string, string>} duplicate tag id → surviving tag id
export function duplicateTagMap(tags, transactions) {
  const uses = new Map()
  for (const tx of transactions) for (const l of tx.lines ?? []) for (const id of l.tags ?? []) uses.set(id, (uses.get(id) ?? 0) + 1)
  const groups = new Map()
  for (const t of tags) {
    if (t.class !== 'grouping' || !String(t.name ?? '').trim()) continue
    const k = keyOf(t)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  }
  const map = new Map()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const [keep, ...rest] = [...list].sort(
      (a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id),
    )
    for (const t of rest) map.set(t.id, keep.id)
  }
  return map
}

const budgetId = (b, tagId) => `b-${b.year}-${b.planVersion}-${b.categoryId ?? b.allocationTagId}-${tagId ?? 'top'}-${String(b.month).padStart(2, '0')}`

// The writes that carry out `map`.
// @returns {{ sets: {col: string, id: string, data: object}[], deletes: {col: string, id: string}[] }}
export function tagMergeWrites(map, { tags, transactions, budgets = [], cellComments = [] }) {
  const sets = []
  const deletes = []
  const to = (id) => map.get(id) ?? id

  for (const tx of transactions) {
    if (!(tx.lines ?? []).some((l) => (l.tags ?? []).some((id) => map.has(id)))) continue
    const lines = tx.lines.map((l) => ({ ...l, tags: [...new Set((l.tags ?? []).map(to))] }))
    sets.push({ col: 'transactions', id: tx.id, data: { ...tx, lines } })
  }

  // A budget row of the duplicate moves to the survivor's row; when the
  // survivor already has a value for that month (both were lines in the same
  // block), the two are added up and their notes joined.
  const byId = new Map(budgets.map((b) => [b.id, b]))
  const moved = new Map()
  for (const b of budgets) {
    if (!map.has(b.breakdownTagId)) continue
    const id = budgetId(b, to(b.breakdownTagId))
    const base = moved.get(id) ?? (byId.has(id) && !map.has(byId.get(id).breakdownTagId) ? byId.get(id) : null)
    const note = [base?.note, b.note].filter(Boolean).join(' / ')
    moved.set(id, base ? { ...base, plannedAmountCents: (base.plannedAmountCents ?? 0) + (b.plannedAmountCents ?? 0), note } : { ...b, id, breakdownTagId: to(b.breakdownTagId) })
    deletes.push({ col: 'budgets', id: b.id })
  }
  for (const [id, data] of moved) sets.push({ col: 'budgets', id, data })

  // Verlauf cell comments are keyed by row ids that contain the tag id.
  const commentIds = new Set(cellComments.map((c) => c.id))
  const movedComments = new Map()
  for (const c of cellComments) {
    const parts = String(c.rowId).split(':')
    if (!parts.some((p) => map.has(p))) continue
    const rowId = parts.map(to).join(':')
    const id = `${c.year}__${rowId}__${c.colId}`
    const existing = movedComments.get(id) ?? (commentIds.has(id) ? cellComments.find((x) => x.id === id) : null)
    movedComments.set(id, existing ? { ...existing, text: `${existing.text}\n${c.text}` } : { ...c, id, rowId })
    deletes.push({ col: 'cellComments', id: c.id })
  }
  for (const [id, data] of movedComments) sets.push({ col: 'cellComments', id, data })

  for (const t of tags) {
    if (map.has(t.id)) {
      deletes.push({ col: 'tags', id: t.id })
      continue
    }
    const children = t.parentTag && map.has(t.parentTag)
    const survivorTypeless = [...map].some(([from, keep]) => keep === t.id && !t.groupingType && tags.find((x) => x.id === from)?.groupingType)
    if (children || survivorTypeless) {
      const typed = survivorTypeless ? tags.find((x) => map.get(x.id) === t.id && x.groupingType)?.groupingType : t.groupingType
      sets.push({ col: 'tags', id: t.id, data: { ...t, parentTag: to(t.parentTag ?? null) ?? null, groupingType: typed ?? null } })
    }
  }
  return { sets, deletes }
}
