// Tags nothing refers to any more (Oct 2026, Markus: "auto remove tags that
// are not in use anywhere"). A tag is in use when any booking line — soft-
// deleted ones included, they can be restored — carries it, a budget
// breakdown line points at it, or a kept tag is its child (a parent stays as
// long as a child does). Allocation tags are fixed structure (spec §2.5) and
// never removed. A tag created within `graceMs` is left alone: it is created
// first and applied to its line a moment later.
//
// @returns {string[]} ids of the tags to delete
export function unusedTagIds({ tags, transactions, budgets = [], yearSettings = [], now = Date.now(), graceMs = 24 * 60 * 60 * 1000 }) {
  const used = new Set()
  for (const tx of transactions) for (const line of tx.lines ?? []) for (const id of line.tags ?? []) used.add(id)
  for (const b of budgets) if (b.breakdownTagId) used.add(b.breakdownTagId)
  for (const s of yearSettings) if (s.targetId) used.add(s.targetId)
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  // A kept child keeps its parent (repeat: parents can be nested).
  for (let changed = true; changed; ) {
    changed = false
    for (const id of used) {
      const parent = byId[id]?.parentTag
      if (parent && !used.has(parent)) {
        used.add(parent)
        changed = true
      }
    }
  }
  return tags
    .filter((t) => t.class !== 'allocation' && !used.has(t.id) && !(t.createdAt && now - t.createdAt < graceMs))
    .map((t) => t.id)
}
