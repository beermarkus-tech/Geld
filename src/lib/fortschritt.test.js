import { describe, expect, it } from 'vitest'

import { projectCards } from './fortschritt'

const tags = [
  { id: 'sco', name: 'Schottland', parentTag: null, class: 'grouping', groupingType: 'project' },
  { id: 'sco-h', name: 'Hotels', parentTag: 'sco', class: 'grouping', groupingType: 'project' },
  { id: 'sco-f', name: 'Flüge', parentTag: 'sco', class: 'grouping', groupingType: 'project' },
  { id: 'nor', name: 'Norwegen', parentTag: null, class: 'grouping', groupingType: 'project' },
  { id: 'loan', name: 'Dirk Sept', parentTag: null, class: 'grouping', groupingType: null }, // no children, untyped: not a project
  { id: 'spar', name: 'Sparen', parentTag: null, class: 'allocation' },
]
const tx = (id, date, cents, tagIds, extra = {}) => ({ id, date, detail: '', lines: [{ amountCents: cents, categoryId: 'urlaub', tags: tagIds }], ...extra })
const b = (year, month, cents, tag, extra = {}) => ({ year, planVersion: 'plan1', categoryId: 'urlaub', breakdownTagId: tag, month, plannedAmountCents: cents, ...extra })

const transactions = [
  tx('h25', '2025-08-03', -40000, ['sco-h'], { detail: 'Hotel Oban' }),
  tx('f25', '2025-09-10', -30000, ['sco-f'], { detail: 'Flug EDI' }),
  tx('h26', '2026-03-02', -20000, ['sco-h'], { detail: 'Anzahlung' }),
  tx('h26b', '2026-05-02', -10000, ['sco-h'], { detail: 'Anzahlung' }),
  tx('loose', '2026-04-01', -500, ['sco']),
  tx('x', '2026-02-01', -999, ['loan']),
  tx('s', '2026-02-02', -7, ['spar']),
]
const budgets = [b(2025, 8, -40000, 'sco-h'), b(2026, 3, -50000, 'sco-h'), b(2026, 9, -30000, 'sco-h'), b(2026, 7, -25000, 'sco-f'), b(2026, 7, -5, 'sco-h', { planVersion: 'plan0' })]
const closedByYear = new Map([[2026, [1, 2, 3, 4]]])
const base = { tags, transactions, budgets, closedByYear, todayYear: 2026, cellComments: [{ rowId: 'categoryId:urlaub:plan1:sco-f', year: 2026, text: 'Rückflug evtl. teurer' }] }

describe('projectCards', () => {
  const cards = projectCards(base)
  const sco = cards.find((c) => c.key === 'sco')

  it('one card per project tag with activity; childless untyped tags and allocation tags are no projects', () => {
    expect(cards.map((c) => c.key)).toEqual(['sco'])
    expect(sco.years).toEqual([2025, 2026])
  })
  it('rows per child and year, child name then year; a parent-only booking is "(allgemein)"', () => {
    expect(sco.rows.map((r) => `${r.label}|${r.year}`)).toEqual(['(allgemein)|2026', 'Flüge|2025', 'Flüge|2026', 'Hotels|2025', 'Hotels|2026'])
  })
  it('per-year split: a past year without ticks is fully booked, a ticked year splits at its last tick', () => {
    const h25 = sco.rows.find((r) => r.label === 'Hotels' && r.year === 2025)
    expect(h25).toMatchObject({ booked: -40000, planned: 0, plannedBooked: 0 })
    const h26 = sco.rows.find((r) => r.label === 'Hotels' && r.year === 2026)
    // booked: March (≤ April); the May booking is after the split → plannedBooked
    expect(h26).toMatchObject({ booked: -20000, planned: -30000, plannedBooked: -10000 })
    const f26 = sco.rows.find((r) => r.label === 'Flüge' && r.year === 2026)
    expect(f26).toMatchObject({ booked: 0, planned: -25000 })
  })
  it('details from the bookings (distinct, largest first), comments from Verlauf', () => {
    const h26 = sco.rows.find((r) => r.label === 'Hotels' && r.year === 2026)
    expect(h26.details).toEqual(['Anzahlung'])
    expect(sco.rows.find((r) => r.label === 'Hotels' && r.year === 2025).details).toEqual(['Hotel Oban'])
    expect(sco.rows.find((r) => r.label === 'Flüge' && r.year === 2026).comments).toEqual(['Rückflug evtl. teurer'])
  })
  it('card totals: Budget over all years, Prognose = ticked month real / open month plan', () => {
    expect(sco.budget).toBe(-40000 - 50000 - 30000 - 25000)
    // 2025 fully ticked: -40000 + -30000; 2026: Mar -20000, Apr -500 real; open months plan: Jul -25000, Sep -30000 (May booking ignored)
    expect(sco.prognose).toBe(-40000 - 30000 - 20000 - 500 - 25000 - 30000)
    expect(sco.booked).toBe(-40000 - 30000 - 20000 - 500)
    expect(sco.planned).toBe(-55000)
    expect(sco.plannedBooked).toBe(-10000)
  })
  it('a future year is fully planned, the current year without ticks too', () => {
    const r = projectCards({ ...base, closedByYear: new Map(), transactions: [tx('a', '2026-01-05', -100, ['sco-h'])], budgets: [b(2026, 2, -300, 'sco-h'), b(2027, 1, -900, 'nor')], todayYear: 2026 })
    expect(r.find((c) => c.key === 'sco')).toMatchObject({ booked: 0, planned: -300, plannedBooked: -100 })
    expect(r.find((c) => c.key === 'nor')).toMatchObject({ booked: 0, planned: -900 })
  })
  it('Rücklagen plan lines are out of scope; newest activity first', () => {
    const r = projectCards({ ...base, budgets: [...budgets, { year: 2026, planVersion: 'plan1', categoryId: null, allocationTagId: 'spar', breakdownTagId: 'sco-h', month: 6, plannedAmountCents: -1 }, b(2027, 1, -100, 'nor')] })
    expect(r.map((c) => c.key)).toEqual(['nor', 'sco'])
    expect(r.find((c) => c.key === 'sco').budget).toBe(-145000)
  })
  it('a project with only one tag level has no "(allgemein)" label', () => {
    const r = projectCards({ ...base, transactions: [tx('n', '2026-01-02', -5, ['nor'])], budgets: [] })
    expect(r.find((c) => c.key === 'nor').rows[0].label).toBeNull()
  })
})
