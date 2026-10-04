import { describe, expect, it } from 'vitest'

import { incomeCategoryIds, budgetDeviation, isReductionRow, reductionPercent, urlaubeCategoryId, urlaubeOverview } from './urlaube'

const categories = [
  { id: 'sonst', name: 'Sonstiges', parentCategoryId: null },
  { id: 'urlaube', name: 'Urlaube', parentCategoryId: 'sonst' },
  { id: 'food', name: 'Lebensmittel', parentCategoryId: 'leben' },
  { id: 'einn', name: 'Einnahmen', parentCategoryId: null },
  { id: 'sonst-einn', name: 'Sonstige Einnahmen', parentCategoryId: 'einn' },
]
const tags = [
  { id: 'lr', name: '2025 La Rochelle', parentTag: null, class: 'grouping' },
  { id: 'lr-h', name: 'Hotel', parentTag: 'lr', class: 'grouping' },
  { id: 'sco', name: 'Schottland', parentTag: null, class: 'grouping', groupingType: 'project' },
  { id: 'sco-f', name: 'Flüge', parentTag: 'sco', class: 'grouping' },
  { id: 'it', name: '2026 Italien', parentTag: null, class: 'grouping' },
  { id: 'it-sub', name: 'Subvention', parentTag: 'it', class: 'grouping' },
  { id: 'rechn', name: 'Rechnung offen', parentTag: null, class: 'grouping', groupingType: 'claim' }, // not a holiday tag
  { id: 'spar', name: 'Sparen', parentTag: null, class: 'allocation' },
]
const tx = (id, date, cents, tagIds, categoryId = 'urlaube', extra = {}) => ({ id, date, detail: '', lines: [{ amountCents: cents, categoryId, tags: tagIds }], ...extra })
const b = (year, month, cents, tag, extra = {}) => ({ year, planVersion: 'plan1', categoryId: 'urlaube', breakdownTagId: tag, month, plannedAmountCents: cents, ...extra })

const transactions = [
  tx('f24', '2024-12-20', -30000, ['lr-h'], 'urlaube', { detail: 'Anzahlung' }), // paid the year before
  tx('h25', '2025-08-03', -70000, ['rechn', 'lr-h'], 'urlaube', { detail: 'Hotel' }), // the Rechnung tag comes first
  tx('s25', '2025-09-01', -20000, ['sco-f']), // Schottland: no year in the name → latest booking year
  tx('s26', '2026-02-01', -5000, ['sco-f']),
  tx('i26', '2026-03-05', -10000, ['it']),
  tx('loose', '2026-04-01', -1000, []), // no holiday tag
  tx('other', '2026-05-01', -400, ['sco'], 'food'), // a holiday tag in another category
  tx('gift', '2026-06-01', 2000, ['it'], 'sonst-einn'), // a subvention in Sonstige Einnahmen: belongs to the holiday
  tx('salary', '2026-06-02', 300000, [], 'sonst-einn'), // plain income: not Urlaube's business
  tx('rechnung-only', '2026-06-03', -300, ['rechn']), // Urlaube booking with no holiday tag
  tx('x', '2026-02-02', -7, ['spar'], 'food'),
]
const budgets = [b(2025, 8, -80000, 'lr-h'), b(2026, 9, -50000, 'it'), b(2026, 4, -3000, 'sco-f'), b(2026, 8, -9, 'it', { planVersion: 'plan0' })]
const base = { categoryId: 'urlaube', incomeIds: incomeCategoryIds(categories), tags, transactions, budgets, closedByYear: new Map([[2026, [1, 2, 3, 4, 5, 6]]]), todayYear: 2026 }

describe('urlaubeCategoryId', () => {
  it('finds Sonstiges › Urlaube by name', () => {
    expect(urlaubeCategoryId(categories)).toBe('urlaube')
    expect(urlaubeCategoryId([{ id: 'u', name: 'Urlaube', parentCategoryId: 'other' }, { id: 'other', name: 'Hobbys' }])).toBeNull()
    expect(urlaubeCategoryId([])).toBeNull()
  })
})

describe('reductionPercent', () => {
  it('total cost ÷ cost only − 1, in whole percent', () => {
    expect(reductionPercent(100000, 20000)).toBe(-20)
    expect(reductionPercent(300000, 10000)).toBe(-3)
    expect(reductionPercent(100000, 0)).toBe(0)
    expect(reductionPercent(100000, 150000)).toBe(-150) // more subsidy than cost
    expect(reductionPercent(0, 5)).toBeNull()
  })
})

describe('incomeCategoryIds', () => {
  it('the categories of the group Einnahmen', () => {
    expect([...incomeCategoryIds(categories)]).toEqual(['sonst-einn'])
    expect(incomeCategoryIds([]).size).toBe(0)
  })
})

describe('urlaubeOverview', () => {
  const o = urlaubeOverview(base)
  const h = (key) => o.holidays.find((x) => x.key === key)

  it('year from the tag name; without it the year of the latest booking or plan line; newest year first', () => {
    expect(o.holidays.map((x) => [x.key, x.tripYear])).toEqual([['it', 2026], ['sco', 2026], ['lr', 2025]])
  })
  it('only the category Urlaube counts; allocation tags make no holiday', () => {
    expect(o.holidays.map((x) => x.key)).not.toContain('spar')
    expect(h('sco').booked).toBe(-25000)
  })
  it('a holiday costs booked + still to be booked, over all years, as a plus number', () => {
    expect(h('lr').total).toBe(100000) // 2024 + 2025 bookings
    expect(h('lr').years).toEqual([2024, 2025])
    // Italien: -10000 + 2000 booked in ticked months, -50000 planned in September
    expect(h('it')).toMatchObject({ booked: -8000, planned: -50000, total: 58000 })
  })
  it('a subvention or gift in an income category belongs to the holiday and reduces its cost', () => {
    expect(h('it').rows[0].booked).toBe(-8000)
    expect(o.outside).toBe(400) // the income booking is not "outside"
  })
  it('splits every holiday into cost only (negative bookings) and subventions + gifts (positive ones)', () => {
    // Italien: -10000 flight booked, +2000 gift, -50000 still planned
    expect(h('it')).toMatchObject({ cost: 60000, subvention: 2000, total: 58000 })
    expect(h('lr')).toMatchObject({ cost: 100000, subvention: 0, total: 100000 })
    expect(h('it').cost - h('it').subvention).toBe(h('it').total)
    expect(h('it').rows[0]).toMatchObject({ cost: 60000, subvention: 2000 })
  })
  it('money in with a holiday tag counts wherever it was booked; money out elsewhere is only reported', () => {
    const r = urlaubeOverview({
      ...base,
      transactions: [
        ...transactions,
        tx('sub-expense-cat', '2026-06-10', 7000, ['it'], 'food'), // a subvention booked in an expense category
        tx('sub-no-cat', '2026-06-11', 3000, ['it'], null), // not categorised yet
        tx('sub-old-cat', '2026-06-12', 1000, ['it'], 'einnahmen-erstattungen'), // a category that no longer exists
        tx('out-elsewhere', '2026-06-13', -9000, ['it'], 'food'),
      ],
    })
    const it = r.holidays.find((x) => x.key === 'it')
    expect(it.subvention).toBe(2000 + 7000 + 3000 + 1000)
    expect(it.cost).toBe(60000) // the -9000 elsewhere is not a cost here
    expect(it.outside).toBe(-9000)
  })
  it('repayments of Dienstreise / Anspruch tags make no holiday card, and a subvention alone makes none either', () => {
    const t2 = [
      ...tags,
      { id: 'ham', name: '2026-05 HAM', parentTag: null, class: 'grouping', groupingType: 'business-trip' },
      { id: 'get', name: '2026-06 GET', parentTag: null, class: 'grouping', groupingType: null }, // untyped, year-named
    ]
    const r = urlaubeOverview({ ...base, tags: t2, transactions: [...transactions, tx('hamrepay', '2026-06-01', 4500, ['ham'], 'food'), tx('getrepay', '2026-06-02', 124500, ['get'], 'food')] })
    expect(r.holidays.map((x) => x.key)).toEqual(['it', 'sco', 'lr'])
  })
  it('a planned subvention (a Plan1 line in Sonstige Einnahmen) belongs to the holiday', () => {
    const r = urlaubeOverview({
      ...base,
      budgets: [...budgets, b(2026, 9, 20000, 'it-sub', { categoryId: 'sonst-einn' }), b(2026, 3, 20000, 'it-sub', { categoryId: 'sonst-einn' }), b(2026, 9, 99999, 'rechn', { categoryId: 'sonst-einn' }), b(2026, 9, -777, 'it', { categoryId: 'food' })],
      cellComments: [{ rowId: 'categoryId:sonst-einn:plan1:it-sub', year: 2026, text: 'Antrag läuft' }],
    })
    const it = r.holidays.find((x) => x.key === 'it')
    // March is ticked (before the split at June): only September's 200 € is still to come
    expect(it).toMatchObject({ planned: -50000 + 20000, subvention: 2000 + 20000, cost: 60000, total: 58000 - 20000 })
    expect(it.budget).toBe(-50000 + 20000 + 20000) // Plan1 of the holiday incl. both planned subventions
    const row = it.rows.find((x) => x.label === 'Subvention')
    expect(row).toMatchObject({ booked: 0, planned: 20000, subvention: 20000, cost: 0 })
    expect(row.comments).toEqual(['Antrag läuft'])
    // a non-holiday tag in the income category and a cost line elsewhere add nothing
    expect(r.holidays.map((x) => x.key)).not.toContain('rechn')
  })
  it('a planned subvention alone makes no holiday', () => {
    const r = urlaubeOverview({ ...base, transactions: [], budgets: [b(2026, 9, 20000, 'it-sub', { categoryId: 'sonst-einn' })] })
    expect(r.holidays).toEqual([])
  })
  it('Budget against Gesamt: no warning within a few euros, else the difference', () => {
    // Italien: plan -50000 (September, still to come) -> budget -50000; booked -8000 + planned -50000 -> gesamt -58000
    expect(budgetDeviation(h('it'))).toBe(-50000 - (-8000 + -50000))
    // La Rochelle: planned 100000 in August 2025, booked 100000 -> no deviation
    expect(budgetDeviation({ budget: -10000, booked: -14900, planned: 0 })).toBe(0) // 49 € off: no warning
    expect(budgetDeviation({ budget: -10000, booked: -15000, planned: 0 })).toBe(0) // exactly 50 €: still none
    expect(budgetDeviation({ budget: -10000, booked: -15100, planned: 0 })).toBe(5100)
    expect(budgetDeviation({ budget: -10000, booked: -10000, planned: -400 })).toBe(0)
  })
  it('rows of only subventions / gifts go to the bottom of a card, each group alphabetical', () => {
    const t2 = [...tags, { id: 'it-a', name: 'Aktivitäten', parentTag: 'it', class: 'grouping' }, { id: 'it-z', name: 'Zuschuss', parentTag: 'it', class: 'grouping' }]
    const r = urlaubeOverview({
      ...base,
      tags: t2,
      transactions: [...transactions, tx('act', '2026-02-02', -500, ['it-a']), tx('zus', '2026-02-03', 900, ['it-z'], 'sonst-einn')],
      budgets: [...budgets, b(2026, 9, 20000, 'it-sub', { categoryId: 'sonst-einn' })],
    })
    const rows = r.holidays.find((x) => x.key === 'it').rows
    expect(rows.map((x) => x.label)).toEqual(['(allgemein)', 'Aktivitäten', 'Subvention', 'Zuschuss'])
    expect(rows.map(isReductionRow)).toEqual([false, false, true, true])
  })
  it('only the holiday tag counts when a line carries several tags', () => {
    // "Rechnung offen" is first on the line, yet the booking is La Rochelle's
    expect(h('lr').booked).toBe(-100000) // 2025's -70000 plus the 2024 Anzahlung, none lost to the Rechnung tag
    expect(o.holidays.map((x) => x.key)).not.toContain('rechn')
    // a line with only a non-holiday tag has no holiday: untagged
    expect(o.untagged).toBe(1300)
  })
  it('plain income without a holiday tag is ignored, and a non-holiday plan tag makes no card', () => {
    expect(o.years.find((x) => x.year === 2026).booked).toBe(14300)
    const r = urlaubeOverview({ ...base, budgets: [...budgets, b(2026, 5, -999, 'rechn')] })
    expect(r.holidays.map((x) => x.key)).not.toContain('rechn')
  })
  it('per year: trips of the year, everything booked in the year, difference, budget', () => {
    const y = (n) => o.years.find((x) => x.year === n)
    expect(o.years.map((x) => x.year)).toEqual([2026, 2025, 2024])
    // 2026: Italien 58000 + Schottland 25000 | booked in 2026: 5000 + 10000 + 1000 − 2000
    // + the invoice-only booking (300) is untagged: booked 14300
    expect(y(2026)).toMatchObject({ trips: 2, tripCost: 83000, booked: 14300, untagged: 1300, difference: 68700, budget: 53000 })
    // 2025: La Rochelle 100000 | booked in 2025: 70000 + 20000
    expect(y(2025)).toMatchObject({ trips: 1, tripCost: 100000, booked: 90000, difference: 10000, budget: 80000 })
    // 2024: only the Anzahlung for a 2025 trip
    expect(y(2024)).toMatchObject({ trips: 0, tripCost: 0, booked: 30000, difference: -30000 })
  })
  it('names the bookings behind the two reports, with their newest year', () => {
    expect(o.untaggedTxs.ids.sort()).toEqual(['loose', 'rechnung-only'])
    expect(o.untaggedTxs.year).toBe(2026)
    expect(o.outsideTxs).toEqual({ ids: ['other'], year: 2026 })
    expect(urlaubeOverview({ ...base, categoryId: null }).untaggedTxs).toEqual({ ids: [], year: null })
  })
  it('reports what is not counted: untagged Urlaube bookings and holiday tags used in other categories', () => {
    expect(o.untagged).toBe(1300)
    expect(h('sco').outside).toBe(-400)
    expect(o.outside).toBe(400)
  })
  it('rows per child tag over all years, child-less bookings as (allgemein), Details and comments', () => {
    const lr = h('lr')
    // Unterkünfte was booked in 2024 and 2025: one row, summed
    expect(lr.rows.map((r) => [r.label, r.booked, r.lastYear])).toEqual([['Hotel', -100000, 2025]])
    expect(lr.rows[0].details).toEqual(['Hotel', 'Anzahlung'])
    expect(h('sco').rows.map((r) => r.label)).toEqual(['Flüge'])
    const r = urlaubeOverview({ ...base, cellComments: [{ rowId: 'categoryId:urlaube:plan1:sco-f', year: 2026, text: 'teurer?' }, { rowId: 'categoryId:other:plan1:sco-f', year: 2026, text: 'nein' }] })
    expect(r.holidays.find((x) => x.key === 'sco').rows[0].comments).toEqual(['teurer?'])
  })
  it('a parent-only booking next to child bookings is its own row "(allgemein)"', () => {
    const r = urlaubeOverview({ ...base, transactions: [...transactions, tx('loose-sco', '2026-02-02', -700, ['sco'])] })
    expect(r.holidays.find((x) => x.key === 'sco').rows.map((x) => x.label)).toEqual(['(allgemein)', 'Flüge'])
  })
  it('no category yet: nothing', () => {
    expect(urlaubeOverview({ ...base, categoryId: null })).toEqual({ holidays: [], years: [], untagged: 0, outside: 0, untaggedTxs: { ids: [], year: null }, outsideTxs: { ids: [], year: null } })
  })
})
