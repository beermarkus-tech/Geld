import { describe, expect, it } from 'vitest'

import { fortschrittCards } from './fortschritt'

const tags = [
  { id: 'sco', name: 'Schottland', parentTag: null, class: 'grouping' },
  { id: 'sco-h', name: 'Hotels', parentTag: 'sco', class: 'grouping' },
  { id: 'sco-f', name: 'Flüge', parentTag: 'sco', class: 'grouping' },
  { id: 'nor', name: 'Norwegen', parentTag: null, class: 'grouping' },
  { id: 'spar', name: 'Sparen', parentTag: null, class: 'allocation' },
]
const tx = (id, date, cents, tagIds = [], categoryId = 'urlaub') => ({
  id,
  date,
  displayLabel: id,
  lines: [{ amountCents: cents, categoryId, tags: tagIds }],
})
const b = (month, cents, breakdownTagId = null, extra = {}) => ({ year: 2026, planVersion: 'plan1', categoryId: 'urlaub', breakdownTagId, month, plannedAmountCents: cents, ...extra })

const transactions = [
  tx('hotel-jul', '2026-07-03', -50000, ['sco-h']),
  tx('flug-jul', '2026-07-10', -30000, ['sco-f']),
  tx('flug-aug', '2026-08-02', -20000, ['sco-f']), // after the pivot: booked early
  tx('misc', '2026-06-01', -1000), // untagged
  tx('other-cat', '2026-07-01', -999, ['sco-h'], 'food'),
  tx('old', '2025-07-01', -777, ['sco-h']),
]
const budgets = [
  b(7, -50000, 'sco-h'),
  b(8, -40000, 'sco-h'),
  b(8, -25000, 'sco-f'),
  b(9, -10000, 'nor'),
  b(8, -5, 'sco-h', { planVersion: 'plan0' }),
  b(8, -1, null), // flat total — ignored once breakdown lines exist
]
const base = { categoryId: 'urlaub', year: 2026, transactions, budgets, tags }

describe('fortschrittCards', () => {
  const { pivot, cards } = fortschrittCards({ ...base, closedMonths: [1, 2, 3, 4, 5, 6, 7] })
  const by = (k) => cards.find((c) => c.key === k)

  it('pivot is the last closed month; one card per parent, untagged last', () => {
    expect(pivot).toBe(7)
    expect(cards.map((c) => c.key)).toEqual(['nor', 'sco', 'none'])
  })
  it('children become sub-lines of their parent card', () => {
    expect(by('sco').subs.map((s) => s.label)).toEqual(['Flüge', 'Hotels'])
  })
  it('Bereits gebucht = bookings up to the pivot; other categories and years are left out', () => {
    expect(by('sco').bookedTotal).toBe(-80000)
    expect(by('sco').subs.find((s) => s.label === 'Hotels').booked.map((e) => e.txId)).toEqual(['hotel-jul'])
  })
  it('Noch geplant = Plan1 after the pivot; an early booking rides on its month', () => {
    const flug = by('sco').subs.find((s) => s.label === 'Flüge')
    expect(flug.planned).toEqual([{ month: 8, plan: -25000, booked: -20000 }])
    expect(by('sco').plannedTotal).toBe(-65000)
  })
  it('Budget is the Plan1 year total, Prognose follows Verlauf (closed = real, open = plan)', () => {
    expect(by('sco').budget).toBe(-115000)
    expect(by('sco').prognose).toBe(-80000 + -65000)
  })
  it('a planned-only trip is a card; untagged bookings get "Ohne Tag"; flat plan ignored', () => {
    expect(by('nor')).toMatchObject({ budget: -10000, bookedTotal: 0, plannedTotal: -10000 })
    expect(by('none')).toMatchObject({ budget: 0, bookedTotal: -1000 })
  })
  it('allocation tags are never cards', () => {
    const r = fortschrittCards({ ...base, transactions: [tx('s', '2026-07-01', -5, ['spar'])], budgets: [], closedMonths: [7] })
    expect(r.cards.map((c) => c.key)).toEqual(['none'])
  })
  it('no tags and no breakdown: one flat card using the flat plan', () => {
    const r = fortschrittCards({ ...base, transactions: [tx('a', '2026-01-05', -100)], budgets: [b(2, -300)], closedMonths: [1] })
    expect(r.cards).toHaveLength(1)
    expect(r.cards[0]).toMatchObject({ key: 'none', budget: -300, bookedTotal: -100, plannedTotal: -300, prognose: -400 })
  })
  it('no month closed: nothing is booked yet, everything is planned', () => {
    const r = fortschrittCards({ ...base, closedMonths: [] })
    expect(r.pivot).toBe(0)
    expect(r.cards.find((c) => c.key === 'sco').bookedTotal).toBe(0)
  })
})
