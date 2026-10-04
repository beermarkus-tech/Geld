import { isAnchorTransaction } from './balance'

// Plan1 as a control tower (spec.md §3b, Oct 2026, Markus): next to every
// Plan1 figure Verlauf shows how reality compares — green when the booked
// amount is within a percentage of the plan, another colour when not, a tinted
// cell when something was booked that was never planned — and says it in words
// in the top bar. Plan1 itself stays purely manual; Prog stays the one-liner
// the app's own maths uses. Plain data in, plain data out.

export const DEFAULT_TOLERANCE_PERCENT = 5

// 'ok' | 'off' | 'unplanned' | null (nothing to say).
//   - plan 0 and nothing booked → null
//   - plan 0 but booked → 'unplanned' (any month, open or ticked)
//   - ticked month: within `percent` of the plan → 'ok', else 'off'. The screen
//     shows whole euros, so figures that look equal there also count as 'ok'.
//   - open month with a plan → null (reality hasn't closed yet)
export function planStatus({ plan, actual, closed, percent = DEFAULT_TOLERANCE_PERCENT }) {
  if (plan === 0 && actual === 0) return null
  if (plan === 0) return 'unplanned'
  if (!closed) return null
  const diff = Math.abs(actual - plan)
  if (diff <= (Math.abs(plan) * percent) / 100) return 'ok'
  return Math.round(actual / 100) === Math.round(plan / 100) ? 'ok' : 'off'
}

// Real booking lines of one year by category and month, built in one pass so
// the grid can ask per row and month cheaply. A line counts once however many
// of the asked tags it carries.
// @returns {{ total(categoryId, month): number, lines(categoryId, month): {cents, tags}[], sumTags(categoryId, month, tagIds: Set): number }}
export function categoryActualIndex(transactions, year) {
  const byCat = new Map()
  const prefix = `${year}-`
  for (const tx of transactions) {
    if (isAnchorTransaction(tx) || !tx.date?.startsWith(prefix)) continue
    const month = Number(tx.date.slice(5, 7))
    if (!(month >= 1 && month <= 12)) continue
    for (const line of tx.lines ?? []) {
      if (!line.categoryId) continue
      let months = byCat.get(line.categoryId)
      if (!months) {
        months = Array.from({ length: 12 }, () => ({ total: 0, lines: [] }))
        byCat.set(line.categoryId, months)
      }
      const slot = months[month - 1]
      slot.total += line.amountCents ?? 0
      slot.lines.push({ cents: line.amountCents ?? 0, tags: line.tags ?? [] })
    }
  }
  const slotOf = (categoryId, month) => byCat.get(categoryId)?.[month - 1]
  return {
    total: (categoryId, month) => slotOf(categoryId, month)?.total ?? 0,
    lines: (categoryId, month) => slotOf(categoryId, month)?.lines ?? [],
    sumTags: (categoryId, month, tagIds) => {
      let sum = 0
      for (const l of slotOf(categoryId, month)?.lines ?? []) if (l.tags.some((t) => tagIds.has(t))) sum += l.cents
      return sum
    },
  }
}

// For an Übergruppe's row: what was booked under it that has no Plan1 line of
// its own — a child tag nobody planned (named by the child), or the parent tag
// alone ("ohne Untertag"). `plannedChildIds` are the children that do have a line.
// @returns {{ label: string, cents: number }[]} largest first
export function partsWithoutLine({ lines, parentId, familyIds, plannedChildIds, nameOf }) {
  const planned = new Set(plannedChildIds)
  const sums = new Map()
  for (const l of lines) {
    const inFamily = l.tags.filter((t) => familyIds.has(t))
    if (inFamily.length === 0 || inFamily.some((t) => planned.has(t))) continue
    const child = inFamily.find((t) => t !== parentId)
    const key = child ?? parentId
    sums.set(key, (sums.get(key) ?? 0) + l.cents)
  }
  return [...sums.entries()]
    .map(([id, cents]) => ({ label: id === parentId ? `${nameOf(parentId)} ohne Untertag` : nameOf(id), cents }))
    .filter((p) => p.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
}

// For a category's total row: bookings that carry none of the tags the plan
// lines cover (`coveredIds`) — they sit in the category total but under no line.
export function unassignedCents(lines, coveredIds) {
  let sum = 0
  for (const l of lines) if (!l.tags.some((t) => coveredIds.has(t))) sum += l.cents
  return sum
}

const num = (c) => (Number.isInteger(c / 100) ? (c / 100).toLocaleString('de-DE') : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const eur = (c) => `${num(c)} €`

// The top-bar sentence for one cell. `scope` names the period ("Juli", or
// "Stand abgehakter Monate (bis Juli)" for the year column).
// @returns {{ text: string, tone: 'ok'|'off'|'info' } | null}
export function checkMessage({ where, scope, plan, actual, status, closed, percent = DEFAULT_TOLERANCE_PERCENT, parts = [], unassigned = 0 }) {
  if (!status && actual === 0) return null
  let text
  let tone
  if (status === 'unplanned') {
    text = `nichts geplant, aber gebucht ${eur(actual)} → Plan1 ergänzen`
    tone = 'off'
  } else if (status === 'ok') {
    text = `Plan ${eur(plan)}, gebucht ${eur(actual)} — im Rahmen (±${String(percent).replace('.', ',')} %)`
    tone = 'ok'
  } else if (status === 'off') {
    const diff = actual - plan
    text = `Plan ${eur(plan)}, gebucht ${eur(actual)} — Abweichung ${eur(diff)} (${Math.round((Math.abs(diff) / Math.abs(plan)) * 100)} %) → Plan1 prüfen`
    tone = 'off'
  } else {
    text = `Plan ${eur(plan)}, bisher gebucht ${eur(actual)}${closed ? '' : ' (Monat noch offen)'}`
    tone = 'info'
  }
  if (parts.length > 0) text += ` · davon ohne eigene Plan-Zeile: ${parts.map((p) => `${p.label} ${eur(p.cents)}`).join(', ')}`
  if (unassigned !== 0) text += ` · davon keiner Plan-Zeile zugeordnet: ${eur(unassigned)}`
  return { text: `${where} · ${scope}: ${text}`, tone }
}
