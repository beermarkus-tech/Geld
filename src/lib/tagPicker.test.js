import { describe, expect, it } from 'vitest'

import { findTagByText, splitTagText, tagKey } from './tagPicker'

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
