import { describe, expect, it } from 'vitest'

import {
  allocationMonthActual,
  breakdownGroupAllocationMonthActual,
  breakdownGroupMonthActual,
  budgetBreakdownLineMonths,
  budgetTopLineMonths,
  categoryMonthActual,
  planungSummary,
  progMonths,
  regularShare,
  splitYear,
} from './budget'

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

describe('budgetBreakdownLineMonths()', () => {
  it('reads one specific breakdown line\'s own rows only, not every line under the category', () => {
    const budgets = [
      { year: 2025, planVersion: 'plan1', categoryId: 'sonstiges-urlaube', allocationTagId: null, breakdownTagId: 'schottland-hotels', month: 6, plannedAmountCents: -20000 },
      { year: 2025, planVersion: 'plan1', categoryId: 'sonstiges-urlaube', allocationTagId: null, breakdownTagId: 'schottland-flug', month: 6, plannedAmountCents: -30000 },
    ]
    const { months, yearTotal } = budgetBreakdownLineMonths('categoryId', 'sonstiges-urlaube', 'schottland-hotels', 'plan1', 2025, budgets)
    expect(months[5]).toBe(-20000)
    expect(yearTotal).toBe(-20000)
  })

  it('returns all-zero months for a line with no rows yet (a freshly created, still-blank breakdown line)', () => {
    const { months, yearTotal } = budgetBreakdownLineMonths('categoryId', 'sonstiges-urlaube', 'schottland-auto', 'plan1', 2025, [])
    expect(months).toEqual(Array(12).fill(0))
    expect(yearTotal).toBe(0)
  })
})

describe('breakdownGroupMonthActual()', () => {
  it('sums only lines carrying the parent or a child tag, within the given category and month', () => {
    const hotelBooking = {
      date: '2025-06-05',
      lines: [{ amountCents: -18000, categoryId: 'sonstiges-urlaube', note: '', tags: ['schottland-hotels'] }],
    }
    const flightBooking = {
      date: '2025-06-10',
      lines: [{ amountCents: -29000, categoryId: 'sonstiges-urlaube', note: '', tags: ['schottland-flug'] }],
    }
    const untaggedTripSpend = {
      date: '2025-06-12',
      lines: [{ amountCents: -5000, categoryId: 'sonstiges-urlaube', note: '', tags: [] }],
    }
    const otherCategory = {
      date: '2025-06-15',
      lines: [{ amountCents: -1000, categoryId: 'lebensmittel', note: '', tags: ['schottland-hotels'] }],
    }
    const tagIds = new Set(['schottland', 'schottland-hotels', 'schottland-flug'])
    expect(
      breakdownGroupMonthActual('sonstiges-urlaube', tagIds, 2025, 6, [hotelBooking, flightBooking, untaggedTripSpend, otherCategory]),
    ).toBe(-47000)
  })

  it('a bare parent-tagged line (not broken into a child) still counts, per spec.md §2.7', () => {
    const bareParentSpend = {
      date: '2025-06-20',
      lines: [{ amountCents: -2000, categoryId: 'sonstiges-urlaube', note: '', tags: ['schottland'] }],
    }
    const tagIds = new Set(['schottland', 'schottland-hotels'])
    expect(breakdownGroupMonthActual('sonstiges-urlaube', tagIds, 2025, 6, [bareParentSpend])).toBe(-2000)
  })

  it('excludes a matching-tag line dated in a different month', () => {
    const laterBooking = {
      date: '2025-07-01',
      lines: [{ amountCents: -18000, categoryId: 'sonstiges-urlaube', note: '', tags: ['schottland-hotels'] }],
    }
    expect(breakdownGroupMonthActual('sonstiges-urlaube', new Set(['schottland-hotels']), 2025, 6, [laterBooking])).toBe(0)
  })
})

describe('breakdownGroupAllocationMonthActual()', () => {
  // Real bug (Sept 2026): a Rücklagen breakdown's own rollup header always
  // showed blank in a closed month, since Verlauf.jsx's own rollupMonths
  // computation only ever called the category-side breakdownGroupMonthActual,
  // hardcoding 0 for an allocation-tag target instead of computing anything.
  const SPAREN_FAMILIE = { id: 'sparen-familie', reconciliationTargetAccountIds: ['livret-a-sparen'] }

  it('sums the signed change for lines carrying the parent or a child tag, same sign convention as allocationMonthActual()', () => {
    const fondsContribution = {
      date: '2025-06-05',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      lines: [{ amountCents: 10000, categoryId: null, note: '', tags: ['sparen-familie', 'fonds-a'] }],
    }
    const fondsBContribution = {
      date: '2025-06-10',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      lines: [{ amountCents: 5000, categoryId: null, note: '', tags: ['sparen-familie', 'fonds-b'] }],
    }
    const untaggedContribution = {
      date: '2025-06-12',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      lines: [{ amountCents: 2000, categoryId: null, note: '', tags: ['sparen-familie'] }],
    }
    const tagIds = new Set(['fonds', 'fonds-a', 'fonds-b'])
    expect(
      breakdownGroupAllocationMonthActual(
        'sparen-familie',
        tagIds,
        2025,
        6,
        [fondsContribution, fondsBContribution, untaggedContribution],
        [SPAREN_FAMILIE],
      ),
    ).toBe(-15000)
  })

  it('excludes a matching-tag line dated in a different month', () => {
    const laterContribution = {
      date: '2025-07-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      lines: [{ amountCents: 10000, categoryId: null, note: '', tags: ['fonds-a'] }],
    }
    expect(
      breakdownGroupAllocationMonthActual('sparen-familie', new Set(['fonds-a']), 2025, 6, [laterContribution], [SPAREN_FAMILIE]),
    ).toBe(0)
  })
})

describe('progMonths()', () => {
  const plan1 = [-100, -200, -300, -400, -500, -600, -700, -800, -900, -1000, -1100, -1200]
  const tx = { date: '2025-02-14', lines: [{ amountCents: -250, categoryId: 'tanken', note: '', tags: [] }] }

  it('uses the real actual for a closed month and mirrors Plan1 for an open one', () => {
    const prog = progMonths('categoryId', 'tanken', plan1, [1, 2], 2025, [tx], [])
    expect(prog[0]).toBe(0) // closed, nothing booked
    expect(prog[1]).toBe(-250) // closed, real actual
    expect(prog[2]).toBe(-300) // open, mirrors Plan1
  })

  it('uses the allocation-tag actual for an allocationTagId target', () => {
    const tag = { id: 'sparen-sophia', reconciliationTargetAccountIds: ['livret-a-sparen'] }
    const contribution = {
      date: '2025-01-05',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      lines: [{ amountCents: 5000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(progMonths('allocationTagId', 'sparen-sophia', plan1, [1], 2025, [contribution], [tag])[0]).toBe(-5000)
  })
})

describe('regularShare() / splitYear()', () => {
  it('a near-constant monthly cost with one lump lands at the median × 12 share (spec.md §3c Nebenkosten pattern)', () => {
    // 11 × −200 plus one −1.000 lump: median −200, regular −2.400 of −3.200 = 75 %
    const months = [...Array(11).fill(-20000), -100000]
    const share = regularShare(months)
    expect(share).toBeCloseTo(0.75)
    expect(splitYear(-400000, share)).toEqual({ regularYear: -300000, regularMonth: -25000, lumpYear: -100000, percent: 75 })
  })

  it('mostly-zero months with one lump payment land at 100 % einmalig', () => {
    const months = [0, 0, 0, 0, 0, -500000, 0, 0, 0, 0, 0, 0]
    expect(splitYear(-600000, regularShare(months))).toEqual({ regularYear: 0, regularMonth: 0, lumpYear: -600000, percent: 0 })
  })

  it('no reference data, or a zero reference total, falls back to 100 % einmalig', () => {
    expect(regularShare(null)).toBe(0)
    expect(regularShare(Array(12).fill(0))).toBe(0)
  })

  it('a refund pushing the share past 100 % is shown as computed, not clamped (spec.md §2.8)', () => {
    // 11 × −100 plus a +500 refund: total −600, median −100 → −1.200 regular, 200 %
    const share = regularShare([...Array(11).fill(-10000), 50000])
    expect(share).toBeCloseTo(2)
    const split = splitYear(-60000, share)
    expect(split.percent).toBe(200)
    expect(split.lumpYear).toBe(60000)
  })

  it('regular + lump always add back up to the yearly figure', () => {
    const split = splitYear(-335000, 0.8)
    expect(split.regularYear + split.lumpYear).toBe(-335000)
  })
})

describe('planungSummary() — spec.md §3c Budget formula', () => {
  // The aggregate 2025 figures already published in spec.md §3c (whole
  // euros, in cents): Einnahmen 166.373, Fixkosten −67.716, Jahresanfang
  // minus Puffer 5.687 (13.687 − 8.000) → Budget 104.344; Ausgaben +
  // Rücklagen together −97.000 → Ausgaben vs. Budget 7.344.
  it('reproduces the 2025 worked example', () => {
    const { startCash, budget, ausgabenVsBudget } = planungSummary({
      einnahmen: 16637300,
      fixkosten: -6771600,
      jahresanfang: 1368700,
      puffer: 800000,
      ausgaben: -9700000,
      ruecklagen: 0,
    })
    expect(startCash).toBe(568700)
    expect(budget).toBe(10434400)
    expect(ausgabenVsBudget).toBe(734400)
  })

  it('reproduces the 2026 worked example Budget', () => {
    const { budget } = planungSummary({
      einnahmen: 13378800,
      fixkosten: -8334600,
      jahresanfang: 2224000,
      puffer: 800000,
      ausgaben: 0,
      ruecklagen: 0,
    })
    expect(budget).toBe(6468200)
  })

  it('Rücklagen count against the budget exactly like Ausgaben', () => {
    const base = { einnahmen: 1000000, fixkosten: -200000, jahresanfang: 100000, puffer: 100000 }
    const a = planungSummary({ ...base, ausgaben: -500000, ruecklagen: -100000 })
    const b = planungSummary({ ...base, ausgaben: -600000, ruecklagen: 0 })
    expect(a.ausgabenVsBudget).toBe(b.ausgabenVsBudget)
    expect(a.ausgabenVsBudget).toBe(200000)
  })
})

describe('opening-balance anchors are never a period\'s activity (spec.md §2.3)', () => {
  // The Jahresabschluß transaction is dated at the first year's start and
  // carries the opening balance, tagged per allocation tag — it must count
  // in balances but not as January's bookings in Verlauf/Planung.
  const SPAREN = { id: 'sparen-familie', reconciliationTargetAccountIds: ['livret-a-sparen'] }
  const anchor = {
    id: 'jahresabschluss-livret-a-sparen',
    date: '2025-01-01',
    fromAccountId: 'jahresabschluss',
    toAccountId: 'livret-a-sparen',
    amountCents: 500000,
    lines: [{ amountCents: 500000, categoryId: 'gehalt', note: '', tags: ['sparen-familie', 'fonds'] }],
  }
  const realContribution = {
    date: '2025-01-15',
    fromAccountId: 'bnp-konto',
    toAccountId: 'livret-a-sparen',
    lines: [{ amountCents: 10000, categoryId: null, note: '', tags: ['sparen-familie', 'fonds'] }],
  }

  it('allocationMonthActual() ignores the anchor but keeps a real January contribution', () => {
    expect(allocationMonthActual('sparen-familie', 2025, 1, [anchor], [SPAREN])).toBe(0)
    expect(allocationMonthActual('sparen-familie', 2025, 1, [anchor, realContribution], [SPAREN])).toBe(-10000)
  })

  it('breakdownGroupAllocationMonthActual() ignores the anchor', () => {
    expect(breakdownGroupAllocationMonthActual('sparen-familie', new Set(['fonds']), 2025, 1, [anchor, realContribution], [SPAREN])).toBe(-10000)
  })

  it('categoryMonthActual() and breakdownGroupMonthActual() ignore the anchor', () => {
    expect(categoryMonthActual('gehalt', 2025, 1, [anchor])).toBe(0)
    expect(breakdownGroupMonthActual('gehalt', new Set(['fonds']), 2025, 1, [anchor])).toBe(0)
  })

  it('Prog of a closed January shows the real contribution only, not the opening balance', () => {
    const plan1 = Array(12).fill(-5000)
    expect(progMonths('allocationTagId', 'sparen-familie', plan1, [1], 2025, [anchor, realContribution], [SPAREN])[0]).toBe(-10000)
  })
})
