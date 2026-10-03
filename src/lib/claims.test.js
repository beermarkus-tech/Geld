import { describe, expect, it } from 'vitest'

import { AUSSENSTAENDE_ACCOUNT_ID as AUS, claimLines, claimOverview, claimTagIds, receivableAccountIds } from './claims'
import { tagFilterTotal } from './tagBalance'

// Synthetic fixtures only.
const tx = (id, date, from, to, cents, tagIds, extra = {}) => ({ id, date, fromAccountId: from, toAccountId: to, amountCents: cents, displayLabel: id, detail: '', lines: [{ amountCents: cents, categoryId: null, tags: tagIds }], ...extra })
const REC = new Set([AUS, 'cpam', 'airbus'])
const tags = [
  { id: 'loan', name: 'Dirk Sept', class: 'grouping', groupingType: null, parentTag: null },
  { id: 'trip', name: '2026-05 HAM', class: 'grouping', groupingType: 'claim', parentTag: null },
  { id: 'meal', name: 'Meal', class: 'grouping', groupingType: 'claim-category', parentTag: null },
  { id: 'spar', name: 'Sparen', class: 'allocation', parentTag: null },
]

describe('claim discovery and totals', () => {
  const txs = [
    tx('out', '2026-09-05', 'bar', AUS, 5000, ['loan']),
    tx('back', '2026-09-20', AUS, 'bar', 4500, ['loan']),
    tx('lunch', '2026-05-26', 'visa', null, -4480, ['trip', 'meal']),
    tx('x', '2026-05-27', 'bar', 'dkb', 100, ['loan']), // a transfer between other accounts never counts
  ]

  it('finds loans by their Außenstände booking and trips by their claim type, never categories/allocation tags', () => {
    expect(claimTagIds(tags, txs, REC).sort()).toEqual(['loan', 'trip'])
  })

  it('lists each claim\'s lines and their net equals tagFilterTotal', () => {
    const lines = claimLines('loan', txs, tags, REC)
    expect(lines.map((l) => [l.txId, l.cents])).toEqual([['out', 5000], ['back', -4500]])
    expect(lines.reduce((s, l) => s + l.cents, 0)).toBe(tagFilterTotal('loan', '9999-12-31', txs, REC, tags))
  })

  it('puts open claims first', () => {
    const o = claimOverview(tags, [...txs, tx('o2', '2026-01-02', 'bar', AUS, 100, ['loan']), tx('o3', '2026-01-03', AUS, 'bar', 100, ['loan'])], REC)
    expect(o.map((c) => [c.id, c.net !== 0])).toEqual([['loan', true], ['trip', true]])
    const settled = claimOverview(tags, [tx('a', '2026-01-02', 'bar', AUS, 500, ['loan']), tx('b', '2026-01-09', AUS, 'bar', 500, ['loan']), tx('c', '2026-05-26', 'visa', null, -100, ['trip'])], REC)
    expect(settled.map((c) => [c.id, c.net === 0])).toEqual([['trip', false], ['loan', true]])
  })
})

describe('trip and statement tags on a receivable booking', () => {
  it('are not claims; an untyped tag there still is', () => {
    const t = [
      { id: 'cars', name: 'Cars', class: 'grouping', groupingType: 'claim' },
      { id: 'mw', name: 'Mietwagen', class: 'grouping', groupingType: 'project' },
      { id: 'visa', name: '2025-07', class: 'grouping', groupingType: 'statement' },
      { id: 'dirk', name: 'Dirk Sept', class: 'grouping', groupingType: null },
    ]
    const txs = [tx('a', '2025-07-31', 'aussenstaende', 'bnp', 88275, ['cars', 'mw', 'visa']), tx('b', '2025-08-01', 'bnp', 'aussenstaende', 500, ['dirk'])]
    expect(claimTagIds(t, txs, REC).sort()).toEqual(['cars', 'dirk'])
  })
})

describe('labels within a claim', () => {
  it('a tag typed Anspruchsart is a label, not a claim', () => {
    const t = [
      { id: '2026-03 GET', name: '2026-03 GET', class: 'grouping', groupingType: 'claim' },
      { id: 'Hotel', name: 'Hotel', class: 'grouping', groupingType: 'claim-category' },
    ]
    const txs = [tx('a', '2026-03-09', 'visa', 'airbus', 5000, ['2026-03 GET', 'Hotel']), tx('b', '2026-04-22', 'airbus', 'bnp', 2000, ['2026-03 GET'])]
    expect(claimTagIds(t, txs, REC)).toEqual(['2026-03 GET'])
    expect(claimOverview(t, txs, REC).map((c) => [c.name, c.net])).toEqual([['2026-03 GET', 3000]])
  })
})

describe('claims on the other receivable accounts (CPAM, Airbus)', () => {
  it('are found and totalled', () => {
    const txs = [tx('exp', '2026-05-01', 'visa', 'airbus', 20000, ['trip']), tx('back', '2026-06-01', 'airbus', 'bnp', 15000, ['trip'])]
    const o = claimOverview(tags, txs, REC)
    expect(o).toHaveLength(1)
    expect(o[0].net).toBe(5000)
  })

  it('receivableAccountIds() takes every receivable-group account', () => {
    const ids = receivableAccountIds([{ id: 'a', group: 'receivable' }, { id: 'b', group: 'cash' }, { id: 'c', group: 'receivable' }])
    expect([...ids]).toEqual(['a', 'c'])
  })
})

describe('single-sided bookings on a receivable account (write-offs)', () => {
  it('count with their own natural sign, as in the migration', () => {
    // a 100 € claim fully written off as an expense booked on the receivable itself
    const txs = [
      tx('open', '2026-01-02', 'bar', AUS, 10000, ['loan']),
      tx('writeoff', '2026-02-02', AUS, null, -10000, ['loan']),
    ]
    expect(claimOverview(tags, txs, REC)[0].net).toBe(0)
  })
})

describe('Dienstreise', () => {
  it('is a claim; its children count into it and are no claims of their own', () => {
    const t = [
      { id: 'ham', name: '2024-05 HAM', parentTag: null, class: 'grouping', groupingType: 'business-trip' },
      { id: 'ham-hotel', name: 'Hotel', parentTag: 'ham', class: 'grouping', groupingType: 'business-trip' },
      { id: 'ham-taxi', name: 'Taxi', parentTag: 'ham', class: 'grouping', groupingType: null },
    ]
    const txs = [
      tx('a', '2024-05-10', 'visa', 'airbus', 30000, ['ham-hotel']),
      tx('b', '2024-05-11', 'visa', 'airbus', 5000, ['ham-taxi']),
      tx('c', '2024-06-20', 'airbus', 'bnp', 30000, ['ham']),
    ]
    expect(claimTagIds(t, txs, REC)).toEqual(['ham'])
    expect(claimOverview(t, txs, REC).map((c) => [c.id, c.net, c.lines.length])).toEqual([['ham', 5000, 3]])
  })
})
