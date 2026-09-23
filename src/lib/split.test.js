import { describe, expect, it } from 'vitest'

import { withRemainder } from './split'

describe('withRemainder()', () => {
  it('computes the remainder as whatever is left of the parent total (§3a auto-remainder)', () => {
    // The spec's own example: an €8 sub-line carved out of a €10 total
    // automatically leaves a €2 remainder.
    const lines = [
      { amountCents: 800, categoryId: 'lebensmittel', note: '', tags: [] },
      { amountCents: 0, categoryId: null, note: '', tags: [] },
    ]
    const result = withRemainder(1000, lines)
    expect(result[0].amountCents).toBe(800)
    expect(result[1].amountCents).toBe(200)
  })

  it('keeps the invariant true for any number of committed lines (§2.6 — parent === Σ lines)', () => {
    const lines = [
      { amountCents: 300, categoryId: 'a', note: '', tags: [] },
      { amountCents: -150, categoryId: 'b', note: '', tags: [] },
      { amountCents: 0, categoryId: null, note: '', tags: [] },
    ]
    const result = withRemainder(500, lines)
    const sum = result.reduce((s, l) => s + l.amountCents, 0)
    expect(sum).toBe(500)
    expect(result[2].amountCents).toBe(350)
  })

  it('handles negative-sign lines independent of the parent sign (§2.6)', () => {
    // A split salary deposit: parent positive, one line (Steuern) negative.
    const lines = [
      { amountCents: 800000, categoryId: 'gehalt', note: 'Gehalt Markus', tags: [] },
      { amountCents: -190839, categoryId: 'krankenkasse', note: 'Krankenkasse', tags: [] },
      { amountCents: 0, categoryId: null, note: 'Firmenwagen', tags: [] },
    ]
    const result = withRemainder(503593, lines)
    expect(result.reduce((s, l) => s + l.amountCents, 0)).toBe(503593)
    expect(result[2].amountCents).toBe(503593 - 800000 - -190839)
  })

  it('leaves every line except the last untouched', () => {
    const lines = [
      { amountCents: 100, categoryId: 'a', note: 'keep', tags: ['x'] },
      { amountCents: 999, categoryId: 'stale', note: 'overwritten', tags: [] },
    ]
    const result = withRemainder(400, lines)
    expect(result[0]).toEqual(lines[0])
    expect(result[1].amountCents).toBe(300)
  })

  it('produces a zero remainder when the committed lines already sum to the total', () => {
    const lines = [
      { amountCents: 1000, categoryId: 'a', note: '', tags: [] },
      { amountCents: 0, categoryId: null, note: '', tags: [] },
    ]
    const result = withRemainder(1000, lines)
    expect(result[1].amountCents).toBe(0)
  })
})
