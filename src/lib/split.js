// Pure split-transaction invariant logic (spec.md §2.6/§3a) — no Firestore
// access here, just plain data in, a new lines array out. Deliberately
// framework-free so it's trivial to unit-test (see split.test.js), the same
// pattern as balance.js.

/**
 * Recomputes the last line's amountCents so that the invariant holds:
 * parent amountCents === Σ lines[].amountCents. Every line except the last
 * is left exactly as given — the last is always "whatever's left", the
 * concrete, stored form of §3a's "live, auto-generated remaining amount
 * line". Only meaningful once a transaction actually has more than one
 * line; an unsplit (≤1 line) transaction's amount mirroring works
 * differently (the parent is still authoritative, not derived) and is
 * handled separately in Konten.jsx's persistTx.
 *
 * @param {number} amountCents  the parent's fixed total — splitting only
 *   ever redistributes this, never changes it here.
 * @param {Array<{amountCents: number}>} lines  must have length > 1.
 * @returns {Array} a new lines array, same length, only the last entry's
 *   amountCents changed.
 */
export function withRemainder(amountCents, lines) {
  const committed = lines.slice(0, -1)
  const committedSum = committed.reduce((sum, l) => sum + l.amountCents, 0)
  const last = lines[lines.length - 1]
  return [...committed, { ...last, amountCents: amountCents - committedSum }]
}
