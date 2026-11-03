import { describe, expect, it } from 'vitest'

import { newRowPrefill } from './newRowPrefill'

const categories = [
  { id: 'g', name: 'Lebenshaltung', parentCategoryId: null },
  { id: 'food', name: 'Lebensmittel', parentCategoryId: 'g' },
  { id: 'fuel', name: 'Tanken', parentCategoryId: 'g' },
]
const tagList = [{ id: 't1', name: 'Schottland' }, { id: 't2', name: 'Schottland: Fähre' }, { id: 't3', name: 'Sparen' }]
const ctx = { categories, tagList }

describe('newRowPrefill', () => {
  it('takes over Empfänger and Details from contains/equals/one ticked value', () => {
    expect(newRowPrefill({ empfaenger: { filterType: 'text', type: 'contains', filter: 'PayPal' } }, ctx)).toEqual({ displayLabel: 'PayPal' })
    expect(newRowPrefill({ empfaenger: { filterType: 'values', values: ['Lidl'] }, details: { filterType: 'text', type: 'equals', filter: 'x' } }, ctx)).toEqual({ displayLabel: 'Lidl', detail: 'x' })
  })
  it('leaves blank, many values, Betrag and Datum alone', () => {
    expect(newRowPrefill({ empfaenger: { filterType: 'text', type: 'blank' }, betrag: { filterType: 'text', type: 'contains', filter: '5' }, date: { filterType: 'text', type: 'contains', filter: '2026' } }, ctx)).toEqual({})
    expect(newRowPrefill({ empfaenger: { filterType: 'values', values: ['a', 'b'] } }, ctx)).toEqual({})
  })
  it('finds the category only when exactly one leaf matches', () => {
    expect(newRowPrefill({ unterkategorie: { filterType: 'text', type: 'contains', filter: 'tank' } }, ctx)).toEqual({ categoryId: 'fuel' })
    expect(newRowPrefill({ unterkategorie: { filterType: 'text', type: 'contains', filter: 'e' } }, ctx)).toEqual({})
    expect(newRowPrefill({ unterkategorie: { filterType: 'values', values: ['Lebensmittel'] } }, ctx)).toEqual({ categoryId: 'food' })
  })
  it('tags: exact name wins over contains; a tag filter on the grid adds that tag', () => {
    expect(newRowPrefill({ tags: { filterType: 'text', type: 'contains', filter: 'Schottland' } }, ctx)).toEqual({ tagIds: ['t1'] })
    expect(newRowPrefill({}, { ...ctx, tagFilterId: 't3' })).toEqual({ tagIds: ['t3'] })
    expect(newRowPrefill({ tags: { filterType: 'values', values: ['Sparen'] } }, { ...ctx, tagFilterId: 't3' })).toEqual({ tagIds: ['t3'] })
  })
})
