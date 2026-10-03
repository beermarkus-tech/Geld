import { describe, expect, it } from 'vitest'

import { planMerge } from './tagMerge'

const tags = [
  { id: 'dirk', name: '2025 Besuch Dirk', parentTag: null, class: 'grouping', groupingType: 'project' },
  { id: 'aus-k', name: 'Ausgaben', parentTag: 'dirk', class: 'grouping', groupingType: null },
  { id: 'food--dirk--ausgaben', name: 'Ausgaben ', parentTag: 'dirk', class: 'grouping', groupingType: 'project' },
  { id: 'tiere', name: 'Tiere', parentTag: null, class: 'grouping' },
  { id: 'x--tiere', name: 'tiere', parentTag: null, class: 'grouping' },
  { id: 'kid', name: 'Futter', parentTag: 'x--tiere', class: 'grouping' },
  { id: 'alloc', name: 'Sparen', parentTag: null, class: 'allocation' },
]
const transactions = [
  { id: 't1', lines: [{ tags: ['aus-k'] }, { tags: ['aus-k'] }] },
  { id: 't2', lines: [{ tags: ['food--dirk--ausgaben', 'aus-k'] }] },
  { id: 't3', lines: [{ tags: ['tiere'] }] },
]
const b = (tag, month, cents, note = '') => ({ id: `b-2025-plan1-food-${tag}-0${month}`, year: 2025, planVersion: 'plan1', categoryId: 'food', allocationTagId: null, breakdownTagId: tag, month, plannedAmountCents: cents, note })
const budgets = [b('food--dirk--ausgaben', 1, -100, 'a'), b('aus-k', 1, -50, 'b'), b('food--dirk--ausgaben', 2, -70)]
const cellComments = [{ id: '2025__categoryId:food:plan1:food--dirk--ausgaben__m1', year: 2025, rowId: 'categoryId:food:plan1:food--dirk--ausgaben', colId: 'm1', text: 'hi' }]

describe('planMerge', () => {
  const r = planMerge(tags, 'food--dirk--ausgaben', 'aus-k', { transactions, budgets, cellComments })
  const set = (col, id) => r.sets.find((s) => s.col === col && s.id === id)?.data
  it('retags bookings without doubling a tag on one line', () => {
    expect(set('transactions', 't2').lines[0].tags).toEqual(['aus-k'])
    expect(set('transactions', 't1')).toBeUndefined()
  })
  it('moves plan rows, adding up a month both had, and comments', () => {
    expect(set('budgets', 'b-2025-plan1-food-aus-k-01')).toMatchObject({ plannedAmountCents: -150, note: 'b / a' })
    expect(set('budgets', 'b-2025-plan1-food-aus-k-02')).toMatchObject({ plannedAmountCents: -70, breakdownTagId: 'aus-k' })
    expect(r.deletes).toContainEqual({ col: 'budgets', id: 'b-2025-plan1-food-food--dirk--ausgaben-01' })
    expect(set('cellComments', '2025__categoryId:food:plan1:aus-k__m1')).toMatchObject({ rowId: 'categoryId:food:plan1:aus-k' })
  })
  it('takes over a type and deletes the merged tag', () => {
    expect(set('tags', 'aus-k').groupingType).toBe('project')
    expect(r.deletes).toContainEqual({ col: 'tags', id: 'food--dirk--ausgaben' })
  })
  it('moves children under the kept tag', () => {
    const m = planMerge(tags, 'x--tiere', 'tiere', { transactions, budgets: [], cellComments: [] })
    expect(m.sets.find((s) => s.id === 'kid').data.parentTag).toBe('tiere')
  })
  it('refuses what would break the tree', () => {
    expect(planMerge(tags, 'x--tiere', 'aus-k', { transactions }).reason).toBe('has-children')
    expect(planMerge(tags, 'x--tiere', 'kid', { transactions }).reason).toBe('into-child')
    expect(planMerge(tags, 'alloc', 'tiere', { transactions }).reason).toBe('locked')
    expect(planMerge(tags, 'tiere', 'tiere', { transactions }).reason).toBe('same')
  })
})
