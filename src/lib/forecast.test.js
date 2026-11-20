import { describe, expect, it } from 'vitest'

import { forecastSeries, kEuro, niceStep } from './forecast'

const accounts = [
  { id: 'bnp', reportingGroup: 'Barkonten' },
  { id: 'bar', reportingGroup: 'Bargeld' },
  { id: 'livret', reportingGroup: 'Sparkonten' },
  { id: 'aktien', reportingGroup: 'Geldanlage' },
  { id: 'jahresabschluss', reportingGroup: null },
]
const categories = [
  { id: 'g', name: 'Lebenshaltung', parentCategoryId: null },
  { id: 'food', name: 'Lebensmittel & Haushalt', parentCategoryId: 'g' },
  { id: 'pay', name: 'Gehalt Markus', parentCategoryId: 'g' },
]
const tags = [{ id: 'sparen-familie', class: 'allocation', reconciliationTargetAccountIds: ['livret'] }]
const b = (pv, key, id, month, cents) => ({ year: 2026, month, planVersion: pv, type: 'expense', [key]: id, breakdownTagId: null, plannedAmountCents: cents })
const budgets = [
  ...[1, 2, 3].map((m) => b('plan1', 'categoryId', 'pay', m, 400000)),
  ...[1, 2, 3].map((m) => b('plan1', 'categoryId', 'food', m, -100000)),
  ...[1, 2, 3].map((m) => b('plan0', 'categoryId', 'food', m, -150000)),
  b('plan1', 'allocationTagId', 'sparen-familie', 2, -50000),
  b('plan1', 'allocationTagId', 'sparen-familie', 3, -50000),
]
const tx = (id, date, from, to, cents, lines) => ({ id, date, fromAccountId: from, toAccountId: to, amountCents: cents, lines })
const transactions = [
  tx('o1', '2025-12-31', null, 'bnp', 1000000, []), // start cash 10.000
  tx('o2', '2025-12-31', null, 'livret', 2000000, []),
  tx('o3', '2025-12-31', null, 'aktien', 3000000, []),
  tx('s1', '2026-01-25', null, 'bnp', 400000, [{ amountCents: 400000, categoryId: 'pay', tags: [] }]),
  tx('f1', '2026-01-10', 'bnp', null, -120000, [{ amountCents: -120000, categoryId: 'food', tags: [] }]),
  tx('a1', '2026-01-28', null, 'aktien', 10000, []), // gain on Aktien in January
]

describe('forecastSeries', () => {
  const r = forecastSeries({ accounts, categories, tags, budgets, transactions, year: 2026, closedMonths: [1] })
  it('starts from the real balances at the end of the year before', () => {
    expect(r.start).toEqual({ cash: 1000000, geldanlage: 3000000, sparkonten: 2000000, openClaims: 0 })
  })
  it('Plan lines add each month’s planned result (incl. Rücklagen transfers) to the start', () => {
    expect(r.months.slice(0, 3).map((x) => x.plan1)).toEqual([1300000, 1550000, 1800000])
    expect(r.months.slice(0, 3).map((x) => x.plan0)).toEqual([850000, 700000, 550000])
    expect(r.months[11].plan1).toBe(1800000)
  })
  it('Prognose = Verlauf’s Prog line: booked in closed months, Plan1 in open ones', () => {
    // January closed: +4.000 −1.200; February open: Plan1 +4.000 −1.000 −500
    expect(r.months[0].prog).toBe(1000000 + 400000 - 120000)
    expect(r.months[1].prog).toBe(1280000 + 400000 - 100000 - 50000)
  })
  it('bars: real balance in closed months, then planned Rücklagen transfers into the group', () => {
    expect(r.months[0]).toMatchObject({ closed: true, geldanlage: 3010000, sparkonten: 2000000 })
    expect(r.months[1]).toMatchObject({ closed: false, geldanlage: 3010000, sparkonten: 2050000 })
    expect(r.months[2].sparkonten).toBe(2100000)
  })
})

describe('open Außenstände at the start', () => {
  it('count into the cash start (they come back as money; claim bookings are no planning rows)', () => {
    const cats = [...categories, { id: 'aussenstaende-kategorie', name: 'Außenstände', parentCategoryId: null }, { id: 'aussenstaende-verliehen', name: 'Verliehen', parentCategoryId: 'aussenstaende-kategorie' }]
    const lent = tx('l', '2025-11-02', 'bnp', null, -120000, [{ amountCents: -120000, categoryId: 'aussenstaende-verliehen', tags: ['dirk'] }])
    const r = forecastSeries({ accounts, categories: cats, tags, budgets, transactions: [...transactions, lent], year: 2026, closedMonths: [] })
    expect(r.start.openClaims).toBe(120000)
    expect(r.start.cash).toBe(1000000 - 120000 + 120000)
  })
})

describe('helpers', () => {
  it('kEuro and niceStep', () => {
    expect(kEuro(2222000)).toBe('22,2 k€')
    expect(kEuro(-1000)).toBe('0,0 k€')
    expect(niceStep(100000, 4)).toBe(25000)
    expect(niceStep(7230000, 4)).toBe(2000000)
  })
})
