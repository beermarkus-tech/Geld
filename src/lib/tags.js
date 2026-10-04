// The central tag lookups (PLAN.md Phase 5b, step 1 — Oct 2026, Markus: "only
// one central list that all sheets refer to"). TagsProvider.jsx holds the one
// live tag list and builds these once; every screen reads them through
// useTags() / useTagUsage() instead of keeping its own copy.

// Lookups over the tag list: `tagById` (plain object, the shape most screens
// use), `tagMap` (Map), and the one way of naming a tag on its own.
export function tagIndex(tags) {
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]))
  const tagMap = new Map(tags.map((t) => [t.id, t]))
  return { tags, tagById, tagMap }
}

// "Schottland: Hotels" for a child, the plain name for a top-level tag, the raw
// value for an id without a record (old plain-text tags). Used wherever a tag
// appears without its parent next to it; Verlauf (parent row + indented child)
// and Settings (tree) show the structure instead.
export function qualifiedName(id, tagById) {
  const t = tagById[id]
  if (!t) return id ?? ''
  const parent = t.parentTag ? tagById[t.parentTag] : null
  return parent ? `${parent.name}: ${t.name}` : t.name
}

// How much each tag is used — computed once for the whole app (Settings,
// Verlauf's pick lists; the same uses the unused-tag cleanup counts):
//   lines / deletedLines  booking lines carrying it (soft-deleted ones too:
//                         they can be restored, so they keep the tag alive)
//   planRows              budget documents (one per month) pointing at it
//   plans                 those grouped per year · plan version · category/allocation tag
//   bookings              the booking lines, for "where is it used"
//   yearSettings          year settings pointing at it
// Ids without a tag record (old plain-text tags) are included too.
// @returns {Map<string, {lines, deletedLines, planRows, plans, bookings, yearSettings}>}
export function tagUsage({ transactions = [], budgets = [], yearSettings = [] }) {
  const map = new Map()
  const at = (id) => {
    let e = map.get(id)
    if (!e) {
      e = { lines: 0, deletedLines: 0, planRows: 0, plans: [], bookings: [], yearSettings: 0, planByKey: new Map() }
      map.set(id, e)
    }
    return e
  }
  for (const tx of transactions)
    for (const l of tx.lines ?? [])
      for (const id of new Set(l.tags ?? [])) {
        const e = at(id)
        if (tx.deletedAt) e.deletedLines += 1
        else e.lines += 1
        // Details as in Konten: a split line's own detail, else the booking's.
        const details = ((tx.lines.length > 1 && l.note) || tx.detail || '').trim()
        e.bookings.push({ txId: tx.id, date: tx.date, label: tx.displayLabel, cents: l.amountCents ?? 0, details, deleted: Boolean(tx.deletedAt) })
      }
  for (const b of budgets) {
    if (!b.breakdownTagId || String(b.breakdownTagId).startsWith('lbl:')) continue // a plain-text label is no tag (lib/labels.js)
    const e = at(b.breakdownTagId)
    e.planRows += 1
    const targetId = b.categoryId ?? b.allocationTagId
    const key = `${b.year}|${b.planVersion}|${targetId}`
    let pl = e.planByKey.get(key)
    if (!pl) {
      pl = { key, year: b.year, planVersion: b.planVersion, targetKey: b.categoryId ? 'categoryId' : 'allocationTagId', targetId, months: 0, sum: 0 }
      e.planByKey.set(key, pl)
      e.plans.push(pl)
    }
    pl.months += 1
    pl.sum += b.plannedAmountCents ?? 0
  }
  for (const s of yearSettings) if (s.targetId) at(s.targetId).yearSettings += 1
  for (const e of map.values()) {
    delete e.planByKey
    e.plans.sort((a, b) => a.year - b.year || a.planVersion.localeCompare(b.planVersion))
    e.bookings.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }
  return map
}

export const EMPTY_USAGE = Object.freeze({ lines: 0, deletedLines: 0, planRows: 0, plans: [], bookings: [], yearSettings: 0 })

// "2 Buchungen · 1 Plan" — the short hint next to a tag in pick lists.
export function usageHint(usage = EMPTY_USAGE) {
  const n = usage.lines
  return `${n} ${n === 1 ? 'Buchung' : 'Buchungen'}${usage.plans.length > 0 ? ` · ${usage.plans.length} Plan` : ''}`
}
