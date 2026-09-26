import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import { db } from './firebase'
import { allocationMonthActual, budgetTopLineMonths, categoryMonthActual } from './lib/budget'
import { centsToEuro } from './lib/format'
import { syncAgGridColorScheme } from './lib/gridColorScheme'

ModuleRegistry.registerModules([AllCommunityModule])
syncAgGridColorScheme()

const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

// Fixed group order (spec.md §2.4's own transcription order — not
// alphabetical, so there's no substitute for spelling it out) — Einnahmen
// first, then every expense group in the Gsheet's own order.
const GROUP_ORDER = ['Einnahmen', 'Wohnen', 'Kommunikation', 'Mobilität', 'Lebenshaltung', 'Gesundheit', 'Hobbys', 'Sonstiges']

// Same reasoning for the Rücklagen section's own fixed order (spec.md
// §2.5's own listing) — alphabetical would scramble Sparen Familie/
// Sophia/Julia away from each other.
const ALLOCATION_TAG_ORDER = [
  'sparen-familie',
  'sparen-sophia',
  'sparen-julia',
  'ruecklagen-steuern',
  'anlage-familie',
  'anlage-sophia',
  'tagesgeld',
]

// A cell whose value is exactly 0 shows empty, not "0" (spec.md §3b) —
// across every numeric cell, month columns and Jahr alike.
function formatMonthCell(cents) {
  return cents === 0 ? '' : centsToEuro(cents)
}

export default function Verlauf({ year }) {
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [closedMonths, setClosedMonths] = useState([])
  // Two independent global controls (spec.md §3b) — breakdown-block
  // show/hide isn't built yet (no breakdown lines rendered at all this
  // round), so only Plan0's own toggle exists so far.
  const [showPlan0, setShowPlan0] = useState(true)

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'tags'), (snap) => setTags(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'transactions'), (snap) => setTransactions(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'budgets'), (snap) => setBudgets(snap.docs.map((d) => d.data()))),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  // settings/{year} is a single document, not a collection — its own
  // subscription, re-pointed whenever the global year selector changes.
  useEffect(() => {
    if (!year) return
    const unsub = onSnapshot(doc(db, 'settings', String(year)), (snap) => {
      setClosedMonths(snap.exists() ? (snap.data().closedMonths ?? []) : [])
    })
    return unsub
  }, [year])

  function toggleMonthClosed(month) {
    const next = closedMonths.includes(month) ? closedMonths.filter((m) => m !== month) : [...closedMonths, month].sort((a, b) => a - b)
    setDoc(doc(db, 'settings', String(year)), { id: String(year), closedMonths: next }, { merge: true })
  }

  const yearNum = Number(year)

  // Prog (spec.md §3b): a closed month is a pure Konten rollup; an open
  // month mirrors Plan1 for that same month ("if nothing changes, this is
  // what will happen"). Same rule for a category and an allocation tag,
  // just via the matching actual-computation function for each.
  function progMonths(targetKey, targetId, plan1Months, isAllocation) {
    return plan1Months.map((plan1Value, i) => {
      const month = i + 1
      if (!closedMonths.includes(month)) return plan1Value
      return isAllocation
        ? allocationMonthActual(targetId, yearNum, month, transactions, tags)
        : categoryMonthActual(targetId, yearNum, month, transactions)
    })
  }

  // One row per plan line (Prog/Plan1/Plan0), in that display order
  // (spec.md §3b) — breakdown lines aren't rendered yet (deferred, see
  // CODEMAP.md), so every subcategory/allocation tag gets exactly these
  // three rows for now.
  function planLineRows(groupName, subcatName, targetKey, targetId, isAllocation) {
    const plan1 = budgetTopLineMonths(targetKey, targetId, 'plan1', yearNum, budgets)
    const plan0 = budgetTopLineMonths(targetKey, targetId, 'plan0', yearNum, budgets)
    const prog = progMonths(targetKey, targetId, plan1.months, isAllocation)
    const progTotal = prog.reduce((a, b) => a + b, 0)
    const rows = [
      { groupName, subcatName, rowLabel: 'Prog', months: prog, yearTotal: progTotal },
      { groupName, subcatName, rowLabel: 'Plan1', months: plan1.months, yearTotal: plan1.yearTotal },
      { groupName, subcatName, rowLabel: 'Plan0', months: plan0.months, yearTotal: plan0.yearTotal, isPlan0: true },
    ]
    return showPlan0 ? rows : rows.filter((r) => !r.isPlan0)
  }

  const rowData = useMemo(() => {
    const groups = categories.filter((c) => !c.parentCategoryId)
    const sortedGroups = [...groups].sort((a, b) => GROUP_ORDER.indexOf(a.name) - GROUP_ORDER.indexOf(b.name))
    const out = []
    for (const group of sortedGroups) {
      const subcats = categories.filter((c) => c.parentCategoryId === group.id).sort((a, b) => a.name.localeCompare(b.name))
      for (const subcat of subcats) {
        out.push(...planLineRows(group.name, subcat.name, 'categoryId', subcat.id, false))
      }
    }
    const allocationTags = tags.filter((t) => t.class === 'allocation')
    const sortedAllocationTags = [...allocationTags].sort(
      (a, b) => ALLOCATION_TAG_ORDER.indexOf(a.id) - ALLOCATION_TAG_ORDER.indexOf(b.id),
    )
    for (const tag of sortedAllocationTags) {
      out.push(...planLineRows('Rücklagen', tag.name, 'allocationTagId', tag.id, true))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planLineRows/progMonths close over categories/tags/transactions/budgets/closedMonths/showPlan0/yearNum, all already current each render
  }, [categories, tags, transactions, budgets, closedMonths, showPlan0, yearNum])

  const columnDefs = useMemo(() => {
    const monthCols = MONTH_LABELS.map((label, i) => ({
      headerName: label,
      colId: `m${i + 1}`,
      valueGetter: (p) => p.data.months[i],
      valueFormatter: (p) => formatMonthCell(p.value),
      cellClass: 'text-right tabular-figure',
      width: 90,
    }))
    return [
      {
        headerName: 'Kategorie',
        field: 'groupName',
        spanRows: true,
        pinned: 'left',
        width: 130,
      },
      {
        headerName: 'Unterkategorie',
        field: 'subcatName',
        spanRows: true,
        pinned: 'left',
        width: 140,
      },
      {
        headerName: '',
        colId: 'label',
        pinned: 'left',
        width: 150,
        cellClass: (p) => (p.data.isPlan0 ? 'italic text-[var(--color-text-muted)]' : undefined),
        // Combines the row's own label with its yearly total in one column
        // (spec.md §3b) — the Jahr figure always carries the € sign, unlike
        // every month column.
        cellRenderer: (p) => (
          <span className="flex w-full justify-between gap-2">
            <span>{p.data.rowLabel}</span>
            <span className="tabular-figure">{p.data.yearTotal === 0 ? '' : `${centsToEuro(p.data.yearTotal)} €`}</span>
          </span>
        ),
      },
      ...monthCols,
    ]
  }, [])

  return (
    <div className="flex min-h-full flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input type="checkbox" checked={showPlan0} onChange={(e) => setShowPlan0(e.target.checked)} />
          Plan0 anzeigen
        </label>
        {/* Month-close "ok" switches (spec.md §3b) — visually a separate
            row above the grid rather than merged into AG Grid's own header
            row directly under the month labels (a custom AG Grid header
            component, deferred — functionally identical, not yet
            pixel-matched to the mockup). */}
        <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <span>Abgeschlossen:</span>
          {MONTH_LABELS.map((label, i) => (
            <label key={label} className="flex items-center gap-1">
              <input type="checkbox" checked={closedMonths.includes(i + 1)} onChange={() => toggleMonthClosed(i + 1)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="h-[70vh] min-h-[360px]">
        <AgGridReact
          theme={themeQuartz}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ suppressMovable: true, sortable: false, filter: false, resizable: true }}
          headerHeight={36}
          rowHeight={30}
        />
      </div>
    </div>
  )
}
