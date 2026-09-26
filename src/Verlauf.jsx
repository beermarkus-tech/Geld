import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import { db } from './firebase'
import {
  allocationMonthActual,
  breakdownGroupMonthActual,
  budgetBreakdownLineMonths,
  budgetTopLineMonths,
  categoryMonthActual,
} from './lib/budget'
import { centsToWholeEuro } from './lib/format'
import { syncAgGridColorScheme } from './lib/gridColorScheme'
import { slugify } from './TagEditor'

ModuleRegistry.registerModules([AllCommunityModule])
syncAgGridColorScheme()

const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

// The month-close "ok" switch, embedded directly in that month's own
// column header (Markus: "include the months check boxes into the column
// headers") — AG Grid supports a fully custom React header component via
// `headerComponent`, receiving whatever `headerComponentParams` passes
// through as plain props. Replaces the separate checkbox row that used to
// sit above the grid (spec.md §3b's own mockup had them as their own
// header row anyway — this is closer to that, not further from it).
// stopPropagation on click: the header cell itself has its own click
// handling (would otherwise fire for a plain header click too, e.g. any
// future sort/menu behavior), and the checkbox shouldn't trigger it.
function MonthHeader({ displayName, month, closedMonths, onToggle }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-0.5">
      <span>{displayName}</span>
      <input
        type="checkbox"
        checked={closedMonths.includes(month)}
        onChange={() => onToggle(month)}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

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
// across every numeric cell, month columns and Jahr alike. Rounded to
// whole euros (Markus, Sept 2026) — a display-only rounding, checked
// against the exact cent value above, not the rounded one, so a genuinely
// nonzero but sub-euro residual still shows "0" rather than vanishing.
function formatMonthCell(cents) {
  return cents === 0 ? '' : centsToWholeEuro(cents)
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
// number). A breakdown/rollup row (Sept 2026) follows whichever of these
// three its own plan-line rule already covers — a Plan1 breakdown line
// reads like Plan1, a Plan0 one like Plan0, and the automated rollup
// header like Prog (same mirror-then-lock behavior).
function monthTextColorVar(rowLabel, isClosed) {
  if (rowLabel === 'Plan0' || rowLabel === 'Plan0-breakdown') return '--color-text-muted'
  if (rowLabel === 'Plan1' || rowLabel === 'Plan1-breakdown') return isClosed ? '--color-text-muted' : '--color-text'
  return isClosed ? '--color-text' : '--color-text-muted' // Prog, Rollup
}

// No gridline between the three sibling rows (Prog/Plan1/Plan0) of one
// block (spec.md §3b) — they read as one visual unit; the line between one
// block and the next stays.
//
// **Found the real source of the line only after it was still visible,
// thinner, past two earlier attempts (Markus's own report) — neither
// `getRowStyle` nor a `cellStyle` override on `.ag-cell` was ever touching
// the right element.** AG Grid's default per-row border isn't drawn by
// `.ag-row` or `.ag-cell` at all for an ordinary row — it's
// `.ag-grid-scrolling-cells`/`.ag-grid-pinned-left-cells` (an internal
// per-row wrapper around every cell in that row-section) that carries a
// real `border-bottom: var(--ag-row-border-style) var(--ag-row-border-color)
// var(--ag-row-border-width)`, with no colDef- or row-level hook able to
// reach it. The actual fix (see the `verlauf-grid` CSS rule in index.css)
// is to suppress that default at the grid level entirely
// (`--ag-row-border-color: transparent`), leaving this function's own
// per-cell border as the *only* one ever drawn — so it can finally be
// exactly where it's wanted. Kategorie/Unterkategorie don't need this —
// they're genuinely merged into one spanned cell per block via `spanRows`,
// so there's no seam between sibling rows there to begin with.
function blockBorderStyle(rowData) {
  if (rowData.isLastOfBlock) return { borderBottom: '1px solid var(--color-border)' }
  return { borderBottom: '0px none' }
}

// Deterministic budget-document id, exactly matching
// migration/transform-budgets.py's own `emit()` convention
// (`f"b-{YEAR}-{plan}-{target_id}-{breakdown or 'top'}-{month:02d}"`) — an
// edit must land on the *same* document a migrated month already occupies,
// or budgetTopLineMonths()/budgetBreakdownLineMonths() would silently
// double-count by summing both the old and a stray new document for that
// month. `breakdownTagId` defaults to the flat top-line's own 'top'
// placeholder.
function budgetDocId(year, planVersion, targetId, month, breakdownTagId) {
  return `b-${year}-${planVersion}-${targetId}-${breakdownTagId ?? 'top'}-${String(month).padStart(2, '0')}`
}

// Parses a Plan0/Plan1 month cell's typed text back into cents — mirrors
// Konten.jsx's own parseEuroInput, but for whole euros only (matching this
// screen's own display rounding, §3b) and treating a cleared cell as 0
// (Verlauf's "0 shows blank" convention runs the other way at display
// time; an edit clearing the box should mean "plan 0 for this month," not
// reject the edit). Strips German thousands-grouping dots first (the edit
// box is pre-filled from centsToWholeEuro's own de-DE formatting, e.g.
// "8.000") — without this, committing an untouched large value back
// unchanged would silently reinterpret "8.000" as 8 (JS parses a bare
// "8.000" as the number 8).
function parseWholeEuroInput(s) {
  const cleaned = String(s).trim().replace(/[€\s]/g, '')
  if (cleaned === '') return 0
  if (cleaned === '-') return null
  const normalized = cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  const f = Number(normalized)
  return Number.isNaN(f) ? null : Math.round(f) * 100
}

const SHOW_PLAN0_KEY = 'geld-verlauf-show-plan0'
const SHOW_BREAKDOWNS_KEY = 'geld-verlauf-show-breakdowns'

// Per-device convenience only, same reasoning as NavShell.jsx's own
// sidebar-collapsed persistence (Markus, Sept 2026: "save the state of
// show or hide plan0") — a read/write failure (private browsing, blocked
// storage) just means it starts shown every time, never a crash.
function readBoolSetting(key) {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

// A budget row's per-month document, keyed however this particular flat
// top-line/breakdown line is targeted — every write path (a plain month
// edit, converting a category to breakdown mode, adding/removing a line)
// goes through this one shape so they can't quietly drift apart.
function budgetDoc(yearNum, targetKey, targetId, planVersion, month, breakdownTagId, cents, note) {
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

export default function Verlauf({ year }) {
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [closedMonths, setClosedMonths] = useState([])
  // Global controls (spec.md §3b): Plan0's own show/hide, and (Sept 2026)
  // "Aufschlüsselung anzeigen/ausblenden" for every breakdown block at
  // once. A block not individually touched defaults to expanded once
  // breakdowns are shown at all (`collapsedBlocks` below) — nothing
  // pre-populates that set, absence from it just means "expanded."
  const [showPlan0, setShowPlan0] = useState(() => readBoolSetting(SHOW_PLAN0_KEY))
  const [showBreakdowns, setShowBreakdowns] = useState(() => readBoolSetting(SHOW_BREAKDOWNS_KEY))
  const [collapsedBlocks, setCollapsedBlocks] = useState(() => new Set())
  // Two-click arm/confirm for removing a breakdown line (Sept 2026,
  // Markus's own established convention elsewhere — Konten's delete
  // column) — a real, permanent loss of that line's planned figures, so
  // one click alone shouldn't be enough.
  const [confirmRemoveRowId, setConfirmRemoveRowId] = useState(null)
  const gridApiRef = useRef(null)

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_PLAN0_KEY, showPlan0 ? '1' : '0')
    } catch {
      // Per-device convenience only — nothing to recover from here.
    }
  }, [showPlan0])

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_BREAKDOWNS_KEY, showBreakdowns ? '1' : '0')
    } catch {
      // Per-device convenience only — nothing to recover from here.
    }
  }, [showBreakdowns])

  useEffect(() => {
    if (!confirmRemoveRowId) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setConfirmRemoveRowId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmRemoveRowId])

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

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])
  const tagName = (id) => tagById.get(id)?.name ?? id

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

  // Whether a category/allocation tag's top-line row is still the real,
  // directly-edited figure or has become computed (spec.md §2.7: "once
  // breakdown lines exist, the top-line value becomes the sum of its
  // breakdown-line rows"). Checked per planVersion independently, same as
  // budgetTopLineMonths()'s own internal check.
  function hasBreakdownLines(targetKey, targetId, planVersion) {
    return budgets.some((b) => b.year === yearNum && b.planVersion === planVersion && b[targetKey] === targetId && b.breakdownTagId != null)
  }

  // Every distinct breakdownTagId currently in use for one (target,
  // planVersion) — what actually determines which breakdown rows exist,
  // since a tag with zero remaining budget documents has nothing left to
  // discover it by (see addBreakdownLine()'s own always-write-12-months
  // comment on why a freshly created line never hits this edge case).
  function breakdownTagIdsFor(targetKey, targetId, planVersion) {
    return [
      ...new Set(
        budgets
          .filter((b) => b.year === yearNum && b.planVersion === planVersion && b[targetKey] === targetId && b.breakdownTagId != null)
          .map((b) => b.breakdownTagId),
      ),
    ]
  }

  // One plan-version's own rows for a category/allocation-tag block: the
  // top-line row, plus — once it's in breakdown mode and its own block
  // isn't collapsed — the parent-tag "(automatisch)" rollup headers
  // (Plan1 only, spec.md §2.7) and every breakdown line itself, grouped
  // under its parent where one exists, alphabetical otherwise (no ordinal
  // field exists to do better — a reasonable default, not spec-mandated).
  function planVersionRows(common, rowIdBase, planVersion, topMonths) {
    const isPlan0 = planVersion === 'plan0'
    const rowLabel = isPlan0 ? 'Plan0' : 'Plan1'
    const rowHasBreakdown = hasBreakdownLines(common.targetKey, common.targetId, planVersion)
    const blockKey = `${rowIdBase}:${planVersion}`
    const topRow = {
      ...common,
      rowId: `${rowIdBase}:${rowLabel}`,
      rowLabel,
      planVersion,
      months: topMonths.months,
      yearTotal: topMonths.yearTotal,
      isPlan0,
      rowHasBreakdown,
      blockKey,
      blockExpanded: !collapsedBlocks.has(blockKey),
    }
    const out = [topRow]
    if (!rowHasBreakdown || !showBreakdowns || !topRow.blockExpanded) return out

    const breakdownTagIds = breakdownTagIdsFor(common.targetKey, common.targetId, planVersion)
    const byParent = new Map()
    const standalone = []
    for (const tagId of breakdownTagIds) {
      const parentTag = tagById.get(tagId)?.parentTag
      if (parentTag) {
        if (!byParent.has(parentTag)) byParent.set(parentTag, [])
        byParent.get(parentTag).push(tagId)
      } else {
        standalone.push(tagId)
      }
    }
    const byName = (a, b) => tagName(a).localeCompare(tagName(b))
    const parentIds = [...byParent.keys()].sort(byName)

    function breakdownRow(tagId, isLastInBlock) {
      const line = budgetBreakdownLineMonths(common.targetKey, common.targetId, tagId, planVersion, yearNum, budgets)
      return {
        ...common,
        rowId: `${rowIdBase}:${planVersion}:${tagId}`,
        rowLabel: isPlan0 ? 'Plan0-breakdown' : 'Plan1-breakdown',
        planVersion,
        isPlan0,
        breakdownTagId: tagId,
        breakdownLabel: tagName(tagId),
        months: line.months,
        yearTotal: line.yearTotal,
        // Plan1's own last line also gets the "add another line" action
        // (Konten's own split-column convention: the last line is always
        // where the next one gets added) — never Plan0's, since a
        // breakdown line is only ever created via Plan1 (spec.md §2.7:
        // "always both, in parallel" — the app keeps that symmetric on its
        // own, not by offering two independent creation points).
        canAddAfter: !isPlan0 && isLastInBlock,
      }
    }

    for (const parentId of parentIds) {
      const childIds = byParent.get(parentId).sort(byName)
      if (!isPlan0) {
        const tagIdSet = new Set([parentId, ...childIds])
        const rollupMonths = Array.from({ length: 12 }, (_, i) => {
          const month = i + 1
          if (!closedMonths.includes(month)) {
            return childIds.reduce(
              (sum, cid) => sum + budgetBreakdownLineMonths(common.targetKey, common.targetId, cid, planVersion, yearNum, budgets).months[i],
              0,
            )
          }
          return common.targetKey === 'categoryId' ? breakdownGroupMonthActual(common.targetId, tagIdSet, yearNum, month, transactions) : 0
        })
        out.push({
          ...common,
          rowId: `${rowIdBase}:${planVersion}:rollup:${parentId}`,
          rowLabel: 'Rollup',
          breakdownLabel: `${tagName(parentId)} (automatisch)`,
          months: rollupMonths,
          yearTotal: rollupMonths.reduce((a, b) => a + b, 0),
        })
      }
      childIds.forEach((tagId, i) => out.push(breakdownRow(tagId, parentId === parentIds.at(-1) && i === childIds.length - 1 && standalone.length === 0)))
    }
    const standaloneSorted = [...standalone].sort(byName)
    standaloneSorted.forEach((tagId, i) => out.push(breakdownRow(tagId, i === standaloneSorted.length - 1)))
    return out
  }

  // One category/allocation-tag block: Prog (never has breakdown rows of
  // its own, spec.md §3b), then Plan1's own rows, then — while shown —
  // Plan0's.
  function planLineRows(groupName, section, subcatName, targetKey, targetId, isAllocation) {
    const plan1Top = budgetTopLineMonths(targetKey, targetId, 'plan1', yearNum, budgets)
    const prog = progMonths(targetId, plan1Top.months, isAllocation)
    const common = { groupName, section, subcatName, targetKey, targetId, isAllocation }
    const rowIdBase = `${targetKey}:${targetId}`
    const rows = [{ ...common, rowId: `${rowIdBase}:Prog`, rowLabel: 'Prog', months: prog, yearTotal: prog.reduce((a, b) => a + b, 0) }]
    rows.push(...planVersionRows(common, rowIdBase, 'plan1', plan1Top))
    if (showPlan0) {
      const plan0Top = budgetTopLineMonths(targetKey, targetId, 'plan0', yearNum, budgets)
      rows.push(...planVersionRows(common, rowIdBase, 'plan0', plan0Top))
    }
    // Marks the actual last row of this block after every filter above has
    // already applied — used below to draw a real boundary line only
    // between blocks, never between a block's own sibling/breakdown rows.
    rows.forEach((r, i) => {
      r.isLastOfBlock = i === rows.length - 1
    })
    return rows
  }

  // Writes one month's value directly for either a flat top-line row or a
  // real breakdown line (Sept 2026, Markus: Plan0/Plan1 editing; the
  // confirm-to-edit prompt spec.md originally called for on Plan0 was
  // dropped the same round in favor of its own show/hide toggle already
  // being protection enough). Always a full-document upsert at the same
  // deterministic id a migrated month already occupies (budgetDocId,
  // above), preserving any existing `note` rather than wiping it.
  function persistBudgetMonth(row, month, cents) {
    const id = budgetDocId(yearNum, row.planVersion, row.targetId, month, row.breakdownTagId)
    const existing = budgets.find((b) => b.id === id)
    setDoc(
      doc(db, 'budgets', id),
      budgetDoc(yearNum, row.targetKey, row.targetId, row.planVersion, month, row.breakdownTagId, cents, existing?.note ?? ''),
    )
  }

  // Grouping-tag creation for a breakdown line's own name (Sept 2026) —
  // deliberately a scoped-down duplicate of Konten.jsx's own
  // createPlainTag()/createTag(), not an extracted shared module: the two
  // call sites want slightly different things (Konten's is wired through
  // TagEditor's own create-type picker; this one only ever makes a plain
  // grouping tag), and the whole function is short enough that forcing a
  // shared abstraction across two screens isn't worth the indirection —
  // flagged in CODEMAP.md as accepted, deliberate duplication to watch,
  // same discipline already applied elsewhere in this codebase. "Schottland:
  // Hotels" reuses an existing top-level "Schottland" tag by name
  // (case-insensitive) or creates one, then creates a real child under it
  // (spec.md §2.5's hierarchy) — the id actually used as breakdownTagId is
  // always the child's.
  function createPlainGroupingTag(name, parentTag) {
    let id = slugify(name)
    if (tags.some((t) => t.id === id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`
    setDoc(doc(db, 'tags', id), {
      id,
      name,
      parentTag,
      class: 'grouping',
      reconciliationTargetAccountIds: [],
      groupingType: null,
      archived: false,
    })
    return id
  }
  function createBreakdownTag(name) {
    const colon = name.indexOf(':')
    if (colon === -1) return createPlainGroupingTag(name, null)
    const parentName = name.slice(0, colon).trim()
    const childName = name.slice(colon + 1).trim()
    if (!parentName || !childName) return createPlainGroupingTag(name, null)
    const existingParent = tags.find(
      (t) => t.class === 'grouping' && !t.parentTag && t.name.toLowerCase() === parentName.toLowerCase(),
    )
    const parentId = existingParent ? existingParent.id : createPlainGroupingTag(parentName, null)
    return createPlainGroupingTag(childName, parentId)
  }

  // Adding a breakdown line (Sept 2026, Markus) — always writes all 12
  // months for both plan versions right away, even where the value is 0,
  // rather than migration's own "skip a zero month" convention: a brand
  // new line otherwise has *no* budget document anywhere yet, and nothing
  // in the schema records "this breakdown tag exists for this category"
  // independent of having at least one real document — an all-zero line
  // would be undiscoverable (breakdownTagIdsFor() reads it straight off
  // budgets, there's no separate registry).
  async function addBreakdownLine(row) {
    const name = window.prompt('Neue Aufschlüsselungszeile — Name (z. B. "Hotels" oder "Schottland:Hotels" für eine Gruppe):')
    if (!name || !name.trim()) return
    const tagId = createBreakdownTag(name.trim())
    const isFirstLine = !row.rowHasBreakdown
    const batch = writeBatch(db)
    for (const planVersion of ['plan1', 'plan0']) {
      // Converting a previously-flat category: whatever was already
      // planned on the top line must survive into this new first line,
      // for both plan versions symmetrically (spec.md §2.7) — never
      // discarded just because the line didn't exist an instant earlier.
      const carryOver = isFirstLine ? budgetTopLineMonths(row.targetKey, row.targetId, planVersion, yearNum, budgets) : null
      for (let month = 1; month <= 12; month++) {
        const cents = carryOver ? carryOver.months[month - 1] : 0
        const id = budgetDocId(yearNum, planVersion, row.targetId, month, tagId)
        batch.set(doc(db, 'budgets', id), budgetDoc(yearNum, row.targetKey, row.targetId, planVersion, month, tagId, cents, ''))
        if (isFirstLine) {
          const flatId = budgetDocId(yearNum, planVersion, row.targetId, month, null)
          if (budgets.some((b) => b.id === flatId)) batch.delete(doc(db, 'budgets', flatId))
        }
      }
    }
    await batch.commit()
    setCollapsedBlocks((prev) => {
      const next = new Set(prev)
      next.delete(`${row.targetKey}:${row.targetId}:plan1`)
      next.delete(`${row.targetKey}:${row.targetId}:plan0`)
      return next
    })
  }

  // Removing a breakdown line always deletes both its plan1 and plan0
  // documents together (spec.md §2.7: the two plan versions stay
  // symmetric, so a line can't exist for one but not the other). If it was
  // the *last* remaining line, its own final values fold back up into a
  // real flat top-line row instead of just vanishing — mirroring
  // addBreakdownLine()'s own value-preserving carry-over, in reverse.
  async function removeBreakdownLine(row) {
    const remaining = breakdownTagIdsFor(row.targetKey, row.targetId, 'plan1')
    const isLastLine = remaining.length <= 1
    const batch = writeBatch(db)
    for (const planVersion of ['plan1', 'plan0']) {
      const own = isLastLine ? budgetBreakdownLineMonths(row.targetKey, row.targetId, row.breakdownTagId, planVersion, yearNum, budgets) : null
      for (let month = 1; month <= 12; month++) {
        batch.delete(doc(db, 'budgets', budgetDocId(yearNum, planVersion, row.targetId, month, row.breakdownTagId)))
        if (isLastLine) {
          const id = budgetDocId(yearNum, planVersion, row.targetId, month, null)
          batch.set(doc(db, 'budgets', id), budgetDoc(yearNum, row.targetKey, row.targetId, planVersion, month, null, own.months[month - 1], ''))
        }
      }
    }
    await batch.commit()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planLineRows and everything it calls close over categories/tags/transactions/budgets/closedMonths/showPlan0/showBreakdowns/collapsedBlocks/yearNum, all already current each render
  }, [categories, tags, transactions, budgets, closedMonths, showPlan0, showBreakdowns, collapsedBlocks, yearNum])

  const columnDefs = useMemo(() => {
    const monthCols = MONTH_LABELS.map((label, i) => ({
      headerName: label,
      colId: `m${i + 1}`,
      // Centered header label (Markus) — see the matching CSS rule in
      // index.css; AG Grid has no built-in "centered header" class.
      headerClass: 'verlauf-month-header',
      headerComponent: MonthHeader,
      headerComponentParams: { month: i + 1, closedMonths, onToggle: toggleMonthClosed },
      valueGetter: (p) => p.data.months[i],
      valueFormatter: (p) => formatMonthCell(p.value),
      cellClass: (p) => `text-right tabular-figure${p.data.rowLabel?.includes('breakdown') || p.data.rowLabel === 'Rollup' ? ' text-xs' : ''}`,
      cellStyle: (p) => {
        const isClosed = closedMonths.includes(i + 1)
        const style = { color: `var(${monthTextColorVar(p.data.rowLabel, isClosed)})`, ...blockBorderStyle(p.data) }
        // Prog's own row (and its breakdown-group mirror, the automated
        // rollup header) gets a light grey tint on a closed month's cells
        // specifically (spec.md §3b, corrected Sept 2026 — Markus caught
        // it applied to Plan0 instead) — a second, independent cue
        // alongside the grey text, not applied to Plan1/Plan0's cells.
        if ((p.data.rowLabel === 'Prog' || p.data.rowLabel === 'Rollup') && isClosed) style.backgroundColor = 'var(--color-line-row-tint)'
        // A breakdown line itself (not the rollup header) gets its own
        // subtle tinted background regardless of closed-state (spec.md
        // §3b: "visually distinguished by smaller text and a tinted
        // background"), and Plan0's own breakdown rows are additionally
        // italicized to match Plan0's own styling.
        if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown') {
          style.backgroundColor = 'var(--color-line-row-tint)'
          if (p.data.rowLabel === 'Plan0-breakdown') style.fontStyle = 'italic'
        }
        return style
      },
      width: 110,
      // The cursor/focus rectangle should only ever land in a month column
      // (Markus) — every other column is suppressNavigable (below).
      // Editable: Plan1/Plan0 top-line rows once they're *not* in
      // breakdown mode (spec.md §2.7 — the top line becomes computed once
      // real breakdown lines exist under it), and every real breakdown
      // line itself, always. Prog and the automated rollup header are
      // always computed, never editable.
      editable: (p) =>
        ((p.data.rowLabel === 'Plan1' || p.data.rowLabel === 'Plan0') && !p.data.rowHasBreakdown) ||
        p.data.rowLabel === 'Plan1-breakdown' ||
        p.data.rowLabel === 'Plan0-breakdown',
      // useFormatter: the edit box shows the same whole-euro, de-DE-grouped
      // text formatMonthCell() already displays (e.g. "8.000"), not the
      // raw underlying cents — parseWholeEuroInput() undoes exactly that
      // formatting back into cents on commit.
      cellEditor: 'agTextCellEditor',
      cellEditorParams: { useFormatter: true },
      valueSetter: (p) => {
        const cents = parseWholeEuroInput(p.newValue)
        if (cents === null) return false
        const prevCents = p.data.months[i]
        if (cents === prevCents) return false
        p.data.months[i] = cents
        p.data.yearTotal = p.data.yearTotal - prevCents + cents
        persistBudgetMonth(p.data, i + 1, cents)
        return true
      },
    }))
    return [
      {
        headerName: 'Kategorie',
        field: 'groupName',
        colId: 'groupName',
        spanRows: true,
        pinned: 'left',
        width: 40,
        // The cursor/focus rectangle should only ever land in a month
        // column (Markus) — nothing here is ever editable. suppressNavigable
        // only keeps keyboard Tab/arrow navigation from landing here; it
        // does *not* stop a plain mouse click from focusing the cell
        // directly (confirmed by reading AG Grid's own onMouseDown handler,
        // which calls focusCell() unconditionally with no suppressNavigable
        // check at all) — the grid's own onCellFocused handler below
        // redirects a click here back to that row's first month cell.
        suppressNavigable: true,
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
        colId: 'subcatName',
        spanRows: true,
        pinned: 'left',
        width: 170,
        suppressNavigable: true,
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})` }),
        // Vertically centered within its own spanned (merged) cell (Markus)
        // — AG Grid's default cell rendering doesn't center content inside
        // a tall spanned cell on its own.
        cellRenderer: (p) => <div className="flex h-full w-full items-center">{p.value}</div>,
      },
      {
        headerName: '',
        colId: 'breakdownActions',
        pinned: 'left',
        width: 26,
        suppressNavigable: true,
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`, ...blockBorderStyle(p.data) }),
        // One narrow action column covering every breakdown-line
        // interaction (Sept 2026, Markus) — mirrors Konten.jsx's own
        // pinned "split" column conventions closely on purpose (✚ to
        // add/split further, a chevron to expand/collapse, 🗑 per line):
        // ▸/▾ toggles a Plan1/Plan0 block that already has breakdown lines
        // (independent per plan version, spec.md §2.7); a bare ✚ on the
        // top-line row itself starts the *first* breakdown line; once a
        // block is showing, ✚ moves to Plan1's own last line (only Plan1
        // — a line is always created symmetrically for both plan versions
        // together, never independently on Plan0); every breakdown row
        // gets 🗑, arm-then-confirm exactly like Konten's own delete.
        cellRenderer: (p) => {
          const row = p.data
          if (row.rowLabel === 'Plan1-breakdown' || row.rowLabel === 'Plan0-breakdown') {
            const armed = confirmRemoveRowId === row.rowId
            return (
              <div className="flex h-full w-full items-center justify-center gap-0.5">
                <button
                  type="button"
                  title={armed ? 'Nochmal klicken zum Entfernen' : 'Aufschlüsselungszeile entfernen'}
                  className="text-xs leading-none"
                  style={armed ? { color: 'var(--color-alert)' } : undefined}
                  onClick={() => {
                    if (armed) {
                      setConfirmRemoveRowId(null)
                      removeBreakdownLine(row)
                    } else {
                      setConfirmRemoveRowId(row.rowId)
                    }
                  }}
                >
                  {armed ? '⚠︎' : '🗑'}
                </button>
                {row.canAddAfter && (
                  <button type="button" title="Weitere Aufschlüsselungszeile hinzufügen" className="text-xs leading-none" onClick={() => addBreakdownLine(row)}>
                    ✚
                  </button>
                )}
              </div>
            )
          }
          if ((row.rowLabel === 'Plan1' || row.rowLabel === 'Plan0') && row.rowHasBreakdown) {
            return (
              <button
                type="button"
                title={row.blockExpanded ? 'Aufschlüsselung einklappen' : 'Aufschlüsselung ausklappen'}
                className="flex h-full w-full items-center justify-center text-xs leading-none"
                onClick={() =>
                  setCollapsedBlocks((prev) => {
                    const next = new Set(prev)
                    if (next.has(row.blockKey)) next.delete(row.blockKey)
                    else next.add(row.blockKey)
                    return next
                  })
                }
              >
                {row.blockExpanded ? '▾' : '▸'}
              </button>
            )
          }
          if (row.rowLabel === 'Plan1') {
            return (
              <button
                type="button"
                title="Aufschlüsselungszeile hinzufügen"
                className="flex h-full w-full items-center justify-center text-xs leading-none"
                onClick={() => addBreakdownLine(row)}
              >
                ✚
              </button>
            )
          }
          return null
        },
      },
      {
        headerName: '',
        colId: 'label',
        pinned: 'left',
        suppressNavigable: true,
        // Narrower now that this column only holds the € figure (Markus —
        // it was still reserving width for the Prog/Plan1/Plan0 text label
        // dropped earlier) — a little wider than the month columns rather
        // than exactly matching, since this one's own figure always has a
        // trailing " €" the month columns never carry (spec.md §3b), which
        // clipped at the exact same width.
        width: 128,
        cellClass: (p) => `text-right tabular-figure${p.data.rowLabel?.includes('breakdown') || p.data.rowLabel === 'Rollup' ? ' text-xs' : ''}`,
        // The yearly total mixes closed and open months, so it doesn't get
        // the same per-month grey/black toggle the month columns do (that
        // rule is only meaningful per-month) — Plan0 (and its own
        // breakdown rows) stay grey, everything else reads as plain text.
        cellStyle: (p) => {
          const style = {
            backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`,
            color: `var(${p.data.rowLabel === 'Plan0' || p.data.rowLabel === 'Plan0-breakdown' ? '--color-text-muted' : '--color-text'})`,
            ...blockBorderStyle(p.data),
          }
          if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown' || p.data.rowLabel === 'Rollup') {
            style.backgroundColor = 'var(--color-line-row-tint)'
            if (p.data.rowLabel === 'Plan0-breakdown') style.fontStyle = 'italic'
          }
          return style
        },
        // Prog/Plan1/Plan0 show just the yearly € figure (font color
        // already tells them apart, Markus — dropped their own text label
        // last round). A breakdown/rollup row has no other column that
        // could show *which* line it is (Unterkategorie stays one merged
        // cell across the whole block, spec.md §3b: "breakdown item names
        // live in this third column, never in Unterkategorie"), so those
        // get a small two-line name-then-total instead.
        cellRenderer: (p) => {
          const { rowLabel, yearTotal, breakdownLabel } = p.data
          const total = yearTotal === 0 ? '' : `${centsToWholeEuro(yearTotal)} €`
          if (rowLabel === 'Plan1-breakdown' || rowLabel === 'Plan0-breakdown' || rowLabel === 'Rollup') {
            return (
              <div className="flex h-full w-full flex-col items-end justify-center overflow-hidden leading-tight">
                <span className="w-full truncate text-left">{breakdownLabel}</span>
                <span>{total}</span>
              </div>
            )
          }
          return total
        },
      },
      ...monthCols,
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cellStyle/cellRenderer callbacks close over closedMonths/confirmRemoveRowId; valueSetter's persistBudgetMonth and the add/remove handlers' createBreakdownTag close over budgets/tags/yearNum — all already current each render
  }, [closedMonths, budgets, tags, yearNum, confirmRemoveRowId])

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input type="checkbox" checked={showPlan0} onChange={(e) => setShowPlan0(e.target.checked)} />
          Plan0 anzeigen
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input type="checkbox" checked={showBreakdowns} onChange={(e) => setShowBreakdowns(e.target.checked)} />
          Aufschlüsselung anzeigen
        </label>
        {/* Month-close "ok" switches now live in each month's own column
            header (MonthHeader, above) — moved there per Markus's request,
            closer to spec.md §3b's own mockup ("their own header row...
            directly under the month labels") than the separate toolbar row
            this replaces. */}
      </div>

      {/* verlauf-grid: see the matching CSS rule in index.css — it
          suppresses AG Grid's own default per-row border (see the long
          comment on blockBorderStyle() above for why that border can't be
          reached from a cellStyle/getRowStyle override at all), leaving
          blockBorderStyle()'s own per-cell border as the only one drawn. */}
      <div className="verlauf-grid min-h-0 flex-1">
        <AgGridReact
          theme={themeQuartz}
          rowData={rowData}
          // Every row is uniquely identified by which category/allocation
          // tag it belongs to, which plan line, and (for a breakdown/
          // rollup row) which tag it represents — stable across re-renders
          // even though `rowData` itself is a brand-new array of brand-new
          // objects every time (built fresh in the useMemo above, never
          // object-identity-preserved). **Missing until the previous
          // round, unlike Konten.jsx's own grid — real bug, Markus: "when
          // i edit a cell the grid snaps weirdly back to the top."**
          // Without getRowId, AG Grid has no way to match a new rowData
          // array back to the rows it already had (it can only fall back
          // to row *index*, which breaks the moment sibling rows above
          // shift at all — exactly what happens the instant a breakdown
          // block expands/collapses), so every Firestore round-trip that
          // updates `budgets` looked like an entirely new dataset and
          // reset scroll position.
          getRowId={(p) => p.data.rowId}
          onGridReady={(p) => {
            gridApiRef.current = p.api
          }}
          // The cursor/focus rectangle should only ever land in a month
          // column (Markus) — suppressNavigable (above) keeps keyboard
          // Tab/arrow navigation from landing on the other pinned columns,
          // but a plain click still focuses whatever cell it hits
          // regardless (AG Grid's own onMouseDown calls focusCell()
          // unconditionally, with no suppressNavigable check at all — found
          // by reading its bundled source once suppressNavigable alone
          // turned out not to be enough). This redirects any such click
          // straight to that row's January cell instead.
          onCellFocused={(e) => {
            if (e.rowIndex == null || !e.column) return
            if (['groupName', 'subcatName', 'breakdownActions', 'label'].includes(e.column.getColId())) {
              gridApiRef.current?.setFocusedCell(e.rowIndex, 'm1', e.rowPinned)
            }
          }}
          columnDefs={columnDefs}
          defaultColDef={{ suppressMovable: true, sortable: false, filter: false, resizable: true }}
          // A colDef's own `spanRows: true` does nothing on its own — this
          // grid-level flag is what actually turns the feature on (found
          // the hard way: every Kategorie/Unterkategorie cell was silently
          // rendering unmerged, each with its own full-height rotated text
          // overflowing into its neighbors, since `spanRows` alone never
          // took effect without this).
          enableCellSpan
          // Taller than the usual single-line header (Markus, above) — a
          // month header now stacks its label and the close-month checkbox.
          headerHeight={52}
          rowHeight={30}
        />
      </div>
    </div>
  )
}
