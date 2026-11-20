// The sign of a one-sided booking (spec.md §2.6, Nov 2026, Markus): a booking with only a Von
// account is money leaving that account and is always stored negative; one with only a Nach
// account is money arriving and is always stored positive. (A transfer between two accounts
// stores a positive magnitude.) Konten enforces this when the Betrag is typed; this module finds
// and corrects the bookings saved before that rule existed.

/** True when a one-sided booking's stored sign contradicts its account side. */
export function signMismatch(tx) {
  if (!tx || tx.deletedAt) return false
  const { fromAccountId, toAccountId, amountCents } = tx
  if (fromAccountId && toAccountId) return false
  return Boolean((fromAccountId && amountCents > 0) || (toAccountId && amountCents < 0))
}

/** The amount a typed value becomes on a booking with these accounts. */
export function signedForSides(cents, fromAccountId, toAccountId) {
  if (fromAccountId && toAccountId) return Math.abs(cents)
  return fromAccountId ? -Math.abs(cents) : Math.abs(cents)
}

/** The booking with its sign corrected: the total and every line flip together, so the lines still add
 *  up to the total (a split's lines keep their proportions). */
export function fixSign(tx) {
  return {
    ...tx,
    amountCents: -tx.amountCents,
    lines: (tx.lines ?? []).map((l) => ({ ...l, amountCents: -(l.amountCents ?? 0) })),
  }
}
