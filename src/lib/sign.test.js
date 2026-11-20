import { describe, expect, it } from 'vitest'
import { fixSign, signedForSides, signMismatch } from './sign'

describe('sign of one-sided bookings', () => {
  it('flags a positive outflow and a negative inflow only', () => {
    expect(signMismatch({ fromAccountId: 'a', toAccountId: null, amountCents: 620 })).toBe(true)
    expect(signMismatch({ fromAccountId: 'a', toAccountId: null, amountCents: -620 })).toBe(false)
    expect(signMismatch({ fromAccountId: null, toAccountId: 'a', amountCents: -1 })).toBe(true)
    expect(signMismatch({ fromAccountId: null, toAccountId: 'a', amountCents: 1 })).toBe(false)
    expect(signMismatch({ fromAccountId: 'a', toAccountId: 'b', amountCents: 500 })).toBe(false)
    expect(signMismatch({ fromAccountId: 'a', amountCents: 5, deletedAt: 1 })).toBe(false)
  })
  it('signs a typed amount by the side, whatever was typed', () => {
    expect(signedForSides(620, 'a', null)).toBe(-620)
    expect(signedForSides(-620, 'a', null)).toBe(-620)
    expect(signedForSides(-620, null, 'a')).toBe(620)
    expect(signedForSides(-620, 'a', 'b')).toBe(620)
  })
  it('flips the total and every line together', () => {
    const tx = { amountCents: 1000, lines: [{ amountCents: 1200 }, { amountCents: -200 }] }
    const out = fixSign(tx)
    expect(out.amountCents).toBe(-1000)
    expect(out.lines.map((l) => l.amountCents)).toEqual([-1200, 200])
    expect(tx.amountCents).toBe(1000)
  })
})
