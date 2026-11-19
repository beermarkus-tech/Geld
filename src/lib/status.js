// Dashboard "Status – where am I" (spec.md §3f, built Nov 2026): one bar per category, normalised
// to 12 months, showing where actual spending/income stands against the Plan1 budget.
//
// Bar geometry (all heights in "flat months": amount ÷ (yearly plan ÷ 12), so a bar of height 12 is
// the whole yearly plan and 8 is eight months' worth of an even spread):
//  - `actualH`  where actual spend/income stands
//  - `dotH`     the "Budgetmonat": fixed-profile = the plan accumulated up to the current month
//               (an even profile gives that month's number, a seasonal profile more or less);
//               yearly-rolling = the top of the spent part
//  - dark part  min(actualH, dotH) – spent/received within plan
//  - red part   actualH − dotH when actual is ahead of plan (fixed-profile only)
//  - light part from the top of the bar up to 12 – what is left
import { categoryActualIndex } from './planCheck'
import { budgetTopLineMonths } from './budget'

export const PACING_MODES = ['fixed-profile', 'yearly-rolling']

/**
 * @param {object} p
 * @param {Array} p.categories      all categories (leaf ones have parentCategoryId)
 * @param {Array} p.budgets
 * @param {Array} p.yearSettings    categoryYearSettings documents
 * @param {Array} p.transactions
 * @param {number} p.year
 * @param {number} p.month          the current month marker 0..12 (Verlauf's last ticked month)
 * @returns {Array} bars, most negative yearly Plan1 first
 */
export function statusBars({ categories, budgets, yearSettings = [], transactions, year, month }) {
  const index = categoryActualIndex(transactions, year)
  const modeOf = Object.fromEntries(
    yearSettings.filter((s) => s.year === year && s.categoryId).map((s) => [s.categoryId, s.pacingMode]),
  )
  const bars = []
  for (const c of categories) {
    if (!c.parentCategoryId) continue
    const plan = budgetTopLineMonths('categoryId', c.id, 'plan1', year, budgets)
    if (!plan.yearTotal) continue // nothing planned: no pace to measure
    const side = plan.yearTotal > 0 ? 1 : -1 // income (+) or expense (−)
    const annual = Math.abs(plan.yearTotal)
    const unit = annual / 12
    let actual = 0
    let planToDate = 0
    for (let m = 1; m <= Math.min(12, Math.max(0, month)); m += 1) {
      actual += index.total(c.id, m) * side
      planToDate += plan.months[m - 1] * side
    }
    const pacingMode = PACING_MODES.includes(modeOf[c.id]) ? modeOf[c.id] : 'fixed-profile'
    const actualH = Math.max(0, actual) / unit
    const dotH = pacingMode === 'yearly-rolling' ? actualH : Math.max(0, planToDate) / unit
    const darkH = Math.min(actualH, dotH)
    const redH = pacingMode === 'yearly-rolling' ? Math.max(0, actualH - 12) : Math.max(0, actualH - dotH)
    bars.push({
      id: c.id,
      name: c.name,
      side: side > 0 ? 'income' : 'expense',
      pacingMode,
      annualCents: annual,
      actualCents: actual,
      remainingCents: annual - actual,
      actualH,
      dotH,
      darkH,
      redH,
      total: plan.yearTotal,
    })
  }
  return bars.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name, 'de'))
}

/** Compact amount label: 14 · 469 · 1,4k · 10k · 32k (input in cents). */
export function shortAmount(cents) {
  const v = Math.abs(cents) / 100
  const sign = cents < 0 ? '−' : ''
  if (v >= 10000) return `${sign}${Math.round(v / 1000)}k`
  if (v >= 1000) return `${sign}${(v / 1000).toFixed(1).replace('.', ',')}k`
  return `${sign}${Math.round(v)}`
}

/** The month marker: the last month ticked "ok" in Verlauf; without any, the previous calendar month of that year. */
export function currentMonthMarker(closedMonths, year, today = new Date()) {
  if (closedMonths?.length) return Math.max(...closedMonths)
  if (today.getFullYear() > year) return 12
  if (today.getFullYear() < year) return 0
  return Math.max(0, today.getMonth()) // getMonth() is 0-based: January → 0 closed months
}
