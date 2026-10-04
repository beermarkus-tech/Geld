import { isAnchorTransaction } from './balance'

// Fortschritt's lookup (spec.md §3j): one subcategory of one year split into
// "Bereits gebucht" (real bookings up to the pivot — the last month ticked
// "ok" in Verlauf) and "Noch geplant" (Plan1 after it), one card per
// trip/project tag found under it. Plain data in, plain data out.
//
// Cards (Oct 2026, Markus):
//   - one per *parent* tag; a child tag ("Schottland: Hotels") becomes a
//     sub-line inside its parent's card, grouped Hotels / Flüge / …
//   - an extra "Ohne Tag" card (key 'none') for the untagged remainder, so the
//     cards add up to the subcategory; with no tags at all it is the one flat card
//   - a tag is found on a booking line *or* on a Plan1 line (a trip planned but
//     not yet booked still shows); allocation tags are never cards (§3j)
//   - a line with several grouping tags goes to the first one (never counted twice)
// A booking dated after the pivot is not in "Bereits gebucht"; its month's plan
// line carries it as "davon schon gebucht" (`booked`).
//
// Header figures: `budget` = Plan1 year total, `prognose` = Verlauf's Prog
// (closed month → real, open month → Plan1), so both match Verlauf.
//
// @returns {{ pivot: number, cards: Array<{ key, tag, budget, prognose, bookedTotal, plannedTotal,
//   subs: Array<{ key, tag, label, booked: object[], bookedTotal, planned: {month, plan, booked}[], plannedTotal }> }> }}
export function fortschrittCards({ categoryId, year, transactions = [], budgets = [], tags = [], closedMonths = [] }) {
  const pivot = closedMonths.length ? Math.max(...closedMonths) : 0
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const isGrouping = (id) => tagById.get(id)?.class === 'grouping'
  // The card tag and, for a child, the sub-line tag.
  const place = (tagId) => {
    const t = tagById.get(tagId)
    const parent = t.parentTag ? tagById.get(t.parentTag) : null
    return parent ? { root: parent, child: t } : { root: t, child: null }
  }

  const cards = new Map()
  const cardFor = (root) => {
    const key = root ? root.id : 'none'
    if (!cards.has(key)) cards.set(key, { key, tag: root ?? null, subs: new Map() })
    return cards.get(key)
  }
  const subFor = (card, child) => {
    const key = child ? child.id : 'self'
    if (!card.subs.has(key)) card.subs.set(key, { key, tag: child ?? null, entries: [], plan: Array(12).fill(0) })
    return card.subs.get(key)
  }

  for (const tx of transactions) {
    if (isAnchorTransaction(tx) || !tx.date?.startsWith(`${year}-`)) continue
    const month = Number(tx.date.slice(5, 7))
    if (!(month >= 1 && month <= 12)) continue
    ;(tx.lines ?? []).forEach((line, lineIndex) => {
      if (line.categoryId !== categoryId) return
      const id = (line.tags ?? []).find(isGrouping)
      const { root, child } = id ? place(id) : { root: null, child: null }
      subFor(cardFor(root), child).entries.push({
        txId: tx.id,
        lineIndex,
        date: tx.date,
        month,
        label: tx.displayLabel ?? '',
        detail: tx.detail ?? '',
        cents: line.amountCents ?? 0,
      })
    })
  }

  const rows = budgets.filter((b) => b.year === year && b.planVersion === 'plan1' && b.categoryId === categoryId)
  const tagged = rows.filter((b) => b.breakdownTagId != null && isGrouping(b.breakdownTagId))
  // Verlauf's rule: once a category has breakdown lines, its flat total no longer counts.
  const hasBreakdown = rows.some((b) => b.breakdownTagId != null)
  const planRows = hasBreakdown ? tagged : rows.filter((b) => b.breakdownTagId == null)
  for (const b of planRows) {
    const { root, child } = b.breakdownTagId != null ? place(b.breakdownTagId) : { root: null, child: null }
    const sub = subFor(cardFor(root), child)
    if (b.month >= 1 && b.month <= 12) sub.plan[b.month - 1] += b.plannedAmountCents ?? 0
  }

  const sum = (xs) => xs.reduce((s, x) => s + x, 0)
  const out = [...cards.values()].map((card) => {
    const subList = [...card.subs.values()]
    const subs = subList
      .map((s) => {
        const booked = s.entries.filter((e) => e.month <= pivot).sort((a, b) => a.date.localeCompare(b.date) || Math.abs(b.cents) - Math.abs(a.cents))
        const planned = []
        for (let m = pivot + 1; m <= 12; m++) {
          const done = sum(s.entries.filter((e) => e.month === m).map((e) => e.cents))
          if (s.plan[m - 1] !== 0 || done !== 0) planned.push({ month: m, plan: s.plan[m - 1], booked: done })
        }
        const label = s.tag ? s.tag.name : subList.length > 1 ? '(allgemein)' : null
        return { key: s.key, tag: s.tag, label, booked, bookedTotal: sum(booked.map((e) => e.cents)), planned, plannedTotal: sum(planned.map((p) => p.plan)), _s: s }
      })
      .sort((a, b) => (a.key === 'self' ? -1 : b.key === 'self' ? 1 : a.label.localeCompare(b.label, 'de')))
    const budget = sum(subList.map((s) => sum(s.plan)))
    let prognose = 0
    for (let m = 1; m <= 12; m++) {
      const closed = closedMonths.includes(m)
      prognose += sum(subList.map((s) => (closed ? sum(s.entries.filter((e) => e.month === m).map((e) => e.cents)) : s.plan[m - 1])))
    }
    return {
      key: card.key,
      tag: card.tag,
      budget,
      prognose,
      bookedTotal: sum(subs.map((s) => s.bookedTotal)),
      plannedTotal: sum(subs.map((s) => s.plannedTotal)),
      subs: subs.map(({ _s, ...s }) => s),
    }
  })
  out.sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.tag.name.localeCompare(b.tag.name, 'de')))
  return { pivot, cards: out }
}
