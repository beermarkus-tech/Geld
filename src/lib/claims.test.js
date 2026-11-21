import { describe, expect, it } from 'vitest'

import { claimCategoryIds, claimLines, claimOverview, claimStart, claimTagIds, claimTotal, untaggedCards } from './claims'
import { tagFilterTotal } from './tagBalance'

// Synthetic fixtures only. Since Nov 2026 a claim line is a line in an Außenstände sub-category on a
// real account; its amount has the natural sign (paid out −, paid back +).
const V = 'aussenstaende-verliehen'
const C = 'aussenstaende-cpam'
const A = 'aussenstaende-airbus-reisekosten'
const CATS = new Set([V, C, A])
const tx = (id, date, account, cents, tagIds, categoryId = V, extra = {}) => ({
  id,
  date,
  fromAccountId: cents < 0 ? account : null,
  toAccountId: cents < 0 ? null : account,
  amountCents: cents,
  displayLabel: id,
  detail: '',
  lines: [{ amountCents: cents, categoryId, tags: tagIds }],
  ...extra,
})
const tags = [
  { id: 'loan', name: 'Dirk Sept', class: 'grouping', groupingType: null, parentTag: null },
  { id: 'trip', name: '2026-05 HAM', class: 'grouping', groupingType: 'claim', parentTag: null },
  { id: 'meal', name: 'Meal', class: 'grouping', groupingType: 'claim-category', parentTag: null },
  { id: 'spar', name: 'Sparen', class: 'allocation', parentTag: null },
]

describe('claimCategoryIds', () => {
  it('takes the sub-categories of the Außenstände category', () => {
    const cats = [
      { id: 'aussenstaende-kategorie', name: 'Außenstände', parentCategoryId: null },
      { id: V, name: 'Verliehen', parentCategoryId: 'aussenstaende-kategorie' },
      { id: 'food', name: 'Lebensmittel', parentCategoryId: 'g' },
    ]
    expect([...claimCategoryIds(cats)]).toEqual([V])
  })
})

describe('claim discovery and totals', () => {
  const txs = [
    tx('out', '2026-09-05', 'bar', -5000, ['loan']),
    tx('back', '2026-09-20', 'bar', 4500, ['loan']),
    tx('lunch', '2026-05-26', 'visa', -4480, ['trip', 'meal'], A),
    tx('x', '2026-05-27', 'bar', 100, ['loan'], 'food', { fromAccountId: 'bar', toAccountId: 'dkb' }), // a transfer outside Außenstände never counts
  ]

  it('finds loans by their Außenstände line and trips by their claim type, never categories/allocation tags', () => {
    expect(claimTagIds(tags, txs, CATS).sort()).toEqual(['loan', 'trip'])
  })

  it("lists each claim's lines (+ = owed to us) and their net equals tagFilterTotal", () => {
    const lines = claimLines('loan', txs, tags, CATS)
    expect(lines.map((l) => [l.txId, l.cents])).toEqual([['out', 5000], ['back', -4500]])
    expect(lines.reduce((s, l) => s + l.cents, 0)).toBe(tagFilterTotal('loan', '9999-12-31', txs, CATS, tags))
  })

  it('puts open claims first', () => {
    const settled = claimOverview(tags, [tx('a', '2026-01-02', 'bar', -500, ['loan']), tx('b', '2026-01-09', 'bar', 500, ['loan']), tx('c', '2026-05-26', 'visa', -100, ['trip'], A)], CATS)
    expect(settled.map((c) => [c.id, c.net === 0])).toEqual([['trip', false], ['loan', true]])
  })

  it('claimTotal adds up what is open, optionally per sub-category and up to a date', () => {
    expect(claimTotal(txs, CATS)).toBe(5000 - 4500 + 4480)
    expect(claimTotal(txs, CATS, '9999-12-31', A)).toBe(4480)
    expect(claimTotal(txs, CATS, '2026-09-10')).toBe(5000 + 4480)
  })
})

describe('trip and statement tags on a claim line', () => {
  it('are not claims; an untyped tag there still is', () => {
    const t = [
      { id: 'cars', name: 'Cars', class: 'grouping', groupingType: 'claim' },
      { id: 'mw', name: 'Mietwagen', class: 'grouping', groupingType: 'project' },
      { id: 'visa', name: '2025-07', class: 'grouping', groupingType: 'statement' },
      { id: 'dirk', name: 'Dirk Sept', class: 'grouping', groupingType: null },
    ]
    const txs = [tx('a', '2025-07-31', 'bnp', 88275, ['cars', 'mw', 'visa']), tx('b', '2025-08-01', 'bnp', -500, ['dirk'])]
    expect(claimTagIds(t, txs, CATS).sort()).toEqual(['cars', 'dirk'])
  })
})

describe('labels within a claim', () => {
  it('a tag typed Anspruchsart is a label, not a claim', () => {
    const t = [
      { id: '2026-03 GET', name: '2026-03 GET', class: 'grouping', groupingType: 'claim' },
      { id: 'Hotel', name: 'Hotel', class: 'grouping', groupingType: 'claim-category' },
    ]
    const txs = [tx('a', '2026-03-09', 'visa', -5000, ['2026-03 GET', 'Hotel'], A), tx('b', '2026-04-22', 'bnp', 2000, ['2026-03 GET'], A)]
    expect(claimTagIds(t, txs, CATS)).toEqual(['2026-03 GET'])
    expect(claimOverview(t, txs, CATS).map((c) => [c.name, c.net])).toEqual([['2026-03 GET', 3000]])
  })
})

describe('write-offs inside the category', () => {
  it('a claim written off by an opposite line nets to zero', () => {
    const txs = [tx('open', '2026-01-02', 'bar', -10000, ['loan']), tx('writeoff', '2026-02-02', 'bar', 10000, ['loan'])]
    expect(claimOverview(tags, txs, CATS)[0].net).toBe(0)
  })
})

describe('Dienstreise', () => {
  it('is a claim; its children count into it and are no claims of their own', () => {
    const t = [
      { id: 'ham', name: '2024-05 HAM', parentTag: null, class: 'grouping', groupingType: 'business-trip' },
      { id: 'ham-hotel', name: 'Hotel', parentTag: 'ham', class: 'grouping', groupingType: 'business-trip' },
      { id: 'ham-taxi', name: 'Taxi', parentTag: 'ham', class: 'grouping', groupingType: null },
    ]
    const txs = [tx('a', '2024-05-10', 'visa', -30000, ['ham-hotel'], A), tx('b', '2024-05-11', 'visa', -5000, ['ham-taxi'], A), tx('c', '2024-06-20', 'bnp', 30000, ['ham'], A)]
    expect(claimTagIds(t, txs, CATS)).toEqual(['ham'])
    expect(claimOverview(t, txs, CATS).map((c) => [c.id, c.net, c.lines.length])).toEqual([['ham', 5000, 3]])
  })
})

describe('Krankenkasse', () => {
  it('is a claim like Anspruch, even before any booking', () => {
    const t = [
      { id: 'zahn', name: '2026-03 Zahnarzt', parentTag: null, class: 'grouping', groupingType: 'health-insurance' },
      { id: 'zahn-r', name: 'Rechnung', parentTag: 'zahn', class: 'grouping', groupingType: 'health-insurance' },
    ]
    expect(claimTagIds(t, [], CATS)).toEqual(['zahn'])
  })
})

describe('untaggedCards', () => {
  const categories = [
    { id: V, name: 'Verliehen', parentCategoryId: 'aussenstaende-kategorie' },
    { id: C, name: 'CPAM', parentCategoryId: 'aussenstaende-kategorie' },
    { id: A, name: 'Airbus-Reisekosten', parentCategoryId: 'aussenstaende-kategorie' },
    { id: 'food', name: 'Lebensmittel', parentCategoryId: 'g' },
  ]
  const txs = [
    tx('a', '2026-01-02', 'bnp', -5000, []), // untagged, Verliehen
    tx('b', '2026-01-03', 'bnp', -3000, ['loan']), // tagged
    tx('c', '2026-01-04', 'bnp', -1000, ['spar'], C), // allocation tag only → still untagged
    tx('d', '2026-01-05', 'bnp', 700, []), // untagged repayment
    tx('e', '2026-01-06', 'bnp', -900, ['trip'], A),
    tx('f', '2026-01-07', 'bnp', -100, [], 'food'), // not a claim line
    tx('g', '2026-01-08', 'bnp', -400, [], V, { deletedAt: 9 }),
  ]
  it('makes one card per Außenstände sub-category that has untagged lines', () => {
    const cards = untaggedCards(categories, tags, txs, CATS)
    expect(cards.map((c) => c.id)).toEqual([`untagged:${V}`, `untagged:${C}`])
    expect(cards[0]).toMatchObject({ name: 'Verliehen', net: 5000 - 700, txIds: ['a', 'd'], untagged: true })
    expect(cards[1]).toMatchObject({ name: 'CPAM', net: 1000 })
  })
})

describe('claimStart', () => {
  it('counts the first year’s opening claims dated 1 Jan, like jahresanfang()', () => {
    const cats = new Set(['aussenstaende-cpam'])
    const txs = [
      { id: 'o', date: '2025-01-01', fromAccountId: 'jahresabschluss', toAccountId: null, amountCents: -80263, lines: [{ amountCents: -80263, categoryId: 'aussenstaende-cpam', tags: [] }] },
      { id: 'n', date: '2025-01-01', fromAccountId: 'bnp', toAccountId: null, amountCents: -1000, lines: [{ amountCents: -1000, categoryId: 'aussenstaende-cpam', tags: [] }] },
      { id: 'later', date: '2025-03-01', fromAccountId: 'bnp', toAccountId: null, amountCents: -500, lines: [{ amountCents: -500, categoryId: 'aussenstaende-cpam', tags: [] }] },
    ]
    expect(claimStart(txs, cats, 2025)).toBe(80263)
    expect(claimStart(txs, cats, 2026)).toBe(80263 + 1000 + 500)
  })
})
