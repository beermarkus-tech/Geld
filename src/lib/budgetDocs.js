// Budget documents' id and shape (moved out of Verlauf.jsx, Oct 2026, so the
// tag actions — lib/tagActions.js — can write them too).

// Deterministic budget-document id, exactly matching
// migration/transform-budgets.py's own `emit()` convention
// (`f"b-{YEAR}-{plan}-{target_id}-{breakdown or 'top'}-{month:02d}"`) — an
// edit must land on the *same* document a migrated month already occupies,
// or budgetTopLineMonths()/budgetBreakdownLineMonths() would silently
// double-count by summing both the old and a stray new document for that
// month. `breakdownTagId` defaults to the flat top-line's own 'top'
// placeholder.
export function budgetDocId(year, planVersion, targetId, month, breakdownTagId) {
  return `b-${year}-${planVersion}-${targetId}-${breakdownTagId ?? 'top'}-${String(month).padStart(2, '0')}`
}

// A budget row's per-month document, keyed however this particular flat
// top-line/breakdown line is targeted — every write path (a plain month
// edit, converting a category to breakdown mode, adding/removing a line)
// goes through this one shape so they can't quietly drift apart.
export function budgetDoc(yearNum, targetKey, targetId, planVersion, month, breakdownTagId, cents, note) {
  const id = budgetDocId(yearNum, planVersion, targetId, month, breakdownTagId)
  return {
    id,
    year: yearNum,
    month,
    planVersion,
    type: targetKey === 'allocationTagId' ? 'savings-transfer' : 'expense',
    categoryId: targetKey === 'categoryId' ? targetId : null,
    allocationTagId: targetKey === 'allocationTagId' ? targetId : null,
    breakdownTagId: breakdownTagId ?? null,
    plannedAmountCents: cents,
    note,
  }
}
