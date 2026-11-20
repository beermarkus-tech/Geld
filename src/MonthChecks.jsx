import { useMemo } from 'react'

import { centsToEuro } from './lib/format'
import { monthChecks } from './lib/monthChecks'

// Under the Prognose chart (spec.md §3d, Nov 2026): the two automatic month-end checks for every
// closed month (lib/monthChecks.js). A month that balances shows ✓; a difference is shown in the
// same yellow as a missing entry in Konten, with the amount it is off by.
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const YELLOW = { background: 'var(--color-needs-entry)', color: '#1f1a00' }

function Cell({ delta, title }) {
  if (delta === 0)
    return (
      <td className="px-2 py-1 text-center text-[var(--color-income)]" title={title}>
        ✓
      </td>
    )
  return (
    <td className="tabular-figure px-2 py-1 text-right font-medium" style={YELLOW} title={title}>
      {delta > 0 ? '+' : ''}
      {centsToEuro(delta)} €
    </td>
  )
}

export default function MonthChecks({ accounts, categories, tags, budgets, transactions, yearNum, closedMonths }) {
  const rows = useMemo(
    () => monthChecks({ accounts, categories, tags, budgets, transactions, year: yearNum, closedMonths }),
    [accounts, categories, tags, budgets, transactions, yearNum, closedMonths],
  )
  if (rows.length === 0) return <p className="mt-3 px-4 text-sm text-[var(--color-text-muted)]">Prüfung: noch kein Monat abgeschlossen.</p>
  const bad = rows.filter((r) => !r.ok).length
  return (
    <div className="mt-4 px-4 pb-4">
      <h3 className="mb-1 text-sm font-semibold">
        Monatsprüfung{' '}
        <span className="font-normal text-[var(--color-text-muted)]">
          {bad === 0 ? '– alle abgeschlossenen Monate stimmen' : `– ${bad} Monat(e) mit Differenz`}
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead className="text-[var(--color-text-muted)]">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Prüfung</th>
              {rows.map((r) => (
                <th key={r.m} className="px-2 py-1 text-center font-medium">
                  {MONTHS[r.m - 1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-1 whitespace-nowrap">Prognose = Kontostand</td>
              {rows.map((r) => (
                <Cell key={r.m} delta={r.progDelta} title={`Prognose ${centsToEuro(r.prog)} € · Kontostand ${centsToEuro(r.kontostand)} €`} />
              ))}
            </tr>
            {rows[0].reserves.map((g, gi) => (
              <tr key={g.group}>
                <td className="px-2 py-1 whitespace-nowrap">Unterkonten = {g.group}</td>
                {rows.map((r) => {
                  const x = r.reserves[gi]
                  return <Cell key={r.m} delta={x.delta} title={`Unterkonten ${centsToEuro(x.tags)} € · Konten ${centsToEuro(x.accounts)} €`} />
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bad > 0 && (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Eine Differenz heißt: eine Buchung fehlt, ist falsch, oder hat das falsche Vorzeichen (in Konten gelb markiert).
        </p>
      )}
    </div>
  )
}
