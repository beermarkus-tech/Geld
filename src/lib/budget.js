// Pure, in-memory budget/actual computation (spec.md §2.7/§2.8) — no
// Firestore access here, same "plain data in, a number out" shape as
// balance.js/tagBalance.js. Shared by Verlauf (§3b) and Planung (§3c) —
// Planung's own formulas (the regular/lump split, the Budget summary band)
// live at the bottom of this file.

import { isAnchorTransaction } from './balance'

// Speed (Nov 2026, Markus: switching years had become slow – 2 to 4 s): every month actual below used
// to scan *all* bookings, once per category/pot and month. The bookings are now sorted into month
// buckets once per transactions array (opening-balance anchors left out, as every actual here skips
// them), and each actual only walks its own month. Same for the plan rows: indexed once per budgets
// array. Cached by array identity (WeakMap) – a new snapshot is a new array, so nothing goes stale.
const monthBuckets = new WeakMap()
/** The non-anchor bookings dated in one month ("YYYY-MM"). */
export function bookingsInMonth(transactions, year, month) {
  let byMonth = monthBuckets.get(transactions)
  if (!byMonth) {
    byMonth = new Map()
    for (const tx of transactions) {
      if (!tx.date || isAnchorTransaction(tx)) continue
      const ym = tx.date.slice(0, 7)
      let list = byMonth.get(ym)
      if (!list) byMonth.set(ym, (list = []))
      list.push(tx)
    }
    monthBuckets.set(transactions, byMonth)
  }
  return byMonth.get(`${year}-${String(month).padStart(2, '0')}`) ?? []
}

const budgetIndexes = new WeakMap()
/** The plan rows of one year, plan version and target (`categoryId` or `allocationTagId`). */
function budgetRowsFor(budgets, targetKey, targetId, planVersion, year) {
  let idx = budgetIndexes.get(budgets)
  if (!idx) {
    idx = new Map()
    for (const b of budgets) {
      for (const key of ['categoryId', 'allocationTagId']) {
        if (b[key] == null) continue
        const k = `${key}|${b[key]}|${b.planVersion}|${b.year}`
        let list = idx.get(k)
        if (!list) idx.set(k, (list = []))
        list.push(b)
      }
    }
    budgetIndexes.set(budgets, idx)
  }
  return idx.get(`${targetKey}|${targetId}|${planVersion}|${year}`) ?? []
}

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
  let total = 0
  // Opening-balance anchors are balances, not a period's bookings (left out of the month buckets).
  for (const tx of bookingsInMonth(transactions, year, month)) {
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
  // The virtual "Investment Cash" row (lib/investmentCash.js): −(the month's change of all investment
  // accounts), from the accounts alone – no tags.
  // Counted: money moving between a non-investment account and an investment account (BNP → Smartbroker,
  // BNP → ESOP; a purchase Smartbroker → Aktien stays inside and counts nothing), and the opposite of
  // every categorized line booked straight on an investment account (a dividend or fee: its category
  // already counts, the cash did not move). An uncategorized one-sided booking there (a revaluation)
  // touches neither the cash nor any planning row and is left alone.
  if (tag?.investAccountIds) {
    const invest = new Set(tag.investAccountIds)
    let change = 0
    for (const tx of bookingsInMonth(transactions, year, month)) {
      const intoInvest = invest.has(tx.toAccountId)
      const outOfInvest = invest.has(tx.fromAccountId)
      if (!intoInvest && !outOfInvest) continue
      if (tx.fromAccountId && tx.toAccountId) {
        if (intoInvest !== outOfInvest) change += (intoInvest ? 1 : -1) * Math.abs(tx.amountCents ?? 0)
        continue
      }
      for (const line of tx.lines ?? []) if (line.categoryId) change += line.amountCents ?? 0
    }
    return change === 0 ? 0 : -change
  }
  const targets = new Set(tag?.reconciliationTargetAccountIds ?? [])
  let delta = 0
  // Opening-balance anchors are balances, not a period's bookings (left out of the month buckets).
  for (const tx of bookingsInMonth(transactions, year, month)) {
    const isTransfer = Boolean(tx.fromAccountId && tx.toAccountId)
    for (const line of tx.lines ?? []) {
      if (!(line.tags ?? []).includes(allocationTagId)) continue
      // A one-sided line (paid straight from / received straight into a pot's account) already
      // carries its natural sign – add it as is, exactly like tagBalance() does. The −/+ position
      // rule below is for transfers only; applying it here flipped an expense paid from the pot
      // (Nov 2026: 2025's "Feelharmonia", −290 € from Livret A Tagesgeld, counted twice in Prog).
      if (!isTransfer) {
        if (targets.has(tx.fromAccountId) || targets.has(tx.toAccountId)) delta += line.amountCents
        continue
      }
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
  const rows = budgetRowsFor(budgets, targetKey, targetId, planVersion, year)
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
  const rows = budgetRowsFor(budgets, targetKey, targetId, planVersion, year).filter((b) => b.breakdownTagId === breakdownTagId)
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
  let total = 0
  // Opening-balance anchors are balances, not a period's bookings (left out of the month buckets).
  for (const tx of bookingsInMonth(transactions, year, month)) {
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
  let delta = 0
  // Opening-balance anchors are balances, not a period's bookings (left out of the month buckets).
  for (const tx of bookingsInMonth(transactions, year, month)) {
    const isTransfer = Boolean(tx.fromAccountId && tx.toAccountId)
    for (const line of tx.lines ?? []) {
      if (!(line.tags ?? []).some((t) => tagIds.has(t))) continue
      // one-sided: natural sign, as in allocationMonthActual() (same Nov 2026 fix)
      if (!isTransfer) {
        if (targets.has(tx.fromAccountId) || targets.has(tx.toAccountId)) delta += line.amountCents
        continue
      }
      if (targets.has(tx.fromAccountId)) delta -= line.amountCents
      if (targets.has(tx.toAccountId)) delta += line.amountCents
    }
  }
  return delta === 0 ? 0 : -delta
}

/** Whether a row (category or pot) has any non-zero figure in this plan version and year. */
export function hasPlanFigures(targetKey, targetId, planVersion, year, budgets) {
  return budgetRowsFor(budgets, targetKey, targetId, planVersion, year).some((b) => b.plannedAmountCents)
}

/** The plan Prog follows in a row's open months (Nov 2026, Markus, "per row"): Plan1 once that row has
 *  any Plan1 figure in the year, otherwise Plan0 – so a year planned only in Plan0 (2027) already has a
 *  Prognose. Rows are revised one by one (Verlauf's "Plan0 → Plan1" copy). @returns 'plan1' | 'plan0' */
export function progPlanVersion(targetKey, targetId, year, budgets) {
  return hasPlanFigures(targetKey, targetId, 'plan1', year, budgets) ? 'plan1' : 'plan0'
}

/** The monthly figures Prog uses for the open months of one row (see progPlanVersion). */
export function progBaseMonths(targetKey, targetId, year, budgets) {
  return budgetTopLineMonths(targetKey, targetId, progPlanVersion(targetKey, targetId, year, budgets), year, budgets).months
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
// Budget = Einnahmen + Fixkosten (negative) + (Jahresanfang − Puffer) + Entnahmen aus Rücklagen;
// Ausgaben vs. Budget = Budget + Ausgaben + gebildete Rücklagen (both negative when
// money goes out) — "should be near zero".
//
// Rücklagen rows are split by the sign of their year total (Nov 2026, Markus): a row that gives back
// more than it takes over the year (e.g. Steuern paid out of the pot) is money flowing *into* the cash –
// an extra source for the Budget, "+ aus Rücklagen entnommen"; a negative row is money put aside –
// "gebildete Rücklagen". Ausgaben vs. Budget is the same either way; before, a net withdrawal made
// "gebildete Rücklagen" negative and the chart (which cannot draw a negative bar) dropped it.
//
// @param {{einnahmen: number, fixkosten: number, jahresanfang: number, puffer: number, ausgaben: number, ruecklagen: number[]|number}} p
//   `puffer` is the positive minCashBufferCents; `jahresanfang` the raw
//   starting cash before the buffer is taken off; `ruecklagen` the year totals of the Rücklagen rows
//   (a single number still works: its sign decides).
export function planungSummary({ einnahmen, fixkosten, jahresanfang, puffer, ausgaben, ruecklagen }) {
  const rows = Array.isArray(ruecklagen) ? ruecklagen : [ruecklagen]
  const entnahmen = rows.filter((v) => v > 0).reduce((a, v) => a + v, 0)
  const gebildet = rows.filter((v) => v < 0).reduce((a, v) => a + v, 0)
  const startCash = jahresanfang - puffer
  const budget = einnahmen + fixkosten + startCash + entnahmen
  return { startCash, entnahmen, gebildet, budget, ausgabenVsBudget: budget + ausgaben + gebildet }
}
