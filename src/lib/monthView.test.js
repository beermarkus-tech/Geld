import { describe, expect, it } from 'vitest'

import { monthDeviations, scopeMonths, significantRows, waterfallSteps } from './monthView'

const cats = [
  { id: 'g', name: 'G', parentCategoryId: null },
  { id: 'food', name: 'Lebensmittel', parentCategoryId: 'g' },
  { id: 'trip', name: 'Urlaube', parentCategoryId: 'g' },
  { id: 'pay', name: 'Gehalt', parentCategoryId: 'g' },
  { id: 'gift', name: 'Geschenke', parentCategoryId: 'g' },
]
const row = (categoryId, month, cents) => ({ year: 2026, month, planVersion: 'plan1', type: 'expense', categoryId, breakdownTagId: null, plannedAmountCents: cents })
const flat = (categoryId, monthly) => Array.from({ length: 12 }, (_, i) => row(categoryId, i + 1, monthly))
const tx = (id, month, categoryId, cents, label) => ({ id, date: `2026-${String(month).padStart(2, '0')}-10`, displayLabel: label, lines: [{ categoryId, amountCents: cents }] })
const budgets = [...flat('food', -100000), ...flat('pay', 400000), row('trip', 7, -200000)]
const txs = [
  tx('a', 3, 'food', -80000, 'Lidl'),
  tx('b', 3, 'food', -60000, 'Metro'),
  tx('c', 3, 'pay', 380000, 'Airbus'),
  tx('d', 3, 'gift', -15000, 'Spielzeug'), // unplanned category
  tx('e', 3, 'trip', -50000, 'Fähre'), // planned for July only
]

describe('monthDeviations', () => {
  it('worst deviation first; income that falls short counts as worse; drivers are the biggest bookings', () => {
    const r = monthDeviations({ categories: cats, budgets, transactions: txs, year: 2026, months: [3] })
    expect(r.rows.map((x) => [x.id, x.delta])).toEqual([
      ['trip', -50000], // planned 0 in March, spent 500 €
      ['food', -40000], // 1.400 € of 1.000 €
      ['pay', -20000],
      ['gift', -15000],
    ])
    expect(r.planTotal).toBe(-100000 + 400000)
    expect(r.deltaTotal).toBe(r.actualTotal - r.planTotal)
    const food = r.rows.find((x) => x.id === 'food')
    expect(food.drivers.map((d) => d.label)).toEqual(['Lidl', 'Metro'])
    expect(food.drivers[0].main).toBe(true) // 800 € ≥ half of the 400 € overspend
    expect(r.rows.find((x) => x.id === 'gift').drivers[0].unplanned).toBe(true)
    expect(r.rows.find((x) => x.id === 'pay').drivers).toEqual([]) // income fell short: nothing to point at
  })
  it('year to date adds up the months', () => {
    expect(scopeMonths('ytd', 3)).toEqual([1, 2, 3])
    expect(scopeMonths('month', 3)).toEqual([3])
    const r = monthDeviations({ categories: cats, budgets, transactions: txs, year: 2026, months: scopeMonths('ytd', 3) })
    expect(r.rows.find((x) => x.id === 'food').planned).toBe(-300000)
  })
})

describe('significantRows / waterfallSteps', () => {
  const r = monthDeviations({ categories: cats, budgets, transactions: txs, year: 2026, months: [3] })
  it('keeps what is at least 20 % of the gross deviation, but always the top three', () => {
    // deviations −500, −400, −200, −150 → gross 1.250 €, threshold 250 €
    const { big, small } = significantRows(r.rows)
    expect(big.map((x) => x.id)).toEqual(['trip', 'food', 'pay']) // top three kept although 'pay' is below 250
    expect(small.map((x) => x.id)).toEqual(['gift'])
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, delta: -100 - i }))
    expect(significantRows(many).big).toHaveLength(3)
    const lopsided = [{ id: 'a', delta: -100000 }, ...Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, delta: -1000 }))]
    expect(significantRows(lopsided).big.map((x) => x.id)).toEqual(['a', 's0', 's1'])
  })
  it('the waterfall runs from plan to actual; the small ones are folded into "Übrige"', () => {
    const w = waterfallSteps(r)
    expect(w.steps.map((s) => s.label)).toEqual(['Urlaube', 'Lebensmittel', 'Gehalt', 'Übrige (1)'])
    expect(w.steps.at(-1).to).toBe(w.end)
    expect(w.start).toBe(r.planTotal)
  })
})
