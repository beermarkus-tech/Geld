import { describe, expect, it } from 'vitest'

import { newTagDoc, planFindOrCreate, planRename, planReplaceInBlock, planSetType, slugify } from './tagActions'

const tags = [
  { id: 'schottland', name: 'Schottland', parentTag: null, class: 'grouping', groupingType: 'project' },
  { id: 'hotels', name: 'Hotels', parentTag: 'schottland', class: 'grouping', groupingType: 'project' },
  { id: 'sparen', name: 'Sparen Familie', parentTag: null, class: 'allocation' },
]

describe('slugify / newTagDoc', () => {
  it('makes readable ids, numbered when taken', () => {
    expect(slugify(' Fähre & Straße ')).toBe('faehre-strasse')
    const taken = new Set(['hotels'])
    expect(newTagDoc(taken, { name: 'Hotels', now: 5 })).toMatchObject({ id: 'hotels-2', name: 'Hotels', createdAt: 5, class: 'grouping' })
    expect(newTagDoc(taken, { name: 'Hotels' }).id).toBe('hotels-3')
  })
})

describe('planFindOrCreate', () => {
  it('reuses an existing tag, ignoring case and the space after the colon', () => {
    expect(planFindOrCreate(tags, 'schottland:hotels')).toEqual({ tagId: 'hotels', creates: [] })
    expect(planFindOrCreate(tags, 'Schottland: Hotels').tagId).toBe('hotels')
  })
  it('creates a child under an existing parent', () => {
    const r = planFindOrCreate(tags, 'Schottland:Fähre', 'statement', 1)
    expect(r.creates).toEqual([expect.objectContaining({ id: 'faehre', name: 'Fähre', parentTag: 'schottland', groupingType: 'statement' })])
    expect(r.tagId).toBe('faehre')
  })
  it('creates a new parent with the chosen type too', () => {
    const r = planFindOrCreate(tags, '2025 La Rochelle:Unterkünfte', 'project', 1)
    expect(r.creates.map((d) => [d.id, d.parentTag, d.groupingType])).toEqual([
      ['2025-la-rochelle', null, 'project'],
      ['unterkuenfte', '2025-la-rochelle', 'project'],
    ])
  })
  it('creates a top-level tag, with a free id', () => {
    const r = planFindOrCreate(tags, 'Hotels', null, 1)
    expect(r.creates).toEqual([expect.objectContaining({ id: 'hotels-2', parentTag: null })])
  })
})

describe('planRename / planSetType', () => {
  it('renames, refusing clashes and locked tags', () => {
    expect(planRename(tags, 'hotels', ' Hotel ')).toMatchObject({ ok: true, doc: { id: 'hotels', name: 'Hotel', parentTag: 'schottland' } })
    expect(planRename(tags, 'sparen', 'X')).toMatchObject({ ok: false, reason: 'locked' })
  })
  it('changes the type, not of allocation tags, not when unchanged', () => {
    expect(planSetType(tags, 'hotels', 'claim')).toMatchObject({ id: 'hotels', groupingType: 'claim' })
    expect(planSetType(tags, 'hotels', 'project')).toBeNull()
    expect(planSetType(tags, 'sparen', 'claim')).toBeNull()
  })
})

describe('planReplaceInBlock', () => {
  const all = [
    ...tags,
    { id: 'fehmarn', name: 'Fehmarn', parentTag: null, class: 'grouping' },
    { id: 'fehmarn-hotels', name: 'hotels', parentTag: 'fehmarn', class: 'grouping' },
    { id: 'auto', name: 'Auto', parentTag: 'schottland', class: 'grouping', groupingType: 'project' },
    { id: 'haus', name: 'Haustiere', parentTag: null, class: 'grouping' },
    { id: 'tiere', name: 'Tiere', parentTag: null, class: 'grouping' },
  ]
  const b = (tag, month, cents, extra = {}) => ({ id: `b-2025-plan1-food-${tag}-0${month}`, year: 2025, planVersion: 'plan1', categoryId: 'food', allocationTagId: null, breakdownTagId: tag, month, plannedAmountCents: cents, note: '', ...extra })
  const budgets = [b('haus', 1, -100, { note: 'n' }), b('haus', 1, -7, { planVersion: 'plan0', id: 'p0' }), b('hotels', 2, -50), b('auto', 3, -20)]
  const cellComments = [{ id: '2025__categoryId:food:plan1:haus__m1', year: 2025, rowId: 'categoryId:food:plan1:haus', colId: 'm1', text: 'x' }]
  const base = { tags: all, budgets, cellComments, year: 2025, targetKey: 'categoryId', targetId: 'food', planVersion: 'plan1', now: 1 }

  it('moves a line: its budget rows and comments, this plan version only', () => {
    const r = planReplaceInBlock({ ...base, oldTagId: 'haus', isHeader: false, lineTagIds: ['haus'], newTagId: 'tiere' })
    expect(r.deletes).toEqual([{ col: 'budgets', id: 'b-2025-plan1-food-haus-01' }, { col: 'cellComments', id: '2025__categoryId:food:plan1:haus__m1' }])
    expect(r.sets.map((s) => s.id)).toEqual(['b-2025-plan1-food-tiere-01', '2025__categoryId:food:plan1:tiere__m1'])
    expect(r.sets[0].data).toMatchObject({ breakdownTagId: 'tiere', plannedAmountCents: -100, note: 'n' })
    expect(r.focusRowId).toBe('categoryId:food:plan1:tiere')
  })
  it('moves an Übergruppe: children by name, missing ones created with their type', () => {
    const r = planReplaceInBlock({ ...base, oldTagId: 'schottland', isHeader: true, lineTagIds: ['hotels', 'auto'], newTagId: 'fehmarn' })
    expect(r.creates).toEqual([expect.objectContaining({ id: 'auto-2', name: 'Auto', parentTag: 'fehmarn', groupingType: 'project' })])
    expect(r.sets.filter((s) => s.col === 'budgets').map((s) => s.data.breakdownTagId)).toEqual(['fehmarn-hotels', 'auto-2'])
    expect(r.focusRowId).toBe('categoryId:food:plan1:rollup:fehmarn')
  })
})
