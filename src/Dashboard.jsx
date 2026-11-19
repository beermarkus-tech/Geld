import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'

import { db } from './firebase'
import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { centsToEuro } from './lib/format'
import { currentMonthMarker, PACING_MODES, shortAmount, statusBars } from './lib/status'
import { SUBCAT_ORDER } from './lib/categoryOrder'

// Dashboard (spec.md §1b.2). For now it holds one chart, "Status – where am I" (§3f): a bar per
// category normalised to 12 months, showing where actual spending/income stands against the Plan1
// budget. More graphs can follow later (probably as sub-tabs). Geometry: lib/status.js.
const BAR = 30
const STEP = 46
const AXIS = 34
const TOP = 26
const PLOT_H = 380
const LABEL_H = 130

const PACING_LABEL = { 'fixed-profile': 'Fester Verlauf (Plan Monat für Monat)', 'yearly-rolling': 'Rollierend (Rest ÷ verbleibende Monate)' }
const DARK = { expense: 'var(--color-computed)', income: 'var(--color-income)' }
const LIGHT = {
  expense: 'color-mix(in srgb, var(--color-computed) 26%, var(--color-surface))',
  income: 'color-mix(in srgb, var(--color-income) 26%, var(--color-surface))',
}

export default function Dashboard({ year, active = true }) {
  const syncWhenVisible = useDeferWhileHidden(active)
  const yearNum = Number(year)
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState([])
  const [yearSettings, setYearSettings] = useState([])
  const [transactions, setTransactions] = useState([])
  const [closedMonths, setClosedMonths] = useState([])
  const [side, setSide] = useState('all') // 'all' | 'expense' | 'income'
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    const unsubs = [
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
  const all = useMemo(
    () => statusBars({ categories: categories.filter((c) => !c.parentCategoryId || SUBCAT_ORDER.includes(c.name)), budgets, yearSettings, transactions, year: yearNum, month }),
    [categories, budgets, yearSettings, transactions, yearNum, month],
  )
  const bars = all.filter((b) => side === 'all' || b.side === side)
  const selected = bars.find((b) => b.id === selectedId) ?? null

  const yMax = Math.max(12, Math.ceil(Math.max(0, ...bars.map((b) => b.actualH))))
  const y = (h) => TOP + PLOT_H - (Math.min(h, yMax) / yMax) * PLOT_H
  const W = AXIS + bars.length * STEP + 10
  const H = TOP + PLOT_H + LABEL_H

  function setPacing(bar, mode) {
    const id = `${yearNum}_${bar.id}`
    setDoc(doc(db, 'categoryYearSettings', id), { id, year: yearNum, categoryId: bar.id, allocationTagId: null, pacingMode: mode }, { merge: true })
  }

  const chip = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setSide(id)}
      className={`rounded-full border px-3 py-1 text-sm ${side === id ? 'border-[var(--color-computed)] bg-[var(--color-computed)] text-white' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Status {yearNum}</h2>
        <span className="text-sm text-[var(--color-text-muted)]">
          Stand nach Monat {month} (letzter in Verlauf abgehakter Monat) · Balkenhöhe = Monate des Jahresplans (Plan1)
        </span>
        <div className="ml-auto flex gap-2">
          {chip('all', 'Alle')}
          {chip('expense', 'Ausgaben')}
          {chip('income', 'Einnahmen')}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <Legend><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-text)]" /> Budgetmonat</Legend>
        <Legend><span className="inline-block w-5 border-t-2 border-dashed border-[var(--color-text)]" /> aktueller Monat</Legend>
        <Legend><Swatch color={LIGHT.expense} /> Budget</Legend>
        <Legend><Swatch color="var(--color-alert)" /> Mehrausgaben</Legend>
        <Legend><Swatch color={DARK.expense} /> Ausgaben</Legend>
        <Legend><Swatch color={LIGHT.income} /> Zieleinnahmen</Legend>
        <Legend><Swatch color={DARK.income} /> Einnahmen</Legend>
      </div>

      {bars.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Keine Kategorien mit Plan1-Werten für {yearNum}.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W, width: '100%', maxHeight: 640 }} role="img" aria-label="Status je Kategorie">
            {Array.from({ length: yMax + 1 }, (_, m) => (
              <g key={m}>
                <line x1={AXIS} x2={W - 6} y1={y(m)} y2={y(m)} stroke="var(--color-border)" strokeWidth="1" />
                <text x={AXIS - 6} y={y(m) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-muted)">
                  {m}
                </text>
              </g>
            ))}
            {bars.map((b, i) => {
              const x = AXIS + i * STEP + (STEP - BAR) / 2
              const cx = x + BAR / 2
              const top = Math.max(b.actualH, 0)
              const isSel = b.id === selectedId
              return (
                <g key={b.id} onClick={() => setSelectedId(isSel ? null : b.id)} style={{ cursor: 'pointer' }}>
                  <title>
                    {`${b.name}: ${centsToEuro(b.actualCents)} € von ${centsToEuro(b.annualCents)} € (Rest ${centsToEuro(b.remainingCents)} €)`}
                  </title>
                  {/* light = what is left, up to 12 */}
                  <rect x={x} y={y(12)} width={BAR} height={Math.max(0, y(top) - y(12))} fill={LIGHT[b.side]} />
                  <rect x={x} y={y(b.darkH)} width={BAR} height={y(0) - y(b.darkH)} fill={DARK[b.side]} />
                  {b.redH > 0 && <rect x={x} y={y(b.darkH + b.redH)} width={BAR} height={y(b.darkH) - y(b.darkH + b.redH)} fill="var(--color-alert)" />}
                  {isSel && <rect x={x - 2} y={y(yMax)} width={BAR + 4} height={y(0) - y(yMax)} fill="none" stroke="var(--color-text)" strokeWidth="1.5" />}
                  <text x={cx} y={y(12) + 13} textAnchor="middle" fontSize="10" fill="var(--color-text)">
                    {shortAmount(b.remainingCents)}
                  </text>
                  <text x={cx} y={y(0) - 5} textAnchor="middle" fontSize="10" fill="#fff">
                    {shortAmount(b.actualCents)}
                  </text>
                  <circle cx={cx} cy={y(b.dotH)} r="4.5" fill="var(--color-text)" />
                  <text
                    transform={`translate(${cx + 4},${y(0) + 12}) rotate(-45)`}
                    textAnchor="end"
                    fontSize="11"
                    fill="var(--color-text)"
                  >
                    {b.name}
                  </text>
                </g>
              )
            })}
            <line x1={AXIS} x2={W - 6} y1={y(month)} y2={y(month)} stroke="var(--color-text)" strokeWidth="1.5" strokeDasharray="6 4" />
          </svg>
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          <b>{selected.name}</b>
          <span>Plan {centsToEuro(selected.annualCents)} €</span>
          <span>{selected.side === 'income' ? 'Eingenommen' : 'Ausgegeben'} {centsToEuro(selected.actualCents)} €</span>
          <span>Rest {centsToEuro(selected.remainingCents)} €</span>
          <span className="ml-auto flex items-center gap-2">
            Verlauf:
            {PACING_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPacing(selected, mode)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${selected.pacingMode === mode ? 'border-[var(--color-computed)] bg-[var(--color-computed)] text-white' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
              >
                {PACING_LABEL[mode]}
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  )
}

const Legend = ({ children }) => <span className="inline-flex items-center gap-1.5">{children}</span>
const Swatch = ({ color }) => <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
