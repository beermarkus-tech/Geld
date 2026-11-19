import { useMemo, useState } from 'react'

import { centsToEuro } from './lib/format'
import { SUBCAT_ORDER } from './lib/categoryOrder'
import { monthDeviations, scopeMonths, waterfallSteps } from './lib/monthView'
import { shortAmount } from './lib/status'

// Dashboard "Monat": where am I this month (or year to date), what is off, and which bookings
// caused it. Logic: lib/monthView.js. Signs as in the books – red = worse than plan (more spent
// or less earned), green = better.
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const BAD = 'var(--color-alert)'
const GOOD = 'var(--color-income)'
const NEUTRAL = 'var(--color-computed)'
const eur = (c) => `${centsToEuro(c)} €`
const signed = (c) => `${c > 0 ? '+' : ''}${centsToEuro(c)} €`

function Waterfall({ data }) {
  const { start, steps, end } = data
  const levels = [start, end, ...steps.flatMap((s) => [s.from, s.to])]
  const lo = Math.min(0, ...levels)
  const hi = Math.max(0, ...levels)
  const W = 70 + (steps.length + 2) * 84
  const H = 250
  const top = 20
  const plotH = 150
  const y = (v) => top + ((hi - v) / (hi - lo || 1)) * plotH
  const bar = (i, from, to, color, label, value) => {
    const x = 60 + i * 84
    const y1 = y(Math.max(from, to))
    const h = Math.max(2, Math.abs(y(from) - y(to)))
    return (
      <g key={label + i}>
        <rect x={x} y={y1} width={54} height={h} fill={color} rx="2" />
        <text x={x + 27} y={y1 - 5} textAnchor="middle" fontSize="11" fill="var(--color-text)">
          {value}
        </text>
        <text transform={`translate(${x + 30},${top + plotH + 14}) rotate(-30)`} textAnchor="end" fontSize="11" fill="var(--color-text)">
          {label.length > 18 ? `${label.slice(0, 17)}…` : label}
        </text>
      </g>
    )
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W, width: '100%', maxHeight: 280 }} role="img" aria-label="Von Plan zu Ist">
      <line x1="54" x2={W - 6} y1={y(0)} y2={y(0)} stroke="var(--color-border)" />
      {bar(0, 0, start, NEUTRAL, 'Plan', shortAmount(start))}
      {steps.map((s, i) => bar(i + 1, s.from, s.to, s.delta < 0 ? BAD : GOOD, s.label, (s.delta > 0 ? '+' : '') + shortAmount(s.delta)))}
      {bar(steps.length + 1, 0, end, NEUTRAL, 'Ist', shortAmount(end))}
    </svg>
  )
}

export default function MonthView({ categories, budgets, transactions, yearNum, defaultMonth, onOpenInKonten }) {
  const [month, setMonth] = useState(null) // null → follows the default (last closed month)
  const [scope, setScope] = useState('month')
  const [showAll, setShowAll] = useState(false)
  const m = month ?? Math.max(1, defaultMonth)
  const months = scopeMonths(scope, m)

  const data = useMemo(
    () => monthDeviations({ categories: categories.filter((c) => !c.parentCategoryId || SUBCAT_ORDER.includes(c.name)), budgets, transactions, year: yearNum, months }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- months derives from scope and m
    [categories, budgets, transactions, yearNum, scope, m],
  )
  const wf = useMemo(() => waterfallSteps(data), [data])
  const visible = data.rows.filter((r) => Math.abs(r.delta) >= 100)
  const shown = showAll ? visible : visible.slice(0, 8)
  const maxDelta = Math.max(1, ...visible.map((r) => Math.abs(r.delta)))
  const open = (txIds) => onOpenInKonten?.({ txIds, from: 'dashboard' })

  const pill = (active, label, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-[var(--color-computed)] bg-[var(--color-computed)] text-white' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={m}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          aria-label="Monat"
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name} {yearNum}
            </option>
          ))}
        </select>
        {pill(scope === 'month', 'Dieser Monat', () => setScope('month'))}
        {pill(scope === 'ytd', 'Seit Jahresbeginn', () => setScope('ytd'))}
        <span className="text-sm text-[var(--color-text-muted)]">Vergleich mit Plan1 · Rot = schlechter als geplant (mehr ausgegeben oder weniger eingenommen)</span>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div>
          <div className="text-xs text-[var(--color-text-muted)]">Plan (Ergebnis)</div>
          <div className="tabular-figure text-lg font-semibold">{eur(data.planTotal)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-muted)]">Ist</div>
          <div className="tabular-figure text-lg font-semibold">{eur(data.actualTotal)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-muted)]">Abweichung</div>
          <div className="tabular-figure text-lg font-semibold" style={{ color: data.deltaTotal < 0 ? BAD : data.deltaTotal > 0 ? GOOD : undefined }}>
            {signed(data.deltaTotal)}
          </div>
        </div>
      </div>

      {data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
          <div className="px-1 pb-1 text-xs text-[var(--color-text-muted)]">Von Plan zu Ist – die größten Abweichungen</div>
          <Waterfall data={wf} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {shown.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Keine Abweichungen in diesem Zeitraum.</p>}
        {shown.map((r) => (
          <div key={r.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
            <button type="button" onClick={() => open(r.txIds)} className="flex w-full items-center gap-3 text-left" title="Buchungen in Konten zeigen">
              <span className="w-44 shrink-0 truncate font-medium">{r.name}</span>
              <span className="tabular-figure w-28 shrink-0 text-right text-sm text-[var(--color-text-muted)]">Plan {shortAmount(r.planned)}</span>
              <span className="tabular-figure w-28 shrink-0 text-right text-sm">Ist {shortAmount(r.actual)}</span>
              {/* diverging bar: left = worse, right = better, zero line in the middle */}
              <span className="relative h-4 min-w-24 flex-1">
                <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border)]" />
                <span
                  className="absolute inset-y-0.5 rounded-sm"
                  style={{
                    background: r.delta < 0 ? BAD : GOOD,
                    width: `${(Math.abs(r.delta) / maxDelta) * 50}%`,
                    left: r.delta < 0 ? `${50 - (Math.abs(r.delta) / maxDelta) * 50}%` : '50%',
                  }}
                />
              </span>
              <span className="tabular-figure w-28 shrink-0 text-right font-semibold" style={{ color: r.delta < 0 ? BAD : GOOD }}>
                {signed(r.delta)}
              </span>
            </button>
            {r.drivers.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-1 text-sm">
                {r.drivers.map((d) => (
                  <li key={d.txId + d.cents}>
                    <button type="button" onClick={() => open([d.txId])} className="flex w-full items-baseline gap-3 text-left hover:underline" title="Diese Buchung in Konten zeigen">
                      <span className="w-12 shrink-0 text-[var(--color-text-muted)]">{d.date.slice(8, 10)}.{d.date.slice(5, 7)}.</span>
                      <span className="min-w-0 flex-1 truncate">
                        {d.label}
                        {d.detail ? <span className="text-[var(--color-text-muted)]"> · {d.detail}</span> : null}
                      </span>
                      {d.unplanned && <span className="rounded px-1.5 text-xs" style={{ background: 'var(--color-needs-entry)', color: '#1f1a00' }}>ungeplant</span>}
                      {d.main && <span className="rounded border border-[var(--color-alert)] px-1.5 text-xs text-[var(--color-alert)]">Hauptgrund</span>}
                      <span className="tabular-figure shrink-0">{eur(d.cents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {visible.length > 8 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start text-sm text-[var(--color-computed)] underline">
            {showAll ? 'Weniger anzeigen' : `Alle ${visible.length} anzeigen`}
          </button>
        )}
      </div>
    </div>
  )
}
