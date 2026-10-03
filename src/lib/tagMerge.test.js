import { describe, expect, it } from 'vitest'

import { duplicateTagMap, tagMergeWrites } from './tagMerge'

const tags = [
  { id: 'dirk', name: '2025 Besuch Dirk', parentTag: null, class: 'grouping', groupingType: 'project' },
  { id: 'aus-k', name: 'Ausgaben', parentTag: 'dirk', class: 'grouping', groupingType: null },
  { id: 'food--dirk--ausgaben', name: 'Ausgaben ', parentTag: 'dirk', class: 'grouping', groupingType: 'project' },
  { id: 'tiere', name: 'Tiere', parentTag: null, class: 'grouping' },
  { id: 'x--tiere', name: 'tiere', parentTag: null, class: 'grouping' },
  { id: 'kid', name: 'Futter', parentTag: 'x--tiere', class: 'grouping' },
  { id: 'other', name: 'Ausgaben', parentTag: 'elsewhere', class: 'grouping' },
  { id: 'alloc', name: 'Tiere', parentTag: null, class: 'allocation' },
]
const transactions = [
  { id: 't1', lines: [{ tags: ['aus-k'] }, { tags: ['aus-k'] }] },
  { id: 't2', lines: [{ tags: ['food--dirk--ausgaben', 'aus-k'] }] },
  { id: 't3', lines: [{ tags: ['tiere'] }] },
]

describe('duplicateTagMap', () => {
  it('pairs same-name siblings, keeping the one used most', () => {
    const m = duplicateTagMap(tags, transactions)
    expect([...m]).toEqual([
      ['food--dirk--ausgaben', 'aus-k'],
      ['x--tiere', 'tiere'],
    ])
  })
})

describe('tagMergeWrites', () => {
  const map = duplicateTagMap(tags, transactions)
  const budgets = [
    { id: 'b-2025-plan1-food-food--dirk--ausgaben-01', year: 2025, planVersion: 'plan1', categoryId: 'food', allocationTagId: null, breakdownTagId: 'food--dirk--ausgaben', month: 1, plannedAmountCents: -100, note: 'a' },
    { id: 'b-2025-plan1-food-aus-k-01', year: 2025, planVersion: 'plan1', categoryId: 'food', allocationTagId: null, breakdownTagId: 'aus-k', month: 1, plannedAmountCents: -50, note: 'b' },
    { id: 'b-2025-plan1-food-food--dirk--ausgaben-02', year: 2025, planVersion: 'plan1', categoryId: 'food', allocationTagId: null, breakdownTagId: 'food--dirk--ausgaben', month: 2, plannedAmountCents: -70, note: '' },
  ]
  const cellComments = [{ id: '2025__categoryId:food:plan1:food--dirk--ausgaben__m1', year: 2025, rowId: 'categoryId:food:plan1:food--dirk--ausgaben', colId: 'm1', text: 'hi' }]
  const { sets, deletes } = tagMergeWrites(map, { tags, transactions, budgets, cellComments })
  const set = (col, id) => sets.find((s) => s.col === col && s.id === id)?.data

  it('retags bookings without doubling a tag on one line', () => {
    expect(set('transactions', 't2').lines[0].tags).toEqual(['aus-k'])
    expect(set('transactions', 't1')).toBeUndefined()
  })
  it('moves budget rows, adding up a month both had', () => {
    expect(set('budgets', 'b-2025-plan1-food-aus-k-01')).toMatchObject({ plannedAmountCents: -150, note: 'b / a' })
    expect(set('budgets', 'b-2025-plan1-food-aus-k-02')).toMatchObject({ plannedAmountCents: -70, breakdownTagId: 'aus-k' })
    expect(deletes).toContainEqual({ col: 'budgets', id: 'b-2025-plan1-food-food--dirk--ausgaben-01' })
  })
  it('moves comments, re-parents children, takes over a type, deletes duplicates', () => {
    expect(set('cellComments', '2025__categoryId:food:plan1:aus-k__m1')).toMatchObject({ rowId: 'categoryId:food:plan1:aus-k', text: 'hi' })
    expect(set('tags', 'kid').parentTag).toBe('tiere')
    expect(set('tags', 'aus-k').groupingType).toBe('project')
    expect(deletes).toContainEqual({ col: 'tags', id: 'x--tiere' })
    expect(deletes).toContainEqual({ col: 'tags', id: 'food--dirk--ausgaben' })
  })
})
