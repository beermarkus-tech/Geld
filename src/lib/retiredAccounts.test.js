import { describe, expect, it } from 'vitest'

import { planRetiredAccountFixes } from './retiredAccounts'

// Synthetic fixtures only — same standing privacy rule as the other tests.

describe('planRetiredAccountFixes()', () => {
  const loanOut = {
    id: 't1',
    date: '2025-03-01',
    fromAccountId: 'bnp-konto',
    toAccountId: 'geld-verliehen-geliehen',
    amountCents: 20000,
    lines: [{ amountCents: 20000, categoryId: null, note: '', tags: ['dirk'] }],
  }
  const amazonRefund = {
    id: 't2',
    date: '2025-04-01',
    fromAccountId: 'amazon-julia-fr',
    toAccountId: 'bnp-konto',
    amountCents: 3000,
    lines: [{ amountCents: 3000, categoryId: null, note: '', tags: ['amazon'] }],
  }
  const untaggedLoan = {
    id: 't3',
    date: '2025-05-01',
    fromAccountId: 'geld-verliehen-geliehen',
    toAccountId: 'bnp-konto',
    amountCents: 5000,
    deletedAt: 1,
    lines: [{ amountCents: 5000, categoryId: null, note: '', tags: [] }],
  }
  const unrelated = {
    id: 't4',
    date: '2025-05-02',
    fromAccountId: 'bnp-konto',
    toAccountId: 'aussenstaende',
    amountCents: 100,
    lines: [{ amountCents: 100, categoryId: null, note: '', tags: ['dirk'] }],
  }

  it('rewrites only the retired side to aussenstaende, leaving everything else untouched', () => {
    const { fixes } = planRetiredAccountFixes([loanOut, amazonRefund, unrelated])
    expect(fixes).toHaveLength(2)
    expect(fixes[0].after).toEqual({ ...loanOut, toAccountId: 'aussenstaende' })
    expect(fixes[1].after).toEqual({ ...amazonRefund, fromAccountId: 'aussenstaende' })
  })

  it('includes soft-deleted transactions, so a later restore brings back the corrected account', () => {
    const { fixes } = planRetiredAccountFixes([untaggedLoan])
    expect(fixes[0].after.fromAccountId).toBe('aussenstaende')
    expect(fixes[0].after.deletedAt).toBe(1)
  })

  it('counts per old id and flags transactions with no tag on any line', () => {
    const { countsByOldId, untagged } = planRetiredAccountFixes([loanOut, amazonRefund, untaggedLoan, unrelated])
    expect(countsByOldId).toEqual({ 'geld-verliehen-geliehen': 2, 'amazon-julia-fr': 1 })
    expect(untagged.map((t) => t.id)).toEqual(['t3'])
  })

  it('finds nothing once the data is clean', () => {
    expect(planRetiredAccountFixes([unrelated]).fixes).toEqual([])
  })
})
