import { isAnchorTransaction } from './balance'

// Urlaube (spec.md §3j, Oct 2026, Markus): the one family Sonstiges › Urlaube,
// dissected. Left: one card per holiday — a top-level grouping tag, which
// always starts with its year ("2025 La Rochelle") — with its child tags per
// year. Right: two overviews, per year (see `years` below) and per holiday.
//
// A holiday:
//   year         the four digits the tag name starts with; without them the year
//                of its latest booking or Plan1 line
//   total        what it costs: booked + still to be booked, over all years, as a
//                plus number (a subvention or gift, being a positive booking,
//                reads as a cost reduction)
//   split        each year at its own last "ok" month in Verlauf; a past year
//                without ticks counts as fully booked, a future year (and the
//                current one without ticks) as fully planned; a booking after
//                the split is not "gebucht" but reads "davon schon gebucht"
//   rows         per child tag, over all years (Oct 2026, Markus: no year column):
//                Details of the bookings, Verlauf's comments on that line,
//                booked and still to be booked, and the same as cost only /
//                subventions + gifts; `lastYear` is the latest year it was
//                booked or planned in
// Which tag on a line is the holiday tag (Oct 2026, Markus: a line may also
// carry a Rechnung tag or other grouping tags, which are none of this screen's
// business): a tag whose top-level tag starts with a year ("2025 La Rochelle")
// or is typed Reise/Projekt; the year-named one wins. A line with no such tag
// has no holiday.
// What counts: the category Urlaube, plus every booking with the holiday's tag
// that is money in (positive) or sits in an Einnahmen category — and the same for
// Plan1 lines (a planned subvention in Sonstige Einnahmen) — a subvention or
// gift lands in "Sonstige Einnahmen", or wherever it was booked, but belongs to
// the holiday and reduces its cost. Money *out* with a holiday's tag in any other
// category is not counted but reported (`outside`), as are Urlaube bookings with
// no holiday tag (`untagged`).
//
// Per year (`years`): `tripCost` = the total of the holidays *of* that year,
// whenever booked; `booked` = everything booked in that year, whichever holiday
// (all Urlaube bookings dated in it, tagged or not); `difference` = tripCost −
// booked; `budget` = Plan1 of the category (Verlauf's own top-line rule).

export const URLAUBE_GROUP = 'Sonstiges'
export const URLAUBE_NAME = 'Urlaube'

// The ids of the categories in the group Einnahmen (Sonstige Einnahmen, …).
export function incomeCategoryIds(categories) {
  const group = categories.find((c) => !c.parentCategoryId && c.name === 'Einnahmen')
  return new Set(categories.filter((c) => group && c.parentCategoryId === group.id).map((c) => c.id))
}

// The category's id by name, or null while categories are not loaded.
export function urlaubeCategoryId(categories) {
  const group = categories.find((c) => !c.parentCategoryId && c.name === URLAUBE_GROUP)
  return categories.find((c) => c.parentCategoryId && c.parentCategoryId === group?.id && c.name === URLAUBE_NAME)?.id ?? null
}

const sum = (xs) => xs.reduce((s, x) => s + x, 0)

// The reduction a holiday got from subventions and gifts: total cost ÷ cost
// only − 1, in whole percent (−20 for 800 € left of 1.000 €). Null without a
// cost to compare to.
export function reductionPercent(cost, subvention) {
  if (!(cost > 0)) return null
  return Math.round(((cost - subvention) / cost - 1) * 100) + 0
}
const distinct = (texts, limit) => {
  const seen = new Set()
  const out = []
  for (const t of texts) {
    const k = t.toLowerCase()
    if (t && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.length > limit ? [...out.slice(0, limit), '…'] : out
}

// @returns {{ holidays: object[], years: object[], untagged: number, outside: number }}
export function urlaubeOverview({ categoryId, incomeIds = new Set(), tags = [], transactions = [], budgets = [], cellComments = [], closedByYear = new Map(), todayYear }) {
  if (!categoryId) return { holidays: [], years: [], untagged: 0, outside: 0 }
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const isGrouping = (id) => tagById.get(id)?.class === 'grouping'
  const place = (tagId) => {
    const t = tagById.get(tagId)
    const parent = t.parentTag ? tagById.get(t.parentTag) : null
    return parent ? { root: parent, child: t } : { root: t, child: null }
  }
  // A holiday's top-level tag: named with a year, or typed Reise/Projekt —
  // never a Dienstreise, Anspruch, Krankenkasse or Abrechnung tag, whose names
  // also start with a year ("2026-05 HAM").
  const NOT_HOLIDAY = new Set(['business-trip', 'claim', 'health-insurance', 'statement'])
  const isHolidayRoot = (root) => !NOT_HOLIDAY.has(root.groupingType) && (/^\s*\d{4}/.test(root.name) || root.groupingType === 'project')
  // The holiday tag of a set of tag ids (the year-named one first), or null.
  const holidayTag = (tagIds) => {
    const found = (tagIds ?? []).filter(isGrouping).map((id) => ({ id, root: place(id).root })).filter((x) => isHolidayRoot(x.root))
    return (found.find((x) => /^\s*\d{4}/.test(x.root.name)) ?? found[0])?.id ?? null
  }

  const cells = new Map() // `${rootId}|${childId|'self'}|${year}`
  const cellFor = (root, child, year) => {
    const key = `${root.id}|${child ? child.id : 'self'}|${year}`
    let c = cells.get(key)
    if (!c) {
      c = { key, root, child, year, entries: [], plan: Array(12).fill(0), planMonths: 0 }
      cells.set(key, c)
    }
    return c
  }
  const bookedByYear = new Map() // everything booked in the category per year (cents)
  const untaggedByYear = new Map()
  const outsideByRoot = new Map()
  const extras = [] // money in booked outside Urlaube, added once its holiday is known
  const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v)

  for (const tx of transactions) {
    if (isAnchorTransaction(tx) || !tx.date) continue
    const year = Number(tx.date.slice(0, 4))
    const month = Number(tx.date.slice(5, 7))
    if (!(year > 0 && month >= 1 && month <= 12)) continue
    for (const line of tx.lines ?? []) {
      const id = holidayTag(line.tags)
      const cents = line.amountCents ?? 0
      if (line.categoryId !== categoryId) {
        // Money in (a subvention, a gift, a refund) belongs to the holiday
        // wherever it was booked — an Einnahmen category, an expense category,
        // none yet; money out in another category is only reported.
        const belongs = id && (incomeIds.has(line.categoryId) || cents > 0)
        if (id && !belongs) add(outsideByRoot, place(id).root.id, cents)
        if (belongs) {
          // Details as Konten shows them: a split line's own, else the booking's.
          const { root, child } = place(id)
          extras.push({ root, child, year, month, date: tx.date, cents, detail: String((tx.lines.length > 1 && line.note) || tx.detail || '').trim() })
        }
        continue
      }
      add(bookedByYear, year, cents)
      if (!id) {
        add(untaggedByYear, year, cents)
        continue
      }
      const { root, child } = place(id)
      // Details as Konten shows them: a split line's own, else the booking's.
      const detail = String((tx.lines.length > 1 && line.note) || tx.detail || '').trim()
      cellFor(root, child, year).entries.push({ month, date: tx.date, cents, detail })
    }
  }
  const planRows = budgets.filter((b) => b.planVersion === 'plan1' && b.categoryId === categoryId)
  for (const b of planRows) {
    if (!b.breakdownTagId || !isGrouping(b.breakdownTagId) || !(b.month >= 1 && b.month <= 12)) continue
    const { root, child } = place(b.breakdownTagId)
    if (!isHolidayRoot(root)) continue
    const c = cellFor(root, child, b.year)
    c.plan[b.month - 1] += b.plannedAmountCents ?? 0
    if ((b.plannedAmountCents ?? 0) !== 0) c.planMonths += 1
  }

  // A subvention or gift counts for a holiday that really is one: a tag with at
  // least one booking or Plan1 line in Urlaube (so a Dienstreise repayment
  // never makes a card of its own).
  const active = new Set([...cells.values()].filter((c) => c.entries.length > 0 || c.planMonths > 0).map((c) => c.root.id))
  for (const x of extras) {
    if (!active.has(x.root.id)) continue
    add(bookedByYear, x.year, x.cents)
    cellFor(x.root, x.child, x.year).entries.push({ month: x.month, date: x.date, cents: x.cents, detail: x.detail })
  }
  // The same for plan lines: a planned subvention is a Plan1 line "2026 Schottland:
  // Subvention" in Einnahmen › Sonstige Einnahmen (or any category, with a positive
  // amount). It belongs to the holiday and lowers its Budget and what is still
  // to be booked.
  for (const b of budgets) {
    if (b.planVersion !== 'plan1' || !b.categoryId || b.categoryId === categoryId || !b.breakdownTagId || !isGrouping(b.breakdownTagId)) continue
    if (!(b.month >= 1 && b.month <= 12)) continue
    if (!(incomeIds.has(b.categoryId) || (b.plannedAmountCents ?? 0) > 0)) continue
    const { root, child } = place(b.breakdownTagId)
    if (!active.has(root.id)) continue
    const c = cellFor(root, child, b.year)
    c.plan[b.month - 1] += b.plannedAmountCents ?? 0
    if ((b.plannedAmountCents ?? 0) !== 0) c.planMonths += 1
  }

  // Verlauf's comments on a child's Plan1 cells: rowId "categoryId:CAT:plan1:TAG".
  const commentsOf = new Map()
  for (const c of cellComments) {
    const parts = String(c.rowId ?? '').split(':')
    if (parts.length !== 4 || parts[0] !== 'categoryId' || (parts[1] !== categoryId && !incomeIds.has(parts[1])) || parts[2] !== 'plan1' || !c.text) continue
    const k = `${parts[3]}|${c.year}`
    commentsOf.set(k, [...(commentsOf.get(k) ?? []), c.text.trim()])
  }

  const closedOf = (year) => {
    const ticks = closedByYear.get(year) ?? []
    if (ticks.length) return { pivot: Math.max(...ticks), closed: new Set(ticks) }
    return year < todayYear ? { pivot: 12, closed: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) } : { pivot: 0, closed: new Set() }
  }

  const byRoot = new Map()
  for (const c of cells.values()) {
    if (c.entries.length === 0 && c.planMonths === 0) continue
    const { pivot, closed } = closedOf(c.year)
    const booked = sum(c.entries.filter((e) => e.month <= pivot).map((e) => e.cents))
    const plannedBooked = sum(c.entries.filter((e) => e.month > pivot).map((e) => e.cents))
    const planned = sum(c.plan.filter((_, i) => i + 1 > pivot))
    // Cost only (negative bookings) and subventions + gifts (positive bookings),
    // as plus numbers; what is still planned counts by its sign. cost −
    // subvention is the total cost.
    const bookedEntries = c.entries.filter((e) => e.month <= pivot).map((e) => e.cents)
    const cost = -sum(bookedEntries.filter((v) => v < 0)) + (planned < 0 ? -planned : 0)
    const subvention = sum(bookedEntries.filter((v) => v > 0)) + (planned > 0 ? planned : 0)
    let prognose = 0
    for (let m = 1; m <= 12; m++) prognose += closed.has(m) ? sum(c.entries.filter((e) => e.month === m).map((e) => e.cents)) : c.plan[m - 1]
    const tagId = c.child ? c.child.id : c.root.id
    const row = {
      key: c.key,
      tagId,
      childTag: c.child,
      label: c.child ? c.child.name : null,
      year: c.year,
      _entries: c.entries,
      _comments: commentsOf.get(`${tagId}|${c.year}`) ?? [],
      booked,
      planned,
      plannedBooked,
      cost,
      subvention,
      count: c.entries.length,
      _planMonths: c.planMonths,
      _budget: sum(c.plan),
      _prognose: prognose,
      _last: [...c.entries.map((e) => e.date.slice(0, 7)), ...c.plan.map((v, i) => (v !== 0 ? `${c.year}-${String(i + 1).padStart(2, '0')}` : ''))].filter(Boolean).sort().at(-1) ?? '',
    }
    if (!byRoot.has(c.root.id)) byRoot.set(c.root.id, { root: c.root, rows: [] })
    byRoot.get(c.root.id).rows.push(row)
  }

  const holidays = [...byRoot.values()].map(({ root, rows }) => {
    const hasChildRows = rows.some((r) => r.childTag)
    // One row per child tag, whichever year its bookings fall in (Oct 2026,
    // Markus); `lastYear` is where a click on it opens Konten.
    const merged = new Map()
    for (const r of [...rows].sort((a, b) => a.year - b.year)) {
      const m = merged.get(r.tagId) ?? { key: `${root.id}|${r.tagId}`, tagId: r.tagId, childTag: r.childTag, label: r.label, booked: 0, planned: 0, plannedBooked: 0, cost: 0, subvention: 0, count: 0, lastYear: r.year, entries: [], comments: [] }
      for (const k of ['booked', 'planned', 'plannedBooked', 'cost', 'subvention', 'count']) m[k] += r[k]
      m.lastYear = Math.max(m.lastYear, r.year)
      m.entries.push(...r._entries)
      m.comments.push(...r._comments)
      merged.set(r.tagId, m)
    }
    const childRows = [...merged.values()]
      .map(({ entries, comments, ...m }) => ({
        ...m,
        details: distinct([...entries].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)).map((e) => e.detail), 4),
        comments: distinct(comments, 3),
      }))
      .sort((a, b) => (a.childTag ? a.childTag.name : '').localeCompare(b.childTag ? b.childTag.name : '', 'de'))
    const last = rows.map((r) => r._last).sort().at(-1) ?? ''
    const fromName = /^\s*(\d{4})/.exec(root.name)
    const booked = sum(rows.map((r) => r.booked))
    const planned = sum(rows.map((r) => r.planned))
    return {
      key: root.id,
      tag: root,
      tripYear: fromName ? Number(fromName[1]) : Number(last.slice(0, 4)) || todayYear,
      years: [...new Set(rows.map((r) => r.year))].sort(),
      // the years in which Verlauf has Plan1 lines for it (where "In Verlauf" goes)
      planYears: [...new Set(rows.filter((r) => r._planMonths > 0).map((r) => r.year))].sort(),
      budget: sum(rows.map((r) => r._budget)),
      prognose: sum(rows.map((r) => r._prognose)),
      booked,
      planned,
      plannedBooked: sum(rows.map((r) => r.plannedBooked)),
      // what it costs, as a plus number
      total: -(booked + planned),
      cost: sum(rows.map((r) => r.cost)),
      subvention: sum(rows.map((r) => r.subvention)),
      outside: outsideByRoot.get(root.id) ?? 0,
      rows: childRows.map((r) => ({ ...r, label: r.label ?? (hasChildRows ? '(allgemein)' : null) })),
    }
  })
  holidays.sort((a, b) => b.tripYear - a.tripYear || a.tag.name.localeCompare(b.tag.name, 'de'))

  // Plan1 of the category per year, by Verlauf's top-line rule: once breakdown
  // lines exist they replace the flat total.
  const budgetOf = (year) => {
    const rows = planRows.filter((b) => b.year === year)
    const breakdown = rows.filter((b) => b.breakdownTagId != null)
    return sum((breakdown.length > 0 ? breakdown : rows.filter((b) => b.breakdownTagId == null)).map((b) => b.plannedAmountCents ?? 0))
  }
  const yearSet = new Set([...holidays.map((h) => h.tripYear), ...bookedByYear.keys(), ...planRows.map((b) => b.year)])
  const years = [...yearSet]
    .map((year) => {
      const trips = holidays.filter((h) => h.tripYear === year)
      const tripCost = sum(trips.map((h) => h.total))
      const booked = -(bookedByYear.get(year) ?? 0)
      return { year, trips: trips.length, tripCost, booked, untagged: -(untaggedByYear.get(year) ?? 0), difference: tripCost - booked, budget: -budgetOf(year) }
    })
    .filter((y) => y.trips > 0 || y.booked !== 0 || y.budget !== 0)
    .sort((a, b) => b.year - a.year)

  return {
    holidays,
    years,
    untagged: -sum([...untaggedByYear.values()]),
    // what carries a holiday's tag in other categories (not counted anywhere)
    outside: -sum(holidays.map((h) => h.outside)),
  }
}
