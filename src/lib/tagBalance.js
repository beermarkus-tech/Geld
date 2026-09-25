// Pure, in-memory allocation-tag balance computation (spec.md §2.5/§2.8) —
// same shape and reasoning as balance.js's own balance()/jahresende(), just
// keyed on a tag's own reconciliationTargetAccountIds instead of a single
// account id, and summed per *line* (not per transaction) since a tag
// lives on `lines[]`, not the transaction root (§2.6) — a split-off
// portion can carry a tag that doesn't apply to the rest of that
// transaction.
//
// Sign rule: a tagged line contributes its own *signed* amountCents,
// applied + if the parent transaction's toAccountId is one of the tag's
// targets (money arrived in the pool this tag subdivides), and − (i.e.
// negated) if fromAccountId is one of them (money left it) — both checked
// independently, not either/or, so a transaction moving money *between*
// two of a tag's own target accounts (e.g. Aktien -> Crypto, both inside
// Anlage Familie's combined pool) nets to zero.
//
// **Deliberately not Math.abs(line.amountCents) first** (a real bug, caught
// by Markus: Anlage Familie off by exactly the total of some negative-signed
// tagged lines) — unlike balance()'s own account-position rule, which
// always applies a plain magnitude because a transfer's amountCents is
// itself always stored as a positive magnitude (§2.6), a *line's* own sign
// can genuinely differ from its parent's (§2.6: "a line can be positive or
// negative independent of the parent's own sign," e.g. a salary split's
// positive Gehalt / negative Steuern lines) — forcing abs() first silently
// flipped a negative line's real contribution to positive. This exactly
// mirrors `migration/transform-transactions.py`'s own `allocation_tag_delta()`
// — the reference implementation already checked against the real Gsheet
// totals during the original migration (`verify_tag_sums()`) — which never
// takes abs() either, for the same reason.
//
// @param {string} tagId
// @param {string} asOfDate  "YYYY-MM-DD"
// @param {Array} transactions
// @param {Array<{id: string, reconciliationTargetAccountIds?: string[]}>} tags
export function tagBalance(tagId, asOfDate, transactions, tags) {
  const tag = tags.find((t) => t.id === tagId)
  const targets = new Set(tag?.reconciliationTargetAccountIds ?? [])
  if (targets.size === 0) return 0
  let total = 0
  for (const tx of transactions) {
    if (tx.date > asOfDate) continue
    for (const line of tx.lines ?? []) {
      if (!(line.tags ?? []).includes(tagId)) continue
      if (targets.has(tx.fromAccountId)) total -= line.amountCents
      if (targets.has(tx.toAccountId)) total += line.amountCents
    }
  }
  return total
}

/** tagBalance(tagId, Dec 31 of year, transactions, tags) — the pinned
 * panel's own Jahresende figure per allocation tag, same lookup shape as
 * balance.js's jahresende() for a plain account. */
export function tagJahresende(tagId, year, transactions, tags) {
  return tagBalance(tagId, `${year}-12-31`, transactions, tags)
}
