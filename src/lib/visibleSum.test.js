import { describe, expect, it } from 'vitest'

import { visibleSum } from './visibleSum'

// Synthetic fixtures only — same standing privacy rule as the other tests.
const row = (id, cents, from, to, extra = {}) => ({ id, parentId: null, cents, fromAccountId: from, toAccountId: to, deleted: false, ...extra })

describe('visibleSum()', () => {
  it('adds plain income/expense rows even across different accounts', () => {
    expect(visibleSum([row('a', -5000, 'bnp', null), row('b', -3000, 'bar-markus', null)], false)).toBe(-8000)
  })

  it('adds transfers that all go the same way', () => {
    expect(visibleSum([row('a', -10000, 'bnp', 'livret'), row('b', -5000, 'bnp', 'livret'), row('c', -2000, 'bnp', null)], false)).toBe(-17000)
  })

  it('gives no total once the same pair of accounts appears in both directions', () => {
    expect(visibleSum([row('a', -10000, 'bnp', 'livret'), row('b', -5000, 'livret', 'bnp')], false)).toBeNull()
  })

  it('always totals under an account filter, where every row is signed from that account', () => {
    expect(visibleSum([row('a', -10000, 'bnp', 'livret'), row('b', 5000, 'livret', 'bnp')], true)).toBe(-5000)
  })

  it('counts split lines on their own, but skips them when their booking row is visible too', () => {
    const booking = row('s', 400000, null, 'bnp')
    const line1 = row('s::0', 500000, null, 'bnp', { parentId: 's' })
    const line2 = row('s::1', -100000, null, 'bnp', { parentId: 's' })
    expect(visibleSum([line1], false)).toBe(500000)
    expect(visibleSum([booking, line1, line2], false)).toBe(400000)
  })

  it('ignores soft-deleted rows', () => {
    expect(visibleSum([row('a', -5000, 'bnp', null), row('b', -9999, 'bnp', null, { deleted: true })], false)).toBe(-5000)
  })

  it('is 0 for an empty result', () => {
    expect(visibleSum([], false)).toBe(0)
  })
})
