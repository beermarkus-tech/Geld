import { describe, expect, it } from 'vitest'

import { autoChecks, lastDay, openItems, toggleTick, accountHint, DEFAULT_ITEMS } from './monthClose'

const accounts = [
  { id: 'bnp-konto', reportingGroup: 'Barkonten' },
  { id: 'consors-verrechnungskonto', reportingGroup: 'Barkonten' },
]
const categories = [
  { id: 'g', name: 'Lebenshaltung', parentCategoryId: null },
  { id: 'food', name: 'Lebensmittel', parentCategoryId: 'g' },
]
const tx = (id, date, from, to, cents, lines = []) => ({ id, date, fromAccountId: from, toAccountId: to, amountCents: cents, lines })
const base = [
  tx('o1', '2025-12-31', null, 'bnp-konto', 100000, []),
  tx('f1', '2026-01-10', 'bnp-konto', null, -12000, [{ amountCents: -12000, categoryId: 'food', tags: [] }]),
]
const budgets = [{ id: 'b1', year: 2026, month: 1, planVersion: 'plan1', categoryId: 'food', breakdownTagId: null, plannedAmountCents: -12000 }]
const run = (over = {}) =>
  autoChecks({ year: 2026, accounts, categories, tags: [], budgets, transactions: base, importBatches: [], claimCats: new Set(), needsCtx: { claimCategoryIds: new Set(), tagById: new Map() }, percent: 5, uptoMonth: 2, ...over })

describe('monthClose', () => {
  it('lastDay knows the month lengths', () => {
    expect(lastDay(2026, 2)).toBe('2026-02-28')
    expect(lastDay(2028, 2)).toBe('2028-02-29')
    expect(lastDay(2026, 12)).toBe('2026-12-31')
  })
  it('future months are not judged', () => {
    expect(run()('consors', 3).state).toBe(null)
  })
  it('BNP import: missing, covering and matching, covering but off', () => {
    expect(run()('bnpImport', 1).state).toBe('warn')
    const ok = { accountId: 'bnp-konto', status: 'committed', balanceDate: '2026-02-03', bankBalanceCents: 88000 }
    expect(run({ importBatches: [ok] })('bnpImport', 1).state).toBe('ok')
    expect(run({ importBatches: [{ ...ok, bankBalanceCents: 90000 }] })('bnpImport', 1)).toMatchObject({ state: 'warn' })
    expect(run({ importBatches: [{ ...ok, balanceDate: '2026-01-28' }] })('bnpImport', 1).state).toBe('warn')
  })
  it('Consors: over 200 € warns, up to 200 € is fine', () => {
    expect(run({ transactions: [...base, tx('c', '2026-01-05', null, 'consors-verrechnungskonto', 20000)] })('consors', 1).state).toBe('ok')
    expect(run({ transactions: [...base, tx('c', '2026-01-05', null, 'consors-verrechnungskonto', 20001)] })('consors', 1).state).toBe('warn')
  })
  it('Verlauf: a category off its Plan1 warns', () => {
    expect(run()('verlauf', 1).state).toBe('ok')
    expect(run({ transactions: [...base, tx('f2', '2026-01-12', 'bnp-konto', null, -9000, [{ amountCents: -9000, categoryId: 'food', tags: [] }])] })('verlauf', 1)).toMatchObject({ state: 'warn', jump: { view: 'verlauf', month: 1 } })
  })
  it('categorized: a booking without category in that month warns with its id', () => {
    const r = run({ transactions: [...base, tx('x', '2026-02-02', 'bnp-konto', null, -500, [{ amountCents: -500, categoryId: null, tags: [] }])] })
    expect(r('categorized', 1).state).toBe('ok')
    expect(r('categorized', 2)).toMatchObject({ state: 'warn', jump: { txIds: ['x'] } })
  })
  it('claims are info only', () => {
    expect(run()('claims', 1).state).toBe('info')
  })
  it('ticks toggle, and open items list unticked manual and warning auto items', () => {
    const t = toggleTick({}, 'dkb', 1)
    expect(t).toEqual({ dkb: [1] })
    expect(toggleTick(t, 'dkb', 1)).toEqual({ dkb: [] })
    const items = [DEFAULT_ITEMS.find((i) => i.id === 'dkb'), DEFAULT_ITEMS.find((i) => i.id === 'consors-saldo')]
    expect(openItems(items, 1, {}, () => ({ state: 'ok' }))).toEqual(['DKB'])
    expect(openItems(items, 1, t, () => ({ state: 'warn' }))).toEqual(['Consors Verrechnungskonto ≤ 200 €'])
  })
  it('account hint: balance at month end and bookings in the month', () => {
    expect(accountHint('bnp-konto', 2026, 1, base)).toEqual({ balanceCents: 88000, count: 1 })
  })
})
