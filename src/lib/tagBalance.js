// Pure, in-memory allocation-tag balance computation (spec.md §2.5/§2.8) —
// same shape and reasoning as balance.js's own balance()/jahresende(), just
// keyed on a tag's own reconciliationTargetAccountIds instead of a single
// account id, and summed per *line* (not per transaction) since a tag
// lives on `lines[]`, not the transaction root (§2.6) — a split-off
// portion can carry a tag that doesn't apply to the rest of that
// transaction.
//
// Sign rule, generalizing balance()'s own account-position rule to a tag's
// *set* of target accounts: a tagged line contributes +|amount| if the
// parent transaction's toAccountId is one of the tag's targets (money
// arrived in the pool this tag subdivides), and −|amount| if fromAccountId
// is one of them (money left it) — both checked independently, not
// either/or, so a transaction moving money *between* two of a tag's own
// target accounts (e.g. Aktien -> Crypto, both inside Anlage Familie's
// combined pool) nets to zero, same as balance()'s own self-transfer case.
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
      const magnitude = Math.abs(line.amountCents)
      if (targets.has(tx.fromAccountId)) total -= magnitude
      if (targets.has(tx.toAccountId)) total += magnitude
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
