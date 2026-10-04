import { isAnchorTransaction } from './balance'

// Fortschritt (spec.md §3j, reworked Oct 2026, Markus): the totality of a
// project — a parent tag such as "Schottland" with its child tags — across
// every category and every year it touches. One card per project:
//   Budget / Prognose        Plan1 over all years / Verlauf's rule (ticked
//                            month real, open month Plan1), summed per year
//   Gebucht / Noch zu buchen the split at *each year's own* last "ok" month in
//                            Verlauf; a past year without any ticks counts as
//                            fully booked, a future one (or the current year
//                            without ticks) as fully planned
//   rows                     per child tag and year: Details of the bookings,
//                            Verlauf's comments on the planned cells, what is
//                            booked and what is still to be booked
// A booking dated after its year's split is not in "gebucht"; its row shows it
// as `plannedBooked` ("davon schon gebucht"). A line with several grouping tags
// goes to the first one, so nothing is counted twice. Allocation tags and
// Rücklagen plan lines are out of scope (§3j).
//
// Which tags are projects: top-level grouping tags that have child tags, or are
// typed Reise/Projekt or Dienstreise. Only those with bookings or plan lines
// get a card.
//
// @param {{ tags, transactions, budgets, cellComments?: object[], closedByYear?: Map<number, number[]>, todayYear: number }} input
// @returns {Array<{ key, tag, years: number[], budget, prognose, booked, planned, plannedBooked, lastActivity: string,
//   rows: { key, tagId, childTag: object|null, label: string|null, year, details: string[], comments: string[],
//           booked, planned, plannedBooked, count }[] }>} newest activity first
export function projectCards({ tags = [], transactions = [], budgets = [], cellComments = [], closedByYear = new Map(), todayYear }) {
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const isGrouping = (id) => tagById.get(id)?.class === 'grouping'
  const hasKids = new Set(tags.filter((t) => t.class === 'grouping' && t.parentTag && tagById.has(t.parentTag)).map((t) => t.parentTag))
  const isProject = (t) => t.class === 'grouping' && !t.parentTag && (hasKids.has(t.id) || t.groupingType === 'project' || t.groupingType === 'business-trip')
  const place = (tagId) => {
    const t = tagById.get(tagId)
    const parent = t.parentTag ? tagById.get(t.parentTag) : null
    return parent ? { root: parent, child: t } : { root: t, child: null }
  }

  const cells = new Map() // `${rootId}|${childId|'self'}|${year}` → data
  const cellFor = (root, child, year) => {
    const key = `${root.id}|${child ? child.id : 'self'}|${year}`
    let c = cells.get(key)
    if (!c) {
      c = { key, root, child, year, entries: [], plan: Array(12).fill(0), planMonths: 0 }
      cells.set(key, c)
    }
    return c
  }

  for (const tx of transactions) {
    if (isAnchorTransaction(tx) || !tx.date) continue
    const year = Number(tx.date.slice(0, 4))
    const month = Number(tx.date.slice(5, 7))
    if (!(year > 0 && month >= 1 && month <= 12)) continue
    for (const line of tx.lines ?? []) {
      const id = (line.tags ?? []).find(isGrouping)
      if (!id) continue
      const { root, child } = place(id)
      if (!isProject(root)) continue
      // Details as Konten shows them: a split line's own, else the booking's.
      const detail = String((tx.lines.length > 1 && line.note) || tx.detail || '').trim()
      cellFor(root, child, year).entries.push({ month, date: tx.date, cents: line.amountCents ?? 0, detail })
    }
  }
  for (const b of budgets) {
    if (b.planVersion !== 'plan1' || !b.categoryId || !b.breakdownTagId || !isGrouping(b.breakdownTagId)) continue
    const { root, child } = place(b.breakdownTagId)
    if (!isProject(root) || !(b.month >= 1 && b.month <= 12)) continue
    const c = cellFor(root, child, b.year)
    c.plan[b.month - 1] += b.plannedAmountCents ?? 0
    if ((b.plannedAmountCents ?? 0) !== 0) c.planMonths += 1
  }

  // Verlauf's comments on a child's Plan1 cells: rowId "categoryId:CAT:plan1:TAG".
  const commentsOf = new Map() // `${tagId}|${year}` → texts
  for (const c of cellComments) {
    const parts = String(c.rowId ?? '').split(':')
    if (parts.length !== 4 || parts[0] !== 'categoryId' || parts[2] !== 'plan1' || !c.text) continue
    const k = `${parts[3]}|${c.year}`
    commentsOf.set(k, [...(commentsOf.get(k) ?? []), c.text.trim()])
  }

  // Each year's split, and which months count as ticked for Prognose.
  const closedOf = (year) => {
    const ticks = closedByYear.get(year) ?? []
    if (ticks.length) return { pivot: Math.max(...ticks), closed: new Set(ticks) }
    return year < todayYear ? { pivot: 12, closed: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) } : { pivot: 0, closed: new Set() }
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

  const byRoot = new Map()
  for (const c of cells.values()) {
    const { pivot, closed } = closedOf(c.year)
    const booked = sum(c.entries.filter((e) => e.month <= pivot).map((e) => e.cents))
    const plannedBooked = sum(c.entries.filter((e) => e.month > pivot).map((e) => e.cents))
    const planned = sum(c.plan.filter((_, i) => i + 1 > pivot))
    let prognose = 0
    for (let m = 1; m <= 12; m++) prognose += closed.has(m) ? sum(c.entries.filter((e) => e.month === m).map((e) => e.cents)) : c.plan[m - 1]
    const tagId = c.child ? c.child.id : c.root.id
    const sortedEntries = [...c.entries].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
    const row = {
      key: c.key,
      tagId,
      childTag: c.child,
      label: c.child ? c.child.name : null,
      year: c.year,
      details: distinct(sortedEntries.map((e) => e.detail), 4),
      comments: distinct(commentsOf.get(`${tagId}|${c.year}`) ?? [], 3),
      booked,
      planned,
      plannedBooked,
      count: c.entries.length,
      _budget: sum(c.plan),
      _prognose: prognose,
      _last: [...c.entries.map((e) => e.date.slice(0, 7)), ...c.plan.map((v, i) => (v !== 0 ? `${c.year}-${String(i + 1).padStart(2, '0')}` : ''))].filter(Boolean).sort().at(-1) ?? '',
    }
    if (c.entries.length === 0 && c.planMonths === 0) continue
    if (!byRoot.has(c.root.id)) byRoot.set(c.root.id, { root: c.root, rows: [] })
    byRoot.get(c.root.id).rows.push(row)
  }

  const cards = [...byRoot.values()].map(({ root, rows }) => {
    // A parent's own, child-less bookings read "(allgemein)" once it also has children.
    const hasChildRows = rows.some((r) => r.childTag)
    rows.sort((a, b) => (a.childTag ? a.childTag.name : '').localeCompare(b.childTag ? b.childTag.name : '', 'de') || a.year - b.year)
    return {
      key: root.id,
      tag: root,
      years: [...new Set(rows.map((r) => r.year))].sort(),
      budget: sum(rows.map((r) => r._budget)),
      prognose: sum(rows.map((r) => r._prognose)),
      booked: sum(rows.map((r) => r.booked)),
      planned: sum(rows.map((r) => r.planned)),
      plannedBooked: sum(rows.map((r) => r.plannedBooked)),
      lastActivity: rows.map((r) => r._last).sort().at(-1) ?? '',
      rows: rows.map(({ _budget, _prognose, _last, ...r }) => ({ ...r, label: r.label ?? (hasChildRows ? '(allgemein)' : null) })),
    }
  })
  cards.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity) || a.tag.name.localeCompare(b.tag.name, 'de'))
  return cards
}
