import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'

import { db } from './firebase'
import ForecastChart from './ForecastChart'
import MonthChecks from './MonthChecks'
import YearCharts from './YearCharts'
import MonthView from './MonthView'
import StatusChart from './StatusChart'
import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { currentMonthMarker } from './lib/status'
import ui from './lib/uiState'
import { useTags } from './TagsProvider'

// Dashboard (spec.md §1b.2): sub-tabs, each one view of "where am I".
//  - Prognose (first, Nov 2026): cash lines Plan0/Plan1/Prognose + Geldanlage/Sparkonten bars (§3d),
//    then Jahresbilanz + Wo liegt das Geld (YearCharts), then the month-end checks (MonthChecks)
//  - Monat: this month / year to date against Plan1, biggest deviations with the bookings behind them
//  - Status: the 12-month normalised pace chart (spec.md §3f)
// Both read the same data, loaded once here.
export default function Dashboard({ year, active = true, onOpenInKonten }) {
  const syncWhenVisible = useDeferWhileHidden(active)
  const yearNum = Number(year)
  const { tags } = useTags()
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState([])
  const [yearSettings, setYearSettings] = useState([])
  const [transactions, setTransactions] = useState([])
  const [closedMonths, setClosedMonths] = useState([])
  // Prognose is the first sub-tab and what the Dashboard opens with until another one is picked (Nov 2026).
  const [tab, setTab] = useState(() => (['month', 'status'].includes(ui.get('dashboard', 'subtab')) ? ui.get('dashboard', 'subtab') : 'prognose'))
  useEffect(() => ui.set('dashboard', 'subtab', tab), [tab])

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'accounts'), (s) => setAccounts(s.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'categories'), (s) => setCategories(s.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'budgets'), (s) => setBudgets(s.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'categoryYearSettings'), (s) => setYearSettings(s.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'transactions'), (s) => {
        const next = s.docs.map((d) => d.data()).filter((t) => !t.deletedAt)
        syncWhenVisible(() => setTransactions(next))
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])
  useEffect(() => {
    if (!yearNum) return undefined
    return onSnapshot(doc(db, 'settings', String(yearNum)), (s) => setClosedMonths(s.exists() ? (s.data().closedMonths ?? []) : []))
  }, [yearNum])

  const month = currentMonthMarker(closedMonths, yearNum)
  const forecastProps = { accounts, categories, tags, budgets, transactions, yearNum, closedMonths }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-[var(--color-border)] px-4 pt-3">
        {[
          ['prognose', 'Prognose'],
          ['month', 'Monat'],
          ['status', 'Status'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              'rounded-t-md px-3 py-2 text-sm ' +
              (tab === id ? 'border-b-2 border-[var(--color-computed)] font-medium text-[var(--color-computed)]' : 'text-[var(--color-text-muted)]')
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'prognose' ? (
        // Main chart, then Jahresbilanz + Wo liegt das Geld side by side, then the month-end checks (Nov 2026).
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ForecastChart {...forecastProps} />
          <YearCharts {...forecastProps} />
          <MonthChecks {...forecastProps} />
        </div>
      ) : tab === 'month' ? (
        <MonthView categories={categories} budgets={budgets} transactions={transactions} yearNum={yearNum} defaultMonth={month} onOpenInKonten={onOpenInKonten} />
      ) : (
        <StatusChart categories={categories} budgets={budgets} yearSettings={yearSettings} transactions={transactions} yearNum={yearNum} month={month} />
      )}
    </div>
  )
}
