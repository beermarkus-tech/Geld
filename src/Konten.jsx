import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import { db } from './firebase'
import { jahresende } from './lib/balance'

ModuleRegistry.registerModules([AllCommunityModule])

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
  // Betrag → Kategorie → Unterkategorie → Details → Tags. Konto is one
  // merged column (not Konto1/Konto2 — revised Sept 2026): the primary
  // account with an arrow to the second one for a transfer, unless an
  // account filter is active, in which case it shows the *other* side only
  // (a single-account register view) and Betrag is re-signed relative to
  // the filtered account instead of the row's own primary side. Only
  // Unterkategorie is stored; Kategorie is its derived parent.
  const columnDefs = useMemo(
    () => [
      { field: 'date', headerName: 'Datum', width: 110, sort: 'asc' },
      {
        headerName: accountFilter ? `Gegenkonto (${accountName(accountFilter)})` : 'Konto',
        valueGetter: (p) => {
          const t = p.data
          if (accountFilter) {
            const other = t.fromAccountId === accountFilter ? t.toAccountId : t.fromAccountId
            return other ? accountName(other) : '—'
          }
          if (t.fromAccountId && t.toAccountId) {
            return `${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`
          }
          return accountName(t.fromAccountId ?? t.toAccountId)
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        flex: 1.6,
      },
      { field: 'displayLabel', headerName: 'Empfänger', flex: 1.4 },
      {
        headerName: 'Betrag',
        valueGetter: (p) => signedFor(p.data, accountFilter ?? (p.data.fromAccountId ?? p.data.toAccountId)),
        valueFormatter: (p) => centsToEuro(p.value),
        cellClass: 'text-right tabular-figure',
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
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        flex: 1.1,
      },
      {
        headerName: 'Unterkategorie',
        valueGetter: (p) => {
          const ids = [...new Set((p.data.lines ?? []).map((l) => l.categoryId).filter(Boolean))]
          if (ids.length === 0) return '—'
          return ids.length === 1 ? categoryName(ids[0]) : '(mehrere)'
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        flex: 1.3,
      },
      { field: 'detail', headerName: 'Details', flex: 1.3 },
      {
        headerName: 'Tags',
        valueGetter: (p) => [...new Set((p.data.lines ?? []).flatMap((l) => l.tags ?? []))].join(', '),
        flex: 1,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountName/categoryName/groupName close over these
    [accountById, categoryById, accountFilter],
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
    <div className="flex h-full flex-col gap-3 px-4 py-3">
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
              <h3 className="text-sm font-semibold">{group}</h3>
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

      <div className="min-h-0 flex-1">
        <AgGridReact theme={themeQuartz} rowData={rows} columnDefs={columnDefs} getRowId={(p) => p.data.id} />
      </div>
    </div>
  )
}
