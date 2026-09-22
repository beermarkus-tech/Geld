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
      .slice()
      .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
  }, [transactions, year])

  // Confirmed column order (spec.md §3a): Datum → Konto 1 → Konto 2 →
  // Empfänger → Betrag → Kategorie → Unterkategorie → Details → Tags.
  // Konto1 is always the transaction's primary account (fromAccountId when
  // present, else toAccountId); Konto2 is the second account, only for an
  // actual transfer. The narrow arrow column between them shows direction —
  // this is what lets a single-document transfer (no second row on the
  // other account, unlike the old Gsheet) still read unambiguously either
  // way. Only Unterkategorie is stored; Kategorie is its derived parent.
  const columnDefs = useMemo(
    () => [
      { field: 'date', headerName: 'Datum', width: 110, sort: 'asc' },
      {
        headerName: 'Konto 1',
        valueGetter: (p) => accountName(p.data.fromAccountId ?? p.data.toAccountId),
        flex: 1.2,
      },
      {
        headerName: '',
        width: 40,
        cellClass: 'text-center',
        valueGetter: (p) => {
          const t = p.data
          if (!(t.fromAccountId && t.toAccountId)) return ''
          return signedFor(t, t.fromAccountId) < 0 ? '→' : '←'
        },
      },
      {
        headerName: 'Konto 2',
        valueGetter: (p) => (p.data.fromAccountId && p.data.toAccountId ? accountName(p.data.toAccountId) : '—'),
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        flex: 1.2,
      },
      { field: 'displayLabel', headerName: 'Empfänger', flex: 1.4 },
      {
        headerName: 'Betrag',
        valueGetter: (p) => signedFor(p.data, p.data.fromAccountId ?? p.data.toAccountId),
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
