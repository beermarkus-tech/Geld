// Merging one tag into another (Oct 2026, Markus — Settings › Tags, e.g. the
// import's same-name twins). Everything pointing at the merged tag is
// rewritten to the one it is merged into, then the merged tag is deleted:
//   - booking lines (a line never carries the same tag twice);
//   - Verlauf plan rows — a month both tags had in the same block (both were
//     lines there) is added up, notes joined;
//   - Verlauf cell comments of those rows;
//   - its child tags move under the kept tag;
//   - the kept tag takes the merged one's type if it has none.

const budgetId = (b, tagId) => `b-${b.year}-${b.planVersion}-${b.categoryId ?? b.allocationTagId}-${tagId ?? 'top'}-${String(b.month).padStart(2, '0')}`

// The writes that carry out `map` (merged id → kept id).
// @returns {{ sets: {col: string, id: string, data: object}[], deletes: {col: string, id: string}[] }}
function tagMergeWrites(map, { tags, transactions, budgets = [], cellComments = [] }) {
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

// Merge `fromId` into `intoId`. Refused: the same tag, allocation tags, a tag
// with children into a child (tags are one level deep), a parent into its own
// child.
// @returns {{ ok: true, sets, deletes } | { ok: false, reason: 'same'|'missing'|'locked'|'has-children'|'into-child' }}
export function planMerge(tags, fromId, intoId, data) {
  if (fromId === intoId) return { ok: false, reason: 'same' }
  const from = tags.find((t) => t.id === fromId)
  const into = tags.find((t) => t.id === intoId)
  if (!from || !into) return { ok: false, reason: 'missing' }
  if (from.class !== 'grouping' || into.class !== 'grouping') return { ok: false, reason: 'locked' }
  if (into.parentTag === fromId) return { ok: false, reason: 'into-child' }
  if (into.parentTag && tags.some((t) => t.parentTag === fromId)) return { ok: false, reason: 'has-children' }
  return { ok: true, ...tagMergeWrites(new Map([[fromId, intoId]]), { tags, ...data }) }
}

export const MERGE_MESSAGES = {
  'into-child': 'Ein Tag kann nicht in seinen eigenen Untertag übernommen werden.',
  'has-children': 'Dieser Tag hat Untertags — er kann nur in einen Tag ohne Übergruppe übernommen werden.',
  locked: 'Feste Rücklagen-Tags lassen sich nicht zusammenführen.',
}
