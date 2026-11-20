// Dashboard "Prognose" chart (spec.md §3d, built Nov 2026 after Markus's Sheet): month by month,
// from the start of the year (31 Dec of the year before) to December,
//  - three lines for the cash (reportingGroups Barkonten + Bargeld, plus the Außenstände still open at the start):
//      Plan0 and Plan1: the real start + every month's planned result from Verlauf
//                       (income − expenses − Rücklagen transfers, all Plan rows of that version);
//      Prognose:        the real start + Verlauf's Prog line (booked figures in months ticked as
//                       closed, Plan1 in the open ones) – what the month-end closing must agree with;
//  - two stacked bars for Geldanlage and Sparkonten: the real month-end balance in closed months,
//    in open months the month before + that month's planned Rücklagen transfers (Plan1) into the
//    accounts of that group.
import { balance, jahresanfang } from './balance'
import { budgetTopLineMonths, progMonths } from './budget'
import { isBudgetPlannedTag, isKnownSubcat } from './categoryOrder'
import { claimCategoryIds, claimTotal } from './claims'

export const CASH_GROUPS = ['Barkonten', 'Bargeld']
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const monthEnd = (year, m) => `${year}-${String(m).padStart(2, '0')}-31`

/** The planning rows Verlauf shows: known sub-categories and budget-planned allocation tags. */
export function planTargets(categories, tags) {
  return [
    ...categories.filter((c) => c.parentCategoryId && isKnownSubcat(c.name)).map((c) => ({ key: 'categoryId', id: c.id })),
    ...tags.filter((t) => t.class === 'allocation' && isBudgetPlannedTag(t)).map((t) => ({ key: 'allocationTagId', id: t.id })),
  ]
}

/**
 * @returns {{ start: {cash, geldanlage, sparkonten}, months: Array<{ m, plan0, plan1, prog, geldanlage, sparkonten, closed }> }}
 *   every figure in cents; `plan0/plan1/prog` are cash balances at the month's end
 */
export function forecastSeries({ accounts, categories, tags, budgets, transactions, year, closedMonths = [] }) {
  const groupOf = Object.fromEntries(accounts.map((a) => [a.id, a.reportingGroup]))
  const idsIn = (groups) => accounts.filter((a) => groups.includes(a.reportingGroup) && a.tracked !== false).map((a) => a.id)
  const cashIds = idsIn(CASH_GROUPS)
  const anlageIds = idsIn(['Geldanlage'])
  const sparIds = idsIn(['Sparkonten'])
  const sumStart = (ids) => ids.reduce((s, id) => s + jahresanfang(id, year, transactions), 0)
  const sumAt = (ids, date) => ids.reduce((s, id) => s + balance(id, date, transactions), 0)

  const targets = planTargets(categories, tags)
  const months12 = (version) => {
    const out = Array(12).fill(0)
    for (const t of targets) budgetTopLineMonths(t.key, t.id, version, year, budgets).months.forEach((v, i) => (out[i] += v))
    return out
  }
  const plan0 = months12('plan0')
  const plan1 = months12('plan1')
  const prog = Array(12).fill(0)
  for (const t of targets) {
    const p1 = budgetTopLineMonths(t.key, t.id, 'plan1', year, budgets).months
    progMonths(t.key, t.id, p1, closedMonths, year, transactions, tags).forEach((v, i) => (prog[i] += v))
  }
  // planned Rücklagen transfers (Plan1) per month into each group: a − planned amount is money put aside
  const plannedInto = { Geldanlage: Array(12).fill(0), Sparkonten: Array(12).fill(0) }
  for (const t of tags.filter((x) => x.class === 'allocation' && isBudgetPlannedTag(x))) {
    const group = groupOf[(t.reconciliationTargetAccountIds ?? [])[0]]
    if (!plannedInto[group]) continue
    budgetTopLineMonths('allocationTagId', t.id, 'plan1', year, budgets).months.forEach((v, i) => (plannedInto[group][i] -= v))
  }

  // The cash start includes what was still owed to us (open Außenstände) on 31 Dec, as in Markus's
  // Sheet: claim bookings are not planning rows, so the Prog line runs "cash + open claims" anyway.
  const openClaims = claimTotal(transactions, claimCategoryIds(categories), `${year - 1}-12-31`)
  const start = { cash: sumStart(cashIds) + openClaims, geldanlage: sumStart(anlageIds), sparkonten: sumStart(sparIds), openClaims }
  const lv = { plan0: start.cash, plan1: start.cash, prog: start.cash, geldanlage: start.geldanlage, sparkonten: start.sparkonten }
  const months = MONTHS.map((m) => {
    const closed = closedMonths.includes(m)
    lv.plan0 += plan0[m - 1]
    lv.plan1 += plan1[m - 1]
    lv.prog += prog[m - 1]
    lv.geldanlage = closed ? sumAt(anlageIds, monthEnd(year, m)) : lv.geldanlage + plannedInto.Geldanlage[m - 1]
    lv.sparkonten = closed ? sumAt(sparIds, monthEnd(year, m)) : lv.sparkonten + plannedInto.Sparkonten[m - 1]
    return { m, closed, plan0: lv.plan0, plan1: lv.plan1, prog: lv.prog, geldanlage: lv.geldanlage, sparkonten: lv.sparkonten }
  })
  return { start, months }
}

/** "22,2 k€" */
export const kEuro = (cents) => `${(cents / 100000).toFixed(1).replace('.', ',').replace('-0,0', '0,0')} k€`

/** A nice tick step (1, 2, 2.5, 5 × 10^n) so that `range` fits into `count` steps. */
export function niceStep(range, count) {
  const raw = Math.max(1, range) / count
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= raw)
}
