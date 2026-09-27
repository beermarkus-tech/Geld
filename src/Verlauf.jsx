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

// **Deferred, not solved — see the long history in DEVLOG.md/CODEMAP.md:**
// the gridline *between* the three sibling rows (Prog/Plan1/Plan0) of one
// block is still faintly visible on Markus's own device despite three
// separate fix attempts, each verified wrong only by an actual screenshot.
// Rather than attempt a fourth guess at the same problem, Markus's own
// call (Sept 2026): leave that alone for now, and instead make the
// boundary *between* one block and the next unmistakably strong (a solid,
// high-contrast line — "black," inverted to white in dark mode via
// --color-border-strong) so the block structure itself still reads clearly
// even with the faint internal lines still present. Both the first row's
// own top edge and the last row's own bottom edge draw this — the shared
// seam between two adjacent blocks ends up with both sides drawing the
// same line, which is harmless (they overlap exactly, not double-thickness
// in practice), and it's what correctly marks the very first/last block's
// own outer edge too, which only one side could ever reach.
//
// Historical note on *why* a colDef/row-level override is what's needed
// here at all, not a plain AG Grid built-in: AG Grid's own default per-row
// border isn't drawn by `.ag-row` or `.ag-cell` for an ordinary row — it's
// `.ag-grid-scrolling-cells`/`.ag-grid-pinned-left-cells` (an internal
// per-row wrapper) that carries a real `border-bottom`, with no colDef- or
// row-level hook able to reach it — suppressed grid-wide via the
// `verlauf-grid` CSS rule in index.css (`--ag-row-border-color:
// transparent`), leaving this function's own per-cell border as the only
// one ever deliberately drawn. Kategorie/Unterkategorie don't need this —
// they're genuinely merged into one spanned cell per block via `spanRows`,
// so there's no seam there to begin with.
function blockBorderStyle(rowData) {
  return {
    borderTop: rowData.isFirstOfBlock ? '1px solid var(--color-border-strong)' : '0px none',
    borderBottom: rowData.isLastOfBlock ? '1px solid var(--color-border-strong)' : '0px none',
  }
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

// Replaces the old window.prompt()'s colon-syntax ("Schottland:Hotels")
// with two real fields (Markus, Sept 2026): a parent-tag combobox —
// existing parent/standalone tags already used somewhere in this same
// category (e.g. "Schottland"/"Fehmarn"/"Rostock" for a travel
// subcategory), pick one or type a new name to create it — and a plain
// subtag text field, optional. Parent alone creates one standalone total
// row under that name; parent + subtag creates a child row grouped under
// that parent's own automatic rollup header (spec.md §2.7). A plain
// `<input>` + filtered list rather than Konten's own TagEditor: that one's
// built as an AG Grid cell editor (api.stopEditing() etc.) and multi-
// select, neither of which applies here — this only ever resolves to at
// most one parent and one child, and isn't editing a grid cell at all.
function AddBreakdownModal({ parentOptions, tagExistsGloballyByName, onSubmit, onCancel }) {
  const [parentText, setParentText] = useState('')
  const [subtagText, setSubtagText] = useState('')
  const [parentOpen, setParentOpen] = useState(false)
  const parentInputRef = useRef(null)

  useEffect(() => {
    parentInputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const text = parentText.trim().toLowerCase()
  // The suggestion *list* stays scoped to this one category/allocation tag
  // (parentOptions, "available parent tags in that subcategory") — but
  // whether typing an exact name will reuse an existing tag or create a
  // brand new one checks *every* tag, not just this category's own
  // (tagExistsGloballyByName) — otherwise typing a name already used as a
  // breakdown parent for some *other* category (a real tag, just not one
  // suggested here) would silently create a duplicate tag under a
  // disambiguated id instead of reusing it, the same "reuse by exact name"
  // rule Konten.jsx's own createTag() already applies globally.
  const matches = parentOptions.filter((t) => text === '' || t.name.toLowerCase().includes(text))
  const willReuse = text !== '' && tagExistsGloballyByName(text)

  function pick(name) {
    setParentText(name)
    setParentOpen(false)
  }

  function submit() {
    const trimmedParent = parentText.trim()
    if (!trimmedParent) return
    onSubmit({ parentName: trimmedParent, subtagName: subtagText.trim() })
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative flex w-full max-w-sm flex-col gap-3 rounded-lg bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium">Neue Aufschlüsselungszeile</p>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Übergruppe (z. B. „Schottland“) — bestehende wählen oder neuen Namen eingeben
          <input
            ref={parentInputRef}
            type="text"
            value={parentText}
            onChange={(e) => {
              setParentText(e.target.value)
              setParentOpen(true)
            }}
            onFocus={() => setParentOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
          />
        </label>
        {parentOpen && matches.length > 0 && (
          <ul className="max-h-32 overflow-auto rounded border border-[var(--color-border)] text-sm">
            {matches.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(t.name)
                  }}
                  className="flex w-full px-2 py-1 text-left hover:bg-[var(--color-bg)]"
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {parentText.trim() !== '' && !willReuse && (
          <p className="text-xs italic text-[var(--color-text-muted)]">Neu „{parentText.trim()}“ wird angelegt</p>
        )}
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Unterzeile (optional, z. B. „Hotels“) — leer lassen für eine reine Summenzeile
          <input
            type="text"
            value={subtagText}
            onChange={(e) => setSubtagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
          />
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!parentText.trim()}
            className="rounded-md bg-[var(--color-computed)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Hinzufügen
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Verlauf({ year }) {
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [closedMonths, setClosedMonths] = useState([])
  // Global controls (spec.md §3b): Plan0's own show/hide, and (Sept 2026)
  // "Aufschlüsselung anzeigen/ausblenden" for every breakdown block at
  // once — corrected the same round (Markus: unchecking it should only
  // *collapse* every block, not stop a block being shown at all, since he
  // still needs to be able to expand one specific block back open even
  // with the global checkbox off). So this is no longer a hard gate on
  // whether breakdown rows exist at all — see planVersionRows() below —
  // just the *default* a block falls back to until individually
  // overridden. `blockOverrides` (a Map, not a Set) is exactly that
  // per-block override: absent means "follow showBreakdowns," present
  // means "this block was explicitly expanded/collapsed on its own and
  // keeps that until touched again," regardless of what the global
  // checkbox does afterward.
  const [showPlan0, setShowPlan0] = useState(() => readBoolSetting(SHOW_PLAN0_KEY))
  const [showBreakdowns, setShowBreakdowns] = useState(() => readBoolSetting(SHOW_BREAKDOWNS_KEY))
  const [blockOverrides, setBlockOverrides] = useState(() => new Map())
  function isBlockExpanded(blockKey) {
    return blockOverrides.has(blockKey) ? blockOverrides.get(blockKey) : showBreakdowns
  }
  function setBlockExpanded(blockKey, expanded) {
    setBlockOverrides((prev) => {
      const next = new Map(prev)
      next.set(blockKey, expanded)
      return next
    })
  }
  // A real confirmation modal for removing a breakdown line (Sept 2026,
  // Markus: reuse the Abmelden modal's design, not the icon's own two-
  // click arm/confirm — there's no undo, so a stray second click
  // shouldn't be enough on its own either) — holds the row itself (or
  // null when closed), not just its id, since the modal's own text needs
  // the row's label.
  const [confirmRemoveRow, setConfirmRemoveRow] = useState(null)
  // The (targetKey, targetId, planVersion) a "neue Aufschlüsselungszeile"
  // modal is currently open for — null when closed. Always exactly one
  // plan version (Sept 2026: Plan1/Plan0 breakdown lines are now
  // independent, each with its own add affordance, rather than always
  // created symmetrically in both at once).
  const [addModalTarget, setAddModalTarget] = useState(null)
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
    if (!confirmRemoveRow) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setConfirmRemoveRow(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmRemoveRow])

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
      blockExpanded: isBlockExpanded(blockKey),
    }
    const out = [topRow]
    // Breakdown rows exist independent of the global "Aufschlüsselung
    // anzeigen" checkbox now (Sept 2026 — see blockOverrides' own comment
    // above) — only rowHasBreakdown and this one block's own expanded
    // state gate them, never showBreakdowns directly.
    if (!rowHasBreakdown || !topRow.blockExpanded) return out

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
        blockKey,
        breakdownTagId: tagId,
        breakdownLabel: tagName(tagId),
        months: line.months,
        yearTotal: line.yearTotal,
        // The last line of *either* plan version's own block gets the
        // "add another line" action (Konten's own split-column convention
        // — the last line is always where the next one gets added). Both
        // plan versions get their own independent add affordance now
        // (Sept 2026, Markus: "both plan1 and plan0 need their own add
        // buttons... adding a breakdown row in plan1 [used to create] the
        // same breakdown row in plan0" — that forced symmetry was the bug,
        // corrected the same round in addBreakdownLine/removeBreakdownLine
        // below).
        canAddAfter: isLastInBlock,
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
          blockKey,
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
    // Marks the actual first/last row of this block after every filter
    // above has already applied — used below to draw a strong boundary
    // line at each block's own top/bottom edge (Sept 2026, Markus — see
    // blockBorderStyle()'s own comment for why).
    rows.forEach((r, i) => {
      r.isFirstOfBlock = i === 0
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
  // same discipline already applied elsewhere in this codebase.
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

  // Every top-level tag already used as a breakdown line (standalone) or
  // as some breakdown line's own parent, anywhere for this one category/
  // allocation tag (any plan version, any year already loaded) — the
  // "Übergruppe" combobox's own option list in AddBreakdownModal (Sept
  // 2026, Markus: "parent tag is a dropdown field with available parent
  // tags **in that subcategory**... that have been created earlier").
  function parentTagOptionsFor(targetKey, targetId) {
    const usedTagIds = new Set(budgets.filter((b) => b[targetKey] === targetId && b.breakdownTagId != null).map((b) => b.breakdownTagId))
    const parentIds = new Set()
    for (const tagId of usedTagIds) {
      const t = tagById.get(tagId)
      parentIds.add(t?.parentTag ?? tagId)
    }
    return [...parentIds]
      .map((id) => tagById.get(id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  // Adding a breakdown line (Sept 2026, Markus, reworked the same round —
  // see AddBreakdownModal below for the actual parent/subtag UI this
  // feeds). Always writes all 12 months right away, even where the value
  // is 0, rather than migration's own "skip a zero month" convention: a
  // brand new line otherwise has *no* budget document anywhere yet, and
  // nothing in the schema records "this breakdown tag exists for this
  // category" independent of having at least one real document
  // (breakdownTagIdsFor() reads it straight off budgets, there's no
  // separate registry).
  //
  // Scoped to exactly *one* plan version now, never both together — the
  // forced Plan1→Plan0 symmetry this used to have was a real bug (Markus:
  // adding a second breakdown line duplicated the first line's already-
  // carried-over total into the new line too, "each breakdown row added
  // to that block gets the same numbers duplicated again"). Root cause:
  // "is this the first line?" used to read a flag only ever set on the
  // *top-line* row object, so clicking "add another" from an existing
  // breakdown row's own ✚ (which isn't the top-line row) always saw that
  // flag as absent/falsy → wrongly treated every line as the first one →
  // re-carried-over the *already-summed* top-line total each time. Fixed
  // by asking breakdownTagIdsFor() fresh, right here, instead of trusting
  // a caller-supplied flag — and, since that's now checked per plan
  // version anyway, Plan1 and Plan0 fall out independent for free (each
  // plan version gets its own carry-over exactly once, the first time
  // *that version* gains a line, never touching the other).
  async function commitAddBreakdownLine(targetKey, targetId, planVersion, tagId) {
    const existing = breakdownTagIdsFor(targetKey, targetId, planVersion)
    const isFirstLine = existing.length === 0
    const carryOver = isFirstLine ? budgetTopLineMonths(targetKey, targetId, planVersion, yearNum, budgets) : null
    const batch = writeBatch(db)
    for (let month = 1; month <= 12; month++) {
      const cents = carryOver ? carryOver.months[month - 1] : 0
      const id = budgetDocId(yearNum, planVersion, targetId, month, tagId)
      batch.set(doc(db, 'budgets', id), budgetDoc(yearNum, targetKey, targetId, planVersion, month, tagId, cents, ''))
      if (isFirstLine) {
        const flatId = budgetDocId(yearNum, planVersion, targetId, month, null)
        if (budgets.some((b) => b.id === flatId)) batch.delete(doc(db, 'budgets', flatId))
      }
    }
    await batch.commit()
    setBlockExpanded(`${targetKey}:${targetId}:${planVersion}`, true)
  }

  // AddBreakdownModal's own onSubmit — resolves the chosen/typed parent by
  // exact name match against *every* tag (same global "reuse by exact
  // name" rule Konten's own createTag() applies, not just this category's
  // own parentOptions suggestions — see AddBreakdownModal's own comment on
  // willReuse for why that distinction matters), creating a fresh one only
  // if truly nothing matches. Only if a subtag was typed does a child tag
  // get created under it; a bare parent with no subtag uses the parent
  // tag's own id directly as the breakdownTagId (Markus: "when i select or
  // type only a parent tag, a totals row is created").
  async function handleAddBreakdownSubmit({ parentName, subtagName }) {
    const target = addModalTarget
    setAddModalTarget(null)
    if (!target) return
    const existingParent = tags.find((t) => t.class === 'grouping' && !t.parentTag && t.name.toLowerCase() === parentName.toLowerCase())
    const resolvedParentId = existingParent ? existingParent.id : createPlainGroupingTag(parentName, null)
    const tagId = subtagName ? createPlainGroupingTag(subtagName, resolvedParentId) : resolvedParentId
    await commitAddBreakdownLine(target.targetKey, target.targetId, target.planVersion, tagId)
  }

  // Removing a breakdown line — scoped to that one line's own plan
  // version only now, same independence fix as commitAddBreakdownLine()
  // above (Markus: "in the end only totals matter for the underlying
  // math," so there's no longer any reason to force Plan0 to lose a line
  // just because Plan1 did). If it was the *last* remaining line in that
  // plan version, its own final values fold back up into a real flat
  // top-line row instead of just vanishing — mirroring
  // commitAddBreakdownLine()'s own value-preserving carry-over, in
  // reverse.
  async function removeBreakdownLine(row) {
    const remaining = breakdownTagIdsFor(row.targetKey, row.targetId, row.planVersion)
    const isLastLine = remaining.length <= 1
    const own = isLastLine
      ? budgetBreakdownLineMonths(row.targetKey, row.targetId, row.breakdownTagId, row.planVersion, yearNum, budgets)
      : null
    const batch = writeBatch(db)
    for (let month = 1; month <= 12; month++) {
      batch.delete(doc(db, 'budgets', budgetDocId(yearNum, row.planVersion, row.targetId, month, row.breakdownTagId)))
      if (isLastLine) {
        const id = budgetDocId(yearNum, row.planVersion, row.targetId, month, null)
        batch.set(doc(db, 'budgets', id), budgetDoc(yearNum, row.targetKey, row.targetId, row.planVersion, month, null, own.months[month - 1], ''))
      }
    }
    await batch.commit()
  }

  // Opens the "neue Aufschlüsselungszeile" modal for whichever block a ✚
  // click (or the Ctrl++ shortcut, below) came from — a plain top-line row
  // already carries its own planVersion; Prog doesn't (it has no plan
  // version of its own), so Ctrl++ pressed there defaults to Plan1, the
  // more common case.
  function openAddModalFor(row) {
    setAddModalTarget({ targetKey: row.targetKey, targetId: row.targetId, planVersion: row.planVersion ?? 'plan1' })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planLineRows and everything it calls close over categories/tags/transactions/budgets/closedMonths/showPlan0/showBreakdowns/blockOverrides/yearNum, all already current each render
  }, [categories, tags, transactions, budgets, closedMonths, showPlan0, showBreakdowns, blockOverrides, yearNum])

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
        // Prog's own row gets a light grey tint on a closed month's cells
        // specifically (spec.md §3b, corrected Sept 2026 — Markus caught
        // it applied to Plan0 instead) — a second, independent cue
        // alongside the grey text, not applied to Plan1/Plan0's cells.
        if (p.data.rowLabel === 'Prog' && isClosed) style.backgroundColor = 'var(--color-line-row-tint)'
        // A breakdown line gets its own yellow-tinted background always,
        // not just on a closed month (spec.md §3b: "visually distinguished
        // by smaller text and a tinted background"), and Plan0's own
        // breakdown rows are additionally italicized to match Plan0's own
        // styling. The parent-tag rollup header (its own "sub sum" row)
        // gets a step stronger yellow than its own children (Markus, Sept
        // 2026) — same always-on treatment, not tied to closed-state.
        if (p.data.rowLabel === 'Rollup') style.backgroundColor = 'var(--color-breakdown-rollup-tint)'
        if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown') {
          style.backgroundColor = 'var(--color-breakdown-tint)'
          if (p.data.rowLabel === 'Plan0-breakdown') style.fontStyle = 'italic'
        }
        return style
      },
      // Flexed rather than a fixed width (Markus, Sept 2026: "configure the
      // months columns such that they fit the available screen size... i
      // dont want to have a horizontal scrollbar") — the 12 month columns
      // now always share out whatever width is left after the pinned
      // columns' own fixed widths, instead of a fixed 102px each that only
      // happened to fit some screens and forced a horizontal scrollbar on
      // narrower ones. minWidth keeps a month column from being squeezed
      // down to unreadable on a genuinely narrow viewport (a horizontal
      // scrollbar can still appear there — unavoidable short of the
      // phone/one-month-card layout PLAN.md still has as a separate,
      // unbuilt Phase 2 piece).
      flex: 1,
      minWidth: 64,
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
        // The block-boundary border now continues into these two spanned
        // columns too (Markus, Sept 2026: "make sure the black separation
        // grid lines between categorys and subcategories continue into
        // the first two columns") — only the top edge, since a spanned
        // cell's own cellStyle only ever sees the *first* row's data
        // object of the whole span (there's no separate call per
        // constituent row the way an ordinary column gets), so
        // isLastOfBlock here would always read as that first row's own
        // (almost always false). Every internal boundary still draws
        // correctly regardless — it's the very next block's own top edge
        // that draws the shared seam — only the very last block's own
        // outer bottom edge can't be reached this way; a cosmetic gap the
        // other columns' own per-row borders don't have.
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`, borderTop: blockBorderStyle(p.data).borderTop }),
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
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`, borderTop: blockBorderStyle(p.data).borderTop }),
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
        // The add/expand affordances only now — the trashcan moved to its
        // own pinned-*right* column below (Markus, Sept 2026: "place the
        // trashcan icons to the right of the months columns like in
        // konten," which keeps its own delete column separate from the
        // split/expand column the same way). Mirrors Konten.jsx's own
        // pinned "split" column conventions on purpose (✚ to add/split
        // further, a chevron to expand/collapse): ▸/▾ toggles a Plan1/
        // Plan0 block that already has breakdown lines; a bare ✚ on
        // either plan version's own top-line row starts *that version's*
        // first breakdown line — Plan1 and Plan0 each get their own now
        // (Markus: "both plan1 and plan0 need their own add buttons"),
        // no longer forced to stay symmetric.
        cellRenderer: (p) => {
          const row = p.data
          if (row.rowLabel === 'Plan1-breakdown' || row.rowLabel === 'Plan0-breakdown') {
            return row.canAddAfter ? (
              <button
                type="button"
                title="Weitere Aufschlüsselungszeile hinzufügen"
                className="flex h-full w-full items-center justify-center text-xs leading-none"
                onClick={() => openAddModalFor(row)}
              >
                ✚
              </button>
            ) : null
          }
          if ((row.rowLabel === 'Plan1' || row.rowLabel === 'Plan0') && row.rowHasBreakdown) {
            return (
              <button
                type="button"
                title={row.blockExpanded ? 'Aufschlüsselung einklappen (Strg+Tab)' : 'Aufschlüsselung ausklappen (Strg+Tab)'}
                className="flex h-full w-full items-center justify-center text-xs leading-none"
                onClick={() => setBlockExpanded(row.blockKey, !row.blockExpanded)}
              >
                {row.blockExpanded ? '▾' : '▸'}
              </button>
            )
          }
          if (row.rowLabel === 'Plan1' || row.rowLabel === 'Plan0') {
            return (
              <button
                type="button"
                title="Aufschlüsselungszeile hinzufügen (Strg++)"
                className="flex h-full w-full items-center justify-center text-xs leading-none"
                onClick={() => openAddModalFor(row)}
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
        colId: 'rowTitle',
        pinned: 'left',
        suppressNavigable: true,
        // Brought back (Markus, Sept 2026 — spec.md §3b's own original
        // "third column... either the plan-line name (Prog/Plan1/Plan0)
        // or, for a breakdown row, that breakdown item's name" design,
        // dropped as redundant once font color told Prog/Plan1/Plan0 apart
        // — reinstated once breakdown lines needed *some* column to show
        // their own name in, since Unterkategorie stays one merged cell
        // across the whole block and can't do it). Narrow — just the text
        // label now, the € figure moved back to its own column ('label',
        // below) rather than the two-line squeeze this replaces.
        width: 96,
        cellClass: (p) => `truncate${p.data.rowLabel?.includes('breakdown') || p.data.rowLabel === 'Rollup' ? ' text-xs' : ''}`,
        cellStyle: (p) => {
          const style = {
            backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`,
            color: `var(${p.data.rowLabel === 'Plan0' || p.data.rowLabel === 'Plan0-breakdown' ? '--color-text-muted' : '--color-text'})`,
            ...blockBorderStyle(p.data),
          }
          if (p.data.rowLabel === 'Rollup') style.backgroundColor = 'var(--color-breakdown-rollup-tint)'
          if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown') {
            style.backgroundColor = 'var(--color-breakdown-tint)'
            if (p.data.rowLabel === 'Plan0-breakdown') style.fontStyle = 'italic'
          }
          return style
        },
        valueGetter: (p) => (p.data.breakdownLabel ?? p.data.rowLabel),
      },
      {
        headerName: '',
        colId: 'label',
        pinned: 'left',
        suppressNavigable: true,
        // A little wider than the month columns rather than exactly
        // matching, since this one's own figure always has a trailing
        // " €" the month columns never carry (spec.md §3b), which clipped
        // at the exact same width.
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
          if (p.data.rowLabel === 'Rollup') style.backgroundColor = 'var(--color-breakdown-rollup-tint)'
          if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown') {
            style.backgroundColor = 'var(--color-breakdown-tint)'
            if (p.data.rowLabel === 'Plan0-breakdown') style.fontStyle = 'italic'
          }
          return style
        },
        valueGetter: (p) => (p.data.yearTotal === 0 ? '' : `${centsToWholeEuro(p.data.yearTotal)} €`),
      },
      ...monthCols,
      {
        headerName: '',
        colId: 'breakdownDelete',
        pinned: 'right',
        width: 30,
        resizable: false,
        suppressNavigable: true,
        // The trashcan itself, moved out to its own pinned-right column
        // (Markus, Sept 2026 — see breakdownActions' own comment above).
        // A plain click opens the real confirmation modal now (below,
        // "Aufschlüsselungszeile wirklich entfernen?") instead of arming a
        // second click on the icon itself — there's no undo, same
        // reasoning Markus already applied to Abmelden.
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})` }),
        cellRenderer: (p) => {
          const row = p.data
          if (row.rowLabel !== 'Plan1-breakdown' && row.rowLabel !== 'Plan0-breakdown') return null
          return (
            <button
              type="button"
              title="Aufschlüsselungszeile entfernen (Entf)"
              className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-alert)]"
              onClick={() => setConfirmRemoveRow(row)}
            >
              🗑
            </button>
          )
        },
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cellStyle/cellRenderer callbacks close over closedMonths; valueSetter's persistBudgetMonth closes over budgets/tags/yearNum — all already current each render
  }, [closedMonths, budgets, tags, yearNum])

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
        <span className="text-xs text-[var(--color-text-muted)]">
          Strg++ fügt eine Zeile hinzu · Strg+Tab klappt auf/zu · Entf entfernt
        </span>
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
            if (['groupName', 'subcatName', 'breakdownActions', 'label', 'breakdownDelete'].includes(e.column.getColId())) {
              gridApiRef.current?.setFocusedCell(e.rowIndex, 'm1', e.rowPinned)
            }
          }}
          // Del/Ctrl+Tab/Ctrl++ (Markus, Sept 2026) — all three act on
          // whichever row currently has the cursor/focus rectangle:
          // - Delete: only a real breakdown line can be removed this way
          //   (opens the same confirmation modal the trashcan does, not an
          //   instant delete — see confirmRemoveRow above).
          // - Ctrl+Tab: directional, not a plain toggle — "show: from the
          //   subcategory totals row [Plan1/Plan0], collapse: from
          //   anywhere within the breakdown rows [a breakdown line or its
          //   own automatic rollup header]." A no-op from Prog (it has no
          //   plan version, so no single block it could unambiguously
          //   mean).
          // - Ctrl++: opens the "neue Aufschlüsselungszeile" modal for
          //   whichever block the cursor is in (openAddModalFor's own
          //   Prog→Plan1 default applies here too).
          onCellKeyDown={(p) => {
            const key = p.event?.key
            const row = p.data
            if (!row) return
            if (key === 'Delete') {
              if (row.rowLabel === 'Plan1-breakdown' || row.rowLabel === 'Plan0-breakdown') {
                p.event.preventDefault()
                setConfirmRemoveRow(row)
              }
              return
            }
            if (key === 'Tab' && (p.event.ctrlKey || p.event.metaKey)) {
              p.event.preventDefault()
              if (row.rowLabel === 'Plan1' || row.rowLabel === 'Plan0') setBlockExpanded(row.blockKey, true)
              else if (row.rowLabel === 'Plan1-breakdown' || row.rowLabel === 'Plan0-breakdown' || row.rowLabel === 'Rollup') {
                setBlockExpanded(row.blockKey, false)
              }
              return
            }
            if (key === '+' && (p.event.ctrlKey || p.event.metaKey)) {
              p.event.preventDefault()
              openAddModalFor(row)
            }
          }}
          columnDefs={columnDefs}
          defaultColDef={{ suppressMovable: true, sortable: false, filter: false, resizable: true }}
          // No row-add/remove/reorder animation on this screen (Markus,
          // Sept 2026: "is there a way to stop ag grid animations for this
          // screen") — a breakdown block expanding/collapsing or the
          // Plan0/Aufschlüsselung toggles both add or remove many rows at
          // once, and the animation made that transition (and the
          // blank-row rendering glitch below) more noticeable, not less.
          animateRows={false}
          // Every row always in the DOM, never virtualized (Markus: rows
          // going blank after scrolling away and back, only fixed by
          // toggling a show/hide checkbox again) — root cause: Kategorie/
          // Unterkategorie's own spanned cell (enableCellSpan, above)
          // stretches across every row of a whole block, but row
          // virtualization only keeps a scroll-position-relative window of
          // rows in the DOM at all; once a block is taller than that
          // window (a subcategory with several breakdown lines easily is),
          // scrolling could leave rows inside the span's own range un-
          // rendered, and nothing forced them to catch up again short of a
          // full rowData rebuild (exactly what re-toggling a checkbox
          // does). Verlauf's own total row count (every category/
          // allocation-tag block, breakdown lines included) stays well
          // under the 500-row default cap this requires lifting, so
          // rendering every row unconditionally is a safe trade here, not
          // a performance risk.
          suppressRowVirtualisation
          suppressMaxRenderedRowRestriction
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
          // A breakdown line (and its own rollup header) already reads as
          // a lighter-weight detail row via the smaller font above —
          // Markus asked for a shorter row to match, and AG Grid's
          // getRowHeight (plain Community option) is exactly this: a
          // per-row override on top of the grid-wide default.
          getRowHeight={(p) => {
            const label = p.data?.rowLabel
            return label === 'Plan1-breakdown' || label === 'Plan0-breakdown' || label === 'Rollup' ? 22 : 30
          }}
        />
      </div>

      {addModalTarget && (
        <AddBreakdownModal
          parentOptions={parentTagOptionsFor(addModalTarget.targetKey, addModalTarget.targetId)}
          tagExistsGloballyByName={(name) => tags.some((t) => t.class === 'grouping' && !t.parentTag && t.name.toLowerCase() === name)}
          onSubmit={handleAddBreakdownSubmit}
          onCancel={() => setAddModalTarget(null)}
        />
      )}

      {/* Reuses NavShell.jsx's own Abmelden confirmation modal design
          (Markus, Sept 2026: "deleting a breakdown row should lead to a
          real confirmation modal... reuse the abmelden confirmation modal
          design") — a real, permanent loss of that line's planned
          figures, same "no undo" reasoning Abmelden's own modal already
          exists for. */}
      {confirmRemoveRow && (
        <div className="fixed inset-0 z-30 flex items-center justify-center" onClick={() => setConfirmRemoveRow(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative flex w-full max-w-sm flex-col gap-4 rounded-lg bg-[var(--color-surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm">
              „{confirmRemoveRow.breakdownLabel}“ wirklich entfernen? Das kann nicht rückgängig gemacht werden.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveRow(null)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => {
                  const row = confirmRemoveRow
                  setConfirmRemoveRow(null)
                  removeBreakdownLine(row)
                }}
                className="rounded-md bg-[var(--color-alert)] px-3 py-1.5 text-sm font-medium text-white"
              >
                Entfernen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
