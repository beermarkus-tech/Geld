import { describe, expect, it } from 'vitest'

import { allocationMonthActual, budgetTopLineMonths, categoryMonthActual } from './budget'

// Synthetic fixtures only — same standing privacy rule as balance.test.js/
// tagBalance.test.js.

describe('categoryMonthActual()', () => {
  it('sums only lines whose categoryId matches, dated in that month', () => {
    const rewe = {
      date: '2025-03-05',
      lines: [{ amountCents: -5000, categoryId: 'lebensmittel', note: '', tags: [] }],
    }
    const otherMonth = {
      date: '2025-04-05',
      lines: [{ amountCents: -3000, categoryId: 'lebensmittel', note: '', tags: [] }],
    }
    const otherCategory = {
      date: '2025-03-06',
      lines: [{ amountCents: -1000, categoryId: 'wohnen', note: '', tags: [] }],
    }
    expect(categoryMonthActual('lebensmittel', 2025, 3, [rewe, otherMonth, otherCategory])).toBe(-5000)
  })

  it('sums a split transaction\'s matching line only, not the parent total', () => {
    const salary = {
      date: '2025-01-10',
      lines: [
        { amountCents: 300000, categoryId: 'gehalt', note: '', tags: [] },
        { amountCents: -50000, categoryId: 'steuern', note: '', tags: [] },
      ],
    }
    expect(categoryMonthActual('gehalt', 2025, 1, [salary])).toBe(300000)
    expect(categoryMonthActual('steuern', 2025, 1, [salary])).toBe(-50000)
  })

  it('returns 0 with no matching lines', () => {
    expect(categoryMonthActual('unused', 2025, 6, [])).toBe(0)
  })
})

describe('allocationMonthActual()', () => {
  const SPAREN_SOPHIA = { id: 'sparen-sophia', reconciliationTargetAccountIds: ['livret-a-sparen'] }

  it('is negative when money moves into the tag\'s target account (spec.md §2.7: "− = money set aside")', () => {
    const contribution = {
      date: '2025-05-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      lines: [{ amountCents: 10000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(allocationMonthActual('sparen-sophia', 2025, 5, [contribution], [SPAREN_SOPHIA])).toBe(-10000)
  })

  it('is positive when money is taken back out of the tag\'s target account', () => {
    const withdrawal = {
      date: '2025-06-01',
      fromAccountId: 'livret-a-sparen',
      toAccountId: 'bnp-konto',
      lines: [{ amountCents: 4000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(allocationMonthActual('sparen-sophia', 2025, 6, [withdrawal], [SPAREN_SOPHIA])).toBe(4000)
  })

  it('only counts lines dated in the given month', () => {
    const contribution = {
      date: '2025-05-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      lines: [{ amountCents: 10000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(allocationMonthActual('sparen-sophia', 2025, 6, [contribution], [SPAREN_SOPHIA])).toBe(0)
  })
})

describe('budgetTopLineMonths()', () => {
  it('reads the flat row directly when no breakdown lines exist', () => {
    const budgets = [
      { year: 2025, planVersion: 'plan1', categoryId: 'wohnen-nebenkosten', allocationTagId: null, breakdownTagId: null, month: 1, plannedAmountCents: 22300 },
      { year: 2025, planVersion: 'plan1', categoryId: 'wohnen-nebenkosten', allocationTagId: null, breakdownTagId: null, month: 2, plannedAmountCents: 22300 },
    ]
    const { months, yearTotal } = budgetTopLineMonths('categoryId', 'wohnen-nebenkosten', 'plan1', 2025, budgets)
    expect(months[0]).toBe(22300)
    expect(months[1]).toBe(22300)
    expect(months[2]).toBe(0)
    expect(yearTotal).toBe(44600)
  })

  it('sums breakdown-line rows instead of the flat row once any exist (spec.md §2.7: top-line becomes computed)', () => {
    const budgets = [
      // A stale flat row that should be ignored once breakdown lines exist.
      { year: 2025, planVersion: 'plan1', categoryId: 'sonstiges-urlaube', allocationTagId: null, breakdownTagId: null, month: 6, plannedAmountCents: 999900 },
      { year: 2025, planVersion: 'plan1', categoryId: 'sonstiges-urlaube', allocationTagId: null, breakdownTagId: 'schottland-hotels', month: 6, plannedAmountCents: 20000 },
      { year: 2025, planVersion: 'plan1', categoryId: 'sonstiges-urlaube', allocationTagId: null, breakdownTagId: 'schottland-flug', month: 6, plannedAmountCents: 30000 },
    ]
    const { months, yearTotal } = budgetTopLineMonths('categoryId', 'sonstiges-urlaube', 'plan1', 2025, budgets)
    expect(months[5]).toBe(50000)
    expect(yearTotal).toBe(50000)
  })

  it('works for an allocation tag (savings-transfer) via allocationTagId instead of categoryId', () => {
    const budgets = [
      { year: 2025, planVersion: 'plan0', categoryId: null, allocationTagId: 'sparen-familie', breakdownTagId: null, month: 9, plannedAmountCents: -33000 },
    ]
    const { months } = budgetTopLineMonths('allocationTagId', 'sparen-familie', 'plan0', 2025, budgets)
    expect(months[8]).toBe(-33000)
  })

  it('ignores rows from a different year or planVersion', () => {
    const budgets = [
      { year: 2024, planVersion: 'plan1', categoryId: 'wohnen-nebenkosten', allocationTagId: null, breakdownTagId: null, month: 1, plannedAmountCents: 10000 },
      { year: 2025, planVersion: 'plan0', categoryId: 'wohnen-nebenkosten', allocationTagId: null, breakdownTagId: null, month: 1, plannedAmountCents: 20000 },
    ]
    const { yearTotal } = budgetTopLineMonths('categoryId', 'wohnen-nebenkosten', 'plan1', 2025, budgets)
    expect(yearTotal).toBe(0)
  })

  it('adds an annual-lump (month: null) row into the yearly total without assigning it to any month', () => {
    const budgets = [
      { year: 2025, planVersion: 'plan1', categoryId: 'gesundheit-arztkosten', allocationTagId: null, breakdownTagId: null, month: null, plannedAmountCents: -12000 },
      { year: 2025, planVersion: 'plan1', categoryId: 'gesundheit-arztkosten', allocationTagId: null, breakdownTagId: null, month: 3, plannedAmountCents: -5000 },
    ]
    const { months, yearTotal } = budgetTopLineMonths('categoryId', 'gesundheit-arztkosten', 'plan1', 2025, budgets)
    expect(months[2]).toBe(-5000)
    expect(months.reduce((a, b) => a + b, 0)).toBe(-5000)
    expect(yearTotal).toBe(-17000)
  })
})
