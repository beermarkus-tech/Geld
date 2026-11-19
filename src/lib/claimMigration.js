// Preparing the switch from the three "Merkkonten" (Außenstände, CPAM, Reisekosten Airbus) to a
// category "Außenstände" with sub-categories CPAM / Airbus-Reisekosten / Verliehen (Nov 2026, Markus).
// This file only *looks*: it sorts every booking that touches one of those accounts into the
// cases the switch has to handle, so the open questions can be answered with the real data
// before anything is written.
import { ANCHOR_ACCOUNT_ID } from './balance'

/** Which new sub-category each Merkkonto becomes. */
export const CLAIM_TARGETS = {
  aussenstaende: 'Verliehen',
  cpam: 'CPAM',
  'reisekosten-airbus': 'Airbus-Reisekosten',
}
export const CLAIM_GROUP = 'Außenstände'

/**
 * @returns {{
 *   receivableIds: string[],
 *   normal: object[],      // one Merkkonto ↔ one real account → becomes a one-sided booking on the real account
 *   between: object[],     // Merkkonto ↔ Merkkonto → no real account left (open question 1)
 *   external: object[],    // Merkkonto ↔ nothing (e.g. a written-off claim) → no account left (open question 2)
 *   anchors: object[],     // Jahresabschluß ↔ Merkkonto: opening balances (open question 3)
 *   recategorized: object[], // lines that already carry another category, which the switch overwrites
 *   existingCategories: object[], // categories already named like the new ones (open question 4)
 *   rules: object[],       // keyword rules whose Gegenkonto is a Merkkonto
 *   byTarget: Record<string, number>, // bookings per new sub-category
 * }}
 */
export function analyzeClaimMigration({ accounts, categories, transactions, rules = [] }) {
  const receivable = new Set(accounts.filter((a) => a.group === 'receivable').map((a) => a.id))
  const isRec = (id) => receivable.has(id)
  const out = { normal: [], between: [], external: [], anchors: [], recategorized: [] }
  const byTarget = {}
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]))
  for (const tx of transactions) {
    if (tx.deletedAt) continue
    const f = isRec(tx.fromAccountId)
    const t = isRec(tx.toAccountId)
    if (!f && !t) continue
    const recId = f ? tx.fromAccountId : tx.toAccountId
    const other = f ? tx.toAccountId : tx.fromAccountId
    const item = { tx, recId, other }
    if (f && t) out.between.push(item)
    else if (other === ANCHOR_ACCOUNT_ID) out.anchors.push(item)
    else if (!other) out.external.push(item)
    else out.normal.push(item)
    const target = CLAIM_TARGETS[recId] ?? recId
    byTarget[target] = (byTarget[target] ?? 0) + 1
    for (const line of tx.lines ?? []) {
      if (line.categoryId) out.recategorized.push({ tx, line, categoryName: catName[line.categoryId] ?? line.categoryId })
    }
  }
  const newNames = new Set([CLAIM_GROUP, ...Object.values(CLAIM_TARGETS)].map((n) => n.toLowerCase()))
  return {
    receivableIds: [...receivable],
    ...out,
    existingCategories: categories.filter((c) => newNames.has(String(c.name).toLowerCase())),
    rules: rules.filter((r) => isRec(r.counterAccountId) || (r.counterAccountId === undefined && r.groupName === 'Außenstände')),
    byTarget,
  }
}

/** The category documents the switch creates (kept if they already exist). */
export function claimCategoryDocs() {
  return [
    { id: 'aussenstaende-kategorie', name: CLAIM_GROUP, parentCategoryId: null, isFixkosten: false },
    { id: 'aussenstaende-cpam', name: 'CPAM', parentCategoryId: 'aussenstaende-kategorie', isFixkosten: false },
    { id: 'aussenstaende-airbus-reisekosten', name: 'Airbus-Reisekosten', parentCategoryId: 'aussenstaende-kategorie', isFixkosten: false },
    { id: 'aussenstaende-verliehen', name: 'Verliehen', parentCategoryId: 'aussenstaende-kategorie', isFixkosten: false },
  ]
}
const SUBCAT_ID = { aussenstaende: 'aussenstaende-verliehen', cpam: 'aussenstaende-cpam', 'reisekosten-airbus': 'aussenstaende-airbus-reisekosten' }

/**
 * One booking on a Merkkonto, rewritten: the Merkkonto is dropped, the booking becomes one-sided on
 * the other account (a real account, or Jahresabschluß for an opening balance) with the natural sign
 * (money out −, money in +), and every line gets the matching Außenstände sub-category (replacing
 * any category it had) while keeping its tags and notes.
 */
export function rewriteClaimBooking(tx, receivable, now = Date.now()) {
  const f = receivable.has(tx.fromAccountId)
  const recId = f ? tx.fromAccountId : tx.toAccountId
  const other = f ? tx.toAccountId : tx.fromAccountId
  const sign = f ? 1 : -1 // Merkkonto → real account: money came in (+); real → Merkkonto: went out (−)
  const categoryId = SUBCAT_ID[recId]
  // A transfer's line amounts are signed in the direction from → to; one-sided they carry the natural sign.
  const lines = (tx.lines ?? []).length
    ? tx.lines.map((l) => ({ ...l, amountCents: sign * (l.amountCents ?? 0), categoryId }))
    : [{ amountCents: sign * (tx.amountCents ?? 0), categoryId, note: tx.detail ?? '', tags: [] }]
  return {
    ...tx,
    fromAccountId: f ? null : other,
    toAccountId: f ? other : null,
    amountCents: lines.reduce((s, l) => s + l.amountCents, 0),
    lines,
    updatedAt: now,
  }
}

/** Everything the switch writes: categories to create, bookings to rewrite, rules to update, accounts to delete. */
export function planClaimMigration({ accounts, categories, transactions, rules = [], now = Date.now() }) {
  const a = analyzeClaimMigration({ accounts, categories, transactions, rules })
  const receivable = new Set(a.receivableIds)
  const existing = new Set(categories.map((c) => c.id))
  const bookings = [...a.normal, ...a.anchors].map((i) => rewriteClaimBooking(i.tx, receivable, now))
  const subName = { 'aussenstaende-verliehen': 'Verliehen', 'aussenstaende-cpam': 'CPAM', 'aussenstaende-airbus-reisekosten': 'Airbus-Reisekosten' }
  const ruleUpdates = a.rules.map((r) => {
    const categoryId = SUBCAT_ID[r.counterAccountId] ?? 'aussenstaende-verliehen'
    return { id: r.id, patch: { counterAccountId: null, groupName: CLAIM_GROUP, categoryId, categoryName: subName[categoryId] } }
  })
  return {
    categories: claimCategoryDocs().filter((c) => !existing.has(c.id)),
    bookings,
    ruleUpdates,
    deleteAccounts: a.receivableIds,
    blocked: a.between.length + a.external.length, // cases decided as "do not exist" – the switch refuses if they do
  }
}
