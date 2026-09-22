import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import { db } from './firebase'
import { jahresende } from './lib/balance'

ModuleRegistry.registerModules([AllCommunityModule])

// Barkonten/Sparkonten/Geldanlage — Markus's own top-level mental model
// (spec.md §2.2's reportingGroup), not the technical account `group`.
const REPORTING_GROUPS = ['Barkonten', 'Sparkonten', 'Geldanlage']

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
      .slice()
      .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
  }, [transactions, year])

  const columnDefs = useMemo(
    () => [
      { field: 'date', headerName: 'Datum', width: 110, sort: 'asc' },
      {
        headerName: 'Konto',
        valueGetter: (p) => {
          const t = p.data
          if (t.fromAccountId && t.toAccountId) {
            return `${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`
          }
          return accountName(t.fromAccountId ?? t.toAccountId)
        },
        flex: 1.4,
      },
      { field: 'displayLabel', headerName: 'Empfänger', flex: 1.4 },
      {
        headerName: 'Kategorie',
        valueGetter: (p) => {
          const lines = p.data.lines ?? []
          const cats = [...new Set(lines.map((l) => (l.categoryId ? categoryName(l.categoryId) : null)).filter(Boolean))]
          if (cats.length === 0) return ''
          if (cats.length === 1) return cats[0]
          return '(mehrere)'
        },
        flex: 1.2,
      },
      {
        headerName: 'Betrag',
        valueGetter: (p) => p.data.amountCents,
        valueFormatter: (p) => centsToEuro(p.value),
        cellClass: 'text-right tabular-figure',
        width: 130,
      },
      {
        headerName: 'Tags',
        valueGetter: (p) => {
          const lines = p.data.lines ?? []
          return [...new Set(lines.flatMap((l) => l.tags ?? []))].join(', ')
        },
        flex: 1,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountName/categoryName close over these
    [accountById, categoryById],
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

      {/* Pinned balance panel — Jahresende(selected year) per account,
          grouped by reportingGroup (spec.md §2.2/§1b.3's "pinned balance
          panel" pattern). This is the direct testable check from PLAN.md
          Phase 1a: every figure here should match the real Gsheet closing
          balance for that account/year. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {panel.map(({ group, items, total }) => (
          <div key={group} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">{group}</h3>
              <span className="tabular-figure text-sm text-[var(--color-computed)]">{centsToEuro(total)} €</span>
            </div>
            <ul className="flex flex-col gap-0.5 text-xs text-[var(--color-text-muted)]">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span>{i.name}</span>
                  <span className="tabular-figure">{centsToEuro(i.cents)} €</span>
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
