import { useMemo } from 'react'

import { forecastSeries, kEuro, niceStep } from './lib/forecast'

// Dashboard "Prognose" (spec.md §3d): cash (Barkonten + Bargeld) month by month as three lines –
// Plan0 dashed, Plan1 black, Prognose red (Verlauf's Prog line) – on the left axis, and the stacked
// bars Geldanlage (dark) + Sparkonten (light) on the right axis. Figures: lib/forecast.js.
const LABELS = ['Start', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const W = 1180
const LEFT = 80
const RIGHT = 80
const TOP = 30
const PLOT_H = 440
const H = TOP + PLOT_H + 40
const STEP = (W - LEFT - RIGHT) / LABELS.length
const BAR_W = STEP * 0.62
const PROG = 'var(--color-alert)'
const PLAN = 'var(--color-text)'
const ANLAGE = 'color-mix(in srgb, var(--color-income) 42%, var(--color-surface))'
const SPAR = 'color-mix(in srgb, var(--color-income) 18%, var(--color-surface))'

export default function ForecastChart({ accounts, categories, tags, budgets, transactions, yearNum, closedMonths }) {
  const data = useMemo(
    () => forecastSeries({ accounts, categories, tags, budgets, transactions, year: yearNum, closedMonths }),
    [accounts, categories, tags, budgets, transactions, yearNum, closedMonths],
  )
  const pts = [{ m: 0, plan0: data.start.cash, plan1: data.start.cash, prog: data.start.cash, geldanlage: data.start.geldanlage, sparkonten: data.start.sparkonten }, ...data.months]

  // left axis (lines) and right axis (bars) share the same number of grid lines
  const lineVals = pts.flatMap((p) => [p.plan0, p.plan1, p.prog])
  const lMinRaw = Math.min(0, ...lineVals)
  const lMaxRaw = Math.max(1, ...lineVals)
  let stepL = niceStep(lMaxRaw - lMinRaw, 4)
  const lo = Math.floor(lMinRaw / stepL) * stepL
  const n = Math.max(1, Math.ceil((lMaxRaw - lo) / stepL))
  const hi = lo + n * stepL
  const barMax = Math.max(1, ...pts.map((p) => Math.max(0, p.geldanlage) + Math.max(0, p.sparkonten)))
  const stepR = niceStep(barMax, n)
  const hiR = stepR * n
  const yL = (v) => TOP + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H
  const yR = (v) => TOP + PLOT_H - (Math.max(0, v) / hiR) * PLOT_H
  const cx = (i) => LEFT + STEP * i + STEP / 2
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${cx(i)},${yL(p[key])}`).join(' ')
  stepL = stepL || 1

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <h2 className="text-lg font-semibold">Prognose {yearNum}</h2>
        <span className="text-sm text-[var(--color-text-muted)]">
          Linien: Barkonten + Bargeld + offene Außenstände am Jahresanfang (linke Achse) · Balken: Geldanlage + Sparkonten (rechte Achse) · abgeschlossene Monate gebucht, offene aus der Planung
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <Legend><span className="inline-block w-6 border-t-[3px] border-[var(--color-text)]" /> Plan1</Legend>
        <Legend><span className="inline-block w-6 border-t-2 border-dashed border-[var(--color-text)]" /> Plan0</Legend>
        <Legend><span className="inline-block w-6 border-t-[3px] border-[var(--color-alert)]" /> Prognose (Barkonten)</Legend>
        <Legend><Swatch color={SPAR} /> Sparkonten</Legend>
        <Legend><Swatch color={ANLAGE} /> Geldanlage</Legend>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 900, width: '100%' }} role="img" aria-label="Prognose">
          {Array.from({ length: n + 1 }, (_, k) => {
            const y = TOP + PLOT_H - (k / n) * PLOT_H
            const lv = lo + k * stepL
            return (
              <g key={k}>
                <line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={lv === 0 ? 1.5 : 1} />
                <text x={LEFT - 8} y={y + 4} textAnchor="end" fontSize="12" fill="var(--color-text-muted)">{kEuro(lv)}</text>
                <text x={W - RIGHT + 8} y={y + 4} fontSize="12" fill="var(--color-text-muted)">{kEuro(k * stepR)}</text>
              </g>
            )
          })}
          {/* the zero line of the left axis */}
          {lo < 0 && <line x1={LEFT} x2={W - RIGHT} y1={yL(0)} y2={yL(0)} stroke="var(--color-text-muted)" strokeWidth="1.2" />}
          {pts.map((p, i) => {
            const x = cx(i) - BAR_W / 2
            const yA = yR(p.geldanlage)
            const yS = yR(Math.max(0, p.geldanlage) + Math.max(0, p.sparkonten))
            return (
              <g key={`bar${i}`}>
                <title>{`${LABELS[i]}: Geldanlage ${kEuro(p.geldanlage)}, Sparkonten ${kEuro(p.sparkonten)}`}</title>
                <rect x={x} y={yA} width={BAR_W} height={Math.max(0, yR(0) - yA)} fill={ANLAGE} />
                <rect x={x} y={yS} width={BAR_W} height={Math.max(0, yA - yS)} fill={SPAR} />
                <text x={cx(i)} y={yR(0) - 6} textAnchor="middle" fontSize="11" fill="var(--color-income)">{kEuro(p.geldanlage)}</text>
                {/* at the bottom of the light segment, as in Markus's Sheet – less in the way of the lines */}
                <text x={cx(i)} y={yA - 6} textAnchor="middle" fontSize="11" fill="var(--color-income)">{kEuro(p.sparkonten)}</text>
                <text x={cx(i)} y={TOP + PLOT_H + 22} textAnchor="middle" fontSize="13" fontWeight={p.closed ? 600 : 400} fill="var(--color-text)">{LABELS[i]}</text>
              </g>
            )
          })}
          <path d={path('plan0')} fill="none" stroke={PLAN} strokeWidth="2" strokeDasharray="9 6" />
          <path d={path('plan1')} fill="none" stroke={PLAN} strokeWidth="3" />
          <path d={path('prog')} fill="none" stroke={PROG} strokeWidth="3" />
          {pts.map((p, i) => (
            <g key={`lbl${i}`}>
              <title>{`${LABELS[i]}: Prognose ${kEuro(p.prog)} · Plan1 ${kEuro(p.plan1)} · Plan0 ${kEuro(p.plan0)}`}</title>
              <text x={cx(i)} y={yL(p.prog) - 9} textAnchor="middle" fontSize="12" fontWeight="600" fill={PROG}>{kEuro(p.prog)}</text>
              <text x={cx(i)} y={yL(p.plan1) + 18} textAnchor="middle" fontSize="12" fill={PLAN}>{kEuro(p.plan1)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

const Legend = ({ children }) => <span className="inline-flex items-center gap-1.5">{children}</span>
const Swatch = ({ color }) => <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
