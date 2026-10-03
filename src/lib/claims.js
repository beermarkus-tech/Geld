import { claimLineContribution, tagFilterMatchIds } from './tagBalance'

// Außenstände's lookups (spec.md §3g) — everything is a query over tagged
// Konten lines; no claim data of its own, no stored status. Plain data in,
// plain data out, like the other lib/ modules.

export const AUSSENSTAENDE_ACCOUNT_ID = 'aussenstaende'

// Every `receivable` account (Außenstände, CPAM, Reisekosten Airbus, …) —
// claims live on whichever of them they belong to (Oct 2026, Markus: Airbus
// and CPAM claims were missing because only Außenstände itself was looked at).
export const receivableAccountIds = (accounts) => new Set(accounts.filter((a) => a.group === 'receivable').map((a) => a.id))

// Every claim/loan tag: top-level tags typed Anspruch or Dienstreise, plus any
// *untyped* tag used on a line of a booking that touches a receivable account
// (a loan tag like "Dirk Sept" may never have been given a type). A tag with
// another type is never a claim, even on such a booking (Reise/Projekt and
// Abrechnung tags just travel along), nor is a child of a claim — a
// Dienstreise's "Hotel" counts into its trip (Oct 2026, Markus: "2026 Schottland: Mietwagen" showed up as an
// open claim in the panel and put red dots on its bookings).
//
// @returns {string[]} tag ids
export function claimTagIds(tags, transactions, receivableIds) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  const isClaimType = (t) => t?.groupingType === 'claim' || t?.groupingType === 'business-trip'
  // A child of a claim (e.g. "2024-05 HAM: Hotel") is part of its parent's
  // claim, never a claim of its own.
  const excluded = (id) => {
    const t = byId[id]
    if (!t) return false
    if (t.class === 'allocation') return true
    if (t.parentTag && (isClaimType(byId[t.parentTag]) || ids.has(t.parentTag))) return true
    return Boolean(t.groupingType && !isClaimType(t))
  }
  const ids = new Set(tags.filter((t) => (t.groupingType === 'claim' || t.groupingType === 'business-trip') && !t.parentTag).map((t) => t.id))
  for (const tx of transactions) {
    if (!receivableIds.has(tx.fromAccountId) && !receivableIds.has(tx.toAccountId)) continue
    for (const line of tx.lines ?? []) {
      // Every tag has a record since the plain-text conversion (PLAN.md Phase 5b
      // step 6), so no special rule for plain-text tags is needed.
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
        // A split booking's line has its own detail (Konten's Details on the line).
        detail: ((tx.lines ?? []).length > 1 && line.note) || tx.detail || '',
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
        // A split booking's line has its own detail (Konten's Details on the line).
        detail: ((tx.lines ?? []).length > 1 && line.note) || tx.detail || '',
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
