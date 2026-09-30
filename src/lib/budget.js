// Pure, in-memory budget/actual computation (spec.md §2.7/§2.8) — no
// Firestore access here, same "plain data in, a number out" shape as
// balance.js/tagBalance.js. Shared by Verlauf (§3b) and Planung (§3c) —
// Planung's own formulas (the regular/lump split, the Budget summary band)
// live at the bottom of this file.

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
// Shared by budgetTopLineMonths() and budgetBreakdownLineMonths() below —
// both ultimately just fold a filtered set of budgets rows into 12 month
// slots plus a yearly total, differing only in *which* rows they hand in.
function sumBudgetRows(rows) {
  const months = Array.from({ length: 12 }, () => 0)
  let lumpTotal = 0
  for (const row of rows) {
    if (row.month == null) lumpTotal += row.plannedAmountCents
    else months[row.month - 1] += row.plannedAmountCents
  }
  const yearTotal = months.reduce((a, b) => a + b, 0) + lumpTotal
  return { months, yearTotal }
}

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
  return sumBudgetRows(source)
}

// One specific breakdown line's own 12 months (spec.md §2.7) — unlike
// budgetTopLineMonths() above, which sums *every* breakdown row into one
// top-line total, this reads a single breakdownTagId's own rows only, for
// rendering that line as its own row in Verlauf.
//
// @param {'categoryId'|'allocationTagId'} targetKey
// @param {string} targetId
// @param {string} breakdownTagId
// @param {'plan0'|'plan1'} planVersion
// @param {number} year
// @param {Array} budgets
export function budgetBreakdownLineMonths(targetKey, targetId, breakdownTagId, planVersion, year, budgets) {
  const rows = budgets.filter(
    (b) => b.year === year && b.planVersion === planVersion && b[targetKey] === targetId && b.breakdownTagId === breakdownTagId,
  )
  return sumBudgetRows(rows)
}

// The "Schottland (automatisch)" parent-tag rollup header (spec.md §2.7) —
// a narrower version of categoryMonthActual()'s own rule: only lines that
// are *both* in this category *and* carry the parent tag or one of its
// children count, since the whole point is showing what's actually been
// tagged under this specific breakdown group, not the category's every
// transaction (that's what the plain Prog row above already shows).
//
// @param {string} categoryId
// @param {Set<string>} tagIds  the parent tag's own id plus every child's
// @param {number} year
// @param {number} month  1-12
// @param {Array} transactions
export function breakdownGroupMonthActual(categoryId, tagIds, year, month, transactions) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  let total = 0
  for (const tx of transactions) {
    if (!tx.date.startsWith(prefix)) continue
    for (const line of tx.lines ?? []) {
      if (line.categoryId !== categoryId) continue
      if (!(line.tags ?? []).some((t) => tagIds.has(t))) continue
      total += line.amountCents
    }
  }
  return total
}

// The same rollup header, generalized to an allocation-tag-targeted
// breakdown group (Sept 2026 — real bug found: a Rücklagen breakdown's own
// "(automatisch)" row always showed blank in a closed month, since this
// case fell through a `targetKey === 'categoryId'` check in Verlauf.jsx
// with a hardcoded `: 0` for anything else, never actually computing an
// allocation-side actual at all). Mirrors `allocationMonthActual()`'s own
// position-based sign rule (+ arriving at one of the allocation tag's own
// `reconciliationTargetAccountIds`, − leaving one) rather than
// `breakdownGroupMonthActual()`'s plain category-sum rule — matches a
// savings-transfer's actual being a signed *change*, not a raw sum — but
// filtered to lines carrying the *breakdown group's* tag (the parent or one
// of its children), the same "which sub-lines does this rollup cover"
// question `breakdownGroupMonthActual()` already answers for a category.
//
// @param {string} allocationTagId
// @param {Set<string>} tagIds  the parent tag's own id plus every child's
// @param {number} year
// @param {number} month  1-12
// @param {Array} transactions
// @param {Array} tags
export function breakdownGroupAllocationMonthActual(allocationTagId, tagIds, year, month, transactions, tags) {
  const tag = tags.find((t) => t.id === allocationTagId)
  const targets = new Set(tag?.reconciliationTargetAccountIds ?? [])
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  let delta = 0
  for (const tx of transactions) {
    if (!tx.date.startsWith(prefix)) continue
    for (const line of tx.lines ?? []) {
      if (!(line.tags ?? []).some((t) => tagIds.has(t))) continue
      if (targets.has(tx.fromAccountId)) delta -= line.amountCents
      if (targets.has(tx.toAccountId)) delta += line.amountCents
    }
  }
  return delta === 0 ? 0 : -delta
}

// Prog for one category/allocation tag, per month (spec.md §3b): a closed
// month is the real Konten actual; an open month mirrors Plan1 for that
// same month ("if nothing changes, this is what will happen"). Shared by
// Verlauf's Prog row and Planung's Prog lens (§3c), so both always agree.
//
// @param {'categoryId'|'allocationTagId'} targetKey
// @param {string} targetId
// @param {number[]} plan1Months  12 entries, Jan..Dec
// @param {number[]} closedMonths  month numbers 1-12 (settings/{year}.closedMonths)
// @param {number} year
// @param {Array} transactions
// @param {Array} tags
export function progMonths(targetKey, targetId, plan1Months, closedMonths, year, transactions, tags) {
  return plan1Months.map((plan1Value, i) => {
    const month = i + 1
    if (!closedMonths.includes(month)) return plan1Value
    return targetKey === 'allocationTagId'
      ? allocationMonthActual(targetId, year, month, transactions, tags)
      : categoryMonthActual(targetId, year, month, transactions)
  })
}

// The regular/lump split (spec.md §2.8/§3c) — how much of a row's yearly
// figure recurs every month vs. arrives as one-off payments, derived from
// the reference year's 12 closed monthly actuals: median × 12 is the
// recurring floor, the rest is einmalig.
//
// Edge cases, all resolved in spec.md §2.8:
// - `referenceMonths` null (no reference-year data at all) → 100 % einmalig.
// - reference total 0 → share 0 (nothing to extrapolate from, not an error).
// - a refund/unusual month can push the share past 100 % (einmal negative)
//   — shown as computed, never clamped.
//
// @param {number[]|null} referenceMonths  12 monthly actuals, or null
// @returns {number} the regular share as a fraction (0.8 = 80 %), unrounded
export function regularShare(referenceMonths) {
  if (!referenceMonths) return 0
  const total = referenceMonths.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const sorted = [...referenceMonths].sort((a, b) => a - b)
  const median = (sorted[5] + sorted[6]) / 2
  return (median * 12) / total
}

// Applies regularShare() to a displayed yearly figure (Planung's planning
// column — whichever of Plan0/Plan1/Prog is on screen, §2.7c: the split
// "describes funding timing, not a re-plan of the category itself").
// Rounded to whole cents; einmal is the exact remainder so the two always
// add back up to the yearly figure.
//
// @param {number} yearCents
// @param {number} share  from regularShare()
// @returns {{regularYear: number, regularMonth: number, lumpYear: number, percent: number}}
export function splitYear(yearCents, share) {
  // `|| 0` everywhere: a 0 share times a negative figure is −0, which
  // would otherwise leak through as "−0" in the display.
  const regularYear = Math.round(yearCents * share) || 0
  return {
    regularYear,
    regularMonth: Math.round(regularYear / 12) || 0,
    lumpYear: yearCents - regularYear,
    percent: Math.round(share * 100) || 0,
  }
}

// Planung's summary band (spec.md §3c), all signed cents as displayed:
// Budget = Einnahmen + Fixkosten (negative) + (Jahresanfang − Puffer);
// Ausgaben vs. Budget = Budget + Ausgaben + Rücklagen (both negative when
// money goes out) — "should be near zero".
//
// @param {{einnahmen: number, fixkosten: number, jahresanfang: number, puffer: number, ausgaben: number, ruecklagen: number}} p
//   `puffer` is the positive minCashBufferCents; `jahresanfang` the raw
//   starting cash before the buffer is taken off.
export function planungSummary({ einnahmen, fixkosten, jahresanfang, puffer, ausgaben, ruecklagen }) {
  const startCash = jahresanfang - puffer
  const budget = einnahmen + fixkosten + startCash
  return { startCash, budget, ausgabenVsBudget: budget + ausgaben + ruecklagen }
}
