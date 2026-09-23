import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import CategoryEditor from './CategoryEditor'
import { db } from './firebase'
import KontoEditor from './KontoEditor'
import { jahresende } from './lib/balance'

ModuleRegistry.registerModules([AllCommunityModule])

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
// needed, single user") — re-mirrors the sole line's amountCents to the
// parent's here, generically, regardless of what changed.
function persistTx(tx) {
  const next = { ...tx }
  if (next.lines?.length === 1) {
    next.lines = [{ ...next.lines[0], amountCents: next.amountCents }]
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

// Barkonten/Sparkonten/Geldanlage/Außenstände — Markus's own top-level
// mental model (spec.md §2.2's reportingGroup), not the technical account
// `group`. Außenstände (the seven receivable accounts) got its own block
// Sept 2026 — they're open claims/loans, not "real accounts" the same way
// a bank or cash balance is (spec.md §2.2's revision note).
const REPORTING_GROUPS = ['Barkonten', 'Sparkonten', 'Geldanlage', 'Außenstände']

function centsToEuro(cents) {
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  // The id of a just-created row waiting to be scrolled into view and put
  // into edit mode once it actually arrives back from Firestore (addRow
  // writes, then onSnapshot brings it into `rows` asynchronously — there's
  // no row to focus synchronously right after the write resolves).
  const pendingFocusIdRef = useRef(null)

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

  const handleCellValueChanged = (params) => persistTx(params.data)

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
        api.setFocusedCell(Math.floor((first + last) / 2), 'date')
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

  // Once addRow's new row actually lands (via Firestore round-trip through
  // onSnapshot into `rows`, not synchronously available right after the
  // write), scroll it into view and put the cell cursor on its Datum cell
  // — but don't start editing it (Markus: he wants the focus rectangle
  // there, ready for a single tap/Enter to open the picker per §1's
  // singleClickEdit, not editing already forced open on arrival).
  useEffect(() => {
    const id = pendingFocusIdRef.current
    if (!id || !rows.some((r) => r.id === id)) return
    pendingFocusIdRef.current = null
    const api = gridRef.current?.api
    if (!api) return
    setTimeout(() => {
      const node = api.getRowNode(id)
      if (!node) return
      api.ensureNodeVisible(node, 'middle')
      // Selected (the blue tint), not just cell-focused (Markus) — this
      // also means the *next* "+ Neue Buchung" naturally inserts below
      // this new row too, chaining correctly when adding several in a row.
      node.setSelected(true, true)
      api.setFocusedCell(node.rowIndex, 'date')
    }, 0)
  }, [rows])

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
        field: 'date',
        headerName: 'Datum',
        width: 110,
        editable: true,
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
        colId: 'date',
      },
      {
        headerName: accountFilter ? `Gegenkonto (${accountName(accountFilter)})` : 'Konto',
        valueGetter: (p) => {
          const t = p.data
          if (accountFilter) {
            const outgoing = t.fromAccountId === accountFilter
            const other = outgoing ? t.toAccountId : t.fromAccountId
            if (!other) return '—'
            // → for money leaving the filtered account (Betrag negative),
            // ← for money arriving into it (Betrag positive) — same
            // direction the unfiltered Konto column's arrow already uses,
            // just read from the filtered account's own side.
            return (outgoing ? '→ ' : '← ') + accountName(other)
          }
          if (t.fromAccountId && t.toAccountId) {
            return `${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`
          }
          return accountName(t.fromAccountId ?? t.toAccountId)
        },
        // A cellRenderer, not just the plain valueGetter string, so the
        // arrow is always the exact same glyph mirrored via CSS rather than
        // the → and ← Unicode characters — which, in the grid's font,
        // render at visibly different sizes (caught by Markus). Reads
        // p.data directly rather than re-parsing the value string.
        cellRenderer: (p) => {
          const t = p.data
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
        editable: true,
        cellEditor: KontoEditor,
        cellEditorParams: { accounts, onApply: applyKontoDirect },
        cellEditorPopup: true,
        flex: 1.6,
      },
      { field: 'displayLabel', headerName: 'Empfänger', editable: true, flex: 1.4 },
      {
        headerName: 'Betrag',
        valueGetter: (p) => signedFor(p.data, accountFilter ?? (p.data.fromAccountId ?? p.data.toAccountId)),
        valueFormatter: (p) => centsToEuro(p.value),
        // Typed relative to the same "reference account" the display uses
        // (the filtered account if any, else Konto1). Two real accounts
        // always store a positive magnitude regardless of the typed sign
        // (§2.6); a single-sided row keeps exactly the typed sign.
        valueSetter: (p) => {
          const cents = parseEuroInput(p.newValue)
          if (cents === null) return false
          const { fromAccountId, toAccountId } = p.data
          if (!fromAccountId && !toAccountId) return false
          p.data.amountCents = fromAccountId && toAccountId ? Math.abs(cents) : cents
          return true
        },
        cellEditor: 'agTextCellEditor',
        cellEditorParams: { useFormatter: true },
        cellClass: 'text-right tabular-figure',
        editable: true,
        width: 130,
      },
      {
        headerName: 'Kategorie',
        valueGetter: (p) => {
          const ids = [...new Set((p.data.lines ?? []).map((l) => l.categoryId).filter(Boolean))]
          if (ids.length === 0) return '—'
          const groups = [...new Set(ids.map(groupName))]
          return groups.length === 1 ? groups[0] : '(mehrere)'
        },
        // Same cascading Kategorie→Unterkategorie picker as the
        // Unterkategorie column below — Kategorie has no stored value of
        // its own, so editing it here writes the same categoryId.
        valueSetter: (p) => {
          const line = ensureLine(p.data)
          line.categoryId = p.newValue?.categoryId ?? line.categoryId
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        editable: (p) => (p.data.lines ?? []).length <= 1,
        cellEditor: CategoryEditor,
        cellEditorParams: { categories, onApply: applyCategoryDirect },
        cellEditorPopup: true,
        flex: 1.1,
      },
      {
        headerName: 'Unterkategorie',
        valueGetter: (p) => {
          const ids = [...new Set((p.data.lines ?? []).map((l) => l.categoryId).filter(Boolean))]
          if (ids.length === 0) return '—'
          return ids.length === 1 ? categoryName(ids[0]) : '(mehrere)'
        },
        // Only editable for an unsplit row (0 or 1 category so far) — a
        // split transaction's per-line categories are Phase 1b's editing
        // surface (the auto-remainder mechanism), not this column.
        valueSetter: (p) => {
          const line = ensureLine(p.data)
          line.categoryId = p.newValue?.categoryId ?? line.categoryId
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        editable: (p) => (p.data.lines ?? []).length <= 1,
        cellEditor: CategoryEditor,
        cellEditorParams: { categories, onApply: applyCategoryDirect },
        cellEditorPopup: true,
        flex: 1.3,
      },
      { field: 'detail', headerName: 'Details', editable: true, flex: 1.3 },
      {
        headerName: 'Tags',
        valueGetter: (p) => [...new Set((p.data.lines ?? []).flatMap((l) => l.tags ?? []))].join(', '),
        // Placeholder editor (comma-separated text) — the real inline
        // tag-autocomplete/creation mechanism (spec.md §2.5) is its own
        // separate feature, not built yet.
        valueSetter: (p) => {
          const line = ensureLine(p.data)
          line.tags = String(p.newValue || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
          return true
        },
        editable: (p) => (p.data.lines ?? []).length <= 1,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountName/categoryName/groupName/ensureLine/handleDeleteClick close over these
    [accountById, categoryById, accountFilter, accounts, categories, confirmDeleteId, year],
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
          rowData={rows}
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
          // state changed elsewhere.
          getRowStyle={(p) =>
            confirmDeleteId === p.data.id ? { backgroundColor: 'var(--color-alert-tint)' } : undefined
          }
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
            if (key !== 'Delete' || p.api.getEditingCells().length > 0) return
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
