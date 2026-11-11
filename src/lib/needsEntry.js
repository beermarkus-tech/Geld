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

// Quick-filter chips in Konten (Nov 2026, Markus): the bookings with a yellow cell, split by who they
// belong to. A booking may fall under several chips; "Fehlende Einträge" is what none of the others show.
const touches = (tx, id) => tx.fromAccountId === id || tx.toAccountId === id
export const NEEDS_ENTRY_CHIPS = [
  { key: 'amazon', label: 'Amazon', test: (tx) => /amazon/i.test(`${tx.displayLabel ?? ''} ${tx.rawDescription ?? ''}`) },
  { key: 'cpam', label: 'CPAM', test: (tx) => touches(tx, 'cpam') },
  { key: 'aussenstaende', label: 'Außenstände', test: (tx) => touches(tx, 'aussenstaende') },
]

/** [{key, label, ids}] – one entry per chip that has something to show, then "Fehlende Einträge" (the rest). */
export function needsEntryChips(transactions, ctx) {
  const missing = new Set(bookingsNeedingEntry(transactions, ctx))
  const byId = new Map(transactions.map((t) => [t.id, t]))
  const out = []
  const claimed = new Set()
  for (const chip of NEEDS_ENTRY_CHIPS) {
    const ids = [...missing].filter((id) => chip.test(byId.get(id)))
    ids.forEach((id) => claimed.add(id))
    if (ids.length) out.push({ key: chip.key, label: chip.label, ids })
  }
  const rest = [...missing].filter((id) => !claimed.has(id))
  if (rest.length) out.push({ key: 'rest', label: 'Fehlende Einträge', ids: rest })
  return out
}
