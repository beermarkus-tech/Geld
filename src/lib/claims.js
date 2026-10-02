import { claimLineContribution, tagFilterMatchIds, tagFilterTotal } from './tagBalance'

// Außenstände's lookups (spec.md §3g) — everything is a query over tagged
// Konten lines; no claim data of its own, no stored status. Plain data in,
// plain data out, like the other lib/ modules.

export const AUSSENSTAENDE_ACCOUNT_ID = 'aussenstaende'

// Every claim/loan tag: tags declared `groupingType: 'claim'`, plus any other
// tag used on a line of a booking that touches the Außenstände account
// (Konten's panel discovers them the same way — a loan tag like "Dirk Sept"
// may never have been given a type). Claim-category tags (Meal/Taxi/…) are
// labels *within* a claim, never a claim themselves.
//
// @returns {string[]} tag ids
export function claimTagIds(tags, transactions) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  const ids = new Set(tags.filter((t) => t.groupingType === 'claim').map((t) => t.id))
  for (const tx of transactions) {
    if (tx.fromAccountId !== AUSSENSTAENDE_ACCOUNT_ID && tx.toAccountId !== AUSSENSTAENDE_ACCOUNT_ID) continue
    for (const line of tx.lines ?? []) for (const id of line.tags ?? []) ids.add(id)
  }
  return [...ids].filter((id) => byId[id] && byId[id].groupingType !== 'claim-category' && byId[id].class !== 'allocation')
}

// One claim's lines, oldest first, each with its signed contribution to the
// claim's net (exactly what tagFilterTotal adds up) and the claim-category
// tag ids it carries (for grouping; lines are never summed within a group).
export function claimLines(tagId, transactions, tags) {
  const matchIds = tagFilterMatchIds(tagId, tags)
  const out = []
  for (const tx of transactions) {
    ;(tx.lines ?? []).forEach((line, lineIndex) => {
      if (!(line.tags ?? []).some((id) => matchIds.has(id))) return
      const cents = claimLineContribution(tx, line, AUSSENSTAENDE_ACCOUNT_ID)
      if (cents === null) return
      out.push({
        txId: tx.id,
        lineIndex,
        date: tx.date,
        label: tx.displayLabel || line.note || '',
        detail: tx.detail ?? '',
        cents,
        tagIds: line.tags ?? [],
      })
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.txId.localeCompare(b.txId))
}

// All claims with their net total, open (net ≠ 0) first, then by newest
// activity. A claim is "settled" exactly when its net is zero — the only
// status there is.
export function claimOverview(tags, transactions) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  const claims = claimTagIds(tags, transactions).map((id) => {
    const lines = claimLines(id, transactions, tags)
    return {
      id,
      name: byId[id].name,
      net: tagFilterTotal(id, '9999-12-31', transactions, AUSSENSTAENDE_ACCOUNT_ID, tags),
      lines,
      lastDate: lines.reduce((m, l) => (l.date > m ? l.date : m), ''),
    }
  })
  return claims
    .filter((c) => c.lines.length > 0)
    .sort((a, b) => (a.net === 0) - (b.net === 0) || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name, 'de'))
}

// The close-out booking (spec §3g): moves the residual from the Außenstände
// account to a real category, carrying the claim tag, so the claim's net
// becomes exactly zero and the shortfall is booked as a real, categorized
// expense. `residualCents` is the claim's net (negative = still outstanding);
// the booking is single-sided *from* Außenstände with that same signed amount
// (an expense for a negative residual, income for a positive one), whose
// contribution (−amount) cancels the net.
export function closeOutTransaction({ id, tagId, tagName, residualCents, categoryId, date, now = Date.now() }) {
  const label = `Ausbuchung ${tagName}`
  return {
    id,
    date,
    fromAccountId: AUSSENSTAENDE_ACCOUNT_ID,
    toAccountId: null,
    amountCents: residualCents,
    rawDescription: label,
    displayLabel: label,
    detail: '',
    lines: [{ amountCents: residualCents, categoryId, note: '', tags: [tagId] }],
    createdAt: now,
    updatedAt: now,
  }
}
