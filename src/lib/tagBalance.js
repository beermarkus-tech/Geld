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

// The general "what's the total for whatever tag I'm currently filtering
// by" figure (spec.md §3a's grid-wide tag filter, Sept 2026) — distinct
// from tagBalance() above, which is specifically for *allocation* tags and
// needs a tag's own stored reconciliationTargetAccountIds (plural — some
// span several accounts, e.g. Anlage Familie). A grouping tag (a trip, an
// expense breakdown, a claim/loan) has no such stored target, and needs a
// different rule depending on what it's actually tagging:
//
// - A tagged line whose parent transaction touches the one shared
//   `Außenstände` account (Markus's design, Sept 2026 — Amazon returns and
//   informal loans collapsed into a single receivable account,
//   distinguished from each other purely by tag, direction given by the
//   sign of the transfer) is summed the same *position-based* way
//   tagBalance() sums an allocation tag against its target: + when money
//   arrived in Außenstände (a claim opens / a loan goes out), − when it
//   left (a claim settles / a loan is repaid). Confirmed directly with
//   Markus: without this, a loan tag like "Dirk" would always total to
//   zero, since *every* line touching it is, by construction, one leg of
//   a transfer — summing the line's own raw signed amount (as if it were
//   a plain expense) would be meaningless.
// - A tagged line that's genuinely single-sided (a real expense or
//   income, exactly one of fromAccountId/toAccountId set) contributes its
//   own natural signed amount directly — this is the common case for a
//   trip/expense tag like "Schottland:Ausgaben", never touching
//   Außenstände at all.
// - A tagged line that's a transfer between two *other* real accounts
//   (neither side Außenstände) is excluded entirely — an internal
//   reallocation between your own accounts isn't real spending and isn't
//   a claim movement either, so it shouldn't move the total either way.
//
// One hardcoded account id, not a per-tag stored target: every claim tag
// here shares the exact same single target (there's only one Außenstände
// account), so there's nothing to configure per tag the way allocation
// tags need.
//
// @param {string} tagId
// @param {string} asOfDate  "YYYY-MM-DD"
// @param {Array} transactions
// @param {string} aussenstaendeAccountId
export function tagFilterTotal(tagId, asOfDate, transactions, aussenstaendeAccountId) {
  let total = 0
  for (const tx of transactions) {
    if (tx.date > asOfDate) continue
    for (const line of tx.lines ?? []) {
      if (!(line.tags ?? []).includes(tagId)) continue
      if (tx.fromAccountId === aussenstaendeAccountId) total -= line.amountCents
      else if (tx.toAccountId === aussenstaendeAccountId) total += line.amountCents
      else if (!tx.fromAccountId || !tx.toAccountId) total += line.amountCents
    }
  }
  return total
}
