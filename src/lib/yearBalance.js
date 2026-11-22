// Dashboard "Prognose", the two charts under the main chart (spec.md §3d, Nov 2026, from Markus's Sheet):
//  - yearBalance(): Jahresbilanz – Jahresanfang → Einnahmen → Ausgaben → Jahresende for all the
//    family's money together (cash + savings pots). Moving money into a pot is no Ausgabe (it stays
//    ours); spending out of a pot is (it is booked on an expense category). So Einnahmen = the
//    income categories, Ausgaben = all other categories (net), per version: Plan0, Plan1 and
//    Prognose (booked in closed months, Plan1 in open ones – Verlauf's Prog line).
//    The bars are the Prognose; Jahresanfang/Jahresende are stacked: Barkonten (cash as in the
//    main chart) + one segment per savings pot (allocation tag).
//  - potLocations(): "Wo liegt das Geld" – per savings pot, which account holds its money.
import { isAnchorTransaction } from './balance'
import { budgetTopLineMonths, progBaseMonths, progMonths } from './budget'
import { ALLOCATION_TAG_ORDER, isBudgetPlannedTag } from './categoryOrder'
import { forecastSeries, planTargets } from './forecast'
import { tagBalance, tagBalanceByAccount } from './tagBalance'
import { incomeCategoryIds } from './urlaube'
import { INVESTMENT_CASH_ID, INVESTMENT_CASH_NAME } from './investmentCash'

const sum = (xs) => xs.reduce((s, x) => s + x, 0)
const lastDay = (year, m) => `${year}-${String(m).padStart(2, '0')}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`

/** The savings pots (allocation tags with a target account) in Verlauf's fixed order, the rest after. */
export function savingsPots(tags) {
  const pots = tags.filter((t) => t.class === 'allocation' && (t.reconciliationTargetAccountIds ?? []).length)
  const rank = (t) => (ALLOCATION_TAG_ORDER.includes(t.id) ? ALLOCATION_TAG_ORDER.indexOf(t.id) : 99)
  return pots.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'))
}

/** The date the "real" figures are taken on: the end of the last closed month, else 31 Dec of the year before. */
export function asOfDate(year, closedMonths = []) {
  const last = Math.max(0, ...closedMonths)
  return last ? lastDay(year, last) : `${year - 1}-12-31`
}

/**
 * @returns {{ versions: {plan0, plan1, prog}: {start, einnahmen, ausgaben, ende},
 *             startParts: Array<{id, name, cents}>, endParts: Array<{id, name, cents}> }}
 *   every figure in cents; parts[0] is always Barkonten (id 'cash')
 */
export function yearBalance({ accounts, categories, tags, budgets, transactions, year, closedMonths = [], closedByYear = null }) {
  const series = forecastSeries({ accounts, categories, tags, budgets, transactions, year, closedMonths, closedByYear })
  const start = series.start.cash + series.start.geldanlage + series.start.sparkonten + series.start.investmentCash
  const income = incomeCategoryIds(categories)
  const cats = planTargets(categories, tags).filter((t) => t.key === 'categoryId')
  const yearOf = (version, id) => {
    if (version === 'prog') return sum(progMonths('categoryId', id, progBaseMonths('categoryId', id, year, budgets), closedMonths, year, transactions, tags))
    return sum(budgetTopLineMonths('categoryId', id, version, year, budgets).months)
  }
  const versions = {}
  for (const v of ['plan0', 'plan1', 'prog']) {
    const einnahmen = sum(cats.filter((t) => income.has(t.id)).map((t) => yearOf(v, t.id)))
    const ausgaben = 0 - sum(cats.filter((t) => !income.has(t.id)).map((t) => yearOf(v, t.id)))
    versions[v] = { start, einnahmen, ausgaben, ende: start + einnahmen - ausgaben }
  }

  // Pots at the end: real up to the last closed month, then that pot's planned transfers (Plan1).
  const pots = savingsPots(tags)
  const startDate = `${year - 1}-12-31`
  const realDate = asOfDate(year, closedMonths)
  const lastClosed = Math.max(0, ...closedMonths)
  // The start as jahresanfang() takes it: everything up to 31 Dec of the year before, plus the opening
  // balances of the very first year, which are dated 1 Jan (Nov 2026: 2025's start bar showed every pot at 0).
  const startTx = transactions.filter((tx) => tx.date <= startDate || (isAnchorTransaction(tx) && tx.date <= `${year}-01-01`))
  // A provisional start (the year before still has open months) is the year before's Prognose end.
  const startParts = series.start.provisional
    ? yearBalance({ accounts, categories, tags, budgets, transactions, year: year - 1, closedMonths: closedByYear[year - 1] ?? [], closedByYear }).endParts
    : [
        { id: 'cash', name: 'Barkonten', cents: series.start.cash },
        { id: INVESTMENT_CASH_ID, name: INVESTMENT_CASH_NAME, cents: series.start.investmentCash },
        ...pots.map((t) => ({ id: t.id, name: t.name, cents: tagBalance(t.id, '9999-12-31', startTx, tags) })),
      ]
  // A provisional year with nothing closed yet builds on its (provisional) start, not on today's balances.
  const potBase = (t) =>
    series.start.provisional && lastClosed === 0 ? (startParts.find((p) => p.id === t.id)?.cents ?? 0) : tagBalance(t.id, realDate, transactions, tags)
  const potEnd = (t) => {
    let cents = potBase(t)
    if (isBudgetPlannedTag(t)) {
      const planned = progBaseMonths('allocationTagId', t.id, year, budgets)
      for (let m = lastClosed + 1; m <= 12; m++) cents -= planned[m - 1]
    }
    return cents
  }
  // Investment Cash (lib/investmentCash.js): its own piece, right after Barkonten – the same figure as
  // the Dashboard bars' lightest green in December.
  const endParts = [
    { id: 'cash', name: 'Barkonten', cents: series.months[11].prog },
    { id: INVESTMENT_CASH_ID, name: INVESTMENT_CASH_NAME, cents: series.months[11].investmentCash },
    ...pots.map((t) => ({ id: t.id, name: t.name, cents: potEnd(t) })),
  ]
  return { versions, startParts, endParts, provisional: series.start.provisional }
}

/**
 * @returns {{ date, pots: Array<{ id, name, total, parts: Array<{ accountId, name, cents }> }> }}
 *   pots holding nothing are left out; parts largest first
 */
export function potLocations({ accounts, tags, transactions, year, closedMonths = [], closedByYear = null }) {
  // Nothing closed yet and the year before still open (a provisional year): its last closed month is the
  // newest real figure – "31 Dec" of the year before would be a date that has not happened yet.
  const prevOpen = closedMonths.length === 0 && closedByYear && (closedByYear[year - 1] ?? []).length > 0 && (closedByYear[year - 1] ?? []).length < 12
  const date = prevOpen ? asOfDate(year - 1, closedByYear[year - 1]) : asOfDate(year, closedMonths)
  const nameOf = Object.fromEntries(accounts.map((a) => [a.id, a.name]))
  const pots = savingsPots(tags)
    .map((t) => {
      const by = tagBalanceByAccount(t.id, date, transactions, tags)
      const parts = Object.entries(by)
        .filter(([, cents]) => cents !== 0)
        .map(([accountId, cents]) => ({ accountId, name: nameOf[accountId] ?? accountId, cents }))
        .sort((a, b) => b.cents - a.cents)
      return { id: t.id, name: t.name, total: sum(parts.map((p) => p.cents)), parts }
    })
    .filter((p) => p.total !== 0)
  return { date, pots }
}
