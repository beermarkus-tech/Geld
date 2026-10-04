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
//   rows         per child tag and year: Details of the bookings, Verlauf's
//                comments on that line, booked and still to be booked
// Which tag on a line is the holiday tag (Oct 2026, Markus: a line may also
// carry a Rechnung tag or other grouping tags, which are none of this screen's
// business): a tag whose top-level tag starts with a year ("2025 La Rochelle")
// or is typed Reise/Projekt; the year-named one wins. A line with no such tag
// has no holiday.
// What counts: the category Urlaube, plus the holiday's bookings in the
// Einnahmen categories (a subvention or gift lands in "Sonstige Einnahmen" but
// belongs to the holiday and reduces its cost). Bookings with a holiday's tag in
// any *other* category are not counted but reported (`outside`), as are Urlaube
// bookings with no holiday tag (`untagged`).
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
  // A holiday's top-level tag: named with a year, or typed Reise/Projekt.
  const isHolidayRoot = (root) => /^\s*\d{4}/.test(root.name) || root.groupingType === 'project'
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
        // Income categories (a subvention, a gift) belong to the holiday; any
        // other category is only reported.
        if (id && !incomeIds.has(line.categoryId)) add(outsideByRoot, place(id).root.id, cents)
        if (!id || !incomeIds.has(line.categoryId)) continue
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

  // Verlauf's comments on a child's Plan1 cells: rowId "categoryId:CAT:plan1:TAG".
  const commentsOf = new Map()
  for (const c of cellComments) {
    const parts = String(c.rowId ?? '').split(':')
    if (parts.length !== 4 || parts[0] !== 'categoryId' || parts[1] !== categoryId || parts[2] !== 'plan1' || !c.text) continue
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
    let prognose = 0
    for (let m = 1; m <= 12; m++) prognose += closed.has(m) ? sum(c.entries.filter((e) => e.month === m).map((e) => e.cents)) : c.plan[m - 1]
    const tagId = c.child ? c.child.id : c.root.id
    const row = {
      key: c.key,
      tagId,
      childTag: c.child,
      label: c.child ? c.child.name : null,
      year: c.year,
      details: distinct([...c.entries].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)).map((e) => e.detail), 4),
      comments: distinct(commentsOf.get(`${tagId}|${c.year}`) ?? [], 3),
      booked,
      planned,
      plannedBooked,
      count: c.entries.length,
      _budget: sum(c.plan),
      _prognose: prognose,
      _last: [...c.entries.map((e) => e.date.slice(0, 7)), ...c.plan.map((v, i) => (v !== 0 ? `${c.year}-${String(i + 1).padStart(2, '0')}` : ''))].filter(Boolean).sort().at(-1) ?? '',
    }
    if (!byRoot.has(c.root.id)) byRoot.set(c.root.id, { root: c.root, rows: [] })
    byRoot.get(c.root.id).rows.push(row)
  }

  const holidays = [...byRoot.values()].map(({ root, rows }) => {
    const hasChildRows = rows.some((r) => r.childTag)
    rows.sort((a, b) => (a.childTag ? a.childTag.name : '').localeCompare(b.childTag ? b.childTag.name : '', 'de') || a.year - b.year)
    const last = rows.map((r) => r._last).sort().at(-1) ?? ''
    const fromName = /^\s*(\d{4})/.exec(root.name)
    const booked = sum(rows.map((r) => r.booked))
    const planned = sum(rows.map((r) => r.planned))
    return {
      key: root.id,
      tag: root,
      tripYear: fromName ? Number(fromName[1]) : Number(last.slice(0, 4)) || todayYear,
      years: [...new Set(rows.map((r) => r.year))].sort(),
      budget: sum(rows.map((r) => r._budget)),
      prognose: sum(rows.map((r) => r._prognose)),
      booked,
      planned,
      plannedBooked: sum(rows.map((r) => r.plannedBooked)),
      // what it costs, as a plus number
      total: -(booked + planned),
      outside: outsideByRoot.get(root.id) ?? 0,
      rows: rows.map(({ _budget, _prognose, _last, ...r }) => ({ ...r, label: r.label ?? (hasChildRows ? '(allgemein)' : null) })),
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
