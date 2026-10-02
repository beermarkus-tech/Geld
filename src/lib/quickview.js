import { isAnchorTransaction } from './balance'
import { tagFilterMatchIds } from './tagBalance'

// Quickview's lookup (spec.md §3e): every real booking line that belongs to
// one selection — a category, or a tag (an allocation tag or a grouping /
// breakdown tag, including a parent tag's children) — grouped by month of
// one year, largest amount first. Nothing planned or compared; plain data
// in, plain data out, like the other lib/ modules.
//
// The amount of an entry is the matching *line's* amount (a split booking
// contributes one entry per matching line, so a split salary's 5.000 € line
// is listed with 5.000 €, not the booking's net). For an allocation tag the
// amount follows the tag's own direction rule (as in tagBalance.js): +
// arriving at one of its reconciliationTargetAccountIds, − leaving one;
// a line of such a tag that touches none of those accounts is skipped.
//
// @param {{kind: 'category'|'tag', id: string}} selection
// @param {number} year
// @param {Array} transactions
// @param {Array} tags
// @returns {Array<{month: number, total: number, count: number, entries: Array}>}
//   12 entries Jan..Dec; `entries` are the single lines, `groups` the per-name
//   sums sorted by |sum|, largest first (what the screen lists)
export function quickviewMonths(selection, year, transactions, tags) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, count: 0, entries: [], groups: [] }))
  if (!selection) return months
  const tag = selection.kind === 'tag' ? tags.find((t) => t.id === selection.id) : null
  const matchIds = tag ? tagFilterMatchIds(tag.id, tags) : null
  const targets = tag?.class === 'allocation' ? new Set(tag.reconciliationTargetAccountIds ?? []) : null
  const prefix = `${year}-`
  for (const tx of transactions) {
    if (isAnchorTransaction(tx)) continue
    if (!tx.date.startsWith(prefix)) continue
    const m = Number(tx.date.slice(5, 7))
    if (!(m >= 1 && m <= 12)) continue
    ;(tx.lines ?? []).forEach((line, lineIndex) => {
      let cents
      if (selection.kind === 'category') {
        if (line.categoryId !== selection.id) return
        cents = line.amountCents
      } else {
        if (!(line.tags ?? []).some((id) => matchIds.has(id))) return
        if (targets) {
          if (targets.has(tx.fromAccountId)) cents = -line.amountCents
          else if (targets.has(tx.toAccountId)) cents = line.amountCents
          else return
        } else {
          cents = line.amountCents
        }
      }
      const bucket = months[m - 1]
      bucket.total += cents
      bucket.count += 1
      bucket.entries.push({ txId: tx.id, lineIndex, date: tx.date, displayLabel: tx.displayLabel ?? '', detail: tx.detail ?? '', cents })
    })
  }
  for (const b of months) {
    b.entries.sort((a, c) => Math.abs(c.cents) - Math.abs(a.cents) || a.date.localeCompare(c.date))
    b.groups = groupByName(b.entries)
  }
  return months
}

// What Quickview actually shows per month (Markus, Oct 2026): every entry
// with the same name (displayLabel, ignoring case and surrounding spaces) is
// summed into one row — all Lidl bookings of the month become one "Lidl"
// total — and the rows are sorted by the size of that total, largest first.
// `detail` is deliberately not part of the name: one name, one row.
function groupByName(entries) {
  const byKey = new Map()
  for (const e of entries) {
    const label = e.displayLabel.trim() || '(ohne Name)'
    const key = label.toLowerCase()
    const g = byKey.get(key) ?? { label, cents: 0, count: 0 }
    g.cents += e.cents
    g.count += 1
    byKey.set(key, g)
  }
  return [...byKey.values()].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.label.localeCompare(b.label, 'de'))
}

// How many months of `year` have really occurred by `today` ("YYYY-MM-DD") —
// real calendar time, not Verlauf's closed-month switch (§3e). 0 for a
// future year, 12 for a past one.
export function occurredMonthCount(year, today) {
  const ty = Number(today.slice(0, 4))
  if (year < ty) return 12
  if (year > ty) return 0
  return Number(today.slice(5, 7))
}
