import { describe, expect, it } from 'vitest'

import { forecastSeries } from './forecast'
import { monthChecks } from './monthChecks'
import { yearBalance } from './yearBalance'

// BNP (cash), Smartbroker (Investment Cash, technically Barkonten), Aktien (Geldanlage), Livret (Sparkonten)
const accounts = [
  { id: 'bnp', name: 'BNP', reportingGroup: 'Barkonten' },
  { id: 'sb', name: 'Smartbroker', reportingGroup: 'Barkonten', group: 'investment-cash' },
  { id: 'aktien', name: 'Aktien', reportingGroup: 'Geldanlage' },
  { id: 'esop', name: 'ESOP', reportingGroup: 'Geldanlage' },
  { id: 'livret', name: 'Livret', reportingGroup: 'Sparkonten' },
  { id: 'jahresabschluss', name: 'Jahresabschluß', reportingGroup: null },
]
const categories = [
  { id: 'ein', name: 'Einnahmen', parentCategoryId: null },
  { id: 'misc', name: 'Sonstige Einnahmen', parentCategoryId: 'ein' },
  { id: 'pay', name: 'Gehalt Markus', parentCategoryId: 'ein' },
]
const tags = [
  { id: 'anlage-familie', name: 'Anlage Familie', class: 'allocation', reconciliationTargetAccountIds: ['aktien', 'esop'] },
  { id: 'sparen-familie', name: 'Sparen Familie', class: 'allocation', reconciliationTargetAccountIds: ['livret'] },
]
const b = (pv, key, id, month, cents) => ({ year: 2026, month, planVersion: pv, type: 'x', [key]: id, breakdownTagId: null, plannedAmountCents: cents })
const tx = (id, date, from, to, cents, lines = []) => ({ id, date, fromAccountId: from, toAccountId: to, amountCents: cents, lines })
const transactions = [
  tx('o1', '2025-12-31', 'jahresabschluss', 'bnp', 1000000),
  tx('o2', '2025-12-31', 'jahresabschluss', 'sb', 300000),
  tx('o3', '2025-12-31', 'jahresabschluss', 'aktien', 500000, [{ amountCents: 500000, tags: ['anlage-familie'] }]),
  // January (closed): salary, top-up of the broker, a purchase from it, a dividend on it, ESOP from the bank
  tx('s', '2026-01-25', null, 'bnp', 400000, [{ amountCents: 400000, categoryId: 'pay', tags: [] }]),
  tx('t', '2026-01-05', 'bnp', 'sb', 200000),
  tx('k', '2026-01-10', 'sb', 'aktien', 150000, [{ amountCents: 150000, tags: ['anlage-familie'] }]),
  tx('d', '2026-01-15', null, 'sb', 5000, [{ amountCents: 5000, categoryId: 'misc', tags: [] }]),
  tx('e', '2026-01-20', 'bnp', 'esop', 30000, [{ amountCents: 30000, tags: ['anlage-familie'] }]),
]
const budgets = [
  b('plan1', 'categoryId', 'pay', 2, 400000),
  b('plan1', 'allocationTagId', 'investment-cash', 2, -100000), // top up the broker in February
  b('plan1', 'allocationTagId', 'anlage-familie', 2, -80000), // invest 800 from it
]
const input = { accounts, categories, tags, budgets, transactions, year: 2026, closedMonths: [1] }

describe('Investment Cash', () => {
  const r = forecastSeries(input)
  it('is not part of the red line, and has its own bar', () => {
    expect(r.start).toMatchObject({ cash: 1000000, investmentCash: 300000, geldanlage: 500000 })
  })
  it('closed month: only money leaving the cash moves the red line (top-up and ESOP), purchase and dividend do not', () => {
    // +4.000 salary, −2.000 to the broker, −300 ESOP; the dividend (+50) counts as income but stays on the broker
    expect(r.months[0].prog).toBe(1000000 + 400000 - 200000 - 30000)
    expect(r.months[0]).toMatchObject({ investmentCash: 300000 + 200000 - 150000 + 5000, geldanlage: 500000 + 150000 + 30000 })
  })
  it('open month: the Investment Cash plan leaves the red line, the Anlage plan only moves light to dark green', () => {
    expect(r.months[1].prog - r.months[0].prog).toBe(400000 - 100000)
    expect(r.months[1].investmentCash - r.months[0].investmentCash).toBe(100000 - 80000)
    expect(r.months[1].geldanlage - r.months[0].geldanlage).toBe(80000)
    // the Anlage plan is not in the Plan lines either; the Investment Cash plan is
    expect(r.months[1].plan1 - r.months[0].plan1).toBe(400000 - 100000)
  })
  it('the month check balances without any tag on the broker bookings', () => {
    expect(monthChecks(input)[0].progDelta).toBe(0)
  })
  it('the Jahresbilanz has an Investment Cash piece and still adds up', () => {
    const yb = yearBalance(input)
    expect(yb.startParts[1]).toMatchObject({ id: 'investment-cash', cents: 300000 })
    const sum = (ps) => ps.reduce((s, p) => s + p.cents, 0)
    expect(sum(yb.startParts)).toBe(yb.versions.prog.start)
    expect(sum(yb.endParts)).toBe(yb.versions.prog.ende)
  })
})
