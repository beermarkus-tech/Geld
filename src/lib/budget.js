// Pure, in-memory budget/actual computation (spec.md §2.7/§2.8) — no
// Firestore access here, same "plain data in, a number out" shape as
// balance.js/tagBalance.js. Verlauf-scoped for now (§3b) — Planung's own
// formulas (§3c's regular/lump split, the Budget/Ausgaben/Rücklagen chart)
// aren't written yet since nothing calls them until Planung itself is built.

// A category's actual for one month — Σ every line's own signed amount
// where that line's categoryId matches, dated in that month (spec.md §3b:
// "Σ transactions where categoryId == X and date in month"). Runs over
// lines[], never a transaction's own cached amountCents (§2.6 — that field
// is a total once split, not itself part of the sum).
//
// @param {string} categoryId
// @param {number} year
// @param {number} month  1-12
// @param {Array} transactions
export function categoryMonthActual(categoryId, year, month, transactions) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  let total = 0
  for (const tx of transactions) {
    if (!tx.date.startsWith(prefix)) continue
    for (const line of tx.lines ?? []) {
      if (line.categoryId === categoryId) total += line.amountCents
    }
  }
  return total
}

// A savings-transfer row's actual for one month — spec.md §2.7:
// "plannedAmountCents... savings-transfer: − = money set aside into the
// tag... so its actual is −(the tag's change that month)". The tag's own
// change uses the same signed-by-target-account rule as tagBalance.js's
// tagBalance() (+ arriving at one of reconciliationTargetAccountIds, − by
// leaving one), just scoped to lines dated within this one month instead
// of accumulated to a date, then negated to match the planned-amount sign
// convention (money moving *into* savings reads negative, like an expense).
//
// @param {string} allocationTagId
// @param {number} year
// @param {number} month  1-12
// @param {Array} transactions
// @param {Array<{id: string, reconciliationTargetAccountIds?: string[]}>} tags
export function allocationMonthActual(allocationTagId, year, month, transactions, tags) {
  const tag = tags.find((t) => t.id === allocationTagId)
  const targets = new Set(tag?.reconciliationTargetAccountIds ?? [])
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  let delta = 0
  for (const tx of transactions) {
    if (!tx.date.startsWith(prefix)) continue
    for (const line of tx.lines ?? []) {
      if (!(line.tags ?? []).includes(allocationTagId)) continue
      if (targets.has(tx.fromAccountId)) delta -= line.amountCents
      if (targets.has(tx.toAccountId)) delta += line.amountCents
    }
  }
  return delta === 0 ? 0 : -delta
}

// A category or allocation tag's top-line Plan0/Plan1 value, per month —
// spec.md §2.7's breakdown-line mechanism: "the category's top-line value
// becomes computed as the sum of its breakdown-line rows" once any exist,
// rather than read from the flat `breakdownTagId: null` row that no longer
// carries real data at that point. `targetKey` is `'categoryId'` or
// `'allocationTagId'` (which field `budgets` rows key off, spec.md §2.7).
//
// A `month: null` row (an annual lump sum, spec.md §2.7's schema comment)
// contributes to the yearly total but no single month column — real data
// never uses this today (every migrated row already carries an explicit
// month), but the schema allows it, so it's handled rather than silently
// dropped.
//
// @param {'categoryId'|'allocationTagId'} targetKey
// @param {string} targetId
// @param {'plan0'|'plan1'} planVersion
// @param {number} year
// @param {Array} budgets
// @returns {{months: number[], yearTotal: number}} months has 12 entries, Jan..Dec
export function budgetTopLineMonths(targetKey, targetId, planVersion, year, budgets) {
  const rows = budgets.filter((b) => b.year === year && b.planVersion === planVersion && b[targetKey] === targetId)
  const breakdownRows = rows.filter((b) => b.breakdownTagId != null)
  const source = breakdownRows.length > 0 ? breakdownRows : rows.filter((b) => b.breakdownTagId == null)
  const months = Array.from({ length: 12 }, () => 0)
  let lumpTotal = 0
  for (const row of source) {
    if (row.month == null) lumpTotal += row.plannedAmountCents
    else months[row.month - 1] += row.plannedAmountCents
  }
  const yearTotal = months.reduce((a, b) => a + b, 0) + lumpTotal
  return { months, yearTotal }
}
