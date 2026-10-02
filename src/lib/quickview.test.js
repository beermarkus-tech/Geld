import { describe, expect, it } from 'vitest'

import { occurredMonthCount, quickviewMonths } from './quickview'

// Synthetic fixtures only.
const tx = (id, date, from, to, lines, extra = {}) => ({ id, date, fromAccountId: from, toAccountId: to, displayLabel: id, detail: '', lines, ...extra })
const line = (amountCents, categoryId, tags = []) => ({ amountCents, categoryId, tags })
const tags = [
  { id: 'sparen', class: 'allocation', reconciliationTargetAccountIds: ['livret'], parentTag: null },
  { id: 'reise', class: 'grouping', parentTag: null },
  { id: 'reise-hotel', class: 'grouping', parentTag: 'reise' },
]

describe('quickviewMonths()', () => {
  it('groups a category by month, largest first, and totals it', () => {
    const txs = [
      tx('a', '2026-03-02', 'bnp', null, [line(-1000, 'food')]),
      tx('b', '2026-03-09', 'bnp', null, [line(-5000, 'food')]),
      tx('c', '2026-04-01', 'bnp', null, [line(-700, 'food')]),
      tx('d', '2026-03-05', 'bnp', null, [line(-999, 'other')]),
      tx('e', '2025-03-05', 'bnp', null, [line(-111, 'food')]),
    ]
    const m = quickviewMonths({ kind: 'category', id: 'food' }, 2026, txs, tags)
    expect(m[2].entries.map((e) => e.txId)).toEqual(['b', 'a'])
    expect(m[2].total).toBe(-6000)
    expect(m[3].count).toBe(1)
    expect(m[0].entries).toEqual([])
  })

  it('lists a split booking by its matching line, not its net', () => {
    const txs = [tx('s', '2026-01-31', null, 'bnp', [line(500000, 'gehalt'), line(-100000, 'steuer')])]
    const m = quickviewMonths({ kind: 'category', id: 'gehalt' }, 2026, txs, tags)
    expect(m[0].entries).toHaveLength(1)
    expect(m[0].entries[0].cents).toBe(500000)
  })

  it('skips opening-balance anchors', () => {
    const txs = [tx('anchor', '2026-01-01', 'jahresabschluss', 'livret', [line(900000, null, ['sparen'])])]
    expect(quickviewMonths({ kind: 'tag', id: 'sparen' }, 2026, txs, tags)[0].count).toBe(0)
  })

  it('signs an allocation tag by direction and includes breakdown-tag children', () => {
    const txs = [
      tx('in', '2026-02-01', 'bnp', 'livret', [line(20000, null, ['sparen'])]),
      tx('out', '2026-02-10', 'livret', 'bnp', [line(5000, null, ['sparen'])]),
      tx('h', '2026-02-11', 'bnp', null, [line(-8000, 'urlaub', ['reise-hotel'])]),
    ]
    const sp = quickviewMonths({ kind: 'tag', id: 'sparen' }, 2026, txs, tags)
    expect(sp[1].total).toBe(15000)
    expect(sp[1].entries.map((e) => e.cents)).toEqual([20000, -5000])
    expect(quickviewMonths({ kind: 'tag', id: 'reise' }, 2026, txs, tags)[1].total).toBe(-8000)
  })
})

describe('quickviewMonths() grouping by name', () => {
  it('sums same-named bookings of a month into one row, sorted by the sum', () => {
    const t = (id, date, label, cents) => tx(id, date, 'bnp', null, [line(cents, 'food')], { displayLabel: label })
    const txs = [
      t('a', '2026-03-02', 'Lidl', -3000), t('b', '2026-03-09', 'LIDL ', -2500), t('c', '2026-03-10', 'Lidl', -1000),
      t('d', '2026-03-05', 'Bäcker', -4000), t('e', '2026-04-05', 'Lidl', -100),
    ]
    const m = quickviewMonths({ kind: 'category', id: 'food' }, 2026, txs, tags)
    expect(m[2].groups.map((g) => [g.label, g.cents, g.count])).toEqual([['Lidl', -6500, 3], ['Bäcker', -4000, 1]])
    expect(m[3].groups).toHaveLength(1)
  })
})

describe('occurredMonthCount()', () => {
  it('is real elapsed calendar time', () => {
    expect(occurredMonthCount(2025, '2026-10-02')).toBe(12)
    expect(occurredMonthCount(2026, '2026-10-02')).toBe(10)
    expect(occurredMonthCount(2027, '2026-10-02')).toBe(0)
  })
})
