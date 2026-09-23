import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import CategoryEditor from './CategoryEditor'
import { db } from './firebase'
import KontoEditor from './KontoEditor'
import { jahresende } from './lib/balance'
import { syncAgGridColorScheme } from './lib/gridColorScheme'
import { withRemainder } from './lib/split'

ModuleRegistry.registerModules([AllCommunityModule])
syncAgGridColorScheme()

// "12,34" or "12.34" -> 1234 cents; null if unparseable. Markus types
// amounts in euros with a comma decimal (German/French convention), not
// the cents integers the schema stores (spec.md §2.6).
function parseEuroInput(s) {
  const cleaned = String(s).trim().replace(/[€\s]/g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-') return null
  const f = Number(cleaned)
  return Number.isNaN(f) ? null : Math.round(f * 100)
}

// Datum is a plain text cell, like Empfänger/Details — Markus specifically
// didn't want a picker (modal or dropdown) here at all. Accepts either the
// full stored "YYYY-MM-DD" as-is, or European shorthand — D.M / D.M. /
// D/M (day first, always — never the American month-first order) with the
// year taken from the app's own year selector (`fallbackYear`), or D.M.YYYY
// / D/M/YYYY with an explicit year (2-digit years read as 20XX). "/", "."
// and "-" are all accepted as separators for the shorthand forms; "-"
// specifically with a 4-digit first part is read as the stored ISO format
// instead, not a day.
function parseFlexibleDate(input, fallbackYear) {
  const parts = String(input ?? '')
    .trim()
    .split(/[./-]/)
    .filter(Boolean)
  let year, month, day
  if (parts.length === 3 && parts[0].length === 4) {
    ;[year, month, day] = parts.map(Number)
  } else if (parts.length === 3) {
    ;[day, month, year] = parts.map(Number)
    if (year < 100) year += 2000
  } else if (parts.length === 2) {
    ;[day, month] = parts.map(Number)
    year = Number(fallbackYear)
  } else {
    return null
  }
  if (!year || !month || !day || month < 1 || month > 12 || day < 1) return null
  // Rejects an impossible day for that month (e.g. 31.04) instead of
  // silently rolling over into the next month the way `new Date(...)` does.
  if (day > new Date(year, month, 0).getDate()) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// A brand-new manually entered transaction has no split yet — exactly one
// line, created lazily the first time Kategorie or a tag is set, mirroring
// whatever the transaction's own amount already is (spec.md §2.6's
// invariant: parent amountCents === Σ lines[].amountCents, trivially true
// for a single line).
function ensureLine(tx) {
  if (!tx.lines || tx.lines.length === 0) {
    tx.lines = [{ amountCents: tx.amountCents, categoryId: null, note: tx.detail || '', tags: [] }]
  }
  return tx.lines[0]
}

// Full-document overwrite (§3a: "simple edit-in-place, no audit trail
// needed, single user"). Two different mirroring directions depending on
// how many lines exist, both keeping the split-transaction invariant
// (§2.6: parent amountCents === Σ lines[].amountCents) true on every save,
// not just checked afterward:
// - Exactly one line: the parent is still authoritative (its Betrag cell
//   is directly editable) — mirror it down into the line.
// - More than one line (genuinely split): the parent becomes a fixed
//   total ("a cached total... every aggregation runs off lines[]", §2.6)
//   that splitting only ever redistributes, never changes. Every line
//   except the last is directly editable; the last is always recomputed
//   here as whatever's left — the "live, auto-generated remaining amount
//   line" §3a describes, made concrete at the one point it actually has
//   to be a real stored number rather than a live UI computation.
function persistTx(tx) {
  const next = { ...tx }
  if (next.lines?.length === 1) {
    next.lines = [{ ...next.lines[0], amountCents: next.amountCents }]
  } else if (next.lines?.length > 1) {
    next.lines = withRemainder(next.amountCents, next.lines)
  }
  // A manually entered row has no real bank text to protect (§3a's "raw
  // label must never be overwritten" is about imported rows specifically,
  // which already arrive with rawDescription set) — mirror Empfänger into
  // it instead of leaving it permanently blank.
  if (!next.rawDescription) next.rawDescription = next.displayLabel
  setDoc(doc(db, 'transactions', next.id), next)
}

// Konto's and Kategorie/Unterkategorie's Übernehmen buttons call these
// directly and persist immediately, rather than going through AG Grid's
// own getValue()/valueSetter commit pipeline the way every other column
// does — a confirmed bug (Markus: selecting an account/category and
// hitting Übernehmen silently did nothing). The column valueSetters below
// still exist and do the same thing, as a fallback for whatever other way
// a cell edit might end (Enter, tabbing away) — but Übernehmen no longer
// depends on that pipeline succeeding.
function applyKontoDirect(data, fromAccountId, toAccountId) {
  if (!fromAccountId && !toAccountId) return
  const tx = { ...data }
  const magnitude = Math.abs(tx.amountCents || 0)
  tx.fromAccountId = fromAccountId
  tx.toAccountId = toAccountId
  tx.amountCents = fromAccountId && toAccountId ? magnitude : fromAccountId ? -magnitude : magnitude
  persistTx(tx)
}
function applyCategoryDirect(data, categoryId) {
  if (!categoryId) return
  const tx = { ...data }
  const line = ensureLine(tx)
  tx.lines = [{ ...line, categoryId }]
  persistTx(tx)
}
// Same idea, scoped to one specific line of an already-split transaction
// (the expanded split-line rows' own Kategorie/Unterkategorie editor) —
// unlike applyCategoryDirect, this never collapses lines down to one.
function applyCategoryToLine(tx, lineIndex, categoryId) {
  if (!categoryId) return
  const next = { ...tx }
  next.lines = next.lines.map((l, i) => (i === lineIndex ? { ...l, categoryId } : l))
  persistTx(next)
}

// Split-transaction editing (§3a's auto-remainder mechanism): both of
// these are the exact same operation regardless of whether they're
// starting the first split or splitting the current remainder further —
// "creating a first sub-line... automatically leaves a second,
// system-maintained line... which can... be split further itself
// (creating a new remainder each time)". Appending a blank line always
// makes the line that was previously last become directly editable, and
// the newly appended one the new live remainder (persistTx recomputes it
// on every save) — one uniform rule instead of a special case for "the
// first split" vs. "splitting again."
function addSplitLine(tx) {
  const next = { ...tx }
  ensureLine(next)
  next.lines = [...next.lines, { amountCents: 0, categoryId: null, note: '', tags: [] }]
  persistTx(next)
}
// Removing any line (including the last) just leaves persistTx to
// recompute the new last line's amount from whatever remains — no special
// casing needed for which position was removed. Falling back to 0 or 1
// lines this way is exactly how a split collapses back to normal.
function removeLine(tx, lineIndex) {
  const next = { ...tx }
  next.lines = next.lines.filter((_, i) => i !== lineIndex)
  persistTx(next)
}

// Barkonten/Sparkonten/Geldanlage/Außenstände — Markus's own top-level
// mental model (spec.md §2.2's reportingGroup), not the technical account
// `group`. Außenstände (the seven receivable accounts) got its own block
// Sept 2026 — they're open claims/loans, not "real accounts" the same way
// a bank or cash balance is (spec.md §2.2's revision note).
const REPORTING_GROUPS = ['Barkonten', 'Sparkonten', 'Geldanlage', 'Außenstände']

function centsToEuro(cents) {
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Keeps a split transaction's line rows glued to their parent under
// *any* column's sort, not just Datum (Markus: sorting by a different
// column scattered them back to the top). AG Grid's default comparator
// sorts by whatever a column's own valueGetter returns, which is blank
// or a line's own distinct value for a line row — either way, not tied
// to the parent, so lines float away from it under most sorts. Given a
// function that computes a column's "parent-level" comparable value,
// this compares every row by *its own parent's* value — a line row and
// its parent always tie under this rule, and JS's stable sort (ES2019+)
// then preserves displayRows' own [parent, line0, line1, ...] build
// order for that tie, keeping them adjacent regardless of which column
// is actually driving the sort.
function glueToParent(getValue) {
  return (_valueA, _valueB, nodeA, nodeB) => {
    const a = getValue(nodeA.data.__isLine ? nodeA.data.__parent : nodeA.data)
    const b = getValue(nodeB.data.__isLine ? nodeB.data.__parent : nodeB.data)
    return a < b ? -1 : a > b ? 1 : 0
  }
}

export default function Konten() {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  // All-time, never year-scoped: balance() needs the full history back to
  // the one Jahresabschluß anchor (spec.md §2.1/§2.3/§2.8). At real-world
  // volume — a few thousand transactions a year, one household — this
  // stays trivial to hold in memory even as more years accumulate.
  const [transactions, setTransactions] = useState([])
  const [loaded, setLoaded] = useState({ accounts: false, categories: false, transactions: false })
  const [year, setYear] = useState(null)
  // Account filter: a distinct mechanism from a plain column filter (spec.md
  // §3a's filtering section) — Konto's own display is derived per row, so
  // the same account can show up on either side depending on that
  // transaction's direction. Picking an account here instead re-displays
  // every matching row from *that* account's own perspective.
  const [accountFilter, setAccountFilter] = useState(null)
  // Two-click delete: which row (if any) is currently armed, waiting for a
  // second click to actually confirm. See handleDeleteClick below.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const confirmTimeoutRef = useRef(null)
  const gridRef = useRef(null)
  const accountSelectRef = useRef(null)
  // The id (and target column) of a row waiting to be scrolled into view,
  // selected, and cell-focused once it actually settles into `rows` —
  // shared by addRow() and any cell edit that can move a row. Both write,
  // then wait: addRow's row only exists in Firestore, not yet round-tripped
  // back through onSnapshot into `rows`; a cell edit's row already exists
  // in `rows`, but if the edited column is part of the active sort (Datum
  // is, always), it can still move. AG Grid does its own immediate resort
  // right after the valueSetter mutates the row locally, but that's not
  // the *final* word — our own `rows` useMemo re-sorts again, from
  // scratch, once the Firestore round-trip lands the edit back through
  // onSnapshot, and its date-then-id tie-break for two same-date rows
  // isn't guaranteed to agree with whatever order AG Grid's own transient
  // in-place resort happened to leave them in (a stable sort keeps
  // whatever relative order they already had, not an id comparison).
  // Refocusing right after AG Grid's own resort (an earlier version of
  // this did exactly that) can therefore end up one row off from where
  // `rows` settles moments later — caught by Markus: two same-dated rows,
  // blue tint on one, cursor rectangle on the other. Waiting for `rows`
  // itself to contain the settled order, like addRow already did, is the
  // one point both agree on.
  const pendingFocusIdRef = useRef(null)
  const pendingFocusColRef = useRef('date')
  // null = focus the parent row once it settles (the normal case); a
  // number = focus that specific line index of the parent instead
  // (editing a split line's own field, per Markus — the cursor should
  // stay on the line just edited, not jump back to the parent row).
  const pendingFocusLineIndexRef = useRef(null)
  // Which split transactions currently show their line rows expanded
  // (§3a: "parent row with an expand chevron... plus its detail rows
  // revealed on expand"). Keyed by the real transaction id, not the
  // synthetic line-row ids — those only exist while expanded.
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'accounts'), (snap) => {
        setAccounts(snap.docs.map((d) => d.data()))
        setLoaded((l) => ({ ...l, accounts: true }))
      }),
      onSnapshot(collection(db, 'categories'), (snap) => {
        setCategories(snap.docs.map((d) => d.data()))
        setLoaded((l) => ({ ...l, categories: true }))
      }),
      onSnapshot(collection(db, 'transactions'), (snap) => {
        setTransactions(snap.docs.map((d) => d.data()))
        setLoaded((l) => ({ ...l, transactions: true }))
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts])
  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const accountName = (id) => accountById[id]?.name ?? id
  const categoryName = (id) => categoryById[id]?.name ?? id
  // Kategorie (the parent group, e.g. "Lebenshaltung") is derived/display
  // only — only the leaf Unterkategorie is ever stored (spec.md §2.6/§3a).
  const groupName = (id) => {
    const parentId = categoryById[id]?.parentCategoryId
    return parentId ? categoryName(parentId) : categoryName(id)
  }

  // The transaction's amount, signed relative to one specific account's own
  // position — the same magnitude-by-position rule balance() uses (§2.6),
  // applied here per row instead of summed over all rows.
  const signedFor = (tx, accountId) => {
    const magnitude = Math.abs(tx.amountCents)
    if (tx.fromAccountId === accountId) return -magnitude
    if (tx.toAccountId === accountId) return magnitude
    return null
  }

  // Each column's "parent-level" comparable/display value, extracted so
  // both its valueGetter (parent-row display) and its comparator (every
  // row, via glueToParent above) compute it exactly the same way — never
  // two parallel implementations that could quietly drift apart.
  const kontoValue = (t) => {
    if (accountFilter) {
      const outgoing = t.fromAccountId === accountFilter
      const other = outgoing ? t.toAccountId : t.fromAccountId
      if (!other) return '—'
      return (outgoing ? '→ ' : '← ') + accountName(other)
    }
    if (t.fromAccountId && t.toAccountId) {
      return `${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`
    }
    return accountName(t.fromAccountId ?? t.toAccountId)
  }
  const betragValue = (t) => signedFor(t, accountFilter ?? (t.fromAccountId ?? t.toAccountId))
  const kategorieValue = (t) => {
    const ids = [...new Set((t.lines ?? []).map((l) => l.categoryId).filter(Boolean))]
    if (ids.length === 0) return '—'
    const groups = [...new Set(ids.map(groupName))]
    return groups.length === 1 ? groups[0] : '(mehrere)'
  }
  const unterkategorieValue = (t) => {
    const ids = [...new Set((t.lines ?? []).map((l) => l.categoryId).filter(Boolean))]
    if (ids.length === 0) return '—'
    return ids.length === 1 ? categoryName(ids[0]) : '(mehrere)'
  }
  const tagsValue = (t) => [...new Set((t.lines ?? []).flatMap((l) => l.tags ?? []))].join(', ')

  // Persists, then defers to the same pendingFocusIdRef/rows effect addRow
  // uses (see its declaration above) to re-locate both the selection tint
  // and the focus rectangle together, once `rows` has actually settled —
  // not right away, which was one resort too early. A line row edits its
  // __parent (a real transaction) rather than itself — that's what
  // actually gets persisted — but the *cursor* should stay on the exact
  // line just edited, not jump back to the parent row (Markus). A pure
  // value edit (amount/category/note/tags) doesn't add or remove lines,
  // so the edited line's own index stays valid across the round-trip;
  // pendingFocusLineIndexRef carries it through to the effect below,
  // which looks the line back up by parent + index rather than by a
  // synthetic id (those now change on any add/remove — see displayRows).
  const handleCellValueChanged = (params) => {
    const tx = params.data.__isLine ? params.data.__parent : params.data
    persistTx(tx)
    pendingFocusIdRef.current = tx.id
    pendingFocusColRef.current = params.column.getColId()
    pendingFocusLineIndexRef.current = params.data.__isLine ? params.data.__lineIndex : null
  }

  // Adds a blank row right below whatever's currently selected in the
  // grid: same date (so it lands next to it once the grid re-sorts by
  // date), and an id whose timestamp suffix sorts after every row that
  // already exists on that date (rows sort by date, then id — §3a's
  // "confirmed column order" note doesn't specify insert position, this is
  // the natural reading of "below"). No selection -> falls back to today
  // (or this year's Jan 1 if today isn't in the year being viewed).
  // Pre-fills fromAccountId from the active account filter, if any, so the
  // new row is actually visible in a filtered view instead of vanishing
  // the moment it's created (it wouldn't match the filter otherwise).
  async function addRow() {
    const selected = gridRef.current?.api?.getSelectedRows()?.[0]
    const today = new Date().toISOString().slice(0, 10)
    const date = selected?.date ?? (year && today.startsWith(year) ? today : `${year}-01-01`)
    const id = `tx-manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    pendingFocusIdRef.current = id
    pendingFocusColRef.current = 'date'
    pendingFocusLineIndexRef.current = null
    await setDoc(doc(db, 'transactions', id), {
      id,
      date,
      fromAccountId: accountFilter ?? null,
      toAccountId: null,
      amountCents: 0,
      rawDescription: '',
      displayLabel: '',
      lines: [],
      detail: '',
      createdAt: Date.now(),
    })
  }

  // Hands the cursor back to the grid, landing on the Datum cell of
  // whichever row is roughly mid-viewport rather than the first/last one —
  // shared by the panel's Escape (clears the filter first) and Enter
  // (keeps it) key handling. Deferred a tick since clearing the filter
  // changes the row set and the grid only re-renders with it after the
  // caller's handler returns.
  function focusGridMidViewport() {
    setTimeout(() => {
      const api = gridRef.current?.api
      const first = api?.getFirstDisplayedRowIndex()
      const last = api?.getLastDisplayedRowIndex()
      if (first != null && first >= 0 && last != null && last >= 0) {
        const rowIndex = Math.floor((first + last) / 2)
        api.setFocusedCell(rowIndex, 'date')
        // Select the landing row explicitly rather than relying on
        // onCellFocused's selection side effect to fire in time — right
        // after a filter change (Escape/Enter from the panel both change
        // accountFilter first) the row set is still settling, and that side
        // effect isn't reliably in sync yet, which left a stale blue tint
        // on the row selected before Ctrl+K was pressed (caught by Markus,
        // screenshot showing two rows tinted at once).
        api.getDisplayedRowAtIndex(rowIndex)?.setSelected(true, true)
      }
    }, 0)
  }

  // Ctrl/Cmd+'+' triggers "+ Neue Buchung" (Markus's request). Note, not
  // hidden: Ctrl/Cmd+'+' is the browser's own zoom-in shortcut in Chrome/
  // Firefox/Safari, and browsers commonly refuse to let a page override or
  // suppress it (unlike most other shortcuts) — this listens for it
  // anyway, since worst case the browser also zooms and best case both
  // happen harmlessly, but it may not be fully reliable everywhere for
  // reasons outside the app's control. '=' is included since '+' usually
  // requires Shift, and keyboards/browsers report that combination either
  // way depending on layout. Skipped while a cell is being edited, so it
  // doesn't fire in the middle of typing a category/tag/etc.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key !== '+' && e.key !== '=') return
      if (gridRef.current?.api?.getEditingCells().length > 0) return
      e.preventDefault()
      addRow()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addRow closes over year/accountFilter, both already current each render
  }, [year, accountFilter])

  // Ctrl/Cmd+K always jumps into the pinned panel's account boxes, never
  // the plain <select> (Markus, correcting an earlier version of this) —
  // landing on the currently active filter's own button if one is set,
  // otherwise the first account overall. From there: arrow keys roam
  // (Session 15/16), Escape resets to "Alle Konten" and returns to the
  // grid, Enter keeps the highlighted filter and *also* returns to the
  // grid (added below) — so Ctrl+K, arrow, Enter, Ctrl+K again reopens
  // exactly where you left off, a closed loop.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return
      if (gridRef.current?.api?.getEditingCells().length > 0) return
      e.preventDefault()
      const target = accountFilter
        ? document.querySelector(`[data-account-id="${accountFilter}"]`)
        : document.querySelector('[data-group] ul button')
      target?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [accountFilter])

  // Two clicks, not a modal (Markus's call) — hard delete for now, not
  // §2.9a's planned soft-delete-with-recovery-window (that's Phase 1b).
  // Firestore's Point-in-Time Recovery (enabled since Phase 0, a 7-day
  // rolling window) is the real safety net behind this until then.
  function armDelete(id) {
    setConfirmDeleteId(id)
    clearTimeout(confirmTimeoutRef.current)
    confirmTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteId((cur) => (cur === id ? null : cur))
    }, 4000)
  }
  async function handleDeleteClick(id) {
    if (confirmDeleteId === id) {
      clearTimeout(confirmTimeoutRef.current)
      setConfirmDeleteId(null)
      await deleteDoc(doc(db, 'transactions', id))
    } else {
      armDelete(id)
    }
  }

  // Escape discharges an armed delete (Markus) regardless of where focus
  // currently is — arming can start from either the trashcan click or the
  // keyboard Delete key on a focused cell, so this listens globally rather
  // than only within the grid's own key handling.
  useEffect(() => {
    if (!confirmDeleteId) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        clearTimeout(confirmTimeoutRef.current)
        setConfirmDeleteId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDeleteId])

  // getRowStyle alone doesn't get re-evaluated for already-rendered rows
  // just because confirmDeleteId changed elsewhere in React state — force
  // AG Grid to re-ask for it whenever the armed row changes, so the
  // red warning tint (Markus) actually appears/disappears live.
  useEffect(() => {
    gridRef.current?.api?.redrawRows()
  }, [confirmDeleteId])

  const years = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 4)))
    return [...set].sort()
  }, [transactions])

  // Default to the most recent year once data has loaded; a manual pick
  // (below) always overrides this.
  useEffect(() => {
    if (year === null && years.length > 0) setYear(years[years.length - 1])
  }, [years, year])

  // AG Grid's own change detection is keyed on row-data identity, not on
  // "did some external value a valueGetter closes over change" — Konto and
  // Betrag both read `accountFilter` from closure (§3a's account filter),
  // and a plain columnDefs update doesn't reliably make the grid re-run
  // valueGetters for rows it already had cached from the *previous* filter
  // (caught directly by Markus: switching from one filtered account
  // straight to another, e.g. Bar Markus → Bar Julia, left stale values —
  // Betrag showing 0,00 and Konto showing the wrong direction for rows
  // that hadn't been re-evaluated against the new filter). Explicitly
  // telling the grid to recompute every visible cell whenever the filter
  // changes is the documented fix for a valueGetter with an external
  // dependency like this.
  useEffect(() => {
    gridRef.current?.api?.refreshCells({ force: true })
  }, [accountFilter])

  const rows = useMemo(() => {
    if (!year) return []
    return transactions
      .filter((t) => t.date.startsWith(year))
      .filter((t) => !accountFilter || t.fromAccountId === accountFilter || t.toAccountId === accountFilter)
      .slice()
      .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
  }, [transactions, year, accountFilter])

  // Once a pending row (addRow's new row, or a just-edited row that may
  // have moved) actually settles into `rows` — via the Firestore
  // round-trip through onSnapshot, never synchronously available right
  // after a write — scroll it into view and put the cell cursor on the
  // target column, selected too (the blue tint), so both always land on
  // the exact same row together. Not editing it (Markus, re: addRow: he
  // wants the focus rectangle there, ready for a single tap/Enter to open
  // per §1's singleClickEdit, not editing already forced open on arrival).
  useEffect(() => {
    const id = pendingFocusIdRef.current
    if (!id || !rows.some((r) => r.id === id)) return
    pendingFocusIdRef.current = null
    const colId = pendingFocusColRef.current
    const lineIndex = pendingFocusLineIndexRef.current
    pendingFocusLineIndexRef.current = null
    const api = gridRef.current?.api
    if (!api) return
    setTimeout(() => {
      let node = api.getRowNode(id)
      // A pending line index means the edit was on a specific split line
      // (Markus: stay there, don't jump to the parent) — find its row by
      // parent + index rather than reconstructing its synthetic id, which
      // now depends on the current line count too (see displayRows) and
      // isn't worth duplicating here. Falls back to the parent's own row
      // if that line somehow no longer exists (e.g. removed elsewhere in
      // the meantime).
      if (lineIndex != null) {
        let lineNode = null
        api.forEachNode((n) => {
          if (n.data?.__isLine && n.data.__parent.id === id && n.data.__lineIndex === lineIndex) lineNode = n
        })
        if (lineNode) node = lineNode
      }
      if (!node) return
      api.ensureNodeVisible(node, 'middle')
      // Selected (the blue tint), not just cell-focused (Markus) — this
      // also means the *next* "+ Neue Buchung" naturally inserts below
      // this new row too, chaining correctly when adding several in a row.
      node.setSelected(true, true)
      api.setFocusedCell(node.rowIndex, colId)
    }, 0)
  }, [rows])

  // What the grid actually renders: `rows` (real transactions) with each
  // expanded split transaction's lines interleaved right after it as
  // synthetic rows (§3a: "parent row... plus its detail rows revealed on
  // expand"). AG Grid Community has no master/detail row support (that's
  // an Enterprise feature) — this is the Community-tier equivalent,
  // feeding the grid one flat array where a "line row" is just an
  // ordinary row with `__isLine: true` that every column def below
  // renders/edits differently. `__parent` is a live reference into `rows`
  // (not a copy), so column defs read/mutate the real transaction object
  // directly, the same pattern already used for every other in-place
  // valueSetter mutation in this file.
  const displayRows = useMemo(() => {
    const out = []
    for (const tx of rows) {
      out.push(tx)
      if ((tx.lines?.length ?? 0) > 1 && expandedIds.has(tx.id)) {
        // The line count is baked into every line's own id here, not just
        // its index — a line has no stable id of its own in the schema
        // (§2.6), so removing/adding a line shifts every later line's
        // *index*, which otherwise means whatever row previously held
        // that index's id (e.g. the old last/remainder line) inherits a
        // *different* line's identity under AG Grid's own id-based row
        // reconciliation — it can't tell "this row moved" from "this id
        // now holds different content" (Markus: a stale leftover row after
        // deleting a non-last line). Baking the count in forces every line
        // row for this transaction to get a genuinely new id whenever the
        // split structure itself changes, so AG Grid fully rebuilds them
        // instead of trying to partially reconcile an ambiguous match —
        // ids stay stable (and updates stay smooth) across a pure value
        // edit, which doesn't change the count.
        tx.lines.forEach((_, i) => {
          out.push({ id: `${tx.id}::line::${i}::${tx.lines.length}`, __isLine: true, __parent: tx, __lineIndex: i })
        })
      }
    }
    return out
  }, [rows, expandedIds])

  // Confirmed column order (spec.md §3a): Datum → Konto → Empfänger →
  // Betrag → Kategorie → Unterkategorie → Details → Tags (plus a narrow,
  // unlabeled delete column at the end — not part of the spec'd order,
  // just an action). Konto is one merged column (not Konto1/Konto2 —
  // revised Sept 2026): the primary account with an arrow to the second
  // one for a transfer, unless an account filter is active, in which case
  // it shows the *other* side only (a single-account register view) and
  // Betrag is re-signed relative to the filtered account instead of the
  // row's own primary side. Only Unterkategorie is stored; Kategorie is
  // its derived parent, but both columns open the same cascading picker.
  //
  // Editing works the same whether or not an account filter is active
  // (rethought Sept 2026 — an earlier version disabled editing entirely
  // while filtered). The only genuinely filter-dependent things are what
  // Konto/Betrag *display*; neither actually needs editing disabled:
  // Konto's editor always edits the real fromAccountId/toAccountId
  // directly, regardless of what the cell shows when not being edited, and
  // Betrag's valueSetter below uses the same "reference account" the
  // display already uses (the filtered account, or Konto1 when unfiltered)
  // to interpret the typed sign — so both stay well-defined either way.
  // Filtering is in fact exactly when you're most likely reviewing and
  // fixing one account's own entries, so disabling editing there was
  // working against the feature's actual purpose.
  const columnDefs = useMemo(
    () => [
      {
        headerName: '',
        colId: 'split',
        width: 56,
        sortable: false,
        filter: false,
        suppressMovable: true,
        resizable: false,
        pinned: 'left',
        // The one control column for the whole split-transaction feature
        // (§3a's "expand chevron and an 'N Positionen' hint" plus the
        // auto-remainder mechanism's own add/remove actions), rather than
        // spreading these across other columns:
        // - Parent, not yet split (≤1 line): "✚" starts the first split
        //   (addSplitLine) and auto-expands, so the newly appended line is
        //   immediately visible without a second click.
        // - Parent, split (>1 lines): a chevron toggling expandedIds.
        // - A line row: "✕" removes just that line; the *last* line (the
        //   live remainder) also gets "✚" to split further — "or split
        //   further itself (creating a new remainder each time)".
        cellRenderer: (p) => {
          const row = p.data
          // Every button here goes through the same pendingFocusIdRef/rows
          // effect as a normal cell edit (see handleCellValueChanged) —
          // these are button clicks, not cell edits, so nothing else
          // would otherwise tell the grid which row to re-select once the
          // Firestore round-trip lands. Without this, AG Grid's own
          // selection state was left to drift across the rowData
          // replacement these actions cause, showing a stale blue tint on
          // some other row that happened to land at the same position
          // (Markus, second screenshot).
          if (row.__isLine) {
            const isLast = row.__lineIndex === row.__parent.lines.length - 1
            return (
              <div className="flex h-full items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeLine(row.__parent, row.__lineIndex)
                    pendingFocusIdRef.current = row.__parent.id
                    pendingFocusColRef.current = 'split'
                    pendingFocusLineIndexRef.current = null
                  }}
                  title="Position entfernen"
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-alert)]"
                >
                  ✕
                </button>
                {isLast && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      addSplitLine(row.__parent)
                      pendingFocusIdRef.current = row.__parent.id
                      pendingFocusColRef.current = 'split'
                      pendingFocusLineIndexRef.current = null
                    }}
                    title="Weiter aufteilen"
                    className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-computed)]"
                  >
                    ✚
                  </button>
                )}
              </div>
            )
          }
          const lineCount = row.lines?.length ?? 0
          if (lineCount > 1) {
            const expanded = expandedIds.has(row.id)
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpanded(row.id)
                }}
                title={expanded ? 'Einklappen' : `${lineCount} Positionen anzeigen`}
                className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)]"
              >
                {expanded ? '▾' : '▸'}
              </button>
            )
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                addSplitLine(row)
                setExpandedIds((prev) => new Set(prev).add(row.id))
                pendingFocusIdRef.current = row.id
                pendingFocusColRef.current = 'split'
                pendingFocusLineIndexRef.current = null
              }}
              title="Aufteilen"
              className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-computed)]"
            >
              ✚
            </button>
          )
        },
      },
      {
        field: 'date',
        headerName: 'Datum',
        width: 110,
        // Blank and non-editable for a line row — a split transaction has
        // exactly one date, at the parent level; only the economic
        // breakdown (category/tags/note/amount) splits across lines.
        valueGetter: (p) => (p.data.__isLine ? '' : p.data.date),
        editable: (p) => !p.data.__isLine,
        // Explicitly false, not left to infer — AG Grid samples this
        // column's own data to auto-detect a "cellDataType" when none is
        // set, and a plain ISO string like "2026-04-03" matches its own
        // built-in "dateString" type, which silently swaps in AG Grid's
        // own agDateStringCellEditor (a calendar popup) in place of the
        // plain text editor intended here — confirmed by reading AG Grid's
        // own DataTypeService source (dataTypeMatchers.dateString), and
        // exactly the "modal still opens" behavior Markus reported despite
        // no cellEditor being set on this column at all.
        cellDataType: false,
        // Plain text, like Empfänger/Details — no picker, modal or
        // dropdown at all (Markus, replacing what had been a three-select
        // popup). Accepts flexible European shorthand via
        // parseFlexibleDate; goes through the same default AG Grid text
        // editor + valueSetter pipeline Empfänger/Details already use
        // successfully (unlike the custom popup editors' getValue()/
        // stopEditing() pipeline, which confirmed wasn't reliable there).
        valueSetter: (p) => {
          const parsed = parseFlexibleDate(p.newValue, year)
          if (!parsed) return false
          p.data.date = parsed
          return true
        },
        // glueToParent, not the default value-based sort — every column
        // needs this, not just Datum (Markus: sorting by a different
        // column scattered line rows back to the top too) — see
        // glueToParent's own comment for why.
        comparator: glueToParent((t) => t.date),
        colId: 'date',
      },
      {
        headerName: accountFilter ? `Gegenkonto (${accountName(accountFilter)})` : 'Konto',
        // Blank and non-editable for a line row, same reasoning as Datum —
        // Konto is fixed at the parent level for a split transaction.
        valueGetter: (p) => (p.data.__isLine ? '' : kontoValue(p.data)),
        comparator: glueToParent(kontoValue),
        // A cellRenderer, not just the plain valueGetter string, so the
        // arrow is always the exact same glyph mirrored via CSS rather than
        // the → and ← Unicode characters — which, in the grid's font,
        // render at visibly different sizes (caught by Markus). Reads
        // p.data directly rather than re-parsing the value string.
        cellRenderer: (p) => {
          const t = p.data
          if (t.__isLine) return ''
          let other, pointsLeft
          if (accountFilter) {
            const outgoing = t.fromAccountId === accountFilter
            other = outgoing ? t.toAccountId : t.fromAccountId
            pointsLeft = !outgoing
          } else if (t.fromAccountId && t.toAccountId) {
            other = null // both names are shown as plain text below, no single "other"
            pointsLeft = false
          }
          if (accountFilter) {
            if (!other) return '—'
            return (
              <span className="inline-flex items-center gap-1">
                <span style={{ display: 'inline-block', transform: pointsLeft ? 'scaleX(-1)' : undefined }}>→</span>
                {accountName(other)}
              </span>
            )
          }
          if (t.fromAccountId && t.toAccountId) {
            return (
              <span className="inline-flex items-center gap-1">
                {accountName(t.fromAccountId)}
                <span style={{ display: 'inline-block' }}>→</span>
                {accountName(t.toAccountId)}
              </span>
            )
          }
          return accountName(t.fromAccountId ?? t.toAccountId)
        },
        // Editing sets fromAccountId/toAccountId directly, then re-derives
        // amountCents' sign convention (positive magnitude once both sides
        // are real accounts, natural sign for a single-sided row — §2.6),
        // keeping whatever magnitude was already there so switching Konto
        // never silently zeroes the amount.
        valueSetter: (p) => {
          const { fromAccountId, toAccountId } = p.newValue ?? {}
          if (!fromAccountId && !toAccountId) return false
          const magnitude = Math.abs(p.data.amountCents || 0)
          p.data.fromAccountId = fromAccountId
          p.data.toAccountId = toAccountId
          p.data.amountCents = fromAccountId && toAccountId ? magnitude : fromAccountId ? -magnitude : magnitude
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        editable: (p) => !p.data.__isLine,
        cellEditor: KontoEditor,
        cellEditorParams: { accounts, onApply: applyKontoDirect },
        cellEditorPopup: true,
        flex: 1.6,
      },
      {
        headerName: 'Empfänger',
        // A line row has no displayLabel of its own — it shows its own
        // `note` instead (§2.6: each line's own short free-text field,
        // e.g. "Gehalt Markus" for one leg of a split salary deposit),
        // prefixed "↳" on display only (the raw value, what's actually
        // editable, has no prefix — the prefix is cellRenderer-only so
        // editing doesn't start from "↳ " as literal text).
        valueGetter: (p) => (p.data.__isLine ? (p.data.__parent.lines[p.data.__lineIndex]?.note ?? '') : p.data.displayLabel),
        cellRenderer: (p) => (p.data.__isLine ? `↳ ${p.value || '(kein Vermerk)'}` : p.value),
        comparator: glueToParent((t) => t.displayLabel),
        valueSetter: (p) => {
          if (p.data.__isLine) {
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, note: p.newValue ?? '' } : l))
            return true
          }
          p.data.displayLabel = p.newValue ?? ''
          return true
        },
        editable: true,
        flex: 1.4,
      },
      {
        headerName: 'Betrag',
        // A line row shows its own signed amountCents directly — no
        // account-relative sign logic needed here, unlike the parent
        // (§2.6: "a line can be positive or negative independent of the
        // parent's own sign").
        valueGetter: (p) => (p.data.__isLine ? (p.data.__parent.lines[p.data.__lineIndex]?.amountCents ?? 0) : betragValue(p.data)),
        valueFormatter: (p) => centsToEuro(p.value),
        // Sorting the whole grid by every individual split line's own
        // amount wouldn't be that meaningful anyway — glued to its
        // already-amount-sorted parent (like every other column) is the
        // sensible behavior here too.
        comparator: glueToParent(betragValue),
        // Typed relative to the same "reference account" the display uses
        // (the filtered account if any, else Konto1). Two real accounts
        // always store a positive magnitude regardless of the typed sign
        // (§2.6); a single-sided row keeps exactly the typed sign. A line
        // row's amount is stored exactly as typed, no sign remapping.
        valueSetter: (p) => {
          const cents = parseEuroInput(p.newValue)
          if (cents === null) return false
          if (p.data.__isLine) {
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, amountCents: cents } : l))
            return true
          }
          const { fromAccountId, toAccountId } = p.data
          if (!fromAccountId && !toAccountId) return false
          p.data.amountCents = fromAccountId && toAccountId ? Math.abs(cents) : cents
          return true
        },
        cellEditor: 'agTextCellEditor',
        cellEditorParams: { useFormatter: true },
        cellClass: 'text-right tabular-figure',
        // The parent, once split, is a fixed total that splitting only
        // ever redistributes (persistTx's own comment) — not directly
        // editable there anymore. A line is editable unless it's the
        // *last* one: that's always the live remainder (persistTx
        // recomputes it on every save), never typed into directly — "the
        // live, auto-generated remaining amount line" (§3a).
        editable: (p) =>
          p.data.__isLine ? p.data.__lineIndex !== p.data.__parent.lines.length - 1 : (p.data.lines ?? []).length <= 1,
        width: 130,
      },
      {
        headerName: 'Kategorie',
        valueGetter: (p) => {
          if (p.data.__isLine) {
            const catId = p.data.__parent.lines[p.data.__lineIndex]?.categoryId
            return catId ? groupName(catId) : '—'
          }
          return kategorieValue(p.data)
        },
        comparator: glueToParent(kategorieValue),
        // Same cascading Kategorie→Unterkategorie picker as the
        // Unterkategorie column below — Kategorie has no stored value of
        // its own, so editing it here writes the same categoryId. A
        // fallback path only (Übernehmen/Enter apply directly and cancel
        // AG Grid's own commit via api.stopEditing(true)) — but AG Grid's
        // own Tab handling can still stop editing in *commit* mode, which
        // does reach this. A line row has no `.lines` of its own —
        // ensureLine(p.data) would silently create a bogus one on the
        // synthetic row object and lose the edit, so this branches exactly
        // like the cellEditorParams above.
        valueSetter: (p) => {
          if (p.data.__isLine) {
            const categoryId = p.newValue?.categoryId
            if (!categoryId) return false
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, categoryId } : l))
            return true
          }
          const line = ensureLine(p.data)
          line.categoryId = p.newValue?.categoryId ?? line.categoryId
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        // A line row is always editable here — including the last/remainder
        // line, which "can... be categorized/tagged directly as the final
        // line" (§3a) — a parent row only while unsplit (≤1 line); once
        // split, per-line category editing happens on the expanded rows.
        editable: (p) => p.data.__isLine || (p.data.lines ?? []).length <= 1,
        cellEditor: CategoryEditor,
        // A per-row function, not a static object: a line row needs its
        // own onApply (writing to that specific line, not
        // ensureLine/replace-lines-with-one-element) and its own current
        // selection to pre-highlight, read from that line directly rather
        // than data.lines[0].
        cellEditorParams: (p) =>
          p.data.__isLine
            ? {
                categories,
                initialCategoryId: p.data.__parent.lines[p.data.__lineIndex]?.categoryId ?? null,
                onApply: (_data, categoryId) => applyCategoryToLine(p.data.__parent, p.data.__lineIndex, categoryId),
                startField: 'group',
              }
            : {
                categories,
                initialCategoryId: (p.data.lines ?? [])[0]?.categoryId ?? null,
                onApply: applyCategoryDirect,
                startField: 'group',
              },
        cellEditorPopup: true,
        flex: 1.1,
      },
      {
        headerName: 'Unterkategorie',
        valueGetter: (p) => {
          if (p.data.__isLine) {
            const catId = p.data.__parent.lines[p.data.__lineIndex]?.categoryId
            return catId ? categoryName(catId) : '—'
          }
          return unterkategorieValue(p.data)
        },
        comparator: glueToParent(unterkategorieValue),
        // Same fallback-path reasoning as Kategorie's valueSetter above.
        valueSetter: (p) => {
          if (p.data.__isLine) {
            const categoryId = p.newValue?.categoryId
            if (!categoryId) return false
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, categoryId } : l))
            return true
          }
          const line = ensureLine(p.data)
          line.categoryId = p.newValue?.categoryId ?? line.categoryId
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        editable: (p) => p.data.__isLine || (p.data.lines ?? []).length <= 1,
        cellEditor: CategoryEditor,
        // startField: 'category' — opening from Unterkategorie directly
        // (Markus) leaves Kategorie as already set and jumps straight to
        // the Unterkategorie list, open and pre-highlighted on the
        // existing selection, instead of starting the chain over at
        // Kategorie every time. Same per-row params as Kategorie above.
        cellEditorParams: (p) =>
          p.data.__isLine
            ? {
                categories,
                initialCategoryId: p.data.__parent.lines[p.data.__lineIndex]?.categoryId ?? null,
                onApply: (_data, categoryId) => applyCategoryToLine(p.data.__parent, p.data.__lineIndex, categoryId),
                startField: 'category',
              }
            : {
                categories,
                initialCategoryId: (p.data.lines ?? [])[0]?.categoryId ?? null,
                onApply: applyCategoryDirect,
                startField: 'category',
              },
        cellEditorPopup: true,
        flex: 1.3,
      },
      {
        headerName: 'Details',
        // `detail` is parent-only free text (distinct from each line's own
        // `note`, shown in Empfänger) — blank and non-editable on a line
        // row rather than repeating/splitting the same field.
        valueGetter: (p) => (p.data.__isLine ? '' : p.data.detail),
        comparator: glueToParent((t) => t.detail),
        valueSetter: (p) => {
          if (p.data.__isLine) return false
          p.data.detail = p.newValue ?? ''
          return true
        },
        editable: (p) => !p.data.__isLine,
        flex: 1.3,
      },
      {
        headerName: 'Tags',
        valueGetter: (p) => (p.data.__isLine ? (p.data.__parent.lines[p.data.__lineIndex]?.tags ?? []).join(', ') : tagsValue(p.data)),
        comparator: glueToParent(tagsValue),
        // Placeholder editor (comma-separated text) — the real inline
        // tag-autocomplete/creation mechanism (spec.md §2.5) is its own
        // separate feature, not built yet.
        valueSetter: (p) => {
          const tags = String(p.newValue || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
          if (p.data.__isLine) {
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, tags } : l))
            return true
          }
          const line = ensureLine(p.data)
          line.tags = tags
          return true
        },
        editable: (p) => p.data.__isLine || (p.data.lines ?? []).length <= 1,
        flex: 1,
      },
      {
        headerName: '',
        colId: 'delete',
        width: 52,
        sortable: false,
        filter: false,
        suppressMovable: true,
        // A genuinely pinned column, not just lockPosition (which only
        // stops drag-reordering *within* the scrollable area) — pinned
        // columns render outside the scrollable body, to the left of
        // where the vertical scrollbar reserves its space, so the
        // trashcan is never half-covered by it (caught by Markus).
        pinned: 'right',
        resizable: false,
        cellRenderer: (p) => {
          // Deleting a whole transaction from a line row doesn't make
          // sense — removing just that line is the "split" colId's ✕
          // button instead.
          if (p.data.__isLine) return ''
          const armed = confirmDeleteId === p.data.id
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteClick(p.data.id)
              }}
              title={armed ? 'Nochmal klicken zum Löschen' : 'Buchung löschen'}
              className={
                'w-full rounded px-1 text-xs ' +
                (armed
                  ? 'font-semibold text-[var(--color-alert)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-alert)]')
              }
            >
              {armed ? '⚠︎' : '🗑'}
            </button>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountName/categoryName/groupName/ensureLine/handleDeleteClick/toggleExpanded close over these
    [accountById, categoryById, accountFilter, accounts, categories, confirmDeleteId, year, expandedIds],
  )

  const panel = useMemo(() => {
    if (!year) return []
    return REPORTING_GROUPS.map((group) => {
      const groupAccounts = accounts.filter((a) => a.reportingGroup === group && a.tracked !== false)
      const items = groupAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        cents: jahresende(a.id, Number(year), transactions),
      }))
      const total = items.reduce((sum, i) => sum + i.cents, 0)
      return { group, items, total }
    })
  }, [accounts, transactions, year])

  const stillLoading = !(loaded.accounts && loaded.categories && loaded.transactions)

  if (stillLoading) {
    return <p className="px-6 py-4 text-[var(--color-text-muted)]">Lädt…</p>
  }
  if (accounts.length === 0) {
    return (
      <p className="px-6 py-4 text-[var(--color-text-muted)]">
        Noch keine Daten importiert — siehe „Datenimport“ oben rechts.
      </p>
    )
  }

  return (
    <div className="flex min-h-full flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Jahr:</span>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={
                'rounded-md px-3 py-1 text-sm ' +
                (y === year
                  ? 'bg-[var(--color-computed)] text-white'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]')
              }
            >
              {y}
            </button>
          ))}
        </div>

        {/* The account filter from spec.md §3a's filtering section — not the
            same as a column filter on Konto (see the note there): this shows
            every transaction touching the chosen account, either side, from
            that account's own perspective. Clicking an account in the panel
            below is a shortcut for picking it here. */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Konto:</span>
          <select
            ref={accountSelectRef}
            value={accountFilter ?? ''}
            onChange={(e) => setAccountFilter(e.target.value || null)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          >
            <option value="">Alle Konten</option>
            {/* Grouped by reportingGroup, via <optgroup> — a flat
                alphabetical list across every account made arrow-key
                navigation jump between unrelated groups (e.g. Consors
                straight to CPAM, caught by Markus); this keeps arrow-key
                movement inside one block at a time, same as the pinned
                panel above reads. */}
            {REPORTING_GROUPS.map((group) => {
              const groupAccounts = accounts
                .filter((a) => a.reportingGroup === group && a.tracked !== false && a.group !== 'system')
                .sort((a, b) => a.name.localeCompare(b.name))
              if (groupAccounts.length === 0) return null
              return (
                <optgroup key={group} label={group}>
                  {groupAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </div>

        <button
          type="button"
          onClick={addRow}
          title="Fügt eine leere Zeile direkt unter der markierten Zeile ein (mit deren Datum)"
          className="rounded-md bg-[var(--color-computed)] px-3 py-1 text-sm font-medium text-white"
        >
          + Neue Buchung
        </button>
      </div>

      {/* Pinned balance panel — Jahresende(selected year) per account,
          grouped by reportingGroup (spec.md §2.2/§1b.3's "pinned balance
          panel" pattern). This is the direct testable check from PLAN.md
          Phase 1a: every figure here should match the real Gsheet closing
          balance for that account/year. Each account is also a shortcut
          into the account filter above. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {panel.map(({ group, items, total }) => (
          <div key={group} data-group={group} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-1 flex items-baseline justify-between">
              {/* The group heading itself is a shortcut back to "Alle
                  Konten" — there's no group-level filter (only single
                  accounts), so this just clears whatever's currently
                  selected. */}
              <button
                type="button"
                onClick={() => setAccountFilter(null)}
                title='Filter zurücksetzen ("Alle Konten")'
                className="text-sm font-semibold hover:underline"
              >
                {group}
              </button>
              <span className="tabular-figure text-sm text-[var(--color-computed)]">{centsToEuro(total)} €</span>
            </div>
            <ul className="flex flex-col gap-0.5 text-xs text-[var(--color-text-muted)]">
              {items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    data-account-id={i.id}
                    onClick={() => setAccountFilter(i.id)}
                    // Up/Down: move within this group's <ul>, listbox-style
                    // (plain <button>s have no built-in arrow-key behavior
                    // the way a <select> does), and *apply the filter as
                    // you move* — Markus: arrow keys should act like the
                    // dropdown's, not just move a focus rectangle. Left/
                    // Right: jump to the first account of the adjacent
                    // reportingGroup box (Barkonten/Sparkonten/Geldanlage/
                    // Außenstände, in that fixed order) via the panel's own
                    // data-group wrapper and DOM sibling order. Escape:
                    // back to "Alle Konten", then to the grid. Enter: keep
                    // whatever's currently highlighted as the filter, then
                    // *also* to the grid — same destination, different
                    // filter outcome. Ctrl+K (see the effect above) closes
                    // the loop back to here, at the active filter's button.
                    onKeyDown={(e) => {
                      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape', 'Enter'].includes(e.key)) {
                        return
                      }
                      e.preventDefault()
                      if (e.key === 'Escape') {
                        setAccountFilter(null)
                        focusGridMidViewport()
                        return
                      }
                      if (e.key === 'Enter') {
                        setAccountFilter(i.id)
                        focusGridMidViewport()
                        return
                      }
                      let target
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        const buttons = [...e.currentTarget.closest('ul').querySelectorAll('button')]
                        target = buttons[buttons.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]
                      } else {
                        const panel = e.currentTarget.closest('[data-group]')
                        const sibling = e.key === 'ArrowRight' ? panel.nextElementSibling : panel.previousElementSibling
                        target = sibling?.querySelector('ul button')
                      }
                      if (!target) return
                      target.focus()
                      setAccountFilter(target.dataset.accountId)
                    }}
                    className={
                      'flex w-full justify-between gap-2 rounded px-1 text-left hover:bg-[var(--color-bg)] ' +
                      (i.id === accountFilter ? 'text-[var(--color-computed)]' : 'text-[var(--color-text-muted)]')
                    }
                  >
                    <span>{i.name}</span>
                    <span className="tabular-figure">{centsToEuro(i.cents)} €</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* A fixed height, not flex-1/min-h-0: that relied on main having a
          bounded height, which broke the moment the panel above grew taller
          than the viewport on a narrow screen (nothing could scroll to
          reach the grid at all). This way the grid always has its own
          working internal scroll, and the page itself scrolls normally if
          the panel above is tall. */}
      <div className="h-[70vh] min-h-[360px]">
        <AgGridReact
          ref={gridRef}
          theme={themeQuartz}
          rowData={displayRows}
          columnDefs={columnDefs}
          // suppressMovable (not just per-column, so it also covers the
          // default column menu) keeps the spec'd column order fixed —
          // Markus's request: no accidental drag-reordering or hiding.
          defaultColDef={{ suppressMovable: true }}
          // Single-row selection just for "+ Neue Buchung"'s "insert below
          // the selected row" — not a bulk-actions feature.
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          // One click starts editing an editable cell, not AG Grid's
          // default double-click — Markus's date-field report ("double
          // click... then a third click to open the date selector") was
          // partly this: the first click was only ever selecting the row,
          // never starting the edit at all.
          singleClickEdit={true}
          getRowId={(p) => p.data.id}
          onCellValueChanged={handleCellValueChanged}
          undoRedoCellEditingLimit={20}
          // Tints a row pale red while its delete is armed, waiting for
          // the confirming second click/Delete/trashcan tap (Markus: red,
          // not grey — an earlier version used opacity/grayscale) —
          // paired with the redrawRows() effect above, since getRowStyle
          // alone isn't re-evaluated for existing rows just because React
          // state changed elsewhere. A split transaction's own line rows
          // get a distinct subtle tint too (Markus), so they read as
          // visually separate from ordinary transaction rows at a glance —
          // armed-delete red still wins if a line row is somehow both.
          getRowStyle={(p) => {
            if (confirmDeleteId === p.data.id) return { backgroundColor: 'var(--color-alert-tint)' }
            if (p.data.__isLine) return { backgroundColor: 'var(--color-line-row-tint)' }
            return undefined
          }}
          // Keyboard cell navigation moves the row selection (the blue
          // tint) along with it, not just the mouse click (Markus: "it
          // will be clearer to know which row is selected"). This also
          // means "+ Neue Buchung"'s insert-below-selected-row now follows
          // wherever arrow keys left the cursor, not only the last click.
          onCellFocused={(p) => {
            if (p.rowIndex == null) return
            p.api.getDisplayedRowAtIndex(p.rowIndex)?.setSelected(true, true)
          }}
          // The keyboard Delete key does the same thing as clicking the
          // trashcan (Markus's request) — same two-click-style arm/confirm
          // via handleDeleteClick, not an instant delete. Ignored while a
          // cell is actively being edited, so Delete still just edits text
          // like normal (clearing a character/selection) rather than also
          // arming row deletion underneath it.
          onCellKeyDown={(p) => {
            const key = p.event?.key
            // A line row's Delete key does nothing here — removing a line
            // is the split column's ✕ button, not the whole-transaction
            // delete (Delete on a line row would otherwise try to arm a
            // transaction-delete against a synthetic id that doesn't
            // exist in Firestore).
            if (key !== 'Delete' || p.api.getEditingCells().length > 0 || p.data.__isLine) return
            handleDeleteClick(p.data.id)
          }}
          // Datum sorted ascending on first load only (the underlying rows
          // are already date-sorted anyway — this is just the header
          // arrow). Previously this was hard-set on the Datum colDef
          // itself, which made it stick around as a permanent secondary
          // sort criterion alongside whatever column got clicked afterward
          // — the "Datum 2 / Betrag 1" priority badges Markus ran into.
          // initialState applies once and then gets out of the way, so
          // clicking any column header now does a normal single-column
          // sort/replace.
          initialState={{ sort: { sortModel: [{ colId: 'date', sort: 'asc' }] } }}
        />
      </div>
    </div>
  )
}
