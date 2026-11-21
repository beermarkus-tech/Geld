import { describe, expect, it } from 'vitest'

import { tagBalance, tagBalanceByAccount } from './tagBalance'
import { asOfDate, potLocations, yearBalance } from './yearBalance'

const accounts = [
  { id: 'bnp', name: 'BNP', reportingGroup: 'Barkonten' },
  { id: 'livret', name: 'Livret', reportingGroup: 'Sparkonten' },
  { id: 'aktien', name: 'Aktien', reportingGroup: 'Geldanlage' },
  { id: 'crypto', name: 'Crypto', reportingGroup: 'Geldanlage' },
  { id: 'jahresabschluss', name: 'Jahresabschluß', reportingGroup: null },
]
const categories = [
  { id: 'ein', name: 'Einnahmen', parentCategoryId: null },
  { id: 'pay', name: 'Gehalt Markus', parentCategoryId: 'ein' },
  { id: 'g', name: 'Lebenshaltung', parentCategoryId: null },
  { id: 'food', name: 'Lebensmittel & Haushalt', parentCategoryId: 'g' },
]
const tags = [
  { id: 'sparen-familie', name: 'Sparen Familie', class: 'allocation', reconciliationTargetAccountIds: ['livret'] },
  { id: 'anlage-familie', name: 'Anlage Familie', class: 'allocation', reconciliationTargetAccountIds: ['aktien', 'crypto'] },
  { id: 'leer', name: 'Leer', class: 'allocation', reconciliationTargetAccountIds: ['livret'] },
]
const b = (pv, key, id, month, cents) => ({ year: 2026, month, planVersion: pv, type: 'expense', [key]: id, breakdownTagId: null, plannedAmountCents: cents })
const budgets = [
  ...[1, 2, 3].map((m) => b('plan1', 'categoryId', 'pay', m, 400000)),
  ...[1, 2, 3].map((m) => b('plan1', 'categoryId', 'food', m, -100000)),
  ...[1, 2, 3].map((m) => b('plan0', 'categoryId', 'pay', m, 300000)),
  b('plan1', 'allocationTagId', 'sparen-familie', 3, -50000),
]
const tx = (id, date, from, to, cents, lines) => ({ id, date, fromAccountId: from, toAccountId: to, amountCents: cents, lines })
const transactions = [
  tx('o1', '2025-12-31', 'jahresabschluss', 'bnp', 1000000, []),
  tx('o2', '2025-12-31', 'jahresabschluss', 'livret', 200000, [{ amountCents: 200000, tags: ['sparen-familie'] }]),
  tx('o3', '2025-12-31', 'jahresabschluss', 'aktien', 300000, [{ amountCents: 300000, tags: ['anlage-familie'] }]),
  tx('s1', '2026-01-25', null, 'bnp', 400000, [{ amountCents: 400000, categoryId: 'pay', tags: [] }]),
  tx('f1', '2026-01-10', 'bnp', null, -120000, [{ amountCents: -120000, categoryId: 'food', tags: [] }]),
  tx('t1', '2026-01-28', 'bnp', 'crypto', 100000, [{ amountCents: 100000, tags: ['anlage-familie'] }]),
]
const input = { accounts, categories, tags, budgets, transactions, year: 2026, closedMonths: [1] }

describe('tagBalanceByAccount', () => {
  it('splits a pot by the account holding it and adds up to tagBalance', () => {
    const by = tagBalanceByAccount('anlage-familie', '2026-12-31', transactions, tags)
    expect(by).toEqual({ aktien: 300000, crypto: 100000 })
    expect(by.aktien + by.crypto).toBe(tagBalance('anlage-familie', '2026-12-31', transactions, tags))
  })
})

describe('yearBalance', () => {
  const r = yearBalance(input)
  it('Einnahmen = income categories, Ausgaben = the other categories, per version', () => {
    expect(r.versions.plan0).toMatchObject({ start: 1500000, einnahmen: 900000, ausgaben: 0, ende: 2400000 })
    expect(r.versions.plan1).toMatchObject({ einnahmen: 1200000, ausgaben: 300000, ende: 2400000 })
    // January booked (+4.000 / −1.200), Feb and Mar Plan1
    expect(r.versions.prog).toMatchObject({ einnahmen: 1200000, ausgaben: 320000, ende: 2380000 })
  })
  it('a transfer into a pot is no Ausgabe: the end segments add up to the Prognose end', () => {
    expect(r.startParts.map((p) => p.cents)).toEqual([1000000, 200000, 300000, 0])
    expect(r.endParts.find((p) => p.id === 'sparen-familie').cents).toBe(250000)
    expect(r.endParts.reduce((s, p) => s + p.cents, 0)).toBe(r.versions.prog.ende)
  })
})

describe('potLocations', () => {
  it('takes the end of the last closed month and leaves empty pots out', () => {
    expect(asOfDate(2026, [1, 2])).toBe('2026-02-28')
    expect(asOfDate(2026, [])).toBe('2025-12-31')
    const r = potLocations(input)
    expect(r.date).toBe('2026-01-31')
    expect(r.pots.map((p) => p.id)).toEqual(['sparen-familie', 'anlage-familie'])
    expect(r.pots[1]).toMatchObject({ total: 400000, parts: [{ name: 'Aktien', cents: 300000 }, { name: 'Crypto', cents: 100000 }] })
  })
})

describe('the first year', () => {
  it('counts the opening balances dated 1 Jan into the start bar', () => {
    const txs = [
      tx('o1', '2026-01-01', 'jahresabschluss', 'bnp', 1000000, []),
      tx('o2', '2026-01-01', 'jahresabschluss', 'livret', 200000, [{ amountCents: 200000, tags: ['sparen-familie'] }]),
    ]
    const r = yearBalance({ ...input, transactions: txs, closedMonths: [] })
    expect(r.startParts.find((p) => p.id === 'sparen-familie').cents).toBe(200000)
    expect(r.startParts.reduce((s, p) => s + p.cents, 0)).toBe(r.versions.prog.start)
  })
})

describe('provisional start', () => {
  it('the start bar is the year before’s end bar while that year has open months', () => {
    const b = [...budgets, { ...budgets[0], year: 2027 }]
    const prev = yearBalance({ ...input, budgets: b })
    const r = yearBalance({ ...input, budgets: b, year: 2027, closedMonths: [], closedByYear: { 2026: [1] } })
    expect(r.provisional).toBe(true)
    expect(r.startParts).toEqual(prev.endParts)
    expect(r.startParts.reduce((s, p) => s + p.cents, 0)).toBe(r.versions.prog.start)
  })
})
