import { describe, expect, it } from 'vitest'

import { unusedTagIds } from './unusedTags'

// Synthetic fixtures only.
const tag = (id, extra = {}) => ({ id, class: 'grouping', parentTag: null, ...extra })
const tx = (...tagIds) => ({ lines: [{ tags: tagIds }] })

describe('unusedTagIds()', () => {
  it('keeps tags used on any line (also of soft-deleted bookings) and removes the rest', () => {
    const tags = [tag('used'), tag('onDeleted'), tag('free')]
    const transactions = [tx('used'), { ...tx('onDeleted'), deletedAt: 1 }]
    expect(unusedTagIds({ tags, transactions })).toEqual(['free'])
  })

  it('keeps a parent while a child is used, removes both when neither is', () => {
    const tags = [tag('parent'), tag('child', { parentTag: 'parent' }), tag('p2'), tag('c2', { parentTag: 'p2' })]
    expect(unusedTagIds({ tags, transactions: [tx('child')] }).sort()).toEqual(['c2', 'p2'])
  })

  it('never removes allocation tags, keeps budget-breakdown and year-setting references', () => {
    const tags = [tag('spar', { class: 'allocation' }), tag('bd'), tag('ys'), tag('x')]
    expect(unusedTagIds({ tags, transactions: [], budgets: [{ breakdownTagId: 'bd' }], yearSettings: [{ targetId: 'ys' }] })).toEqual(['x'])
  })

  it('leaves a just-created tag alone', () => {
    const now = 1_000_000_000
    const tags = [tag('new', { createdAt: now - 1000 }), tag('old', { createdAt: now - 2 * 24 * 3600 * 1000 }), tag('legacy')]
    expect(unusedTagIds({ tags, transactions: [], now })).toEqual(['old', 'legacy'])
  })
})
