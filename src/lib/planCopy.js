// Verlauf's "Plan0 → Plan1" (Nov 2026, Markus): copies one row's (category or pot) whole Plan0 for one
// year onto its Plan1 – the 12 top-line months, every breakdown line and every cell comment – and
// replaces whatever Plan1 had (its figures, breakdown lines and comments are removed first). Pure: it
// only works out what to write and delete; Verlauf commits it in one batch.
import { budgetDocId } from './budgetDocs'
import { budgetTopLineMonths } from './budget'

const rowIdBase = (targetKey, targetId) => `${targetKey}:${targetId}`

// Verlauf's row ids: top line `${base}:Plan0` / `${base}:Plan1`; breakdown and rollup rows
// `${base}:plan0:…` / `${base}:plan1:…`.
const isVersionRow = (rowId, base, version) =>
  rowId === `${base}:${version === 'plan0' ? 'Plan0' : 'Plan1'}` || rowId.startsWith(`${base}:${version}:`)
const toPlan1RowId = (rowId, base) => (rowId === `${base}:Plan0` ? `${base}:Plan1` : `${base}:plan1:${rowId.slice(`${base}:plan0:`.length)}`)

/**
 * What Plan1 of this row already holds (for the safety question).
 * @returns {{ total, lineCount, commentCount, hasAnything }}
 */
export function plan1Contents({ budgets, cellComments, year, targetKey, targetId }) {
  const base = rowIdBase(targetKey, targetId)
  const docs = budgets.filter((b) => b.year === year && b.planVersion === 'plan1' && b[targetKey] === targetId)
  const lineCount = new Set(docs.filter((b) => b.breakdownTagId != null).map((b) => b.breakdownTagId)).size
  const commentCount = cellComments.filter((c) => c.year === year && isVersionRow(c.rowId, base, 'plan1')).length
  const total = budgetTopLineMonths(targetKey, targetId, 'plan1', year, budgets).yearTotal
  return { total, lineCount, commentCount, hasAnything: docs.some((b) => b.plannedAmountCents) || lineCount > 0 || commentCount > 0 }
}

/**
 * @returns {{ deleteBudgetIds: string[], writeBudgets: object[], deleteCommentIds: string[], writeComments: object[] }}
 */
export function planCopyOps({ budgets, cellComments, year, targetKey, targetId, now = Date.now() }) {
  const base = rowIdBase(targetKey, targetId)
  const mine = (version) => budgets.filter((b) => b.year === year && b.planVersion === version && b[targetKey] === targetId)
  const writeBudgets = mine('plan0').map((b) => ({ ...b, id: budgetDocId(year, 'plan1', targetId, b.month, b.breakdownTagId), planVersion: 'plan1' }))
  const written = new Set(writeBudgets.map((b) => b.id))
  // every Plan1 document of the row goes, unless the copy writes the same id anyway
  const deleteBudgetIds = mine('plan1').map((b) => b.id).filter((id) => !written.has(id))

  const yearComments = cellComments.filter((c) => c.year === year)
  const writeComments = yearComments
    .filter((c) => isVersionRow(c.rowId, base, 'plan0'))
    .map((c) => {
      const rowId = toPlan1RowId(c.rowId, base)
      const id = `${year}__${rowId}__${c.colId}`
      return { ...c, id, rowId, updatedAt: now }
    })
  const writtenComments = new Set(writeComments.map((c) => c.id))
  const deleteCommentIds = yearComments
    .filter((c) => isVersionRow(c.rowId, base, 'plan1'))
    .map((c) => c.id)
    .filter((id) => !writtenComments.has(id))
  return { deleteBudgetIds, writeBudgets, deleteCommentIds, writeComments }
}
