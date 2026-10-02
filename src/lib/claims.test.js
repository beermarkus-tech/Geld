import { describe, expect, it } from 'vitest'

import { balance } from './balance'
import { AUSSENSTAENDE_ACCOUNT_ID as AUS, accountReconciliation, claimLines, claimOverview, claimTagIds, receivableAccountIds } from './claims'
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

describe('legacy claims whose tags are raw strings without a tag document', () => {
  it('are found by their first tag and named by it; a second raw string is a label, not a claim', () => {
    const txs = [
      tx('a', '2026-03-09', 'visa', 'airbus', 5000, ['2026-03 GET', 'Hotel']),
      tx('b', '2026-04-22', 'airbus', 'bnp', 2000, ['2026-03 GET']),
    ]
    expect(claimTagIds([], txs, REC)).toEqual(['2026-03 GET'])
    const o = claimOverview([], txs, REC)
    expect(o.map((c) => [c.name, c.net])).toEqual([['2026-03 GET', 3000]])
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

describe('accountReconciliation()', () => {
  it('shows an account\'s balance next to what its claims explain, exposing untagged bookings', () => {
    const accounts = [{ id: AUS, name: 'Außenstände', group: 'receivable' }, { id: 'bar', name: 'Bar', group: 'cash' }]
    const txs = [tx('a', '2026-01-02', 'bar', AUS, 1000, ['loan']), tx('b', '2026-01-03', 'bar', AUS, 300, [])]
    const claims = claimOverview(tags, txs, new Set([AUS]))
    expect(accountReconciliation(accounts, txs, claims, balance)).toEqual([{ id: AUS, name: 'Außenstände', balance: 1300, claims: 1000 }])
  })
})
