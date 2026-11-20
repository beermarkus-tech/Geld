// The automatic month-end checks (spec.md §3d, Nov 2026, Markus's "idiot proof"), run for every
// month ticked as closed:
//  1. Prognose = Kontostand – the Prognose line (start + Verlauf's Prog figures) must equal the
//     real cash at the month's end: Barkonten + Bargeld balances plus the Außenstände still open.
//  2. Unterkonten = Rücklagen – per group (Geldanlage, Sparkonten), the allocation tags whose first
//     target account is in that group must add up to the balances of that group's accounts.
// A difference other than zero means a booking is missing, wrong, or wrongly signed.
import { balance } from './balance'
import { claimCategoryIds, claimTotal } from './claims'
import { CASH_GROUPS, forecastSeries } from './forecast'
import { tagBalance } from './tagBalance'

export const RESERVE_GROUPS = ['Geldanlage', 'Sparkonten']
const monthEnd = (year, m) => `${year}-${String(m).padStart(2, '0')}-31`

/**
 * @returns {Array<{ m, prog, kontostand, progDelta, reserves: Array<{ group, tags, accounts, delta }>, ok }>}
 *   one entry per closed month, oldest first; every figure in cents
 */
export function monthChecks({ accounts, categories, tags, budgets, transactions, year, closedMonths = [] }) {
  const live = transactions.filter((t) => !t.deletedAt)
  const series = forecastSeries({ accounts, categories, tags, budgets, transactions: live, year, closedMonths })
  const tracked = accounts.filter((a) => a.tracked !== false)
  const idsIn = (groups) => tracked.filter((a) => groups.includes(a.reportingGroup)).map((a) => a.id)
  const groupOf = Object.fromEntries(accounts.map((a) => [a.id, a.reportingGroup]))
  const cashIds = idsIn(CASH_GROUPS)
  const claimCats = claimCategoryIds(categories)
  const allocation = tags.filter((t) => t.class === 'allocation' && (t.reconciliationTargetAccountIds ?? []).length)

  return series.months
    .filter((row) => row.closed)
    .map((row) => {
      const date = monthEnd(year, row.m)
      const kontostand = cashIds.reduce((s, id) => s + balance(id, date, live), 0) + claimTotal(live, claimCats, date)
      const reserves = RESERVE_GROUPS.map((group) => {
        const accountSum = idsIn([group]).reduce((s, id) => s + balance(id, date, live), 0)
        const tagSum = allocation
          .filter((t) => groupOf[t.reconciliationTargetAccountIds[0]] === group)
          .reduce((s, t) => s + tagBalance(t.id, date, live, tags), 0)
        return { group, tags: tagSum, accounts: accountSum, delta: tagSum - accountSum }
      })
      const progDelta = row.prog - kontostand
      return { m: row.m, prog: row.prog, kontostand, progDelta, reserves, ok: progDelta === 0 && reserves.every((r) => r.delta === 0) }
    })
}
