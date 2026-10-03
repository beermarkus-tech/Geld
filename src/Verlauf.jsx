import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { TAG_RENAME_MESSAGES, validateTagRename } from './lib/tagRename'
import ui from './lib/uiState'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import { db } from './firebase'
import {
  breakdownGroupAllocationMonthActual,
  breakdownGroupMonthActual,
  budgetBreakdownLineMonths,
  budgetTopLineMonths,
  progMonths as progMonthsFor,
} from './lib/budget'
import { ALLOCATION_TAG_ORDER, GROUP_ORDER, SUBCAT_ORDER, isBudgetPlannedTag, isKnownSubcat } from './lib/categoryOrder'
import { centsToWholeEuro, parseWholeEuroInput } from './lib/format'
import { registerScreenCursor } from './lib/screenCursor'
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
function monthTextColorVar(rowLabel, isClosed, isPlan0) {
  if (rowLabel === 'Plan0' || rowLabel === 'Plan0-breakdown') return '--color-text-muted'
  if (rowLabel === 'Plan1' || rowLabel === 'Plan1-breakdown') return isClosed ? '--color-text-muted' : '--color-text'
  // A Plan0 Rollup row reads like Plan0 (always muted) rather than Prog's
  // mirror-then-lock rule — it's a plain sum of planned values, never a
  // real actual, same as every other Plan0 row (Sept 2026).
  if (rowLabel === 'Rollup' && isPlan0) return '--color-text-muted'
  return isClosed ? '--color-text' : '--color-text-muted' // Prog, Plan1's own Rollup
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
// even with the faint internal lines still present.
//
// **Drawn only once per boundary, not from both sides (corrected later the
// same round — Markus: "horizontal black grid lines at the bottom of
// plan0 blocks... are strangely doubled or maybe thicker than other black
// horizontal lines").** The first version drew this from *both* the
// previous block's own last row (`borderBottom`) *and* the next block's
// own first row (`borderTop`), on the theory that two 1px borders landing
// on the exact same shared pixel line would just overlap harmlessly — true
// for genuine CSS border-collapse (adjacent `<table>` cells), false here:
// these are two *separate* elements (different rows, each its own box),
// and a browser never merges two independently-drawn 1px borders into one
// — it paints both, which reads as a visibly heavier ~2px line, not a
// clean 1px one. Fixed by drawing the boundary from only one side, always
// — the *next* block's own top edge — with a single, narrow exception: the
// very last row of the *entire* grid has no "next block" to draw a top
// edge for it, so that one row alone still draws its own bottom edge
// (`isVeryLastRow`, set once in the rowData useMemo below, after every
// category/allocation-tag block has been built).
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
//
// A second, lighter-weight divider (Sept 2026, Markus: "bottom grid lines
// of plan1 without breakdown rows are black while they should be gray —
// [it's the] line between plan1 and plan0") — the seam between Plan1's own
// group (Prog/Plan1/Plan1's breakdown) and Plan0's own group, whenever
// Plan0 is actually shown, reads as a plain neutral divider, never the
// strong block-boundary black/white — that one is reserved for the seam
// between two different categories/allocation tags, never an internal one.
// This one *is* only ever drawn from one side (Plan1's own group's last
// row) to begin with, so it never had the doubling problem above.
function blockBorderStyle(rowData) {
  return {
    borderTop: rowData.isFirstOfBlock ? '1px solid var(--color-border-strong)' : '0px none',
    borderBottom: rowData.isVeryLastRow
      ? '1px solid var(--color-border-strong)'
      : rowData.isPlan1GroupEnd
        ? '1px solid var(--color-border)'
        : '0px none',
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

const SHOW_PLAN0_KEY = 'geld-verlauf-show-plan0'
const SHOW_BREAKDOWNS_KEY = 'geld-verlauf-show-breakdowns'
const SHOW_PLANUNG_KEY = 'geld-verlauf-show-planung'

// The extra pinned "letztes Jahr" column's width. The 12 month columns are
// flexed, so they simply share out whatever width is left and shrink a
// little while it's shown (Oct 2026, Markus: "instead of shrinking the
// category column... shrink all month columns a little bit instead").
const LAST_YEAR_WIDTH = 76

// Per-device convenience only, same reasoning as NavShell.jsx's own
// sidebar-collapsed persistence (Markus, Sept 2026: "save the state of
// show or hide plan0") — a read/write failure (private browsing, blocked
// storage) just means it starts shown every time, never a crash.
function readBoolSetting(key, fallback = true) {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : stored === '1'
  } catch {
    return fallback
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
// with two real fields (Markus, Sept 2026): **Name** (required — the
// line's own label) and **Übergruppe** (optional combobox — existing
// parent/standalone tags already used somewhere in this same category,
// e.g. "Schottland"/"Fehmarn"/"Rostock" for a travel subcategory; pick one
// or type a new name to create it). Name alone creates one standalone line
// under that name directly; Name + Übergruppe creates it as a child grouped
// under that parent's own automatic rollup header (spec.md §2.7).
// **Corrected the same round (Markus: "I should be able to add a breakdown
// line without a parent")** — the very first version of this modal had it
// backwards, requiring Übergruppe and treating Name as the optional field,
// which made the common flat-line case impossible without inventing a
// throwaway group name. A plain `<input>` + filtered list rather than
// Konten's own TagEditor: that one's built as an AG Grid cell editor
// (api.stopEditing() etc.) and multi-select, neither of which applies
// here — this only ever resolves to at most one parent and one name, and
// isn't editing a grid cell at all.
// The header-row comment field for whichever month/total cell the cursor is
// on (Oct 2026, Markus). Typing saves after a short pause, on Enter, on
// leaving the field and on moving to another cell. Every pending edit
// remembers the cell it was typed under, so a quick click on the next cell
// can never write the text onto the wrong one. The × empties the field,
// which deletes the comment.
function CellCommentField({ cell, description, savedText, onSave, onDone, inputRef: externalRef, active = true }) {
  const [draft, setDraft] = useState(savedText)
  const pending = useRef({ cell, dirty: false, text: savedText })
  const timer = useRef(null)
  const ownRef = useRef(null)
  const inputRef = externalRef ?? ownRef
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  function flush() {
    clearTimeout(timer.current)
    const p = pending.current
    if (p.dirty && p.cell) onSaveRef.current(p.cell, p.text)
    pending.current = { ...p, dirty: false }
  }

  const cellKey = cell ? `${cell.rowId}|${cell.colId}` : ''
  useEffect(() => {
    const p = pending.current
    const prevKey = p.cell ? `${p.cell.rowId}|${p.cell.colId}` : ''
    if (prevKey !== cellKey) flush()
    if (prevKey !== cellKey || !pending.current.dirty) {
      pending.current = { cell, dirty: false, text: savedText }
      setDraft(savedText)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush only touches refs; keyed on the selected cell and its saved text
  }, [cellKey, savedText])
  useEffect(() => () => flush(), [])

  function change(text) {
    setDraft(text)
    pending.current = { cell, dirty: true, text }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 800)
  }

  // A multi-line box (Oct 2026, Markus): Enter adds a line break, only Esc
  // leaves the box — and saves. While focused it grows downward over the
  // header and the cells below; the slot it occupies in the toolbar keeps its
  // single-line height so nothing else moves.
  const [focused, setFocused] = useState(false)
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '2rem'
    // Stays as tall as its text even without the cursor in it (Oct 2026, Markus).
    // Measured only while the screen is shown: a hidden element reports a
    // scrollHeight of 0, which used to squash the box below one line after
    // switching back to Verlauf — so there is also a one-line floor, and it is
    // measured again when the screen becomes visible.
    const grown = Math.max(32, Math.min(el.scrollHeight + 2, 240))
    el.style.height = `${grown}px`
    setTall(grown > 34)
  }, [draft, focused, inputRef, active])

  return (
    <div className="relative h-8 w-[22rem] max-w-full">
      <textarea
        ref={inputRef}
        rows={1}
        value={draft}
        maxLength={500}
        disabled={!cell}
        onChange={(e) => change(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          flush()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            flush()
            if (cell) onDone(cell)
          }
        }}
        placeholder="Kommentar"
        title={description || undefined}
        aria-label="Kommentar zur markierten Zelle"
        // Tinted yellow while the selected cell has a comment (Oct 2026, Markus),
        // so it is obvious at a glance without reading the text.
        className={`absolute left-0 top-0 w-full resize-none rounded-md border py-1 pl-2 pr-8 text-sm leading-5 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] placeholder:opacity-50 disabled:opacity-50 ${
          focused || tall ? 'z-30 overflow-y-auto shadow-lg' : 'overflow-hidden'
        } ${
          draft && cell
            ? 'border-[var(--color-needs-attention)] bg-[color-mix(in_srgb,var(--color-needs-attention)_28%,var(--color-surface))]'
            : 'border-[var(--color-border)] bg-[var(--color-surface)]'
        }`}
      />
      {draft && (
        <button
          type="button"
          aria-label="Kommentar löschen"
          title="Kommentar löschen"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            change('')
            flush()
            inputRef.current?.focus()
          }}
          className="absolute right-1 top-0.5 z-40 px-1 text-xl leading-none text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          ×
        </button>
      )}
    </div>
  )
}

function AddBreakdownModal({ parentOptions, tagExistsGloballyByName, onSubmit, onCancel }) {
  const [nameText, setNameText] = useState('')
  const [groupText, setGroupText] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  // -1 = nothing highlighted (a plain Enter submits the form instead of
  // picking a suggestion) — Markus: "I should be able to navigate the
  // breakdown line modal with arrow keys", same up/down-then-Enter pattern
  // as Konten's own TagEditor suggestion list.
  const [highlight, setHighlight] = useState(-1)
  const nameInputRef = useRef(null)

  useEffect(() => {
    nameInputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const text = groupText.trim().toLowerCase()
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
    setGroupText(name)
    setGroupOpen(false)
    setHighlight(-1)
  }

  function submit() {
    const trimmedName = nameText.trim()
    if (!trimmedName) return
    onSubmit({ name: trimmedName, groupName: groupText.trim() })
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
          Name (z. B. „Hotels“)
          <input
            ref={nameInputRef}
            type="text"
            value={nameText}
            onChange={(e) => setNameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Übergruppe (optional, z. B. „Schottland“) — bestehende wählen oder neu anlegen
          <input
            type="text"
            value={groupText}
            onChange={(e) => {
              setGroupText(e.target.value)
              setGroupOpen(true)
              setHighlight(-1)
            }}
            onFocus={() => setGroupOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setGroupOpen(true)
                setHighlight((i) => Math.min(matches.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlight((i) => Math.max(-1, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (groupOpen && highlight >= 0 && matches[highlight]) pick(matches[highlight].name)
                else submit()
              }
            }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
          />
        </label>
        {groupOpen && matches.length > 0 && (
          <ul className="max-h-32 overflow-auto rounded border border-[var(--color-border)] text-sm">
            {matches.map((t, idx) => (
              <li key={t.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(t.name)
                  }}
                  className={'flex w-full px-2 py-1 text-left ' + (idx === highlight ? 'bg-[var(--color-computed)] text-white' : 'hover:bg-[var(--color-bg)]')}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {groupText.trim() !== '' && !willReuse && (
          <p className="text-xs italic text-[var(--color-text-muted)]">Neu „{groupText.trim()}“ wird angelegt</p>
        )}
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
            disabled={!nameText.trim()}
            className="rounded-md bg-[var(--color-computed)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Hinzufügen
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Verlauf({ year, initialFocus, onFocusChange, active = true, onOpenQuickview }) {
  // Hidden screens keep the newest data aside instead of recomputing on every save elsewhere.
  const syncWhenVisible = useDeferWhileHidden(active)
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
  // Remembered between sessions (lib/uiState.js): which breakdown blocks the
  // user expanded/collapsed by hand.
  const [blockOverrides, setBlockOverrides] = useState(() => {
    const saved = ui.get('verlauf', 'blocks', [])
    return new Map(Array.isArray(saved) ? saved.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'boolean') : [])
  })
  useEffect(() => ui.set('verlauf', 'blocks', [...blockOverrides]), [blockOverrides])
  // "letztes Jahr" checkbox (Oct 2026, Markus): an extra pinned column
  // showing last year's Prog/Plan1/Plan0 yearly totals next to this year's.
  // Off by default — the month columns shrink a little while it's shown.
  const [showPlanung, setShowPlanung] = useState(() => readBoolSetting(SHOW_PLANUNG_KEY, false))
  // Last year's own month-close switches (settings/{year−1}) — what makes
  // last year's Prog read exactly as Verlauf shows that year itself.
  const [lastYearClosedMonths, setLastYearClosedMonths] = useState([])
  // Per-cell comments (Oct 2026, Markus): one short note per month/total
  // cell, stored in the `cellComments` collection (spec.md §2.7d). The cell
  // the cursor is on drives the comment field in the header row.
  const [cellComments, setCellComments] = useState([])
  const [commentCell, setCommentCell] = useState(null)
  const commentInputRef = useRef(null)
  // Keyboard-shortcuts help popover (Markus, same design as Konten's own
  // (i) icon) — hover shows the list, Ctrl+I toggles it without the mouse,
  // Escape closes it.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
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
  const gridWrapperRef = useRef(null)
  // The most recently focused *month* column (m1..m12) — every other
  // column redirects focus back here (below), so this is always a real,
  // editable column, never one of the suppressed ones. Used to restore the
  // cursor to the *same column* it was already in whenever a row-changing
  // action (collapsing a block, removing a line, adding one) has to move
  // focus to a different row (Sept 2026, Markus: several requests all
  // boiling down to "keep me in the same column" — previously every such
  // restore hardcoded 'm1').
  const focusedColIdRef = useRef('m1')
  // The row half of the same tracking — kept separately from
  // `pendingFocusRef` (which is a one-shot claim, cleared once used) since
  // this one needs to persist indefinitely as "wherever the cursor last
  // genuinely was," for the frozen-cursor mitigation below.
  const lastFocusedRowIdRef = useRef(null)
  // The grid loses real browser focus entirely once a modal (add or
  // remove-confirm) opens and then closes — arrow keys stopped doing
  // anything, or scrolled the page instead, until the grid was clicked
  // again (Markus, Sept 2026, two separate reports: after closing the
  // delete-confirmation modal, and after creating a new breakdown line).
  // `focusRowNow()` handles the immediate case (the target row still
  // exists synchronously — a plain cancel, or a fresh add-modal open);
  // `pendingFocusRef` (`{ rowId, colId }`) handles the case where the row
  // doesn't exist yet/anymore at the moment of the action (a newly created
  // line, or the block's top-line row after its last line was just removed
  // or its block just collapsed) — set right before the write, picked up
  // once `rowData` actually contains the target row by the settle effect
  // below, the same "wait for the real row set to settle rather than
  // guess" pattern Konten.jsx's own pendingFocusIdRef already established
  // for the same underlying problem.
  const pendingFocusRef = useRef(null)
  // A *separate*, longer-lived claim from pendingFocusRef, on purpose (see
  // claimPendingFocus's own comment below for why one claim wasn't enough).
  const pendingScrollRef = useRef(null)
  // Bumped by onGridReady (below) — see its own comment on why the settle
  // effect needs this second trigger alongside `rowData`.
  const [gridReadyTick, setGridReadyTick] = useState(0)
  function currentScrollTop() {
    return gridWrapperRef.current?.querySelector('.ag-body-vertical-scroll-viewport')?.scrollTop ?? null
  }
  function restoreScrollTop(value) {
    if (value == null) return
    const el = gridWrapperRef.current?.querySelector('.ag-body-vertical-scroll-viewport')
    if (el) el.scrollTop = value
  }
  function focusRowNow(rowId, colId = focusedColIdRef.current) {
    const node = gridApiRef.current?.getRowNode(rowId)
    if (node) gridApiRef.current.setFocusedCell(node.rowIndex, colId, node.rowPinned)
  }
  // Tab with nothing focused (lib/screenCursor.js, App.jsx): the remembered
  // cell if it still exists, else the first month cell of the first row in
  // view.
  function placeCursorFromTab() {
    const api = gridApiRef.current
    if (!api) return false
    const rememberedId = lastFocusedRowIdRef.current
    if (rememberedId && api.getRowNode(rememberedId)) {
      focusRowNow(rememberedId, focusedColIdRef.current)
      return true
    }
    const row = api.getFirstDisplayedRowIndex()
    if (row == null || row < 0) return false
    api.setFocusedCell(row, focusedColIdRef.current)
    return true
  }
  const placeCursorRef = useRef(placeCursorFromTab)
  placeCursorRef.current = placeCursorFromTab
  useEffect(() => registerScreenCursor('verlauf', () => placeCursorRef.current()), [])
  // Claiming focus also snapshots the current scroll position, restored on
  // every `rowData` change for a couple of seconds afterward (Markus, twice
  // now: "after creating a breakdown row, the grid still jumps all the way
  // back to the top" — still true after a first attempt that only restored
  // scroll *once*, right after focus itself landed). Root cause, found on
  // this second pass: adding a breakdown line is two genuinely separate
  // Firestore writes a moment apart — creating the tag document, then
  // writing the budget documents — each landing via its own `onSnapshot` at
  // a slightly different time in real usage (a disposable test harness
  // with a synchronous mock Firestore batched both into one render and
  // never caught this the first time). Each write resets AG Grid's own
  // scroll position as a side effect of rebuilding `rowData`, so a claim
  // that fires once and clears itself only ever catches the *first* of the
  // two resets. `pendingScrollRef` is a second, longer-lived claim
  // specifically because of this — cleared by its own expiry, not by being
  // "used" once, since there's no reliable way to know in advance how many
  // separate row-data rebuilds one user action will actually trigger.
  function claimPendingFocus(rowId, colId = focusedColIdRef.current) {
    pendingFocusRef.current = { rowId, colId }
    pendingScrollRef.current = { value: currentScrollTop(), until: Date.now() + 2000 }
  }

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_PLAN0_KEY, showPlan0 ? '1' : '0')
    } catch {
      // Per-device convenience only — nothing to recover from here.
    }
  }, [showPlan0])

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_PLANUNG_KEY, showPlanung ? '1' : '0')
    } catch {
      // Per-device convenience only — nothing to recover from here.
    }
  }, [showPlanung])

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_BREAKDOWNS_KEY, showBreakdowns ? '1' : '0')
    } catch {
      // Per-device convenience only — nothing to recover from here.
    }
  }, [showBreakdowns])

  // Same Ctrl/Cmd+I toggle + capture-phase Escape as Konten.jsx's own
  // shortcuts popover — see that file's own comment on why capture phase
  // matters (winning the race against other things that also want Escape).
  // Also Ctrl+Shift+D (Markus: "assign ctrl+shift+d to aufschlüsselung
  // anzeigen check box") and Ctrl+P ("assign ctrl+p to plan0 anzeigen") —
  // global, not scoped to a grid cell, so they work regardless of where
  // the cursor currently is, same as the checkboxes themselves. Ctrl+Shift+D
  // reuses the checkbox's own onChange logic exactly (clearing
  // blockOverrides too), not just the bare setShowBreakdowns toggle.
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }
      if (e.key === 'Escape' && shortcutsOpen) {
        e.stopPropagation()
        setShortcutsOpen(false)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setShowBreakdowns((v) => !v)
        setBlockOverrides(new Map())
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setShowPlan0((v) => !v)
        return
      }
      // Ctrl+K (Markus, Oct 2026): into the comment box for the cell the
      // cursor is on; Enter/Esc there hand the cursor back to that cell.
      if (active && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        const field = commentInputRef.current
        if (!field || field.disabled) return
        e.preventDefault()
        field.focus()
        field.setSelectionRange(field.value.length, field.value.length)
        return
      }
      // Ctrl+Q (Markus, Oct 2026): same as clicking the Unterkategorie name
      // of the row the cursor is in — opens Quickview for it. Only while
      // Verlauf is the visible screen (it stays mounted when hidden).
      if (active && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'q') {
        const row = gridApiRef.current?.getRowNode(lastFocusedRowIdRef.current)?.data
        if (!row?.targetId) return
        e.preventDefault()
        onOpenQuickview?.({ kind: row.targetKey === 'categoryId' ? 'category' : 'tag', id: row.targetId })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [shortcutsOpen, active, onOpenQuickview])

  useEffect(() => {
    if (!confirmRemoveRow) return
    const onKeyDown = (e) => {
      // Enter confirms the same as clicking Entfernen (Markus: "the modal
      // needs to be responsive to the enter key"); Escape cancels, same as
      // Abbrechen — both restore focus to the grid via closeConfirmRemove/
      // confirmRemove below rather than leaving it stranded on whatever
      // the modal itself last had.
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmRemove()
      } else if (e.key === 'Escape') {
        closeConfirmRemove()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmRemoveRow])

  // The grid stays fully interactive underneath either modal by default —
  // a click or arrow key could still move the cursor or start editing a
  // cell behind the overlay (Markus: "while i am in the modal, i should
  // not be able to move the cursor with the arrow keys or make any edits
  // to the grid"). `inert` (a real HTML attribute, not a React prop here
  // since it needs to toggle on an already-mounted DOM node reliably)
  // makes the whole grid subtree genuinely non-interactive and
  // non-focusable for as long as either modal is open — not just visually
  // covered by the overlay.
  useEffect(() => {
    const el = gridWrapperRef.current
    if (!el) return
    el.inert = Boolean(confirmRemoveRow || addModalTarget)
  }, [confirmRemoveRow, addModalTarget])

  // A mitigation, not a proven root-cause fix, for a real but hard-to-pin-
  // down report (Markus: "sometimes i am unable to move the cursor with
  // the arrow keys... after switching screens via the hotkeys and placing
  // the cursor in any cell while accidentally placing and scrolling, the
  // cursor is frozen in place until i displace it again"). Real DOM focus
  // (not just AG Grid's own internal "focused cell" model) has to be on
  // the cell's own element for arrow keys to reach AG Grid's keyboard
  // handling at all — if focus ever ends up elsewhere (the safest general
  // explanation for "frozen until I click again," without being able to
  // reproduce the exact click-while-scrolling sequence directly), the very
  // next arrow-key press here notices real focus isn't inside the grid and
  // restores it to the last cell this screen actually knows about, instead
  // of silently doing nothing.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      const wrapper = gridWrapperRef.current
      if (!wrapper || wrapper.contains(document.activeElement)) return
      if (lastFocusedRowIdRef.current) focusRowNow(lastFocusedRowIdRef.current, focusedColIdRef.current)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Since App.jsx keeps both screens permanently mounted now, hidden via
  // plain CSS rather than unmounted, switching *back* to this screen is no
  // longer a fresh mount — the one-time initialFocus seed effect (above)
  // already fired long ago and won't fire again. Real DOM focus still
  // needs re-establishing explicitly on every switch, though: the browser
  // drops focus from an element the instant its container goes
  // `display: none`, and nothing restores it automatically just because
  // the container becomes visible again. Reuses the exact same restore the
  // frozen-cursor mitigation above already does — same target, same
  // reasoning, just a different trigger (becoming visible, not an arrow
  // key pressed while already visible but unfocused).
  useEffect(() => {
    if (active && lastFocusedRowIdRef.current) focusRowNow(lastFocusedRowIdRef.current, focusedColIdRef.current)
  }, [active])

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'tags'), (snap) => setTags(snap.docs.map((d) => d.data()))),
      // Soft-deleted transactions (spec.md §2.9a) never count toward any
      // actual — same rule as Konten's own activeTransactions (real bug
      // found Sept 2026 while building Planung: Verlauf never filtered them).
      onSnapshot(collection(db, 'transactions'), (snap) => {
        const next = snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt)
        syncWhenVisible(() => setTransactions(next))
      }),
      onSnapshot(collection(db, 'budgets'), (snap) => setBudgets(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'cellComments'), (snap) => setCellComments(snap.docs.map((d) => d.data()))),
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

  useEffect(() => {
    if (!year) return
    const unsub = onSnapshot(doc(db, 'settings', String(Number(year) - 1)), (snap) => {
      setLastYearClosedMonths(snap.exists() ? (snap.data().closedMonths ?? []) : [])
    })
    return unsub
  }, [year])

  function toggleMonthClosed(month) {
    const next = closedMonths.includes(month) ? closedMonths.filter((m) => m !== month) : [...closedMonths, month].sort((a, b) => a - b)
    setDoc(doc(db, 'settings', String(year)), { id: String(year), closedMonths: next }, { merge: true })
  }

  const yearNum = Number(year)

  // This year's comments by `rowId|colId`. cellClass callbacks read it via a
  // ref (the column defs aren't rebuilt for a comment change), and the
  // effect below forces just the commentable cells to redraw.
  const commentsByKey = useMemo(() => {
    const m = new Map()
    for (const c of cellComments) if (c.year === yearNum) m.set(`${c.rowId}|${c.colId}`, c.text)
    return m
  }, [cellComments, yearNum])
  const commentsRef = useRef(commentsByKey)
  commentsRef.current = commentsByKey
  useEffect(() => {
    gridApiRef.current?.refreshCells({ columns: [...MONTH_LABELS.map((_, i) => `m${i + 1}`), 'label'], force: true })
  }, [commentsByKey])

  // Empty text deletes the comment, so clearing the field never leaves a
  // blank document behind.
  function saveCellComment(cell, text) {
    const id = `${yearNum}__${cell.rowId}__${cell.colId}`
    const trimmed = text.trim()
    if (trimmed) setDoc(doc(db, 'cellComments', id), { id, year: yearNum, rowId: cell.rowId, colId: cell.colId, text: trimmed, updatedAt: Date.now() })
    else deleteDoc(doc(db, 'cellComments', id))
  }

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])
  const tagName = (id) => tagById.get(id)?.name ?? id

  // Prog (spec.md §3b) — shared with Planung via budget.js's own
  // progMonths(), so both screens compute it identically.
  function progMonths(targetId, plan1Months, isAllocation) {
    return progMonthsFor(isAllocation ? 'allocationTagId' : 'categoryId', targetId, plan1Months, closedMonths, yearNum, transactions, tags)
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
  // isn't collapsed — the parent-tag rollup headers (Plan1 only, spec.md
  // §2.7) and every breakdown line itself, grouped under its parent where
  // one exists, ordered by creation time otherwise (Sept 2026, Markus: new
  // lines belong at the bottom, not sorted alphabetically in among the
  // existing ones — see createPlainGroupingTag()'s own `createdAt` note).
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
    // The top-line row's own breakdownActions cell always stays its own
    // unmerged span (Markus, second round: "keep the chevron next to
    // plan0 or plan1, do not combine it into the merged cells with the +
    // sign") — only the breakdown/rollup rows under it (below) share
    // `blockKey` to merge into one ✚ cell together.
    topRow.breakdownActionsSpanKey = topRow.rowId
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
    // Sorted by creation order, not alphabetically (Markus, Sept 2026: "new
    // breakdown lines should be added to the bottom of the list... not the
    // top") — see createPlainGroupingTag()'s own comment on why a tag
    // without a `createdAt` (every pre-existing one) sorts as if it were 0,
    // i.e. before every freshly created one, alphabetical only as a
    // tie-break among those.
    const byOrder = (a, b) => (tagById.get(a)?.createdAt ?? 0) - (tagById.get(b)?.createdAt ?? 0) || tagName(a).localeCompare(tagName(b))
    const parentIds = [...byParent.keys()].sort(byOrder)

    function breakdownRow(tagId) {
      const line = budgetBreakdownLineMonths(common.targetKey, common.targetId, tagId, planVersion, yearNum, budgets)
      return {
        ...common,
        rowId: `${rowIdBase}:${planVersion}:${tagId}`,
        rowLabel: isPlan0 ? 'Plan0-breakdown' : 'Plan1-breakdown',
        planVersion,
        isPlan0,
        blockKey,
        // Merges into the same breakdownActions cell as the top-line row
        // and every sibling breakdown/rollup row (above) — the group's
        // single ✚/chevron pair lives there now, not a per-line "add
        // after the last one" affordance.
        breakdownActionsSpanKey: blockKey,
        breakdownTagId: tagId,
        renameTagId: tagId,
        breakdownLabel: tagName(tagId),
        months: line.months,
        yearTotal: line.yearTotal,
      }
    }

    for (const parentId of parentIds) {
      const childIds = byParent.get(parentId).sort(byOrder)
      const plannedSum = (i) =>
        childIds.reduce(
          (sum, cid) => sum + budgetBreakdownLineMonths(common.targetKey, common.targetId, cid, planVersion, yearNum, budgets).months[i],
          0,
        )
      // Plan0's own rollup row is a plain sum of its children's *planned*
      // values, every month, never switching to a real actual — Plan0
      // never reflects actuals anywhere else in this screen either (its
      // top-line and breakdown rows both stay planned-only, always muted),
      // so its rollup shouldn't behave differently just because it's a
      // computed row (Sept 2026, Markus: "plan0 should also render dark
      // yellow rows" — corrected from the original "Plan1's own block
      // only" design once Markus reconsidered it).
      //
      // Real bug found and fixed here (Sept 2026, Markus: "none of the
      // bookings just has Schottland as a tag, they all have a child...
      // the dark yellow rows need to look for the parent tags plus pure
      // parent tags: Schottland:Anything + Schottland (only)") — the
      // actual-computation's own tag set was built from `childIds`, which
      // is deliberately narrower than "every real child of this parent": it
      // only ever includes a child that *already has its own planned
      // breakdown line* (that's what makes it show up as its own row at
      // all), never a child that only ever exists on real transactions
      // with no plan of its own. A real Schottland:Haustiere booking, with
      // no "Haustiere" breakdown line ever planned, was therefore silently
      // excluded from Schottland's own rollup actual — every closed month
      // whose real spending happened to land entirely on never-planned
      // children summed to 0. Fixed by widening the *actual*-side tag set
      // (not the *displayed rows*, which correctly stay scoped to childIds
      // — a row needs a plan value to show/edit in the first place) to
      // every tag in the whole app whose own `parentTag` is this group,
      // planned or not.
      const allRealChildIds = tags.filter((t) => t.parentTag === parentId).map((t) => t.id)
      const tagIdSet = new Set([parentId, ...allRealChildIds])
      const rollupMonths = Array.from({ length: 12 }, (_, i) => {
        if (isPlan0 || !closedMonths.includes(i + 1)) return plannedSum(i)
        const month = i + 1
        // Real bug fixed here (Sept 2026, Markus: "the übergruppe
        // autocalculated rows dont show the totals for checked months
        // while they should") — a Rücklagen (allocationTagId) breakdown's
        // own rollup used to hardcode 0 for a closed month instead of
        // computing anything real, since only the category side had an
        // actual-computation function at all.
        return common.targetKey === 'categoryId'
          ? breakdownGroupMonthActual(common.targetId, tagIdSet, yearNum, month, transactions)
          : breakdownGroupAllocationMonthActual(common.targetId, tagIdSet, yearNum, month, transactions, tags)
      })
      out.push({
        ...common,
        rowId: `${rowIdBase}:${planVersion}:rollup:${parentId}`,
        rowLabel: 'Rollup',
        isPlan0,
        blockKey,
        breakdownActionsSpanKey: blockKey,
        // Just the Übergruppe's own name now (Markus: "remove the
        // (automatisch) behind the übergruppe label") — the row's own
        // tint/style already distinguishes it as the computed rollup,
        // the suffix was redundant.
        renameTagId: parentId,
        breakdownLabel: tagName(parentId),
        months: rollupMonths,
        yearTotal: rollupMonths.reduce((a, b) => a + b, 0),
      })
      childIds.forEach((tagId) => out.push(breakdownRow(tagId)))
    }
    const standaloneSorted = [...standalone].sort(byOrder)
    standaloneSorted.forEach((tagId) => out.push(breakdownRow(tagId)))
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
    const progRowId = `${rowIdBase}:Prog`
    const rows = [
      { ...common, rowId: progRowId, rowLabel: 'Prog', months: prog, yearTotal: prog.reduce((a, b) => a + b, 0), breakdownActionsSpanKey: progRowId },
    ]
    const plan1Rows = planVersionRows(common, rowIdBase, 'plan1', plan1Top)
    rows.push(...plan1Rows)
    if (showPlan0) {
      const plan0Top = budgetTopLineMonths(targetKey, targetId, 'plan0', yearNum, budgets)
      rows.push(...planVersionRows(common, rowIdBase, 'plan0', plan0Top))
      // The last row of Plan1's own group gets the lighter Plan1/Plan0
      // divider (blockBorderStyle() above) — only meaningful when Plan0's
      // group actually follows it in this same block.
      plan1Rows.at(-1).isPlan1GroupEnd = true
    }
    // Last year's yearly totals for the "Planung" column — one figure each
    // for Prog, Plan1 and Plan0 (never for breakdown/rollup rows, Markus:
    // "don't show split line values"), computed exactly as this screen
    // would for that year itself.
    if (showPlanung) {
      const lastYear = yearNum - 1
      const lastPlan1 = budgetTopLineMonths(targetKey, targetId, 'plan1', lastYear, budgets)
      const lastProg = progMonthsFor(targetKey, targetId, lastPlan1.months, lastYearClosedMonths, lastYear, transactions, tags)
      for (const r of rows) {
        if (r.rowLabel === 'Prog') r.lastYearTotal = lastProg.reduce((a, b) => a + b, 0)
        else if (r.rowLabel === 'Plan1') r.lastYearTotal = lastPlan1.yearTotal
        else if (r.rowLabel === 'Plan0') r.lastYearTotal = budgetTopLineMonths(targetKey, targetId, 'plan0', lastYear, budgets).yearTotal
      }
    }
    // Marks the actual first row of this block after every filter above
    // has already applied — used below to draw a strong boundary line at
    // each block's own top edge (Sept 2026, Markus — see
    // blockBorderStyle()'s own comment for why only the top edge, not
    // also the bottom, draws this).
    rows[0].isFirstOfBlock = true
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
  // Renaming a breakdown line (or its Übergruppe) in place (Oct 2026, Markus):
  // it renames the *tag* itself — the id never changes, so every booking,
  // budget row and filter that points at it follows automatically (spec §3i:
  // rename is always safe). The name changes everywhere that tag is shown
  // (Konten's Tags column, Quickview, Außenstände, other categories/years
  // that use the same tag). Refused when empty or when a sibling under the
  // same parent already has that name (it would look like a duplicate).
  function renameTag(tagId, rawName) {
    const result = validateTagRename(tags, tagId, rawName)
    if (!result.ok) {
      if (TAG_RENAME_MESSAGES[result.reason]) window.alert(TAG_RENAME_MESSAGES[result.reason])
      return false
    }
    setDoc(doc(db, 'tags', tagId), { ...tagById.get(tagId), name: result.name })
    return true
  }

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
      // New this round (Markus: "new breakdown lines should be added to
      // the bottom of the list... not the top") — breakdown/rollup
      // ordering below sorts by this instead of alphabetically. A tag
      // without one (every pre-existing tag, migrated or created before
      // this round) sorts as if `createdAt: 0`, i.e. before every newly
      // created one — exactly "existing lines keep their old relative
      // order, new ones land at the bottom" with no migration needed.
      createdAt: Date.now(),
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

  // AddBreakdownModal's own onSubmit — `name` always becomes the line's own
  // tag; if `groupName` was also given, `name` is created/reused as a
  // *child* under that group instead (resolving the group by exact name
  // match against *every* tag, same global "reuse by exact name" rule
  // Konten's own createTag() applies, not just this category's own
  // parentOptions suggestions — see AddBreakdownModal's own comment on
  // willReuse for why that distinction matters). No group at all (Markus:
  // "I should be able to add a breakdown line without a parent") just
  // creates/reuses `name` itself as a standalone tag, same exact-match
  // reuse rule.
  async function handleAddBreakdownSubmit({ name, groupName }) {
    const target = addModalTarget
    setAddModalTarget(null)
    if (!target) return
    const findTopLevel = (n) => tags.find((t) => t.class === 'grouping' && !t.parentTag && t.name.toLowerCase() === n.toLowerCase())
    let tagId
    if (groupName) {
      const parent = findTopLevel(groupName)
      const parentId = parent ? parent.id : createPlainGroupingTag(groupName, null)
      const child = tags.find((t) => t.class === 'grouping' && t.parentTag === parentId && t.name.toLowerCase() === name.toLowerCase())
      tagId = child ? child.id : createPlainGroupingTag(name, parentId)
    } else {
      const existing = findTopLevel(name)
      tagId = existing ? existing.id : createPlainGroupingTag(name, null)
    }
    // Focus follows the newly created/reused line once it renders, in the
    // *same column* it was already in (Markus: "after creating a
    // breakdown row, prevent the screen from jumping somewhere else, stay
    // in place and place the cursor into the new row, same column as
    // before") — the settle effect below picks this up once `rowData`
    // actually contains it.
    claimPendingFocus(`${target.targetKey}:${target.targetId}:${target.planVersion}:${tagId}`)
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

  // Closing the removal-confirmation modal without deleting — Escape or
  // Abbrechen — sends focus back to the line itself (still there, nothing
  // changed). Confirming instead removes it and, since that row won't
  // exist anymore once `rowData` updates, claims focus on the block's own
  // top-line row instead (always exists — even a just-emptied block folds
  // back to a real flat row, never disappears), *same column as before*
  // (Markus: "after deleting a breakdown row... set the cursor back into
  // the plan0 or plan1 cell of that hidden block, same column"), via
  // `claimPendingFocus()`, picked up by the settle effect above once the
  // removal actually lands.
  function closeConfirmRemove() {
    const row = confirmRemoveRow
    setConfirmRemoveRow(null)
    if (row) focusRowNow(row.rowId)
  }
  function confirmRemove() {
    const row = confirmRemoveRow
    if (!row) return
    setConfirmRemoveRow(null)
    claimPendingFocus(`${row.targetKey}:${row.targetId}:${row.isPlan0 ? 'Plan0' : 'Plan1'}`)
    removeBreakdownLine(row)
  }

  // Opens the "neue Aufschlüsselungszeile" modal for whichever block a ✚
  // click (or the Ctrl++ shortcut, below) came from — a plain top-line row
  // already carries its own planVersion; Prog doesn't (it has no plan
  // version of its own), so Ctrl++ pressed there defaults to Plan1, the
  // more common case.
  function openAddModalFor(row) {
    setAddModalTarget({ targetKey: row.targetKey, targetId: row.targetId, planVersion: row.planVersion ?? 'plan1', triggerRowId: row.rowId })
  }

  // Closing the add modal without submitting — Escape or Abbrechen — sends
  // focus straight back to whichever row's ✚ opened it (still there,
  // nothing changed), same "the cursor needs to be focused back on the
  // grid" fix as the removal modal below.
  function closeAddModal() {
    const triggerRowId = addModalTarget?.triggerRowId
    setAddModalTarget(null)
    if (triggerRowId) focusRowNow(triggerRowId)
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
    const allocationTags = tags.filter((t) => t.class === 'allocation' && isBudgetPlannedTag(t))
    const sortedAllocationTags = [...allocationTags].sort(
      (a, b) => ALLOCATION_TAG_ORDER.indexOf(a.id) - ALLOCATION_TAG_ORDER.indexOf(b.id),
    )
    for (const tag of sortedAllocationTags) {
      out.push(...planLineRows('Rücklagen', 'ruecklagen', tag.name, 'allocationTagId', tag.id, true))
    }
    // The very last row of the whole grid — the one exception that still
    // draws its own bottom edge (blockBorderStyle()'s own comment above)
    // since no further block exists to draw a top edge for it instead.
    if (out.length > 0) out.at(-1).isVeryLastRow = true
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planLineRows and everything it calls close over categories/tags/transactions/budgets/closedMonths/showPlan0/showBreakdowns/blockOverrides/showPlanung/lastYearClosedMonths/yearNum, all already current each render
  }, [categories, tags, transactions, budgets, closedMonths, showPlan0, showBreakdowns, blockOverrides, showPlanung, lastYearClosedMonths, yearNum])

  // The settle half of pendingFocusRef (see its own comment above) — fires
  // on every rowData change, no-ops instantly unless a focus claim is
  // actually pending, and leaves it pending (rather than clearing it on a
  // miss) so a claim made just before the row set catches up isn't lost.
  //
  // The scroll-restore half (pendingScrollRef) is deliberately separate and
  // runs unconditionally on every one of these renders while its own claim
  // hasn't expired yet — not just once, and not gated on the focus claim
  // above having anything left to do. One user action here can trigger
  // *several* separate rowData rebuilds a moment apart (creating a
  // breakdown line writes a tag document and a batch of budget documents
  // as two separate Firestore round-trips, each arriving via its own
  // `onSnapshot` at a slightly different real-world time), and each one
  // resets AG Grid's own scroll position independently — so this has to
  // keep re-fighting that reset for as long as more of them might still be
  // coming, not just the first time this effect happens to run afterward.
  useEffect(() => {
    if (pendingScrollRef.current) {
      if (Date.now() <= pendingScrollRef.current.until) {
        const value = pendingScrollRef.current.value
        requestAnimationFrame(() => restoreScrollTop(value))
      } else {
        pendingScrollRef.current = null
      }
    }
    if (!pendingFocusRef.current || !gridApiRef.current) return
    const { rowId, colId } = pendingFocusRef.current
    const node = gridApiRef.current.getRowNode(rowId)
    if (!node) return
    gridApiRef.current.setFocusedCell(node.rowIndex, colId, node.rowPinned)
    pendingFocusRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gridReadyTick is a second trigger alongside rowData (see onGridReady's own comment) — whichever of "data ready" and "grid ready" finishes last is what actually applies a pending claim
  }, [rowData, gridReadyTick])

  // Scroll back to the remembered top row once, after the rows are in and the
  // cursor restore has run (lib/uiState.js) — best effort.
  const scrollRestoredRef = useRef(false)
  useEffect(() => {
    const api = gridApiRef.current
    if (!api || scrollRestoredRef.current || rowData.length === 0) return
    scrollRestoredRef.current = true
    const top = ui.get('verlauf', 'topRow')
    if (typeof top !== 'number' || top <= 0) return
    setTimeout(() => {
      try {
        api.ensureIndexVisible(Math.min(top, api.getDisplayedRowCount() - 1), 'top')
      } catch {
        /* ignore */
      }
    }, 900)
  }, [rowData, gridReadyTick])

  // Restores the cursor to wherever it was when this screen was last left
  // (Markus: "generally, save the cursor position both in konten and
  // verlauf, and place the cursor there again upon switching") — `App.jsx`
  // holds the actual saved position across a full unmount/remount (this
  // component's own state/refs don't survive switching screens and back,
  // since `App.jsx` conditionally renders only the active one). Claimed
  // once, on mount, through the exact same settle mechanism as every other
  // focus restore here — no special-casing needed, it just waits for
  // `rowData` to contain the saved row the same way a freshly added line
  // does.
  useEffect(() => {
    if (initialFocus?.rowId) claimPendingFocus(initialFocus.rowId, initialFocus.colId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, deliberately ignoring subsequent initialFocus prop changes (this screen owns the position from here on, via onFocusChange)
  }, [])

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
      cellClass: (p) =>
        `text-right tabular-figure${p.data.rowLabel?.includes('breakdown') || p.data.rowLabel === 'Rollup' ? ' text-xs' : ''}${
          commentsRef.current.has(`${p.data.rowId}|m${i + 1}`) ? ' has-cell-comment' : ''
        }`,
      cellStyle: (p) => {
        const isClosed = closedMonths.includes(i + 1)
        // Real vertical centering (Markus, Sept 2026: "center the text /
        // values inside the breakdown rows vertically, like all other
        // rows") — turned out to be a pre-existing gap on *every* row, not
        // something breakdown rows were specifically missing: AG Grid's
        // own default cell isn't flex-centered here at all (confirmed via
        // harness — `display: block`, text sits at the top of the line
        // box, a few px of empty space left at the bottom always). Only
        // ever visible on a breakdown row because its shorter 22px height
        // (getRowHeight, below) makes the same few px a much bigger
        // fraction of the row. `justifyContent: 'flex-end'` keeps this
        // column's own right alignment (`text-right`, cellClass) once
        // `display: flex` is what's actually positioning the content, not
        // `text-align` anymore.
        const style = {
          color: `var(${monthTextColorVar(p.data.rowLabel, isClosed, p.data.isPlan0)})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          ...blockBorderStyle(p.data),
        }
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
        // Narrowed further (40→28px, Markus, Sept 2026: "reduce the width
        // of the kategory column, allow line breaks within") — a long
        // group name (e.g. "Kommunikation") now wraps onto a second line
        // instead of needing the column wide enough for its longest name
        // in one line.
        width: 28,
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
        // constituent row the way an ordinary column gets), and every
        // block boundary is now only ever drawn from the *next* block's
        // own top edge anyway (blockBorderStyle()'s own comment on why —
        // avoids doubling up two separate 1px borders into one that reads
        // ~2px thick). Only the very last row of the *entire* grid draws
        // its own bottom edge instead, which these two spanned columns
        // can't reach (their own cellStyle never sees that row as the
        // anchor of its own span) — a small, accepted cosmetic gap at the
        // table's very outer corner, not a real block boundary.
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`, borderTop: blockBorderStyle(p.data).borderTop }),
        // Vertical text via `writing-mode` (Markus, Sept 2026: "allow line
        // breaks within" — was a `rotate(-90deg)` transform on an ordinary
        // horizontal span before, which can't wrap: rotating a box doesn't
        // change its own layout, only how it's painted, so `nowrap`
        // horizontal text stayed exactly as wide as its longest word
        // regardless of the rotation). `vertical-rl` + `rotate(180deg)` is
        // the standard cross-browser way to get top-to-bottom text that
        // still *reads* bottom-to-top like the old transform did (Markus's
        // own already-approved reading direction) — and because it's real
        // vertical layout, not a painted rotation, normal word-wrapping
        // applies along the column's own (now narrower) width, exactly
        // like wrapping horizontal text would along its own height.
        cellRenderer: (p) => (
          <div className="flex h-full w-full items-center justify-center overflow-visible py-1">
            <span
              className="text-center font-bold"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', wordBreak: 'break-word' }}
            >
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
        // Narrowed 170→145px to help fund the € total column's own widening
        // (Markus, Sept 2026: "totals column is too narrow, increase its
        // width... at the cost of column unterkategorie" — paired with real
        // text-wrapping so a longer subcategory name still reads fully,
        // just over two lines now instead of needing the column wide
        // enough for its longest name on one line).
        width: 145,
        suppressNavigable: true,
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`, borderTop: blockBorderStyle(p.data).borderTop }),
        // Vertically centered within its own spanned (merged) cell (Markus)
        // — AG Grid's default cell rendering doesn't center content inside
        // a tall spanned cell on its own. `whiteSpace: normal` overrides
        // AG Grid's own default single-line cell text (nowrap + ellipsis)
        // so a name too long for one line wraps instead of clipping.
        // Clicking the name opens Quickview with that subcategory (or, in the
        // Rücklagen section, that allocation tag) pre-selected (Markus, Oct 2026).
        cellRenderer: (p) => (
          <div
            className="flex h-full w-full cursor-pointer items-center hover:underline"
            style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
            title="In Quickview öffnen"
            onClick={() => onOpenQuickview?.({ kind: p.data.targetKey === 'categoryId' ? 'category' : 'tag', id: p.data.targetId })}
          >
            {p.value}
          </div>
        ),
      },
      {
        headerName: '',
        colId: 'breakdownActions',
        // The span key *plus* the block's expanded state (Oct 2026, Markus:
        // "pressing on the chevrons, I cannot unhide the split lines
        // anymore"). AG Grid only re-renders a cell when its value changes,
        // and the bare span key never does — so after a collapse the chevron
        // kept showing ▾ with a stale `row.blockExpanded`, and the next click
        // "collapsed" the already-collapsed block again. Only a top-line row
        // carries `blockExpanded`, so every breakdown/rollup row of one
        // block still gets the identical value and still merges (spanRows).
        valueGetter: (p) =>
          p.data.breakdownActionsSpanKey + (p.data.blockExpanded === undefined ? '' : p.data.blockExpanded ? '#open' : '#closed'),
        spanRows: true,
        pinned: 'left',
        width: 26,
        suppressNavigable: true,
        // A spanned cell's own cellStyle only ever sees the *anchor* (the
        // span's first) row's data — same caveat as Kategorie/
        // Unterkategorie above. That anchor is never the block's actual
        // *last* row once a span covers more than one row (the last
        // breakdown line is), so `blockBorderStyle()`'s own borderBottom
        // only draws correctly for a genuinely unmerged (single-row) span
        // here — harmless, since this column was never asked to carry the
        // category-boundary line the way Kategorie/Unterkategorie were.
        cellStyle: (p) => ({ backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`, ...blockBorderStyle(p.data) }),
        // The add/expand affordances only now — the trashcan moved to its
        // own pinned-*right* column below (Markus, Sept 2026: "place the
        // trashcan icons to the right of the months columns like in
        // konten," which keeps its own delete column separate from the
        // split/expand column the same way). Mirrors Konten.jsx's own
        // pinned "split" column conventions on purpose (✚ to add, a
        // chevron to expand/collapse). **The chevron always stays on its
        // own top-line row's own cell, never merged (Markus, second round:
        // "keep the chevron next to plan0 or plan1, do not combine it into
        // the merged cells with the + sign")** — a first pass had the
        // top-line row share one merged cell with its own breakdown/rollup
        // rows, showing chevron+✚ stacked together; `breakdownActionsSpanKey`
        // (above) now only merges a block's *breakdown/rollup rows* with
        // each other (the top-line row's own key is always just its own
        // rowId, an unmerged span of one) — the ✚ for adding another line
        // still shows once, centered across just those merged child rows,
        // it just no longer shares a cell with the chevron above it.
        cellRenderer: (p) => {
          const row = p.data
          if (row.rowLabel === 'Plan1-breakdown' || row.rowLabel === 'Plan0-breakdown' || row.rowLabel === 'Rollup') {
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
          if ((row.rowLabel === 'Plan1' || row.rowLabel === 'Plan0') && row.rowHasBreakdown) {
            return (
              <button
                type="button"
                title={row.blockExpanded ? 'Aufschlüsselung einklappen (Strg+D)' : 'Aufschlüsselung ausklappen (Strg+D)'}
                className="flex h-full w-full items-center justify-center text-base leading-none"
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
        // Navigable (Oct 2026, Markus): the cursor can reach the row names with
        // the arrow keys; Enter edits a breakdown/Übergruppe name (see below).
        // Brought back (Markus, Sept 2026 — spec.md §3b's own original
        // "third column... either the plan-line name (Prog/Plan1/Plan0)
        // or, for a breakdown row, that breakdown item's name" design,
        // dropped as redundant once font color told Prog/Plan1/Plan0 apart
        // — reinstated once breakdown lines needed *some* column to show
        // their own name in, since Unterkategorie stays one merged cell
        // across the whole block and can't do it). Just the text label
        // now, the € figure moved back to its own column ('label', below)
        // rather than the two-line squeeze this replaces. **Widened
        // 96→124px (Markus, Sept 2026: "increase the width of the plan1/
        // plan0/prog column to allow labels to show properly")** — a
        // longer breakdown-line name was clipping against `truncate`
        // (still kept as a safety net for a genuinely long one).
        width: 124,
        // Breakdown lines and their Übergruppe can be renamed by editing the
        // cell (double-click, like everywhere else); Prog/Plan1/Plan0 are fixed labels.
        editable: (p) => Boolean(p.data.renameTagId),
        valueSetter: (p) => {
          renameTag(p.data.renameTagId, p.newValue)
          return false // the new name arrives with the tag's own snapshot
        },
        cellClass: (p) => `truncate${p.data.rowLabel?.includes('breakdown') || p.data.rowLabel === 'Rollup' ? ' text-xs' : ''}`,
        cellStyle: (p) => {
          // Real vertical centering, same fix/reasoning as the month
          // columns' own cellStyle above — `justifyContent: 'flex-start'`
          // keeps this column's existing left alignment.
          const style = {
            backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`,
            color: `var(${p.data.rowLabel === 'Plan0' || p.data.rowLabel === 'Plan0-breakdown' ? '--color-text-muted' : '--color-text'})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            ...blockBorderStyle(p.data),
          }
          if (p.data.rowLabel === 'Rollup') {
            style.backgroundColor = 'var(--color-breakdown-rollup-tint)'
            if (p.data.isPlan0) style.fontStyle = 'italic'
          }
          if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown') {
            style.backgroundColor = 'var(--color-breakdown-tint)'
            if (p.data.rowLabel === 'Plan0-breakdown') style.fontStyle = 'italic'
          }
          return style
        },
        valueGetter: (p) => (p.data.breakdownLabel ?? p.data.rowLabel),
        // Prog/Plan1/Plan0 as small, soft chips instead of plain text (Oct
        // 2026, Markus: "less visible and intrusive") — muted text on a
        // faint translucent pill; Plan0 fainter still. Breakdown/rollup
        // rows keep their plain names.
        cellRenderer: (p) => {
          const l = p.data.rowLabel
          if (l !== 'Prog' && l !== 'Plan1' && l !== 'Plan0') return p.value
          return (
            <span
              className="rounded-full px-2 text-[11px] leading-5"
              style={{
                background: 'color-mix(in srgb, var(--color-surface) 55%, transparent)',
                color: 'var(--color-text-muted)',
                opacity: l === 'Plan0' ? 0.75 : 1,
              }}
            >
              {l}
            </span>
          )
        },
      },
      {
        // Last year's yearly totals (Oct 2026, Markus): sits between the
        // Prog/Plan1/Plan0 label and this year's total, shown only while the
        // "Planung" checkbox is on. One figure per Prog/Plan1/Plan0 row;
        // breakdown and rollup rows stay blank. Its own color (the app's
        // blue "computed" token) tells it apart from this year's figures.
        headerName: String(yearNum - 1),
        colId: 'lastYear',
        pinned: 'left',
        hide: !showPlanung,
        suppressNavigable: true,
        width: LAST_YEAR_WIDTH,
        // Header centered over its column (Oct 2026, Markus), same as the
        // month headers; the figures below stay right-aligned.
        headerClass: 'verlauf-month-header',
        cellClass: 'text-right tabular-figure',
        cellStyle: (p) => {
          const style = {
            backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`,
            color: 'var(--color-computed)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            // Trimmed side padding so a six-digit figure with its sign
            // ("-120.000") still fits the narrow column.
            paddingLeft: 4,
            paddingRight: 6,
            ...blockBorderStyle(p.data),
          }
          if (p.data.rowLabel === 'Rollup') style.backgroundColor = 'var(--color-breakdown-rollup-tint)'
          if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown') style.backgroundColor = 'var(--color-breakdown-tint)'
          return style
        },
        valueGetter: (p) => (p.data.lastYearTotal === undefined ? '' : formatMonthCell(p.data.lastYearTotal)),
      },
      {
        // This year's number in the header (Oct 2026, Markus) — next to
        // the "letztes Jahr" column's own header it reads as a pair.
        headerName: String(yearNum),
        colId: 'label',
        pinned: 'left',
        headerClass: 'verlauf-month-header',
        // Navigable now (Oct 2026, Markus): a total cell can carry a
        // comment like a month cell, so the cursor has to be able to land
        // on it. Read-only, no editor.
        // Sized to fit exactly what this column ever needs to show and no
        // more (Markus, Sept 2026: "reduce the width of the totals column.
        // it has to fit a six digit figure max incl. sign: 100.000 €
        // (positive) or -60.000 € (negative)") — narrowed from the
        // month-column-matching 128px down to 96px, still with room for
        // the trailing " €" the month columns never carry (spec.md §3b).
        // **Widened again the same round, 96→110px (Markus: "totals column
        // is too narrow, increase its width a slight little bit at the
        // cost of column unterkategorie")** — 96px still clipped a real
        // six-digit figure; funded by narrowing Unterkategorie instead of
        // widening the grid overall.
        // Same width as the "letztes Jahr" column (Oct 2026, Markus: "make
        // sure this year's and last year's totals column have the same
        // width"), and no € sign any more so it fits.
        width: LAST_YEAR_WIDTH,
        cellClass: (p) =>
          `text-right tabular-figure${p.data.rowLabel?.includes('breakdown') || p.data.rowLabel === 'Rollup' ? ' text-xs' : ''}${
            commentsRef.current.has(`${p.data.rowId}|label`) ? ' has-cell-comment' : ''
          }`,
        // The yearly total mixes closed and open months, so it doesn't get
        // the same per-month grey/black toggle the month columns do (that
        // rule is only meaningful per-month) — Plan0 (and its own
        // breakdown rows) stay grey, everything else reads as plain text.
        cellStyle: (p) => {
          // Real vertical centering, same fix/reasoning as the month
          // columns' own cellStyle above.
          const style = {
            backgroundColor: `var(${SECTION_TINT_VAR[p.data.section]})`,
            color: `var(${p.data.rowLabel === 'Plan0' || p.data.rowLabel === 'Plan0-breakdown' ? '--color-text-muted' : '--color-text'})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            // Trimmed side padding, same as the "letztes Jahr" column, so a
            // six-digit figure with its sign still fits the narrow column.
            paddingLeft: 4,
            paddingRight: 6,
            ...blockBorderStyle(p.data),
          }
          if (p.data.rowLabel === 'Rollup') {
            style.backgroundColor = 'var(--color-breakdown-rollup-tint)'
            if (p.data.isPlan0) style.fontStyle = 'italic'
          }
          if (p.data.rowLabel === 'Plan1-breakdown' || p.data.rowLabel === 'Plan0-breakdown') {
            style.backgroundColor = 'var(--color-breakdown-tint)'
            if (p.data.rowLabel === 'Plan0-breakdown') style.fontStyle = 'italic'
          }
          return style
        },
        valueGetter: (p) => (p.data.yearTotal === 0 ? '' : centsToWholeEuro(p.data.yearTotal)),
      },
      ...monthCols,
      {
        headerName: '',
        colId: 'breakdownDelete',
        pinned: 'right',
        // Widened to match Konten.jsx's own delete column exactly (26→52px,
        // Markus, Sept 2026: "make sure the trashcans are not covered by
        // the vertical scroll bar [...] see how you solved this in konten")
        // — confirmed via harness that the vertical scrollbar really does
        // overlay roughly the rightmost 16px of a pinned-right column in
        // this AG Grid version even though it's genuinely `pinned:
        // 'right'`; Konten's own column was simply always wide enough for
        // its centered icon to clear that zone with real margin, this one
        // wasn't (a narrower 48px left only ~1px of clearance — not worth
        // the risk on a different screen size or font).
        width: 52,
        resizable: false,
        suppressNavigable: true,
        // No section tint here (Markus, Sept 2026: "remove the background
        // tint from the trashcan column") — every other pinned column
        // keeps it, this one doesn't need to match since it's off on its
        // own past the month columns, not visually part of the same block.
        cellStyle: undefined,
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
  }, [closedMonths, budgets, tags, yearNum, showPlanung])

  // The comment field only works on a cell that is currently displayed.
  const commentRow = commentCell ? rowData.find((r) => r.rowId === commentCell.rowId) : null
  const activeCommentCell = commentRow ? commentCell : null
  const commentDescription = commentRow
    ? [
        commentRow.subcatName,
        commentRow.breakdownLabel,
        commentRow.rowLabel.replace('-breakdown', '').replace('Rollup', ''),
        commentCell.colId === 'label' ? String(yearNum) : MONTH_LABELS[Number(commentCell.colId.slice(1)) - 1],
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input type="checkbox" checked={showPlan0} onChange={(e) => setShowPlan0(e.target.checked)} />
          Plan0 anzeigen
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={showBreakdowns}
            onChange={(e) => {
              setShowBreakdowns(e.target.checked)
              // Real usage feedback (Markus): a block expanded/collapsed
              // manually stopped reacting to this checkbox at all
              // afterward, since its own override always won from then on
              // (blockOverrides' own comment above). Touching the checkbox
              // itself now clears every override — it's a fresh "set
              // everyone to this" action, not just a new default for
              // whoever hasn't been touched yet — so a manual per-block
              // peek stays possible, but doesn't survive the *next*
              // checkbox toggle.
              setBlockOverrides(new Map())
            }}
          />
          Aufschlüsselung anzeigen
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input type="checkbox" checked={showPlanung} onChange={(e) => setShowPlanung(e.target.checked)} />
          letztes Jahr
        </label>
        {/* Month-close "ok" switches now live in each month's own column
            header (MonthHeader, above) — moved there per Markus's request,
            closer to spec.md §3b's own mockup ("their own header row...
            directly under the month labels") than the separate toolbar row
            this replaces. */}

        {/* Keyboard-shortcuts help (Markus: "add an (i) hover info button
            top right listing all the shortcuts in this screen, same design
            as in konten") — identical structure/classes to Konten's own. */}
        {/* The comment field and the (i) icon share one `ml-auto` wrapper,
            same single-auto-margin rule as Konten's toolbar. */}
        <div className="ml-auto flex items-center gap-3">
        <CellCommentField
          cell={activeCommentCell}
          inputRef={commentInputRef}
          active={active}
          description={commentDescription}
          savedText={activeCommentCell ? (commentsByKey.get(`${activeCommentCell.rowId}|${activeCommentCell.colId}`) ?? '') : ''}
          onSave={saveCellComment}
          onDone={(cell) => focusRowNow(cell.rowId, cell.colId)}
        />
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setShortcutsOpen(true)}
            onMouseLeave={() => setShortcutsOpen(false)}
            title="Tastenkürzel (Strg+I)"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-computed)]"
          >
            i
          </button>
          {shortcutsOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text)] shadow-lg">
              <div className="mb-1.5 font-medium">Tastenkürzel</div>
              <ul className="space-y-1">
                <li>
                  <b>Strg++</b> — Aufschlüsselungszeile hinzufügen
                </li>
                <li>
                  <b>Strg+D</b> — Aufschlüsselung ein-/ausklappen
                </li>
                <li>
                  <b>Entf</b> — Aufschlüsselungszeile entfernen
                </li>
                <li>
                  <b>Strg+Umschalt+D</b> — Aufschlüsselung anzeigen
                </li>
                <li>
                  <b>Strg+P</b> — Plan0 anzeigen
                </li>
                <li>
                  <b>Strg+K</b> — Kommentar zur markierten Zelle schreiben (Enter = neue Zeile, Esc = speichern und zurück zur Zelle)
                </li>
                <li>
                  <b>Strg+Q</b> — Quickview für die Unterkategorie der aktuellen Zeile öffnen
                </li>
                <li>
                  <b>Strg+I</b> — diese Übersicht ein-/ausblenden
                </li>
              </ul>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* verlauf-grid: see the matching CSS rule in index.css — it
          suppresses AG Grid's own default per-row border (see the long
          comment on blockBorderStyle() above for why that border can't be
          reached from a cellStyle/getRowStyle override at all), leaving
          blockBorderStyle()'s own per-cell border as the only one drawn. */}
      <div ref={gridWrapperRef} className="verlauf-grid min-h-0 flex-1">
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
          onBodyScroll={(e) => {
            if (e.direction === 'vertical') ui.set('verlauf', 'topRow', e.api.getFirstDisplayedRowIndex())
          }}
          onGridReady={(p) => {
            gridApiRef.current = p.api
            // A fresh mount's own settle effect can otherwise run before
            // this ever fires — `gridApiRef.current` still null even after
            // a deferred setTimeout(0) (found via harness testing the
            // cross-screen restore: a brand new AG Grid instance's own
            // internal init takes longer than one macrotask tick, unlike
            // an existing grid just re-rendering with updated rowData).
            // Bumping this re-runs the settle effect once the API is
            // actually ready, same as `rowData` changing does once the
            // *data* is ready — whichever of the two finishes last is what
            // actually applies a pending claim.
            setGridReadyTick((t) => t + 1)
          }}
          // The cursor/focus rectangle should only ever land in a month
          // column (Markus) — suppressNavigable (above) keeps keyboard
          // Tab/arrow navigation from landing on the other pinned columns,
          // but a plain click still focuses whatever cell it hits
          // regardless (AG Grid's own onMouseDown calls focusCell()
          // unconditionally, with no suppressNavigable check at all — found
          // by reading its bundled source once suppressNavigable alone
          // turned out not to be enough). This redirects any such click
          // straight back to the *last real month column* (`focusedColIdRef`,
          // its own comment above) instead of always January — also where
          // `focusedColIdRef` itself gets updated, and where this screen's
          // own saved cursor position (`onFocusChange`, Markus: "save the
          // cursor position... place the cursor there again upon
          // switching") is reported up to `App.jsx`.
          // The cursor stays in the cells: Up from the first row no longer
          // jumps into the column headers (Oct 2026, Markus).
          suppressHeaderFocus
          onCellFocused={(e) => {
            if (e.rowIndex == null || !e.column) return
            const colId = e.column.getColId()
            if (['groupName', 'subcatName', 'breakdownActions', 'lastYear', 'breakdownDelete'].includes(colId)) {
              gridApiRef.current?.setFocusedCell(e.rowIndex, focusedColIdRef.current, e.rowPinned)
              return
            }
            focusedColIdRef.current = colId
            const rowId = gridApiRef.current?.getDisplayedRowAtIndex(e.rowIndex)?.data?.rowId
            if (rowId) {
              lastFocusedRowIdRef.current = rowId
              onFocusChange?.({ rowId, colId })
              // A name cell carries no comment (only numbers do).
              setCommentCell(colId === 'rowTitle' ? null : { rowId, colId })
            }
          }}
          // Del/Ctrl+D/Ctrl++ (Markus, Sept 2026) — all three act on
          // whichever row currently has the cursor/focus rectangle:
          // - Delete: only a real breakdown line can be removed this way
          //   (opens the same confirmation modal the trashcan does, not an
          //   instant delete — see confirmRemoveRow above).
          // - Ctrl+D ("details"; **was Ctrl+Tab, changed the same round —
          //   Markus: "ctrl+tab does not work", real browsers reserve it
          //   for switching tabs at the OS/window-manager level, below
          //   where a page's own JS can ever intercept it, unlike this
          //   confirmed-working replacement**): a real toggle from the
          //   Plan1/Plan0 top-line row now (Markus, second follow-up: "i
          //   need to be able to hide a breakdown block also from the
          //   plan0 or plan1 rows, not only unhide from there") — the
          //   first version only ever showed from there, never hid, since
          //   the chevron click already covered that case and the
          //   keyboard shortcut was built as "show from the top, collapse
          //   from within" without also asking whether the top row was
          //   already expanded. Pressed from anywhere within the
          //   breakdown rows (a line or its own rollup header) it still
          //   always collapses, same as before. A no-op from Prog (it has
          //   no plan version, so no single block it could unambiguously
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
            // !shiftKey excludes Ctrl+Shift+D (Aufschlüsselung anzeigen,
            // below) from also triggering this per-block shortcut.
            if (key?.toLowerCase() === 'd' && (p.event.ctrlKey || p.event.metaKey) && !p.event.shiftKey) {
              p.event.preventDefault()
              if (row.rowLabel === 'Plan1' || row.rowLabel === 'Plan0') setBlockExpanded(row.blockKey, !row.blockExpanded)
              else if (row.rowLabel === 'Plan1-breakdown' || row.rowLabel === 'Plan0-breakdown' || row.rowLabel === 'Rollup') {
                // Collapsing moves the focused row itself out of the row
                // set, so the cursor lands on the block's own top-line row
                // instead — *same column* as before (Markus: "after hiding
                // a breakdown block with ctrl+d, set the cursor back into
                // the plan0 or plan1 cell of that hidden block, same
                // column").
                claimPendingFocus(`${row.targetKey}:${row.targetId}:${row.isPlan0 ? 'Plan0' : 'Plan1'}`)
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
          // Stops AG Grid auto-scrolling to the very top on every rowData
          // change — the real root cause of the scroll-jump-on-add bug
          // (Markus, three rounds running: "the grid still jumps... please
          // check again," "it immediately jumps back to the correct
          // position" once a workaround existed). A `rowData` *prop* change
          // (even with `getRowId` matching every row) is still treated as
          // "a whole new dataset" at this level of AG Grid, which
          // auto-scrolls to the top by default unless told not to
          // (`suppressScrollOnNewData`, a plain grid option, confirmed in
          // AG Grid's own bundled source: `scrollToTopIfNewData()`, gated
          // on exactly this flag) — a much better fix than reacting to the
          // reset after it's already visibly happened (the previous
          // approach, `pendingScrollRef` below, kept as a defensive
          // fallback in case some other path still triggers a reset this
          // doesn't cover, but no longer doing the actual work in the
          // common case).
          suppressScrollOnNewData
          // Double-click (or Enter/F2) opens the editor now, AG Grid's own
          // default — no `singleClickEdit` here. A first pass misread
          // Markus's original wording ("verlauf needs a double click to
          // enter a cell... apply the same principle in konten") as a
          // request for single-click, and added `singleClickEdit` here to
          // match Konten's own (at the time). Markus's later, unambiguous
          // correction ("konten is also still single click to enter...")
          // confirmed the opposite: single-click-to-edit was never wanted
          // in either screen, it should take a real double-click or Enter —
          // removed here, and from Konten.jsx too (see that file's own
          // grid props).
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
          onCancel={closeAddModal}
        />
      )}

      {/* Reuses NavShell.jsx's own Abmelden confirmation modal design
          (Markus, Sept 2026: "deleting a breakdown row should lead to a
          real confirmation modal... reuse the abmelden confirmation modal
          design") — a real, permanent loss of that line's planned
          figures, same "no undo" reasoning Abmelden's own modal already
          exists for. */}
      {confirmRemoveRow && (
        <div className="fixed inset-0 z-30 flex items-center justify-center" onClick={closeConfirmRemove}>
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
                onClick={closeConfirmRemove}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={confirmRemove}
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
