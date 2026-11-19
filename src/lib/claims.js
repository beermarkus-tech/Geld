import { CLAIM_TYPES } from './tagTypes'
import { isClaimLike } from './needsEntry'
import { claimLineContribution, tagFilterMatchIds } from './tagBalance'

// Außenstände's lookups (spec.md §3g) — everything is a query over tagged
// Konten lines; no claim data of its own, no stored status. Plain data in,
// plain data out, like the other lib/ modules.

// Since Nov 2026 (Markus) claims are no longer kept on the three "Merkkonten" (Außenstände, CPAM,
// Reisekosten Airbus, which were not real places): a claim line is a booking line in the category
// **Außenstände** › CPAM / Airbus-Reisekosten / Verliehen, on a real account, and its tag tells
// which claim it belongs to. A claim line's contribution is the *negated* line amount, so a claim
// that is owed to us is positive (money went out: −300 € line → +300 € open) and a repayment
// brings it back to zero.
export const CLAIM_GROUP_ID = 'aussenstaende-kategorie'
export const CLAIM_SUBCATS = {
  verliehen: 'aussenstaende-verliehen',
  cpam: 'aussenstaende-cpam',
  airbus: 'aussenstaende-airbus-reisekosten',
}
/** The ids of the Außenstände sub-categories (whatever they are called today). */
export const claimCategoryIds = (categories) => new Set(categories.filter((c) => c.parentCategoryId === CLAIM_GROUP_ID).map((c) => c.id))

// The old Merkkonten — only still needed by the one-time switch (lib/claimMigration.js).
export const receivableAccountIds = (accounts) => new Set(accounts.filter((a) => a.group === 'receivable').map((a) => a.id))

// Every claim/loan tag: top-level tags typed Anspruch or Dienstreise, plus any
// *untyped* tag used on a claim line (category Außenstände)
// (a loan tag like "Dirk Sept" may never have been given a type). A tag with
// another type is never a claim, even on such a booking (Reise/Projekt and
// Abrechnung tags just travel along), nor is a child of a claim — a
// Dienstreise's "Hotel" counts into its trip (Oct 2026, Markus: "2026 Schottland: Mietwagen" showed up as an
// open claim in the panel and put red dots on its bookings).
//
// @returns {string[]} tag ids
export function claimTagIds(tags, transactions, claimCats) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  const isClaimType = (t) => CLAIM_TYPES.has(t?.groupingType)
  // A child of a claim (e.g. "2024-05 HAM: Hotel") is part of its parent's
  // claim, never a claim of its own.
  const excluded = (id) => {
    const t = byId[id]
    if (!t) return false
    if (t.class === 'allocation') return true
    if (t.parentTag && (isClaimType(byId[t.parentTag]) || ids.has(t.parentTag))) return true
    return Boolean(t.groupingType && !isClaimType(t))
  }
  const ids = new Set(tags.filter((t) => CLAIM_TYPES.has(t.groupingType) && !t.parentTag).map((t) => t.id))
  for (const tx of transactions) {
    for (const line of tx.lines ?? []) {
      if (!claimCats.has(line.categoryId)) continue
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
export function claimLines(tagId, transactions, tags, claimCats) {
  const matchIds = tagFilterMatchIds(tagId, tags)
  const out = []
  for (const tx of transactions) {
    ;(tx.lines ?? []).forEach((line, lineIndex) => {
      if (!(line.tags ?? []).some((id) => matchIds.has(id))) return
      const cents = claimLineContribution(tx, line, claimCats)
      if (cents === null) return
      out.push({
        txId: tx.id,
        lineIndex,
        date: tx.date,
        categoryId: line.categoryId,
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
export function claimOverview(tags, transactions, claimCats) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  const claimIds = new Set(claimTagIds(tags, transactions, claimCats))
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
      const cents = claimLineContribution(tx, line, claimCats)
      if (cents === null) return
      const entry = {
        txId: tx.id,
        lineIndex,
        date: tx.date,
        categoryId: line.categoryId,
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

/** One card per Außenstände sub-category for its claim lines that carry no claim tag at all (Nov
 *  2026, Markus) – the same lines Konten shows with a yellow Tags cell. Same shape as a claim from
 *  claimOverview, plus `untagged: true`, `categoryId` and `txIds`. Cards without lines are left out. */
export function untaggedCards(categories, tags, transactions, claimCats) {
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
  return categories
    .filter((c) => claimCats.has(c.id))
    .map((c) => {
      const lines = []
      for (const tx of transactions) {
        if (tx.deletedAt) continue
        ;(tx.lines ?? []).forEach((line, lineIndex) => {
          if (line.categoryId !== c.id) return
          const tagIds = line.tags ?? []
          if (tagIds.some((id) => isClaimLike(byId[id]))) return
          lines.push({
            txId: tx.id,
            lineIndex,
            date: tx.date,
            categoryId: c.id,
            label: tx.displayLabel || line.note || '',
            detail: ((tx.lines ?? []).length > 1 && line.note) || tx.detail || '',
            cents: claimLineContribution(tx, line, claimCats),
            tagIds,
          })
        })
      }
      lines.sort((x, y) => x.date.localeCompare(y.date) || x.txId.localeCompare(y.txId))
      return {
        id: `untagged:${c.id}`,
        name: c.name,
        untagged: true,
        categoryId: c.id,
        net: lines.reduce((sum, l) => sum + l.cents, 0),
        lines,
        txIds: [...new Set(lines.map((l) => l.txId))],
        lastDate: lines.reduce((m, l) => (l.date > m ? l.date : m), ''),
      }
    })
    .filter((c) => c.lines.length > 0)
}

/** What all claim lines add up to (open total, + = owed to us), up to a date. */
export function claimTotal(transactions, claimCats, asOfDate = '9999-12-31', categoryId = null) {
  let total = 0
  for (const tx of transactions) {
    if (tx.deletedAt || tx.date > asOfDate) continue
    for (const line of tx.lines ?? []) {
      if (!claimCats.has(line.categoryId) || (categoryId && line.categoryId !== categoryId)) continue
      total -= line.amountCents
    }
  }
  return total
}
