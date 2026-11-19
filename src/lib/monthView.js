// Dashboard "Monat" view (Nov 2026, Markus: "where am I this month, and what exactly made me
// overspend"): for one month – or the year to date – every category's plan against what was
// booked, the biggest deviations first, each overspend with the bookings behind it, and the step
// chart (waterfall) from the planned result to the actual one.
//
// Signs follow the books: expenses negative, income positive, so delta = actual − plan is
// negative whenever it went worse (more spent OR less earned) and positive when it went better.
import { budgetTopLineMonths } from './budget'
import { categoryActualIndex } from './planCheck'

/** @param {'month'|'ytd'} scope @param {number} month 1..12 → the month numbers the view covers */
export function scopeMonths(scope, month) {
  const m = Math.min(12, Math.max(1, month))
  return scope === 'ytd' ? Array.from({ length: m }, (_, i) => i + 1) : [m]
}

/**
 * @param {object} p
 * @param {Array} p.categories @param {Array} p.budgets @param {Array} p.transactions
 * @param {number} p.year @param {number[]} p.months
 * @param {number} [p.maxDrivers=3] bookings listed per overspent category
 */
export function monthDeviations({ categories, budgets, transactions, year, months, maxDrivers = 3 }) {
  const index = categoryActualIndex(transactions, year)
  const rows = []
  for (const c of categories) {
    if (!c.parentCategoryId) continue
    const plan = budgetTopLineMonths('categoryId', c.id, 'plan1', year, budgets)
    const planned = months.reduce((s, m) => s + plan.months[m - 1], 0)
    const actual = months.reduce((s, m) => s + index.total(c.id, m), 0)
    if (!planned && !actual) continue
    const delta = actual - planned
    let drivers = []
    // Bookings that explain an overspend; a shortfall of income has no booking to point at.
    const dir = planned !== 0 ? Math.sign(planned) : Math.sign(actual)
    if (delta < 0 && dir < 0) {
      const lines = months.flatMap((m) => index.lines(c.id, m)).filter((l) => Math.sign(l.cents) === dir)
      lines.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
      drivers = lines.slice(0, maxDrivers).map((l, i) => ({
        txId: l.txId,
        label: l.label,
        detail: l.detail,
        date: l.date,
        cents: l.cents,
        unplanned: planned === 0, // the category had nothing planned at all
        main: i === 0 && Math.abs(l.cents) * 2 >= Math.abs(delta), // this one booking explains at least half
      }))
    }
    rows.push({
      id: c.id,
      name: c.name,
      planned,
      actual,
      delta,
      drivers,
      txIds: [...new Set(months.flatMap((m) => index.lines(c.id, m).map((l) => l.txId)))],
    })
  }
  rows.sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name, 'de'))
  const planTotal = rows.reduce((s, r) => s + r.planned, 0)
  const actualTotal = rows.reduce((s, r) => s + r.actual, 0)
  return { rows, planTotal, actualTotal, deltaTotal: actualTotal - planTotal }
}

/**
 * Steps from the planned result to the actual one: the `top` largest deviations by size, the rest
 * folded into "Übrige". Every step carries the running level before and after it.
 */
export function waterfallSteps({ rows, planTotal, actualTotal }, top = 6) {
  const sorted = rows.filter((r) => r.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const shown = sorted.slice(0, top)
  const rest = sorted.slice(top).reduce((s, r) => s + r.delta, 0)
  const steps = []
  let level = planTotal
  for (const r of shown) {
    steps.push({ key: r.id, label: r.name, from: level, to: level + r.delta, delta: r.delta })
    level += r.delta
  }
  if (rest !== 0) steps.push({ key: 'rest', label: 'Übrige', from: level, to: level + rest, delta: rest })
  return { start: planTotal, steps, end: actualTotal }
}
