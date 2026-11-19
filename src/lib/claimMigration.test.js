import { describe, expect, it } from 'vitest'

import { analyzeClaimMigration, planClaimMigration } from './claimMigration'

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

describe('planClaimMigration', () => {
  const rec = (id, from, to, amount, lines) => ({ id, date: '2026-03-01', fromAccountId: from, toAccountId: to, amountCents: amount, lines, detail: 'd' })
  it('turns Merkkonto bookings into one-sided bookings with the Außenstände sub-category, keeps tags, deletes the accounts', () => {
    const p = planClaimMigration({
      accounts,
      categories,
      transactions: [
        rec('lent', 'bnp', 'aussenstaende', 5000, [{ amountCents: 5000, categoryId: 'urlaube', tags: ['Dirk'], note: '' }]),
        rec('back', 'aussenstaende', 'bnp', 5000, [{ amountCents: 5000, categoryId: null, tags: ['Dirk'] }]),
        rec('cpam', 'cpam', 'bnp', 3000, [{ amountCents: 2000, tags: ['C1'] }, { amountCents: 1000, tags: ['C2'] }]),
        rec('open', 'jahresabschluss', 'reisekosten-airbus', 7000, [{ amountCents: 7000, tags: ['A1'] }]),
        rec('nolines', 'bnp', 'cpam', 400, []),
        rec('plain', 'bnp', null, -100, [{ amountCents: -100, categoryId: 'urlaube', tags: [] }]),
      ],
      rules: [{ id: 'r1', counterAccountId: 'cpam' }, { id: 'r2', groupName: 'Außenstände' }],
      now: 9,
    })
    const by = Object.fromEntries(p.bookings.map((b) => [b.id, b]))
    expect(Object.keys(by).sort()).toEqual(['back', 'cpam', 'lent', 'nolines', 'open'])
    expect(by.lent).toMatchObject({ fromAccountId: 'bnp', toAccountId: null, amountCents: -5000, updatedAt: 9 })
    expect(by.lent.lines).toEqual([{ amountCents: -5000, categoryId: 'aussenstaende-verliehen', tags: ['Dirk'], note: '' }])
    expect(by.back).toMatchObject({ fromAccountId: null, toAccountId: 'bnp', amountCents: 5000 })
    expect(by.cpam.lines.map((l) => [l.amountCents, l.categoryId, l.tags[0]])).toEqual([[2000, 'aussenstaende-cpam', 'C1'], [1000, 'aussenstaende-cpam', 'C2']])
    // an opening balance stays on Jahresabschluß, as money that went out (it is owed to us)
    expect(by.open).toMatchObject({ fromAccountId: 'jahresabschluss', toAccountId: null, amountCents: -7000 })
    expect(by.open.lines[0]).toMatchObject({ amountCents: -7000, categoryId: 'aussenstaende-airbus-reisekosten', tags: ['A1'] })
    expect(by.nolines.lines).toEqual([{ amountCents: -400, categoryId: 'aussenstaende-cpam', note: 'd', tags: [] }])
    expect(p.categories.map((c) => c.id)).toEqual(['aussenstaende-kategorie', 'aussenstaende-cpam', 'aussenstaende-airbus-reisekosten', 'aussenstaende-verliehen'])
    expect(p.ruleUpdates).toEqual([
      { id: 'r1', patch: { counterAccountId: null, groupName: 'Außenstände', categoryId: 'aussenstaende-cpam', categoryName: 'CPAM' } },
      { id: 'r2', patch: { counterAccountId: null, groupName: 'Außenstände', categoryId: 'aussenstaende-verliehen', categoryName: 'Verliehen' } },
    ])
    expect(p.deleteAccounts.sort()).toEqual(['aussenstaende', 'cpam', 'reisekosten-airbus'])
    expect(p.blocked).toBe(0)
  })
  it('claims net to zero after the switch: lent −50, repaid +50 → open 0; opening balance → owed to us', async () => {
    const { claimTotal } = await import('./claims')
    const p = planClaimMigration({
      accounts,
      categories,
      transactions: [rec('lent', 'bnp', 'aussenstaende', 5000, [{ amountCents: 5000, tags: ['Dirk'] }]), rec('back', 'aussenstaende', 'bnp', 5000, [{ amountCents: 5000, tags: ['Dirk'] }]), rec('open', 'jahresabschluss', 'cpam', 7000, [{ amountCents: 7000, tags: ['C'] }])],
    })
    const cats = new Set(['aussenstaende-verliehen', 'aussenstaende-cpam', 'aussenstaende-airbus-reisekosten'])
    expect(claimTotal(p.bookings, cats, '9999-12-31', 'aussenstaende-verliehen')).toBe(0)
    expect(claimTotal(p.bookings, cats, '9999-12-31', 'aussenstaende-cpam')).toBe(7000)
  })
})
