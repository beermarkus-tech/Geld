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

const num = (c) => (Number.isInteger(c / 100) ? (c / 100).toLocaleString('de-DE') : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const eur = (c) => `${num(c)} €`

// The top-bar text for one cell (Oct 2026, Markus): just the two figures,
// "Geplant: -500 € · Gebucht: -620 €"; the tone follows the cell's colour.
// Null when there is nothing to say (no plan, nothing booked).
// @returns {{ text: string, tone: 'ok'|'off'|'info' } | null}
export function checkMessage({ plan, actual, status }) {
  if (!status && plan === 0 && actual === 0) return null
  if (!status && actual === 0) return null
  return { text: `Geplant: ${eur(plan)} · Gebucht: ${eur(actual)}`, tone: status === 'ok' ? 'ok' : status ? 'off' : 'info' }
}
