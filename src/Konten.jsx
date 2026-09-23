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

  // Full-document overwrite on every cell commit (§3a: "simple edit-in-place,
  // no audit trail needed, single user") — simplest correct thing for a
  // one-line transaction; splitting (Phase 1b) will need something finer.
  // Re-mirrors the sole line's amountCents to the parent's here, generically,
  // regardless of which column actually changed — cheaper than duplicating
  // that sync in every individual valueSetter.
  const handleCellValueChanged = (params) => {
    const tx = { ...params.data }
    if (tx.lines?.length === 1) {
      tx.lines = [{ ...tx.lines[0], amountCents: tx.amountCents }]
    }
    // A manually entered row has no real bank text to protect (§3a's "raw
    // label must never be overwritten" is about imported rows specifically,
    // which already arrive with rawDescription set) — mirror Empfänger into
    // it instead of leaving it permanently blank.
    if (!tx.rawDescription) tx.rawDescription = tx.displayLabel
    setDoc(doc(db, 'transactions', tx.id), tx)
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

  const years = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 4)))
    return [...set].sort()
  }, [transactions])

  // Default to the most recent year once data has loaded; a manual pick
  // (below) always overrides this.
  useEffect(() => {
    if (year === null && years.length > 0) setYear(years[years.length - 1])
  }, [years, year])

  const rows = useMemo(() => {
    if (!year) return []
    return transactions
      .filter((t) => t.date.startsWith(year))
      .filter((t) => !accountFilter || t.fromAccountId === accountFilter || t.toAccountId === accountFilter)
      .slice()
      .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
  }, [transactions, year, accountFilter])

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
        sort: 'asc',
        editable: true,
        valueSetter: (p) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(p.newValue ?? '')) return false
          p.data.date = p.newValue
          return true
        },
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
        cellEditorParams: { accounts },
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
        cellEditorParams: { categories },
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
        cellEditorParams: { categories },
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
        width: 44,
        sortable: false,
        filter: false,
        suppressMovable: true,
        lockPosition: 'right',
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
    [accountById, categoryById, accountFilter, accounts, categories, confirmDeleteId],
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
            value={accountFilter ?? ''}
            onChange={(e) => setAccountFilter(e.target.value || null)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          >
            <option value="">Alle Konten</option>
            {accounts
              .filter((a) => a.tracked !== false && a.group !== 'system')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
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
          <div key={group} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
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
                    onClick={() => setAccountFilter(i.id)}
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
          getRowId={(p) => p.data.id}
          onCellValueChanged={handleCellValueChanged}
          undoRedoCellEditingLimit={20}
        />
      </div>
    </div>
  )
}
