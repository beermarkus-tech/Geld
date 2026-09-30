// Konten's "Angezeigt" total for whatever the grid currently shows (Markus,
// Sept 2026): the sum of the visible rows' own Betrag values, but only
// when adding them up is meaningful.
//
// Without an account filter, a transfer's Betrag is signed from its left
// (from) account, so "BNP → Livret" and "Livret → BNP" both read negative
// and adding them is nonsense. Rule (Markus's call): no total as soon as
// the same pair of accounts appears in both directions. Plain income/
// expense rows (one account only) never block it, whichever account
// they're on. With an account filter (`anchored`), every row is already
// signed from that one account's point of view, so the total is always
// meaningful — its net change over the visible rows.
//
// A split booking's lines can be visible together with their own booking
// row (expanded) — the lines add up to the booking (spec.md §2.6), so
// they're skipped then, never counted twice. Soft-deleted rows don't count.
//
// @param {Array<{id: string, parentId: string|null, cents: number, fromAccountId: string|null, toAccountId: string|null, deleted: boolean}>} rows
//   the visible rows in grid order; for a line row, from/to are its
//   booking's own accounts and `cents` is the line's displayed amount
// @param {boolean} anchored  whether an account filter is active
// @returns {number|null} the total in cents, or null when it isn't meaningful
export function visibleSum(rows, anchored) {
  const visibleIds = new Set(rows.filter((r) => !r.parentId).map((r) => r.id))
  const pairs = new Set()
  let total = 0
  for (const r of rows) {
    if (r.deleted) continue
    if (r.parentId && visibleIds.has(r.parentId)) continue
    if (!anchored && r.fromAccountId && r.toAccountId) {
      if (pairs.has(`${r.toAccountId}>${r.fromAccountId}`)) return null
      pairs.add(`${r.fromAccountId}>${r.toAccountId}`)
    }
    total += r.cents
  }
  return total
}
