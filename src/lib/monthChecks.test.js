import { describe, expect, it } from 'vitest'

import { monthChecks } from './monthChecks'

const accounts = [
  { id: 'bnp', reportingGroup: 'Barkonten' },
  { id: 'livret', reportingGroup: 'Sparkonten' },
  { id: 'aktien', reportingGroup: 'Geldanlage' },
]
const categories = [
  { id: 'g', name: 'Lebenshaltung', parentCategoryId: null },
  { id: 'food', name: 'Lebensmittel & Haushalt', parentCategoryId: 'g' },
  { id: 'pay', name: 'Gehalt Markus', parentCategoryId: 'g' },
]
const tags = [
  { id: 'sparen', class: 'allocation', reconciliationTargetAccountIds: ['livret'] },
  { id: 'anlage', class: 'allocation', reconciliationTargetAccountIds: ['aktien'] },
]
const tx = (id, date, from, to, cents, lines) => ({ id, date, fromAccountId: from, toAccountId: to, amountCents: cents, lines })
const base = [
  tx('o1', '2025-12-31', null, 'bnp', 1000000, []),
  tx('o2', '2025-12-31', null, 'livret', 2000000, [{ amountCents: 2000000, tags: ['sparen'] }]),
  tx('o3', '2025-12-31', null, 'aktien', 3000000, [{ amountCents: 3000000, tags: ['anlage'] }]),
  tx('s1', '2026-01-25', null, 'bnp', 400000, [{ amountCents: 400000, categoryId: 'pay', tags: [] }]),
  tx('f1', '2026-01-10', 'bnp', null, -120000, [{ amountCents: -120000, categoryId: 'food', tags: [] }]),
]
const run = (transactions, closedMonths = [1]) => monthChecks({ accounts, categories, tags, budgets: [], transactions, year: 2026, closedMonths })

describe('monthChecks', () => {
  it('only checks closed months, and a clean month balances', () => {
    const r = run(base)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ m: 1, prog: 1280000, kontostand: 1280000, progDelta: 0, ok: true })
    expect(r[0].reserves.map((x) => x.delta)).toEqual([0, 0])
  })
  it('a wrongly signed outflow shows up as a Prognose difference of twice its amount', () => {
    const r = run([...base, tx('w', '2026-01-12', 'bnp', null, 620, [{ amountCents: 620, categoryId: 'food', tags: [] }])])
    expect(r[0].progDelta).toBe(2 * 620)
    expect(r[0].ok).toBe(false)
  })
  it('an untagged gain on a reserve account shows up as an Unterkonten difference', () => {
    const r = run([...base, tx('g', '2026-01-28', null, 'aktien', 10000, [])])
    expect(r[0].reserves.find((x) => x.group === 'Geldanlage')).toMatchObject({ tags: 3000000, accounts: 3010000, delta: -10000 })
  })
  it('ignores deleted bookings', () => {
    const r = run([...base, { ...tx('d', '2026-01-12', 'bnp', null, -999, []), deletedAt: 1 }])
    expect(r[0].ok).toBe(true)
  })
})
