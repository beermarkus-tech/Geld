import { describe, expect, it } from 'vitest'

import { budgetDoc } from './budgetDocs'
import { progPlanVersion } from './budget'
import { plan1Contents, planCopyOps } from './planCopy'

const Y = 2027
const top = (pv, m, cents) => budgetDoc(Y, 'categoryId', 'food', pv, m, null, cents, '')
const line = (pv, tag, m, cents) => budgetDoc(Y, 'categoryId', 'food', pv, m, tag, cents, '')
const comment = (rowId, colId, text) => ({ id: `${Y}__${rowId}__${colId}`, year: Y, rowId, colId, text })

describe('Prog follows Plan0 while a row has no Plan1 figure', () => {
  it('per row', () => {
    const budgets = [top('plan0', 1, -10000), budgetDoc(Y, 'categoryId', 'rent', 'plan1', 1, null, -50000, '')]
    expect(progPlanVersion('categoryId', 'food', Y, budgets)).toBe('plan0')
    expect(progPlanVersion('categoryId', 'rent', Y, budgets)).toBe('plan1')
    // a Plan1 document holding only zeros does not count as "Plan1 exists"
    expect(progPlanVersion('categoryId', 'food', Y, [...budgets, top('plan1', 2, 0)])).toBe('plan0')
  })
})

describe('Plan0 → Plan1 copy', () => {
  const budgets = [
    line('plan0', 'hotels', 3, -30000),
    line('plan0', 'fehmarn', 7, -80000),
    top('plan0', 1, -110000),
    top('plan1', 1, -5000),
    line('plan1', 'alt', 2, -1000),
    budgetDoc(Y, 'categoryId', 'rent', 'plan1', 1, null, -50000, ''), // another row: untouched
    budgetDoc(Y - 1, 'categoryId', 'food', 'plan1', 1, null, -7000, ''), // another year: untouched
  ]
  const cellComments = [
    comment('categoryId:food:Plan0', 'm1', 'Grundbedarf'),
    comment('categoryId:food:plan0:hotels', 'm3', 'Ostern'),
    comment('categoryId:food:Plan1', 'm1', 'alt'),
    comment('categoryId:food:plan1:alt', 'm2', 'weg'),
    comment('categoryId:rent:Plan1', 'm1', 'bleibt'),
  ]
  const input = { budgets, cellComments, year: Y, targetKey: 'categoryId', targetId: 'food', now: 1 }

  it('reports what Plan1 already holds', () => {
    expect(plan1Contents(input)).toMatchObject({ lineCount: 1, commentCount: 2, hasAnything: true })
    expect(plan1Contents({ ...input, targetId: 'nothing' }).hasAnything).toBe(false)
  })
  it('writes Plan0’s months, lines and comments as Plan1 and removes the rest of Plan1', () => {
    const ops = planCopyOps(input)
    expect(ops.writeBudgets.map((b) => [b.id, b.planVersion, b.plannedAmountCents])).toEqual([
      ['b-2027-plan1-food-hotels-03', 'plan1', -30000],
      ['b-2027-plan1-food-fehmarn-07', 'plan1', -80000],
      ['b-2027-plan1-food-top-01', 'plan1', -110000],
    ])
    expect(ops.deleteBudgetIds).toEqual(['b-2027-plan1-food-alt-02']) // top-01 is overwritten, not deleted
    expect(ops.writeComments.map((c) => [c.rowId, c.colId, c.text])).toEqual([
      ['categoryId:food:Plan1', 'm1', 'Grundbedarf'],
      ['categoryId:food:plan1:hotels', 'm3', 'Ostern'],
    ])
    expect(ops.deleteCommentIds).toEqual(['2027__categoryId:food:plan1:alt__m2'])
  })
})
