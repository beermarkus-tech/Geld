import { describe, expect, it } from 'vitest'

import { confirmedModel, isKnownQuickModel, quickFilterPasses, quickItems, suggestionsFor } from './quickFilter'

describe('quickFilterPasses()', () => {
  it('contains: case-insensitive and spaces count', () => {
    const m = { filterType: 'text', type: 'contains', filter: 'markt 1' }
    expect(quickFilterPasses(m, 'Markt 12')).toBe(true)
    expect(quickFilterPasses(m, 'Markt1')).toBe(false)
    expect(quickFilterPasses({ ...m, filter: 'r ' }, 'Bar x')).toBe(true)
    expect(quickFilterPasses({ ...m, filter: 'r ' }, 'Bar')).toBe(false)
  })
  it('equals and blank (used by the Quickview links)', () => {
    expect(quickFilterPasses({ filterType: 'text', type: 'equals', filter: 'Kurz' }, 'kurz')).toBe(true)
    expect(quickFilterPasses({ filterType: 'text', type: 'equals', filter: 'Kurz' }, 'Kurz Plus')).toBe(false)
    expect(quickFilterPasses({ filterType: 'text', type: 'blank' }, '  ')).toBe(true)
    expect(quickFilterPasses({ filterType: 'text', type: 'blank' }, 'x')).toBe(false)
  })
  it('values: any of the cell\'s entries is ticked', () => {
    const m = { filterType: 'values', values: ['Hotel', 'Fähre'] }
    expect(quickFilterPasses(m, 'Hotel, Reise', ['Hotel', 'Reise'])).toBe(true)
    expect(quickFilterPasses(m, 'Reise', ['Reise'])).toBe(false)
    expect(quickFilterPasses(m, 'fähre', ['fähre'])).toBe(true)
  })
  it('no model passes everything', () => {
    expect(quickFilterPasses(null, 'x')).toBe(true)
  })
})

describe('quickItems()', () => {
  it('splits tags, takes the shown form of an amount, drops blanks', () => {
    expect(quickItems('tags', 'A, B: C')).toEqual(['A', 'B: C'])
    expect(quickItems('betrag', '-1.000,00 -1000,00')).toEqual(['-1.000,00'])
    expect(quickItems('details', '  ')).toEqual([])
    expect(quickItems('empfaenger', 'Lidl')).toEqual(['Lidl'])
  })
})

describe('suggestionsFor()', () => {
  it('lists distinct matches sorted, keeps spaces, caps and reports the rest', () => {
    const c = ['Markt 2', 'Markt 10', 'Markt 2', 'Bäcker', 'markt 1']
    expect(suggestionsFor(c, 'markt ').items).toEqual(['markt 1', 'Markt 2', 'Markt 10'])
    expect(suggestionsFor(c, 'markt', 2)).toEqual({ items: ['markt 1', 'Markt 2'], more: 1 })
    expect(suggestionsFor(c, '').items).toHaveLength(4)
  })
})

describe('confirmedModel()', () => {
  it('ticked entries win, then the highlighted one, then the typed text, else clear', () => {
    expect(confirmedModel({ ticked: ['a', 'b'], highlighted: 'c', text: 'x' })).toEqual({ filterType: 'values', values: ['a', 'b'] })
    expect(confirmedModel({ ticked: [], highlighted: 'c', text: 'x' })).toEqual({ filterType: 'values', values: ['c'] })
    expect(confirmedModel({ ticked: [], highlighted: null, text: 'ab cd' })).toEqual({ filterType: 'text', type: 'contains', filter: 'ab cd' })
    expect(confirmedModel({ ticked: [], highlighted: null, text: '   ' })).toBeNull()
  })
})

describe('isKnownQuickModel()', () => {
  it('accepts the supported shapes only', () => {
    expect(isKnownQuickModel({ filterType: 'text', type: 'contains', filter: 'x' })).toBe(true)
    expect(isKnownQuickModel({ filterType: 'values', values: ['a'] })).toBe(true)
    expect(isKnownQuickModel({ filterType: 'number', type: 'equals', filter: 1 })).toBe(false)
    expect(isKnownQuickModel({ filterType: 'text', conditions: [] })).toBe(false)
  })
})
