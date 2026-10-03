import { describe, expect, it } from 'vitest'

import { findTagByText, headerChildMapping, replaceOptions, splitTagText, tagKey } from './tagPicker'

const tags = [
  { id: 'schottland', name: 'Schottland', parentTag: null, class: 'grouping' },
  { id: 'hotels', name: 'Hotels', parentTag: 'schottland', class: 'grouping' },
  { id: 'alt', name: 'Alt', parentTag: null, class: 'grouping', archived: true },
  { id: 'a', name: 'Anlage', parentTag: null, class: 'allocation' },
]

describe('tagPicker', () => {
  it('splits parent and child', () => {
    expect(splitTagText('Schottland:Hotels')).toEqual({ parent: 'Schottland', child: 'Hotels' })
    expect(splitTagText(' Schottland : Hotels ')).toEqual({ parent: 'Schottland', child: 'Hotels' })
    expect(splitTagText('Hotels')).toEqual({ parent: null, child: 'Hotels' })
    expect(splitTagText('Schottland:')).toEqual({ parent: null, child: 'Schottland:' })
  })
  it('compares ignoring case and spaces around the colon', () => {
    expect(tagKey('Schottland: Hotels')).toBe(tagKey('schottland:hotels'))
  })
  it('finds existing grouping tags by qualified name', () => {
    expect(findTagByText(tags, 'schottland')?.id).toBe('schottland')
    expect(findTagByText(tags, 'Schottland: Hotels')?.id).toBe('hotels')
    expect(findTagByText(tags, 'Hotels')).toBeUndefined()
    expect(findTagByText(tags, 'Alt')).toBeUndefined()
    expect(findTagByText(tags, 'Anlage')).toBeUndefined()
  })
})

describe('replaceOptions / headerChildMapping', () => {
  const t = [
    { id: 'sch', name: 'Schottland', parentTag: null, class: 'grouping' },
    { id: 'feh', name: 'Fehmarn', parentTag: null, class: 'grouping' },
    { id: 'haus', name: 'Haustiere', parentTag: null, class: 'grouping' },
    { id: 'tiere', name: 'Tiere', parentTag: null, class: 'grouping' },
    { id: 'sch-h', name: 'Hotels', parentTag: 'sch', class: 'grouping' },
    { id: 'sch-f', name: 'Fähre', parentTag: 'sch', class: 'grouping', groupingType: 'project' },
    { id: 'sch-a', name: 'Auto', parentTag: 'sch', class: 'grouping' },
    { id: 'feh-h', name: 'hotels', parentTag: 'feh', class: 'grouping' },
    { id: 'alloc', name: 'Sparen', parentTag: null, class: 'allocation' },
    { id: 'old', name: 'Alt', parentTag: null, class: 'grouping', archived: true },
  ]
  const ids = (list) => list.map((x) => x.id)
  it('a child line is offered its siblings only', () => {
    expect(ids(replaceOptions(t, { kind: 'child', tagId: 'sch-h', parentId: 'sch', blockTagIds: new Set(['sch', 'sch-h', 'sch-f']) }))).toEqual(['sch-a'])
  })
  it('a standalone line and a header are offered top-level tags not in the block', () => {
    expect(ids(replaceOptions(t, { kind: 'standalone', tagId: 'haus', blockTagIds: new Set(['haus', 'sch']) }))).toEqual(['feh', 'tiere'])
    expect(ids(replaceOptions(t, { kind: 'header', tagId: 'sch', parentId: 'sch', blockTagIds: new Set(['sch', 'haus']) }))).toEqual(['feh', 'tiere'])
  })
  it('maps children to the new parent by name, creating missing ones', () => {
    const { mapping, create } = headerChildMapping(t, ['sch-h', 'sch-f'], 'feh')
    expect([...mapping]).toEqual([['sch-h', 'feh-h']])
    expect(create).toEqual([{ fromId: 'sch-f', name: 'Fähre', groupingType: 'project' }])
  })
})
