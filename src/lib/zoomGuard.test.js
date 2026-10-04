import { describe, expect, it } from 'vitest'

import { zoomLooksOff } from './zoomGuard'

describe('zoomLooksOff', () => {
  it('the usual screen pixel ratios are not zoom', () => {
    for (const r of [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3]) expect(zoomLooksOff(r)).toBe(false)
  })
  it('ratios no screen has mean a zoomed page', () => {
    for (const r of [1.1, 0.9, 0.8, 1.2, 1.1 * 1.25, 1.25 * 1.1]) expect(zoomLooksOff(r)).toBe(true)
  })
  it('tolerates rounding noise', () => {
    expect(zoomLooksOff(1.0000001)).toBe(false)
    expect(zoomLooksOff(1.4999)).toBe(false)
  })
})
