import { describe, expect, it } from 'vitest'

import { categoryActualIndex, checkMessage, planStatus } from './planCheck'

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
  it('details: distinct, largest booking first, limited', () => {
    const i2 = categoryActualIndex(
      [
        { id: 'a', date: '2026-07-01', detail: 'Klein', lines: [{ amountCents: -10, categoryId: 'c', tags: ['t'] }] },
        { id: 'b', date: '2026-07-02', detail: 'Groß', lines: [{ amountCents: -900, categoryId: 'c', tags: ['t'] }] },
        { id: 'c', date: '2026-08-02', detail: 'groß', lines: [{ amountCents: -50, categoryId: 'c', tags: [] }] },
        { id: 'd', date: '2026-08-03', detail: 'Mittel', lines: [{ amountCents: -300, categoryId: 'c', tags: [] }] },
        { id: 'e', date: '2026-08-04', detail: 'Extra', lines: [{ amountCents: -200, categoryId: 'c', tags: [] }] },
        { id: 'f', date: '2026-07-05', detail: '', lines: [{ amountCents: -5000, categoryId: 'c', tags: [] }] },
        { id: 'g', date: '2026-07-06', detail: 'Buchung', lines: [{ amountCents: -100, note: 'Zeile 1', categoryId: 'c', tags: [] }, { amountCents: -100, note: '', categoryId: 'c', tags: [] }] },
      ],
      2026,
    )
    expect(i2.details('c', [7], new Set(['t']))).toEqual(['Groß', 'Klein'])
    expect(i2.details('c', [8])).toEqual(['Mittel', 'Extra', 'groß'])
    expect(i2.details('c', [7, 8], null, 2)).toEqual(['Groß', 'Mittel', '…'])
    expect(i2.details('none', [7])).toEqual([])
  })
  it('totals and tag sums per category and month; a line counts once', () => {
    expect(idx.total('urlaub', 7)).toBe(-157)
    expect(idx.total('urlaub', 8)).toBe(-1)
    expect(idx.sumTags('urlaub', 7, new Set(['x', 'y']))).toBe(-150)
    expect(idx.sumTags('urlaub', 7, new Set(['y']))).toBe(-150)
    expect(idx.sumTags('urlaub', 7, new Set(['x']))).toBe(-100)
    expect(idx.total('nothing', 7)).toBe(0)
  })
})

describe('checkMessage', () => {
  it('shows planned and booked, toned by the status', () => {
    expect(checkMessage({ plan: -50000, actual: -62000, status: 'off' })).toEqual({ text: 'Geplant: -500 € · Gebucht: -620 €', tone: 'off' })
    expect(checkMessage({ plan: -50000, actual: -49800, status: 'ok' })).toEqual({ text: 'Geplant: -500 € · Gebucht: -498 €', tone: 'ok' })
    expect(checkMessage({ plan: 0, actual: -9000, status: 'unplanned' })).toEqual({ text: 'Geplant: 0 € · Gebucht: -90 €', tone: 'off' })
    expect(checkMessage({ plan: -50000, actual: -2000, status: null })).toEqual({ text: 'Geplant: -500 € · Gebucht: -20 €', tone: 'info' })
  })
  it('shows cents when there are some', () => {
    expect(checkMessage({ plan: -10000, actual: -10040, status: 'ok' }).text).toBe('Geplant: -100 € · Gebucht: -100,40 €')
  })
  it('adds the Details of the bookings, when there are any', () => {
    expect(checkMessage({ plan: -100, actual: -300, status: 'off', details: ['Hotel Oban', 'Fähre'] }).text).toBe('Geplant: -1 € · Gebucht: -3 € (Hotel Oban, Fähre)')
    expect(checkMessage({ plan: -100, actual: -300, status: 'off', details: ['A', 'B', 'C', '…'] }).text).toBe('Geplant: -1 € · Gebucht: -3 € (A, B, C …)')
  })
  it('says nothing when nothing is booked and the month is not judged', () => {
    expect(checkMessage({ plan: -50000, actual: 0, status: null })).toBeNull()
    expect(checkMessage({ plan: 0, actual: 0, status: null })).toBeNull()
  })
})
