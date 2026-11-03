import { CLAIM_TYPES } from './tagTypes'

// "Needs an entry" (Nov 2026, Markus): a cell that must still be filled is shown bright yellow.
// Derived live from the booking – nothing is stored, so the signal vanishes by itself once the
// entry is made. Each rule below is one small, independent check; a new case is a new rule here.
//
// A rule gets one booking line plus the context and returns the id(s) of the column(s) that are missing
// (a string, an array, or null). Columns use Konten's colIds ('tags', 'kategorie', 'unterkategorie', …).

/** A tag that can serve as a claim/loan tag: not an allocation tag, not typed as something else. */
export function isClaimLike(tag) {
  if (!tag) return true // an old free-text value still counts as "something was entered"
  if (tag.class === 'allocation') return false
  return !tag.groupingType || CLAIM_TYPES.has(tag.groupingType)
}

/** The lines of a booking; a booking without any line yet (a blank new row) counts as one empty line. */
export const linesOf = (tx) => ((tx.lines ?? []).length ? tx.lines : [{ tags: [], categoryId: null }])

export const NEEDS_ENTRY_RULES = [
  {
    id: 'category',
    label: 'Buchung ohne Kategorie (alles außer Überweisungen zwischen zwei Konten)',
    // Anything that is not a transfer (both accounts set) must be categorized.
    check: (tx, line) => (tx.fromAccountId && tx.toAccountId) || line.categoryId ? null : ['kategorie', 'unterkategorie'],
  },
  {
    id: 'claim-tag',
    label: 'Außenstände-Buchung ohne Forderungs-Tag',
    // A line of a booking on a receivable account (Außenstände, CPAM, Reisekosten …) with no claim tag.
    check: (tx, line, ctx) => {
      const touches = ctx.receivableIds.has(tx.fromAccountId) || ctx.receivableIds.has(tx.toAccountId)
      if (!touches) return null
      return (line.tags ?? []).some((id) => isClaimLike(ctx.tagById[id])) ? null : 'tags'
    },
  },
]

/** The column ids still missing an entry on one line of a booking. */
export function missingColumns(tx, line, ctx) {
  if (!tx || tx.deletedAt) return new Set()
  const cols = new Set()
  for (const rule of NEEDS_ENTRY_RULES) {
    const found = rule.check(tx, line, ctx)
    for (const col of [found].flat()) if (col) cols.add(col)
  }
  return cols
}

/** Ids of all bookings with at least one line missing an entry. */
export function bookingsNeedingEntry(transactions, ctx) {
  return transactions
    .filter((tx) => !tx.deletedAt && linesOf(tx).some((line) => missingColumns(tx, line, ctx).size > 0))
    .map((tx) => tx.id)
}
