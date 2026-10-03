import { claimLineContribution, tagFilterMatchIds } from './tagBalance'

// Außenstände's lookups (spec.md §3g) — everything is a query over tagged
// Konten lines; no claim data of its own, no stored status. Plain data in,
// plain data out, like the other lib/ modules.

export const AUSSENSTAENDE_ACCOUNT_ID = 'aussenstaende'

// Every `receivable` account (Außenstände, CPAM, Reisekosten Airbus, …) —
// claims live on whichever of them they belong to (Oct 2026, Markus: Airbus
// and CPAM claims were missing because only Außenstände itself was looked at).
export const receivableAccountIds = (accounts) => new Set(accounts.filter((a) => a.group === 'receivable').map((a) => a.id))

// Every claim/loan tag: tags declared `groupingType: 'claim'`, plus any other
// tag used on a line of a booking that touches the Außenstände account
// (Konten's panel discovers them the same way — a loan tag like "Dirk Sept"
// may never have been given a type). Claim-category tags (Meal/Taxi/…) are
// labels *within* a claim, never a claim themselves.
//
// @returns {string[]} tag ids
export function claimTagIds(tags, transactions, receivableIds) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  const excluded = (id) => byId[id]?.groupingType === 'claim-category' || byId[id]?.class === 'allocation'
  const ids = new Set(tags.filter((t) => t.groupingType === 'claim').map((t) => t.id))
  for (const tx of transactions) {
    if (!receivableIds.has(tx.fromAccountId) && !receivableIds.has(tx.toAccountId)) continue
    for (const line of tx.lines ?? []) {
      // Since the old plain-text tags were converted (Oct 2026, PLAN.md Phase 5b
      // step 6) every tag here has a record: labels within a claim are typed
      // Anspruchsart and excluded, no "first plain-text tag" rule needed.
      for (const id of line.tags ?? []) if (!excluded(id)) ids.add(id)
    }
  }
  return [...ids]
}

// One claim's lines, oldest first, each with its signed contribution to the
// claim's net (exactly what tagFilterTotal adds up) and the claim-category
// tag ids it carries (for grouping; lines are never summed within a group).
export function claimLines(tagId, transactions, tags, receivableIds) {
  const matchIds = tagFilterMatchIds(tagId, tags)
  const out = []
  for (const tx of transactions) {
    ;(tx.lines ?? []).forEach((line, lineIndex) => {
      if (!(line.tags ?? []).some((id) => matchIds.has(id))) return
      const cents = claimLineContribution(tx, line, receivableIds)
      if (cents === null) return
      out.push({
        txId: tx.id,
        lineIndex,
        date: tx.date,
        accountId: receivableIds.has(tx.fromAccountId) ? tx.fromAccountId : receivableIds.has(tx.toAccountId) ? tx.toAccountId : null,
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
export function claimOverview(tags, transactions, receivableIds) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  const claimIds = new Set(claimTagIds(tags, transactions, receivableIds))
  // One pass over every booking (not one pass per claim — with ~100 claims and
  // thousands of bookings that made every save take noticeable time): each
  // line counts for every claim whose tag it carries, a child tag also for its
  // parent claim (as tagFilterMatchIds() does).
  const lineSets = new Map([...claimIds].map((id) => [id, []]))
  for (const tx of transactions) {
    ;(tx.lines ?? []).forEach((line, lineIndex) => {
      const tagIds = line.tags ?? []
      if (tagIds.length === 0) return
      let targets = null
      for (const t of tagIds) {
        for (const c of [t, byId[t]?.parentTag]) {
          if (c && claimIds.has(c) && !(targets && targets.has(c))) (targets ??= new Set()).add(c)
        }
      }
      if (!targets) return
      const cents = claimLineContribution(tx, line, receivableIds)
      if (cents === null) return
      const entry = {
        txId: tx.id,
        lineIndex,
        date: tx.date,
        accountId: receivableIds.has(tx.fromAccountId) ? tx.fromAccountId : receivableIds.has(tx.toAccountId) ? tx.toAccountId : null,
        label: tx.displayLabel || line.note || '',
        detail: tx.detail ?? '',
        cents,
        tagIds,
      }
      for (const c of targets) lineSets.get(c).push(entry)
    })
  }
  const claims = [...claimIds].map((id) => {
    const lines = lineSets.get(id).sort((a, b) => a.date.localeCompare(b.date) || a.txId.localeCompare(b.txId))
    return {
      id,
      name: byId[id]?.name ?? id,
      net: lines.reduce((s, l) => s + l.cents, 0),
      lines,
      lastDate: lines.reduce((m, l) => (l.date > m ? l.date : m), ''),
    }
  })
  return claims
    .filter((c) => c.lines.length > 0)
    .sort((a, b) => (a.net === 0) - (b.net === 0) || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name, 'de'))
}
