import { describe, expect, it } from 'vitest'

import { autoChecks, bookingCounter, isDone, lastDay, openItems, toggleTick, accountHint, DEFAULT_ITEMS } from './monthClose'

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
  autoChecks({ year: 2026, accounts, categories, tags: [], budgets, transactions: base, claimCats: new Set(), needsCtx: { claimCategoryIds: new Set(), tagById: new Map() }, uptoMonth: 2, ...over })

describe('monthClose', () => {
  it('lastDay knows the month lengths', () => {
    expect(lastDay(2026, 2)).toBe('2026-02-28')
    expect(lastDay(2028, 2)).toBe('2028-02-29')
    expect(lastDay(2026, 12)).toBe('2026-12-31')
  })
  it('future months are not judged', () => {
    expect(run()('consors', 3).state).toBe(null)
  })
  it('autoTick accounts are done as soon as they have a booking in the month; without, a manual tick counts', () => {
    const count = bookingCounter(base, 2026)
    const bnp = DEFAULT_ITEMS.find((i) => i.id === 'bnp-import')
    const bar = DEFAULT_ITEMS.find((i) => i.id === 'bar')
    expect(count('bnp-konto', 1)).toBe(1)
    expect(isDone(bnp, 1, {}, count)).toBe(true)
    expect(isDone(bnp, 2, {}, count)).toBe(false)
    expect(isDone(bnp, 2, { 'bnp-import': [2] }, count)).toBe(true)
    expect(isDone(bar, 1, {}, count)).toBe(false)
    expect(openItems([bnp, bar], 1, {}, () => ({ state: 'ok' }), count)).toEqual(['Bar'])
  })
  it('Consors: below 200 € warns, from 200 € on it is fine', () => {
    expect(run({ transactions: [...base, tx('c', '2026-01-05', null, 'consors-verrechnungskonto', 20000)] })('consors', 1).state).toBe('ok')
    expect(run({ transactions: [...base, tx('c', '2026-01-05', null, 'consors-verrechnungskonto', 19999)] })('consors', 1).state).toBe('warn')
  })
  it('categorized only looks at the category, not at other yellow cells (e.g. a sign mismatch)', () => {
    const r = run({ transactions: [...base, tx('s', '2026-01-03', 'bnp-konto', null, 500, [{ amountCents: 500, categoryId: 'food', tags: [] }])] })
    expect(r('categorized', 1).state).toBe('ok')
  })
  it('Außenstände: ✓ when every claim line of the month has a claim tag', () => {
    const claimCats = new Set(['cpam'])
    const needsCtx = { claimCategoryIds: claimCats, tagById: { c1: { id: 'c1', class: 'grouping', groupingType: 'claim' } } }
    const line = (tags) => [{ amountCents: -3000, categoryId: 'cpam', tags }]
    expect(run({ claimCats, needsCtx, transactions: [...base, tx('a', '2026-01-04', 'bnp-konto', null, -3000, line(['c1']))] })('claims', 1).state).toBe('ok')
    expect(run({ claimCats, needsCtx, transactions: [...base, tx('a', '2026-01-04', 'bnp-konto', null, -3000, line([]))] })('claims', 1)).toMatchObject({ state: 'warn', jump: { txIds: ['a'] } })
  })
  it('categorized: a booking without category in that month warns with its id', () => {
    const r = run({ transactions: [...base, tx('x', '2026-02-02', 'bnp-konto', null, -500, [{ amountCents: -500, categoryId: null, tags: [] }])] })
    expect(r('categorized', 1).state).toBe('ok')
    expect(r('categorized', 2)).toMatchObject({ state: 'warn', jump: { txIds: ['x'] } })
  })
  it('ticks toggle, and open items list unticked manual and warning auto items', () => {
    const t = toggleTick({}, 'dkb', 1)
    expect(t).toEqual({ dkb: [1] })
    expect(toggleTick(t, 'dkb', 1)).toEqual({ dkb: [] })
    const items = [DEFAULT_ITEMS.find((i) => i.id === 'dkb'), DEFAULT_ITEMS.find((i) => i.id === 'consors-saldo')]
    expect(openItems(items, 1, {}, () => ({ state: 'ok' }))).toEqual(['DKB'])
    expect(openItems(items, 1, t, () => ({ state: 'warn' }))).toEqual(['Consors Verrechnungskonto ≥ 200 €'])
  })
  it('account hint: balance at month end and bookings in the month', () => {
    expect(accountHint('bnp-konto', 2026, 1, base)).toEqual({ balanceCents: 88000, count: 1 })
  })
})
