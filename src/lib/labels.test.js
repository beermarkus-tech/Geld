import { describe, expect, it } from 'vitest'

import { budgetDoc } from './budgetDocs'
import { isLabelId, labelIdFor, labelNames } from './labels'
import { planReplaceInBlock } from './tagActions'
import { tagUsage } from './tags'

describe('labels', () => {
  it('a label id has its own prefix and follows the text, not its case or punctuation', () => {
    expect(labelIdFor('Flug & Auto')).toBe('lbl:flug-auto')
    expect(labelIdFor('  flug  &  AUTO ')).toBe('lbl:flug-auto')
    expect(isLabelId('lbl:flug')).toBe(true)
    expect(isLabelId('flug')).toBe(false)
    expect(isLabelId(null)).toBe(false)
  })
  it('a budget document keeps the label text, a tag line stays unchanged', () => {
    expect(budgetDoc(2026, 'categoryId', 'urlaube', 'plan1', 3, 'lbl:flug', -5000, '', 'Flug')).toMatchObject({ breakdownTagId: 'lbl:flug', breakdownLabel: 'Flug', plannedAmountCents: -5000 })
    expect('breakdownLabel' in budgetDoc(2026, 'categoryId', 'urlaube', 'plan1', 3, 'hotels', -5000, '')).toBe(false)
  })
  it('names come from the budget documents', () => {
    const names = labelNames([
      { breakdownTagId: 'lbl:flug', breakdownLabel: 'Flug' },
      { breakdownTagId: 'lbl:flug', breakdownLabel: 'Flug' },
      { breakdownTagId: 'hotels' },
      { breakdownTagId: null },
    ])
    expect([...names]).toEqual([['lbl:flug', 'Flug']])
  })
  it('labels are not tag usage — Settings never lists them', () => {
    const usage = tagUsage({ transactions: [], budgets: [{ breakdownTagId: 'lbl:flug', year: 2026, planVersion: 'plan1', categoryId: 'u', plannedAmountCents: -1, breakdownLabel: 'Flug' }, { breakdownTagId: 'hotels', year: 2026, planVersion: 'plan1', categoryId: 'u', plannedAmountCents: -1 }] })
    expect([...usage.keys()]).toEqual(['hotels'])
  })
  it('renaming a label moves its budget documents and comments to the new id, with the new text', () => {
    const budgets = [{ id: 'b-2026-plan1-u-lbl:flug-03', year: 2026, planVersion: 'plan1', categoryId: 'u', allocationTagId: null, breakdownTagId: 'lbl:flug', breakdownLabel: 'Flug', month: 3, plannedAmountCents: -5000, note: 'n' }]
    const cellComments = [{ id: '2026__categoryId:u:plan1:lbl:flug__m3', year: 2026, rowId: 'categoryId:u:plan1:lbl:flug', colId: 'm3', text: 'x' }]
    const r = planReplaceInBlock({ tags: [], budgets, cellComments, year: 2026, targetKey: 'categoryId', targetId: 'u', planVersion: 'plan1', oldTagId: 'lbl:flug', isHeader: false, lineTagIds: ['lbl:flug'], newTagId: 'lbl:fluege', newLabel: 'Flüge' })
    expect(r.deletes.map((d) => d.col)).toEqual(['budgets', 'cellComments'])
    expect(r.sets[0].data).toMatchObject({ breakdownTagId: 'lbl:fluege', breakdownLabel: 'Flüge', plannedAmountCents: -5000, note: 'n' })
    expect(r.focusRowId).toBe('categoryId:u:plan1:lbl:fluege')
  })
})
