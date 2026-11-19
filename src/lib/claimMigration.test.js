import { describe, expect, it } from 'vitest'

import { analyzeClaimMigration } from './claimMigration'

const accounts = [
  { id: 'bnp', group: 'cash' },
  { id: 'aussenstaende', group: 'receivable' },
  { id: 'cpam', group: 'receivable' },
  { id: 'reisekosten-airbus', group: 'receivable' },
  { id: 'jahresabschluss', group: 'system' },
]
const categories = [{ id: 'urlaube', name: 'Urlaube', parentCategoryId: 'x' }, { id: 'old-cpam', name: 'CPAM', parentCategoryId: 'y' }]
const tx = (id, from, to, cat = null, extra = {}) => ({ id, date: '2026-03-01', fromAccountId: from, toAccountId: to, amountCents: 100, lines: [{ amountCents: 100, categoryId: cat, tags: [] }], ...extra })

describe('analyzeClaimMigration', () => {
  it('sorts the bookings on Merkkonten into the cases the switch must handle', () => {
    const r = analyzeClaimMigration({
      accounts,
      categories,
      transactions: [
        tx('n1', 'bnp', 'aussenstaende', 'urlaube'),
        tx('n2', 'cpam', 'bnp'),
        tx('b1', 'cpam', 'aussenstaende'),
        tx('e1', 'aussenstaende', null),
        tx('a1', 'jahresabschluss', 'reisekosten-airbus'),
        tx('x', 'bnp', null),
        tx('gone', 'bnp', 'cpam', null, { deletedAt: 1 }),
      ],
      rules: [{ id: 'r1', counterAccountId: 'aussenstaende' }, { id: 'r2', counterAccountId: 'livret' }, { id: 'r3', groupName: 'Außenstände' }],
    })
    expect(r.normal.map((i) => i.tx.id)).toEqual(['n1', 'n2'])
    expect(r.between.map((i) => i.tx.id)).toEqual(['b1'])
    expect(r.external.map((i) => i.tx.id)).toEqual(['e1'])
    expect(r.anchors.map((i) => i.tx.id)).toEqual(['a1'])
    expect(r.recategorized.map((i) => [i.tx.id, i.categoryName])).toEqual([['n1', 'Urlaube']])
    expect(r.existingCategories.map((c) => c.id)).toEqual(['old-cpam'])
    expect(r.rules.map((x) => x.id)).toEqual(['r1', 'r3'])
    expect(r.byTarget).toEqual({ Verliehen: 2, CPAM: 2, 'Airbus-Reisekosten': 1 })
  })
})
