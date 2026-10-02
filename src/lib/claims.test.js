import { describe, expect, it } from 'vitest'

import { AUSSENSTAENDE_ACCOUNT_ID as AUS, claimLines, claimOverview, claimTagIds, closeOutTransaction } from './claims'
import { tagFilterTotal } from './tagBalance'

// Synthetic fixtures only.
const tx = (id, date, from, to, cents, tagIds, extra = {}) => ({ id, date, fromAccountId: from, toAccountId: to, amountCents: cents, displayLabel: id, detail: '', lines: [{ amountCents: cents, categoryId: null, tags: tagIds }], ...extra })
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
    expect(claimTagIds(tags, txs).sort()).toEqual(['loan', 'trip'])
  })

  it('lists each claim\'s lines and their net equals tagFilterTotal', () => {
    const lines = claimLines('loan', txs, tags)
    expect(lines.map((l) => [l.txId, l.cents])).toEqual([['out', 5000], ['back', -4500]])
    expect(lines.reduce((s, l) => s + l.cents, 0)).toBe(tagFilterTotal('loan', '9999-12-31', txs, AUS, tags))
  })

  it('puts open claims first', () => {
    const o = claimOverview(tags, [...txs, tx('o2', '2026-01-02', 'bar', AUS, 100, ['loan']), tx('o3', '2026-01-03', AUS, 'bar', 100, ['loan'])])
    expect(o.map((c) => [c.id, c.net !== 0])).toEqual([['loan', true], ['trip', true]])
    const settled = claimOverview(tags, [tx('a', '2026-01-02', 'bar', AUS, 500, ['loan']), tx('b', '2026-01-09', AUS, 'bar', 500, ['loan']), tx('c', '2026-05-26', 'visa', null, -100, ['trip'])])
    expect(settled.map((c) => [c.id, c.net === 0])).toEqual([['trip', false], ['loan', true]])
  })
})

describe('closeOutTransaction()', () => {
  it('brings an under-paid loan to exactly zero (and an over-paid one too)', () => {
    for (const repaid of [4500, 5500]) {
      const txs = [tx('out', '2026-09-05', 'bar', AUS, 5000, ['loan']), tx('back', '2026-09-20', AUS, 'bar', repaid, ['loan'])]
      const residual = tagFilterTotal('loan', '9999-12-31', txs, AUS, tags)
      expect(residual).not.toBe(0)
      const close = closeOutTransaction({ id: 'c', tagId: 'loan', tagName: 'Dirk Sept', residualCents: residual, categoryId: 'sonstiges', date: '2026-10-01' })
      expect(tagFilterTotal('loan', '9999-12-31', [...txs, close], AUS, tags)).toBe(0)
      expect(close.lines[0].amountCents).toBe(close.amountCents)
      expect(close.toAccountId).toBeNull()
    }
  })
})
