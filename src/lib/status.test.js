import { describe, expect, it } from 'vitest'

import { currentMonthMarker, shortAmount, statusBars } from './status'

const cats = [
  { id: 'g', name: 'Lebenshaltung', parentCategoryId: null },
  { id: 'food', name: 'Lebensmittel', parentCategoryId: 'g' },
  { id: 'cloth', name: 'Klamotten', parentCategoryId: 'g' },
  { id: 'pay', name: 'Gehalt', parentCategoryId: 'g' },
  { id: 'none', name: 'Ungeplant', parentCategoryId: 'g' },
]
const row = (categoryId, month, cents) => ({ year: 2026, month, planVersion: 'plan1', type: 'expense', categoryId, breakdownTagId: null, plannedAmountCents: cents })
const flat = (categoryId, monthly) => Array.from({ length: 12 }, (_, i) => row(categoryId, i + 1, monthly))
const tx = (month, categoryId, cents) => ({ id: `t${month}${categoryId}${cents}`, date: `2026-${String(month).padStart(2, '0')}-05`, lines: [{ categoryId, amountCents: cents }] })

describe('statusBars', () => {
  const budgets = [...flat('food', -100000), ...flat('cloth', -50000), ...flat('pay', 400000)]
  it('fixed profile: dot at the month, dark up to it, red for overspend, light is the rest', () => {
    // 8 months planned 8 × 1000 €; spent 9.1 months' worth
    const t = [tx(1, 'food', -910000)]
    const [b] = statusBars({ categories: cats, budgets, transactions: t, year: 2026, month: 8 }).filter((x) => x.id === 'food')
    expect(b.annualCents).toBe(1200000)
    expect(b.dotH).toBeCloseTo(8)
    expect(b.darkH).toBeCloseTo(8)
    expect(b.redH).toBeCloseTo(1.1)
    expect(b.actualCents).toBe(910000)
    expect(b.remainingCents).toBe(290000)
  })
  it('behind plan: no red, dark ends below the dot', () => {
    const b = statusBars({ categories: cats, budgets, transactions: [tx(2, 'food', -300000)], year: 2026, month: 8 }).find((x) => x.id === 'food')
    expect(b.darkH).toBeCloseTo(3)
    expect(b.redH).toBe(0)
    expect(b.dotH).toBeCloseTo(8)
  })
  it('yearly rolling: the dot sits on top of the spent part', () => {
    const ys = [{ year: 2026, categoryId: 'cloth', pacingMode: 'yearly-rolling' }]
    const b = statusBars({ categories: cats, budgets, yearSettings: ys, transactions: [tx(3, 'cloth', -250000)], year: 2026, month: 8 }).find((x) => x.id === 'cloth')
    expect(b.actualH).toBeCloseTo(5)
    expect(b.dotH).toBeCloseTo(5)
    expect(b.redH).toBe(0)
  })
  it('income is a bar of its own side, only closed months count, sorted most negative first, unplanned left out', () => {
    const t = [tx(1, 'pay', 400000), tx(9, 'pay', 400000), tx(1, 'none', -100)]
    const bars = statusBars({ categories: cats, budgets, transactions: t, year: 2026, month: 8 })
    expect(bars.map((x) => x.id)).toEqual(['food', 'cloth', 'pay'])
    const pay = bars[2]
    expect(pay.side).toBe('income')
    expect(pay.actualCents).toBe(400000) // September is after the marker
  })
})

describe('helpers', () => {
  it('shortAmount', () => {
    expect([14, 469, 1400, 10000, 32000, 3200].map((e) => shortAmount(e * 100))).toEqual(['14', '469', '1,4k', '10k', '32k', '3,2k'])
  })
  it('currentMonthMarker', () => {
    expect(currentMonthMarker([1, 2, 8], 2026)).toBe(8)
    expect(currentMonthMarker([], 2026, new Date(2026, 10, 19))).toBe(10)
    expect(currentMonthMarker([], 2025, new Date(2026, 10, 19))).toBe(12)
    expect(currentMonthMarker([], 2027, new Date(2026, 10, 19))).toBe(0)
  })
})
