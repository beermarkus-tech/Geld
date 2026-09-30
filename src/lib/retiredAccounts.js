// One-off repair (Sept 2026): spec.md §2.2's shared `aussenstaende`
// account replaced five old receivable accounts, but some transactions
// still point at the old ids, so they count toward no pinned-panel group
// and no Jahresanfang. This finds them and computes the corrected
// documents; BackupScreen.jsx does the actual writing. Temporary, remove
// once Markus has confirmed the live data is clean.

export const RETIRED_ACCOUNT_IDS = [
  'geld-verliehen-geliehen',
  'amazon-julia-de',
  'amazon-julia-fr',
  'amazon-markus-de',
  'amazon-markus-fr',
]
export const REPLACEMENT_ACCOUNT_ID = 'aussenstaende'

// @param {Array} transactions  every transaction, soft-deleted ones included
// @returns {{fixes: Array<{before: object, after: object}>, countsByOldId: Record<string, number>, untagged: Array<object>}}
//   `fixes` — one entry per affected transaction, `after` being the full
//   corrected document (only fromAccountId/toAccountId differ).
//   `untagged` — affected transactions with no tag on any line: they'd land
//   on Außenstände without an open-claim row in the panel, so Markus
//   needs to tag them by hand.
export function planRetiredAccountFixes(transactions) {
  const retired = new Set(RETIRED_ACCOUNT_IDS)
  const countsByOldId = {}
  const fixes = []
  const untagged = []
  for (const tx of transactions) {
    const fromOld = retired.has(tx.fromAccountId)
    const toOld = retired.has(tx.toAccountId)
    if (!fromOld && !toOld) continue
    if (fromOld) countsByOldId[tx.fromAccountId] = (countsByOldId[tx.fromAccountId] ?? 0) + 1
    if (toOld) countsByOldId[tx.toAccountId] = (countsByOldId[tx.toAccountId] ?? 0) + 1
    const after = {
      ...tx,
      fromAccountId: fromOld ? REPLACEMENT_ACCOUNT_ID : tx.fromAccountId,
      toAccountId: toOld ? REPLACEMENT_ACCOUNT_ID : tx.toAccountId,
    }
    fixes.push({ before: tx, after })
    if (!(tx.lines ?? []).some((l) => (l.tags ?? []).length > 0)) untagged.push(tx)
  }
  return { fixes, countsByOldId, untagged }
}
