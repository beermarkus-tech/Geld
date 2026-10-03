import { describe, expect, it } from 'vitest'

import { EMPTY_USAGE, qualifiedName, tagIndex, tagUsage, usageHint } from './tags'

const tags = [
  { id: 'sco', name: 'Schottland', parentTag: null, class: 'grouping' },
  { id: 'hot', name: 'Hotels', parentTag: 'sco', class: 'grouping' },
]

describe('tagIndex / qualifiedName', () => {
  const { tagById, tagMap } = tagIndex(tags)
  it('looks tags up both ways', () => {
    expect(tagById.hot.name).toBe('Hotels')
    expect(tagMap.get('sco').name).toBe('Schottland')
  })
  it('names a child "Parent: Child", a top-level tag plainly, a plain-text tag by its text', () => {
    expect(qualifiedName('hot', tagById)).toBe('Schottland: Hotels')
    expect(qualifiedName('sco', tagById)).toBe('Schottland')
    expect(qualifiedName('RAW GET', tagById)).toBe('RAW GET')
  })
})

describe('tagUsage', () => {
  const usage = tagUsage({
    transactions: [
      { id: 't1', date: '2026-01-02', displayLabel: 'A', lines: [{ amountCents: -100, tags: ['hot', 'hot'] }, { amountCents: -50, tags: ['RAW'] }] },
      { id: 't2', date: '2026-03-01', displayLabel: 'B', deletedAt: 1, lines: [{ amountCents: -20, tags: ['hot'] }] },
    ],
    budgets: [
      { breakdownTagId: 'hot', year: 2025, planVersion: 'plan1', categoryId: 'food', plannedAmountCents: -100 },
      { breakdownTagId: 'hot', year: 2025, planVersion: 'plan1', categoryId: 'food', plannedAmountCents: -200 },
      { breakdownTagId: 'hot', year: 2025, planVersion: 'plan0', categoryId: 'food', plannedAmountCents: -5 },
      { breakdownTagId: null, year: 2025, planVersion: 'plan1', categoryId: 'food', plannedAmountCents: -1 },
    ],
    yearSettings: [{ targetId: 'sco' }],
  })
  it('counts booking lines once per line, deleted ones separately', () => {
    expect(usage.get('hot')).toMatchObject({ lines: 1, deletedLines: 1, planRows: 3 })
    expect(usage.get('hot').bookings.map((b) => b.txId)).toEqual(['t2', 't1'])
    expect(usage.get('RAW').lines).toBe(1)
  })
  it('groups plan rows per year · plan version · target', () => {
    expect(usage.get('hot').plans).toEqual([
      { key: '2025|plan0|food', year: 2025, planVersion: 'plan0', targetId: 'food', months: 1, sum: -5 },
      { key: '2025|plan1|food', year: 2025, planVersion: 'plan1', targetId: 'food', months: 2, sum: -300 },
    ])
    expect(usage.get('sco').yearSettings).toBe(1)
  })
  it('hints', () => {
    expect(usageHint(usage.get('hot'))).toBe('1 Buchung · 2 Plan')
    expect(usageHint(EMPTY_USAGE)).toBe('0 Buchungen')
  })
})
