import { CLAIM_TYPES } from './tagTypes'
import { signMismatch } from './sign'

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
    label: 'Außenstände-Zeile ohne Forderungs-Tag',
    // A line in the category Außenstände (CPAM, Airbus-Reisekosten, Verliehen) with no claim tag.
    check: (tx, line, ctx) => {
      if (!ctx.claimCategoryIds?.has(line.categoryId)) return null
      return (line.tags ?? []).some((id) => isClaimLike(ctx.tagById[id])) ? null : 'tags'
    },
  },
  {
    id: 'sign',
    label: 'Vorzeichen passt nicht zum Konto (nur Von = minus, nur Nach = plus)',
    // Booking-level (the same answer for every line); the cell is Betrag.
    check: (tx) => (signMismatch(tx) ? 'betrag' : null),
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
// belong to. A booking may fall under several chips; "Andere" is what none of the others show.
// A booking belongs to a sub-category chip when one of its lines is in that Außenstände sub-category.
const inCat = (tx, id) => (tx.lines ?? []).some((l) => l.categoryId === id)
/** An Amazon booking: "amazon" or "amz…" in the Empfänger or the bank text (also used by Monatsabschluss). */
export const isAmazon = (tx) => /amazon|\bamz/i.test(`${tx.displayLabel ?? ''} ${tx.rawDescription ?? ''}`)
export const NEEDS_ENTRY_CHIPS = [
  { key: 'sign', label: 'Vorzeichen', test: (tx) => signMismatch(tx) },
  { key: 'amazon', label: 'Amazon', test: (tx) => isAmazon(tx) },
  { key: 'cpam', label: 'CPAM', test: (tx) => inCat(tx, 'aussenstaende-cpam') },
  { key: 'verliehen', label: 'Verliehen', test: (tx) => inCat(tx, 'aussenstaende-verliehen') },
  { key: 'airbus', label: 'Airbus', test: (tx) => inCat(tx, 'aussenstaende-airbus-reisekosten') },
]

/** [{key, label, ids}] – one entry per chip that has something to show, then "Andere" (the rest). */
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
  if (rest.length) out.push({ key: 'rest', label: 'Andere', ids: rest })
  return out
}
