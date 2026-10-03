import { describe, expect, it } from 'vitest'

import { validateTagRename } from './tagRename'

// Synthetic fixtures only.
const tags = [
  { id: 'a', name: 'Schottland', class: 'grouping', parentTag: null },
  { id: 'a1', name: 'Hotels', class: 'grouping', parentTag: 'a' },
  { id: 'a2', name: 'Fähre', class: 'grouping', parentTag: 'a' },
  { id: 'b', name: 'Norwegen', class: 'grouping', parentTag: null },
  { id: 'b1', name: 'Hotels', class: 'grouping', parentTag: 'b' },
  { id: 'sp', name: 'Sparen Familie', class: 'allocation', parentTag: null },
]

describe('validateTagRename()', () => {
  it('accepts a new name and trims it', () => {
    expect(validateTagRename(tags, 'a2', '  Überfahrt ')).toEqual({ ok: true, name: 'Überfahrt' })
  })
  it('refuses empty, unchanged and unknown', () => {
    expect(validateTagRename(tags, 'a2', '   ')).toEqual({ ok: false, reason: 'empty' })
    expect(validateTagRename(tags, 'a2', 'Fähre')).toEqual({ ok: false, reason: 'same' })
    expect(validateTagRename(tags, 'zz', 'X')).toEqual({ ok: false, reason: 'missing' })
  })
  it('refuses a sibling duplicate (any case) but allows the same name under another parent', () => {
    expect(validateTagRename(tags, 'a2', 'hotels')).toEqual({ ok: false, reason: 'clash' })
    expect(validateTagRename(tags, 'b1', 'Fähre')).toEqual({ ok: true, name: 'Fähre' })
  })
  it('locks allocation tags', () => {
    expect(validateTagRename(tags, 'sp', 'Sparen')).toEqual({ ok: false, reason: 'locked' })
  })
})
