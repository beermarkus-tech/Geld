import { describe, expect, it } from 'vitest'

import { tagBalance, tagJahresende } from './tagBalance'

// Synthetic fixtures only — same standing privacy rule as balance.test.js.

const SPAREN_SOPHIA = { id: 'sparen-sophia', reconciliationTargetAccountIds: ['livret-a-sparen'] }
const ANLAGE_FAMILIE = { id: 'anlage-familie', reconciliationTargetAccountIds: ['aktien', 'crypto', 'edelmetalle', 'esop'] }

describe('tagBalance()', () => {
  it('adds a line tagged on a transaction whose toAccountId is the tag\'s target (spec.md §2.5\'s own worked example)', () => {
    const tx = {
      date: '2025-03-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      amountCents: 10000,
      lines: [{ amountCents: 10000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(tagBalance('sparen-sophia', '2025-12-31', [tx], [SPAREN_SOPHIA])).toBe(10000)
  })

  it('subtracts when the tagged line\'s transaction has the target as fromAccountId (money leaving the pool)', () => {
    const tx = {
      date: '2025-04-01',
      fromAccountId: 'livret-a-sparen',
      toAccountId: 'bnp-konto',
      amountCents: 3000,
      lines: [{ amountCents: 3000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(tagBalance('sparen-sophia', '2025-12-31', [tx], [SPAREN_SOPHIA])).toBe(-3000)
  })

  it('ignores an untagged line even on an otherwise-matching transaction', () => {
    const tx = {
      date: '2025-03-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      amountCents: 10000,
      lines: [{ amountCents: 10000, categoryId: null, note: '', tags: [] }],
    }
    expect(tagBalance('sparen-sophia', '2025-12-31', [tx], [SPAREN_SOPHIA])).toBe(0)
  })

  it('sums only the tagged line\'s own amount on a split transaction, not the parent total', () => {
    const tx = {
      date: '2025-05-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      amountCents: 10000,
      lines: [
        { amountCents: 6000, categoryId: null, note: '', tags: ['sparen-sophia'] },
        { amountCents: 4000, categoryId: null, note: '', tags: [] },
      ],
    }
    expect(tagBalance('sparen-sophia', '2025-12-31', [tx], [SPAREN_SOPHIA])).toBe(6000)
  })

  it('nets to zero when a tagged line\'s transaction moves money between two of the tag\'s own target accounts', () => {
    // Aktien -> Crypto, both inside Anlage Familie's combined pool — an
    // internal reallocation, not new money into or out of the pool.
    const tx = {
      date: '2025-06-01',
      fromAccountId: 'aktien',
      toAccountId: 'crypto',
      amountCents: 5000,
      lines: [{ amountCents: 5000, categoryId: null, note: '', tags: ['anlage-familie'] }],
    }
    expect(tagBalance('anlage-familie', '2025-12-31', [tx], [ANLAGE_FAMILIE])).toBe(0)
  })

  it('sums across multiple target accounts for a combined-pool tag (Anlage Familie: Aktien/Crypto/Edelmetalle/ESOP)', () => {
    const into = {
      date: '2025-02-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'aktien',
      amountCents: 8000,
      lines: [{ amountCents: 8000, categoryId: null, note: '', tags: ['anlage-familie'] }],
    }
    const alsoInto = {
      date: '2025-07-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'esop',
      amountCents: 2000,
      lines: [{ amountCents: 2000, categoryId: null, note: '', tags: ['anlage-familie'] }],
    }
    expect(tagBalance('anlage-familie', '2025-12-31', [into, alsoInto], [ANLAGE_FAMILIE])).toBe(10000)
  })

  it('excludes a line dated after asOfDate', () => {
    const early = {
      date: '2025-02-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      amountCents: 5000,
      lines: [{ amountCents: 5000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    const late = {
      date: '2025-09-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      amountCents: 7000,
      lines: [{ amountCents: 7000, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(tagBalance('sparen-sophia', '2025-06-01', [early, late], [SPAREN_SOPHIA])).toBe(5000)
  })

  it('returns 0 for an unknown tag id rather than throwing', () => {
    expect(tagBalance('does-not-exist', '2025-12-31', [], [SPAREN_SOPHIA])).toBe(0)
  })

  it('uses a line\'s own signed amountCents directly, not Math.abs() (bug caught by Markus: a negative-signed tagged line, e.g. a fee split out of a contribution, silently flipped positive)', () => {
    // Single-sided income into Aktien, split into a positive contribution
    // line and a negative fee line — both tagged, same as a real
    // salary-split line pair (§2.6's own Gehalt/Steuern example).
    const tx = {
      date: '2025-08-01',
      fromAccountId: null,
      toAccountId: 'aktien',
      amountCents: 9000,
      lines: [
        { amountCents: 10000, categoryId: null, note: '', tags: ['anlage-familie'] },
        { amountCents: -1000, categoryId: null, note: '', tags: ['anlage-familie'] },
      ],
    }
    expect(tagBalance('anlage-familie', '2025-12-31', [tx], [ANLAGE_FAMILIE])).toBe(9000)
  })
})

describe('tagJahresende()', () => {
  it('is tagBalance() as of Dec 31 of the given year', () => {
    const tx = {
      date: '2025-03-01',
      fromAccountId: 'bnp-konto',
      toAccountId: 'livret-a-sparen',
      amountCents: 4200,
      lines: [{ amountCents: 4200, categoryId: null, note: '', tags: ['sparen-sophia'] }],
    }
    expect(tagJahresende('sparen-sophia', 2025, [tx], [SPAREN_SOPHIA])).toBe(4200)
    expect(tagJahresende('sparen-sophia', 2025, [tx], [SPAREN_SOPHIA])).toBe(tagBalance('sparen-sophia', '2025-12-31', [tx], [SPAREN_SOPHIA]))
  })
})
