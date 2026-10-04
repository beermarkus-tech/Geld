import { describe, expect, it } from 'vitest'

import { categoryActualIndex, checkMessage, partsWithoutLine, planStatus, unassignedCents } from './planCheck'

describe('planStatus', () => {
  const s = (plan, actual, closed = true, percent = 5) => planStatus({ plan, actual, closed, percent })
  it('nothing planned, nothing booked → null', () => expect(s(0, 0)).toBeNull())
  it('booked without a plan → unplanned, in open months too', () => {
    expect(s(0, -500)).toBe('unplanned')
    expect(s(0, -500, false)).toBe('unplanned')
  })
  it('ticked month: within the percentage is ok, beyond is off; the limit itself is ok', () => {
    expect(s(-100000, -104000)).toBe('ok')
    expect(s(-100000, -105000)).toBe('ok')
    expect(s(-100000, -105100)).toBe('off')
    expect(s(-100000, -90000)).toBe('off')
    expect(s(-100000, 0)).toBe('off')
  })
  it('figures that look equal in whole euros are ok even on tiny plans', () => {
    expect(s(-1000, -1040)).toBe('ok')
    expect(s(-1000, -1100)).toBe('off')
  })
  it('the percentage is the setting', () => {
    expect(s(-100000, -110000, true, 5)).toBe('off')
    expect(s(-100000, -110000, true, 10)).toBe('ok')
    expect(s(-100000, -100001, true, 0)).toBe('ok') // same whole euro
  })
  it('open month with a plan → null (nothing to judge yet)', () => expect(s(-100000, -20000, false)).toBeNull())
})

const tx = (id, date, cents, tags = [], categoryId = 'urlaub') => ({ id, date, lines: [{ amountCents: cents, categoryId, tags }] })
describe('categoryActualIndex', () => {
  const idx = categoryActualIndex(
    [
      tx('a', '2026-07-03', -100, ['x', 'y']),
      tx('b', '2026-07-09', -50, ['y']),
      tx('c', '2026-07-09', -7),
      tx('d', '2026-08-01', -1),
      tx('e', '2025-07-01', -999),
      tx('f', '2026-07-02', -3, [], 'food'),
    ],
    2026,
  )
  it('totals and tag sums per category and month; a line counts once', () => {
    expect(idx.total('urlaub', 7)).toBe(-157)
    expect(idx.total('urlaub', 8)).toBe(-1)
    expect(idx.sumTags('urlaub', 7, new Set(['x', 'y']))).toBe(-150)
    expect(idx.sumTags('urlaub', 7, new Set(['y']))).toBe(-150)
    expect(idx.sumTags('urlaub', 7, new Set(['x']))).toBe(-100)
    expect(idx.total('nothing', 7)).toBe(0)
  })
})

describe('parts and unassigned', () => {
  const nameOf = (id) => ({ sco: 'Schottland', auto: 'Auto', hot: 'Hotels' })[id]
  const lines = [
    { cents: -90, tags: ['auto'] },
    { cents: -20, tags: ['sco'] },
    { cents: -500, tags: ['hot'] },
    { cents: -40, tags: [] },
  ]
  it('names what has no plan line of its own under an Übergruppe', () => {
    expect(partsWithoutLine({ lines, parentId: 'sco', familyIds: new Set(['sco', 'auto', 'hot']), plannedChildIds: ['hot'], nameOf })).toEqual([
      { label: 'Auto', cents: -90 },
      { label: 'Schottland ohne Untertag', cents: -20 },
    ])
  })
  it('totals what no plan line covers', () => {
    expect(unassignedCents(lines, new Set(['sco', 'auto', 'hot']))).toBe(-40)
  })
})

describe('checkMessage', () => {
  const base = { where: 'Urlaube › Hotels', scope: 'Juli', percent: 5 }
  it('says ok / off / unplanned in words', () => {
    expect(checkMessage({ ...base, plan: -50000, actual: -49800, status: 'ok', closed: true }).text).toBe('Urlaube › Hotels · Juli: Plan -500 €, gebucht -498 € — im Rahmen (±5 %)')
    const off = checkMessage({ ...base, plan: -50000, actual: -62000, status: 'off', closed: true })
    expect(off.text).toContain('Abweichung -120 € (24 %) → Plan1 prüfen')
    expect(off.tone).toBe('off')
    expect(checkMessage({ ...base, plan: 0, actual: -9000, status: 'unplanned', closed: false }).text).toContain('nichts geplant, aber gebucht -90 €')
  })
  it('shows a decimal percentage with a comma', () => {
    expect(checkMessage({ ...base, percent: 2.5, plan: -50000, actual: -50000, status: 'ok', closed: true }).text).toContain('±2,5 %')
  })
  it('open month with an early booking is information only; nothing at all gives no message', () => {
    expect(checkMessage({ ...base, plan: -50000, actual: -2000, status: null, closed: false })).toMatchObject({ tone: 'info' })
    expect(checkMessage({ ...base, plan: -50000, actual: 0, status: null, closed: false })).toBeNull()
  })
  it('appends what has no plan line', () => {
    const m = checkMessage({ ...base, plan: -100, actual: -300, status: 'off', closed: true, parts: [{ label: 'Auto', cents: -9000 }], unassigned: -4000 })
    expect(m.text).toContain('davon ohne eigene Plan-Zeile: Auto -90 €')
    expect(m.text).toContain('davon keiner Plan-Zeile zugeordnet: -40 €')
  })
})
