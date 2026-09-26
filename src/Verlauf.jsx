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

// Fixed subcategory order within each group (spec.md §3b, Sept 2026,
// Markus's own literal list — not alphabetical, an earlier, now-corrected
// assumption). "Erstattungen" is deliberately absent — see spec.md §2.4's
// own note on why it's filtered out everywhere, not just here.
const SUBCAT_ORDER = [
  'Gehalt Markus', 'Gehalt Julia', 'Sonderzahlungen', 'Kindergeld', 'Sonstige Einnahmen',
  'Hauskredit', 'Nebenkosten', 'Instandhaltung', 'Einrichtung', 'Garten',
  'Internet', 'Fernsehen', 'Telefon',
  'Firmenwagen', 'Autoversicherung', 'Wartung', 'Tanken', 'Gebühren',
  'Lebensmittel & Haushalt', 'Kantine', 'Ausgehen', 'Klamotten Markus', 'Klamotten Julia', 'Klamotten Sophia',
  'Ausstattung Sophia', 'Allgemein', 'Haustiere', 'Versicherungen',
  'Medizin', 'Arztkosten', 'Krankenkasse',
  'Hobbys Julia', 'Hobbys Markus', 'Hobbys Sophia',
  'Urlaube', 'Geschenke', 'Sonderausgaben', 'Steuerausgaben', 'Rente', 'Sonstige Ausgaben',
]

// A category not in SUBCAT_ORDER is filtered out entirely, not shown at an
// arbitrary position — "Erstattungen" (spec.md §2.4) is the deliberate
// case today, but this also means a genuinely new category silently has
// no home here until someone adds it to the list above, rather than
// popping up in a random spot.
function isKnownSubcat(name) {
  return SUBCAT_ORDER.includes(name)
}

// Same reasoning for the Rücklagen section's own fixed order (spec.md
// §2.5/§3b's own listing) — alphabetical would scramble Sparen Familie/
// Sophia/Julia away from each other.
const ALLOCATION_TAG_ORDER = [
  'sparen-familie',
  'sparen-sophia',
  'sparen-julia',
  'anlage-familie',
  'anlage-sophia',
  'ruecklagen-steuern',
  'tagesgeld',
]

// A cell whose value is exactly 0 shows empty, not "0" (spec.md §3b) —
// across every numeric cell, month columns and Jahr alike.
function formatMonthCell(cents) {
  return cents === 0 ? '' : centsToEuro(cents)
}

// Section background tint (spec.md §1b.4's one explicit red exception,
// §3b) — Kategorie/Unterkategorie/row-total columns only, never the month
// columns themselves.
const SECTION_TINT_VAR = {
  einnahmen: '--color-income-tint',
  ausgaben: '--color-alert-tint',
  ruecklagen: '--color-savings-tint',
}

// Font color by row and by that month's own open/closed state (spec.md
// §3b, Sept 2026): Plan0 is always grey. Plan1 is black while its month is
// still open (the actively relevant forecast), grey once closed
// (superseded by the real actual). Prog is the mirror image — grey while
// open (a placeholder echo of Plan1), black once closed (now the real
// number).
function monthTextColorVar(rowLabel, isClosed) {
  if (rowLabel === 'Plan0') return '--color-text-muted'
  if (rowLabel === 'Plan1') return isClosed ? '--color-text-muted' : '--color-text'
  return isClosed ? '--color-text' : '--color-text-muted' // Prog
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
  function progMonths(targetId, plan1Months, isAllocation) {
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
  function planLineRows(groupName, section, subcatName, targetKey, targetId, isAllocation) {
    const plan1 = budgetTopLineMonths(targetKey, targetId, 'plan1', yearNum, budgets)
    const plan0 = budgetTopLineMonths(targetKey, targetId, 'plan0', yearNum, budgets)
    const prog = progMonths(targetId, plan1.months, isAllocation)
    const progTotal = prog.reduce((a, b) => a + b, 0)
    const rows = [
      { groupName, section, subcatName, rowLabel: 'Prog', months: prog, yearTotal: progTotal },
      { groupName, section, subcatName, rowLabel: 'Plan1', months: plan1.months, yearTotal: plan1.yearTotal },
      { groupName, section, subcatName, rowLabel: 'Plan0', months: plan0.months, yearTotal: plan0.yearTotal, isPlan0: true },
    ]
    return showPlan0 ? rows : rows.filter((r) => !r.isPlan0)
  }

  const rowData = useMemo(() => {
    const groups = categories.filter((c) => !c.parentCategoryId)
    const sortedGroups = [...groups].sort((a, b) => GROUP_ORDER.indexOf(a.name) - GROUP_ORDER.indexOf(b.name))
    const out = []
    for (const group of sortedGroups) {
      const section = group.name === 'Einnahmen' ? 'einnahmen' : 'ausgaben'
      const subcats = categories
        .filter((c) => c.parentCategoryId === group.id && isKnownSubcat(c.name))
        .sort((a, b) => SUBCAT_ORDER.indexOf(a.name) - SUBCAT_ORDER.indexOf(b.name))
      for (const subcat of subcats) {
        out.push(...planLineRows(group.name, section, subcat.name, 'categoryId', subcat.id, false))
      }
    }
    const allocationTags = tags.filter((t) => t.class === 'allocation')
    const sortedAllocationTags = [...allocationTags].sort(
      (a, b) => ALLOCATION_TAG_ORDER.indexOf(a.id) - ALLOCATION_TAG_ORDER.indexOf(b.id),
    )
    for (const tag of sortedAllocationTags) {
      out.push(...planLineRows('Rücklagen', 'ruecklagen', tag.name, 'allocationTagId', tag.id, true))
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
      cellStyle: (p) => {
        const isClosed = closedMonths.includes(i + 1)
        const style = { color: `var(${monthTextColorVar(p.data.rowLabel, isClosed)})` }
        // Plan0's own row gets a light grey tint on a closed month's cells
        // specifically (spec.md §3b) — a second, independent cue alongside
        // the grey text, not applied to Prog/Plan1's cells.
        if (p.data.isPlan0 && isClosed) style.backgroundColor = 'var(--color-line-row-tint)'
        return style
      },
      width: 110,
    }))
    return [
      {
        headerName: 'Kategorie',
        field: 'groupName',
        spanRows: true,
        pinned: 'left',
        width: 40,
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})` }),
        // Rotated 90° counterclockwise, vertically centered, bold (Markus)
        // — the column can stay narrow now that the text runs vertically,
        // freeing width for Unterkategorie and the row-total column below.
        cellRenderer: (p) => (
          <div className="flex h-full w-full items-center justify-center overflow-visible">
            <span className="whitespace-nowrap font-bold" style={{ transform: 'rotate(-90deg)' }}>
              {p.value}
            </span>
          </div>
        ),
      },
      {
        headerName: 'Unterkategorie',
        field: 'subcatName',
        spanRows: true,
        pinned: 'left',
        width: 170,
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})` }),
      },
      {
        headerName: '',
        colId: 'label',
        pinned: 'left',
        width: 170,
        cellClass: 'text-right tabular-figure',
        // The yearly total mixes closed and open months, so it doesn't get
        // the same per-month grey/black toggle the month columns do (that
        // rule is only meaningful per-month) — Plan0 stays grey (it's
        // always the fixed reference), Prog/Plan1 both read as plain text.
        cellStyle: (p) => ({
          backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`,
          color: `var(${p.data.rowLabel === 'Plan0' ? '--color-text-muted' : '--color-text'})`,
        }),
        // Just the yearly € figure now (Markus, once font color told
        // Prog/Plan1/Plan0 apart, the repeated text label became
        // redundant) — the Jahr figure always carries the € sign, unlike
        // every month column.
        valueGetter: (p) => (p.data.yearTotal === 0 ? '' : `${centsToEuro(p.data.yearTotal)} €`),
      },
      ...monthCols,
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cellStyle callbacks close over closedMonths, already current each render
  }, [closedMonths])

  // No gridline between the three sibling rows (Prog/Plan1/Plan0) of one
  // category/allocation-tag block (spec.md §3b) — they read as one visual
  // unit; the line between one block and the next stays. Determined by
  // whether the *next* row belongs to the same block, not this row's own
  // rowLabel, since Plan0 may be hidden (making Plan1 the last row shown).
  function getRowStyle(params) {
    const next = rowData[params.node.rowIndex + 1]
    const same = next && next.groupName === params.data.groupName && next.subcatName === params.data.subcatName
    return same ? { borderBottom: 'none' } : undefined
  }

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-3">
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

      <div className="min-h-0 flex-1">
        <AgGridReact
          theme={themeQuartz}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ suppressMovable: true, sortable: false, filter: false, resizable: true }}
          getRowStyle={getRowStyle}
          headerHeight={36}
          rowHeight={30}
        />
      </div>
    </div>
  )
}
