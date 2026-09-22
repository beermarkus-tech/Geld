import { describe, expect, it } from 'vitest'

import { balance, jahresanfang, jahresende } from './balance'

// Synthetic fixtures only — never real figures. The repo is public
// (CLAUDE.md/DEVLOG.md's standing privacy rule: no real financial data in
// this repo, ever), so this committed suite can't use Markus's actual 2025
// numbers even though PLAN.md's Phase 1a originally imagined it would.
// The equivalent real-data check already happens, just not as a committed
// test: migration/transform-transactions.py's verify_account_sums()
// implements this exact same per-account-position sign rule and checks it
// against the real Gsheet totals for every account, every year, before the
// data ever reaches Firestore (see CODEMAP.md).

const JAHRESABSCHLUSS = {
  id: 'jahresabschluss-bnp-konto',
  date: '2025-01-01',
  fromAccountId: 'jahresabschluss',
  toAccountId: 'bnp-konto',
  amountCents: 100000,
}

describe('balance()', () => {
  it('adds a single-sided income transaction', () => {
    const tx = { date: '2025-02-01', fromAccountId: null, toAccountId: 'bnp-konto', amountCents: 5000 }
    expect(balance('bnp-konto', '2025-12-31', [tx])).toBe(5000)
  })

  it('subtracts a single-sided expense transaction (natural negative sign)', () => {
    const tx = { date: '2025-02-01', fromAccountId: 'bnp-konto', toAccountId: null, amountCents: -1600 }
    expect(balance('bnp-konto', '2025-12-31', [tx])).toBe(-1600)
  })

  it('applies a two-account transfer to each side by position, not by the stored sign (§2.6)', () => {
    // amountCents is always a positive magnitude for a two-account
    // transaction — the critical case that broke a naive "add the signed
    // field to both sides" implementation during the real migration.
    const transfer = { date: '2025-03-01', fromAccountId: 'bnp-konto', toAccountId: 'livret-a-sparen', amountCents: 10000 }
    expect(balance('bnp-konto', '2025-12-31', [transfer])).toBe(-10000)
    expect(balance('livret-a-sparen', '2025-12-31', [transfer])).toBe(10000)
  })

  it('excludes transactions dated after asOfDate', () => {
    const early = { date: '2025-02-01', fromAccountId: null, toAccountId: 'bnp-konto', amountCents: 5000 }
    const late = { date: '2025-06-01', fromAccountId: null, toAccountId: 'bnp-konto', amountCents: 7000 }
    expect(balance('bnp-konto', '2025-03-01', [early, late])).toBe(5000)
    expect(balance('bnp-konto', '2025-06-01', [early, late])).toBe(12000)
  })

  it('includes a transaction dated exactly on asOfDate', () => {
    const tx = { date: '2025-12-31', fromAccountId: null, toAccountId: 'bnp-konto', amountCents: 100 }
    expect(balance('bnp-konto', '2025-12-31', [tx])).toBe(100)
  })

  it('ignores transactions that touch a different account entirely', () => {
    const tx = { date: '2025-02-01', fromAccountId: null, toAccountId: 'dkb-konto', amountCents: 5000 }
    expect(balance('bnp-konto', '2025-12-31', [tx])).toBe(0)
  })

  it('runs continuously across a year boundary with no restatement (§2.3 — one anchor, ever)', () => {
    const expense2025 = { date: '2025-06-01', fromAccountId: 'bnp-konto', toAccountId: null, amountCents: -20000 }
    const income2026 = { date: '2026-01-15', fromAccountId: null, toAccountId: 'bnp-konto', amountCents: 30000 }
    const all = [JAHRESABSCHLUSS, expense2025, income2026]
    expect(balance('bnp-konto', '2025-12-31', all)).toBe(80000)
    expect(balance('bnp-konto', '2026-12-31', all)).toBe(110000)
  })
})

describe('jahresanfang() / jahresende()', () => {
  const expense2025 = { date: '2025-06-01', fromAccountId: 'bnp-konto', toAccountId: null, amountCents: -20000 }
  const income2026 = { date: '2026-01-15', fromAccountId: null, toAccountId: 'bnp-konto', amountCents: 30000 }
  const all = [JAHRESABSCHLUSS, expense2025, income2026]

  it('computes Jahresanfang(2026) as a lookup against 2025-12-31, not a stored value', () => {
    expect(jahresanfang('bnp-konto', 2026, all)).toBe(80000)
  })

  it('computes Jahresende(2025) the same way, for Prognose to compare against', () => {
    expect(jahresende('bnp-konto', 2025, all)).toBe(80000)
    expect(jahresende('bnp-konto', 2025, all)).toBe(jahresanfang('bnp-konto', 2026, all))
  })
})
