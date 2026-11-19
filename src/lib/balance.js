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

// The bookkeeping plug account of the one opening-balance transaction per
// account (spec.md §2.3).
const ANCHOR_ACCOUNT_ID = 'jahresabschluss'

/** True for an opening-balance anchor transaction (spec.md §2.3). It is part
 * of every balance, but never of a period's activity: Verlauf's and Planung's
 * month actuals must skip it (Oct 2026, Markus: the savings accounts' opening
 * balances showed up as January bookings in Verlauf 2025). */
export const isAnchorTransaction = (tx) => tx.fromAccountId === ANCHOR_ACCOUNT_ID || tx.toAccountId === ANCHOR_ACCOUNT_ID
const isAnchor = isAnchorTransaction

/** The account's balance at the start of `year` — spec.md §2.1/§2.3: the
 * balance on Dec 31 of year-1, **plus the Jahresabschluß opening-balance
 * anchor when it is dated at the start of this very year**. The anchor is
 * dated to the start of the earliest imported year (e.g. 2025-01-01), so for
 * that first year there is no prior-year balance to look up at all — its
 * Jahresanfang *is* the anchor (Oct 2026, Markus: Planung showed 0 for the
 * first year). For every later year the anchor lies before Dec 31 of the
 * previous year and is already part of the running sum, so nothing is
 * counted twice. */
export function jahresanfang(accountId, year, transactions) {
  const priorYearEnd = `${year - 1}-12-31`
  const yearStart = `${year}-01-01`
  return balance(
    accountId,
    '9999-12-31',
    transactions.filter((tx) => tx.date <= priorYearEnd || (isAnchor(tx) && tx.date <= yearStart)),
  )
}

/** balance(accountId, Dec 31 of year, transactions) — the companion lookup
 * Prognose (§3d) compares Jahresanfang against. */
export function jahresende(accountId, year, transactions) {
  return balance(accountId, `${year}-12-31`, transactions)
}
