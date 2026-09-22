// Pure, in-memory account-balance computation (spec.md §2.1/§2.6/§2.8) — no
// Firestore access here, just plain data in, a number out. Deliberately
// framework-free so it's trivial to unit-test (see balance.test.js) and
// reuse anywhere the app needs "what's this account worth as of date X":
// the pinned balance panel, and later Prognose's Jahresanfang/Jahresende
// lookups.

/**
 * All-time running balance — no year scoping, no stored per-year figure
 * (spec.md §2.1/§2.3): the account's balance as of `asOfDate` is the sum of
 * every transaction dated on or before it, going all the way back to the
 * one Jahresabschluß anchor. A later year's Jahresanfang is just this same
 * function called with the previous Dec 31 — never a separately stored
 * value.
 *
 * Sign rule (§2.6, clarified during the Phase 1a migration): `amountCents`
 * is a magnitude applied by the account's own position, never the stored
 * field's raw sign applied to both sides of a transfer — that would
 * double-apply the sign and get one side backwards. A single-account
 * income/expense transaction already stores its natural sign (positive
 * income, negative expense) with the other side null, so the same
 * magnitude-by-position rule handles both cases uniformly.
 *
 * @param {string} accountId
 * @param {string} asOfDate  "YYYY-MM-DD"
 * @param {Array<{date: string, fromAccountId: string|null, toAccountId: string|null, amountCents: number}>} transactions
 * @returns {number} the balance in integer cents
 */
export function balance(accountId, asOfDate, transactions) {
  let total = 0
  for (const tx of transactions) {
    if (tx.date > asOfDate) continue
    const magnitude = Math.abs(tx.amountCents)
    if (tx.fromAccountId === accountId) total -= magnitude
    if (tx.toAccountId === accountId) total += magnitude
  }
  return total
}

/** balance(accountId, Dec 31 of year-1, transactions) — spec.md §2.1/§2.3. */
export function jahresanfang(accountId, year, transactions) {
  return balance(accountId, `${year - 1}-12-31`, transactions)
}

/** balance(accountId, Dec 31 of year, transactions) — the companion lookup
 * Prognose (§3d) compares Jahresanfang against. */
export function jahresende(accountId, year, transactions) {
  return balance(accountId, `${year}-12-31`, transactions)
}
