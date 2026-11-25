import { useMemo, useState } from 'react'

import { forecastSeries, kEuro, niceStep } from './lib/forecast'
import { useNarrow } from './lib/useNarrow'

// Dashboard "Prognose" (spec.md §3d): cash (Barkonten + Bargeld) month by month as three lines –
// Plan0 dashed, Plan1 black, Prognose red (Verlauf's Prog line) – on the left axis, and the stacked
// bars Geldanlage (dark) + Sparkonten (light) on the right axis. Figures: lib/forecast.js.
const LABELS = ['Start', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const W = 1180
// Phone (Nov 2026, Pixel 7): the whole year fits the width instead of scrolling; the chart is
// drawn taller and with bigger type (it is scaled down ~3×), and the many value labels give way
// to one line under the chart for the tapped month.
const geometry = (narrow) => {
  const LEFT = narrow ? 150 : 80
  const RIGHT = narrow ? 150 : 80
  const TOP = 30
  const PLOT_H = narrow ? 1000 : 440
  const STEP = (W - LEFT - RIGHT) / LABELS.length
  return { LEFT, RIGHT, TOP, PLOT_H, H: TOP + PLOT_H + (narrow ? 80 : 40), STEP, BAR_W: STEP * 0.62, AXIS_FS: narrow ? 36 : 12, MONTH_FS: narrow ? 34 : 13 }
}
const PROG = 'var(--color-alert)'
const PLAN = 'var(--color-text)'
// Three clearly different greens (Nov 2026): Geldanlage dark, Sparkonten medium, Investment Cash the
// lightest ("parked, not yet invested", lib/investmentCash.js; plain, no stripes – Markus).
const ANLAGE = 'var(--chart-anlage)'
const SPAR = 'var(--chart-spar)'
const IC = 'var(--chart-ic)'
// a thin outline keeps the lightest segment apart from Sparkonten (and from the background) without stripes
const IC_OUTLINE = 'color-mix(in srgb, var(--color-income) 45%, var(--color-surface))'

export default function ForecastChart({ accounts, categories, tags, budgets, transactions, yearNum, closedMonths, closedByYear }) {
  const narrow = useNarrow()
  const { LEFT, RIGHT, TOP, PLOT_H, H, STEP, BAR_W, AXIS_FS, MONTH_FS } = geometry(narrow)
  const [picked, setPicked] = useState(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const data = useMemo(
    () => forecastSeries({ accounts, categories, tags, budgets, transactions, year: yearNum, closedMonths, closedByYear }),
    [accounts, categories, tags, budgets, transactions, yearNum, closedMonths, closedByYear],
  )
  const pts = [
    { m: 0, plan0: data.start.cash, plan1: data.start.cash, prog: data.start.cash, geldanlage: data.start.geldanlage, sparkonten: data.start.sparkonten, investmentCash: data.start.investmentCash },
    ...data.months,
  ]

  // left axis (lines) and right axis (bars) share the same number of grid lines
  const lineVals = pts.flatMap((p) => [p.plan0, p.plan1, p.prog])
  const lMinRaw = Math.min(0, ...lineVals)
  const lMaxRaw = Math.max(1, ...lineVals)
  let stepL = niceStep(lMaxRaw - lMinRaw, 4)
  const lo = Math.floor(lMinRaw / stepL) * stepL
  const n = Math.max(1, Math.ceil((lMaxRaw - lo) / stepL))
  const hi = lo + n * stepL
  const barMax = Math.max(1, ...pts.map((p) => Math.max(0, p.geldanlage) + Math.max(0, p.sparkonten) + Math.max(0, p.investmentCash)))
  const stepR = niceStep(barMax, n)
  const hiR = stepR * n
  const yL = (v) => TOP + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H
  const yR = (v) => TOP + PLOT_H - (Math.max(0, v) / hiR) * PLOT_H
  const cx = (i) => LEFT + STEP * i + STEP / 2
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${cx(i)},${yL(p[key])}`).join(' ')
  stepL = stepL || 1

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <h2 className="text-lg font-semibold">Prognose {yearNum}</h2>
        <button type="button" onClick={() => setInfoOpen((v) => !v)} aria-label="Erklärung" className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] md:hidden">
          i
        </button>
        <span className={`text-sm text-[var(--color-text-muted)] ${infoOpen ? '' : 'max-md:hidden'}`}>
          Linien: Barkonten (ohne Investment Cash) + Bargeld + offene Außenstände am Jahresanfang (linke Achse) · Balken: Geldanlage + Sparkonten + Investment Cash (rechte Achse) · abgeschlossene Monate gebucht, offene aus der Planung
        </span>
        {data.start.provisional && (
          <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--color-needs-entry)', color: '#1f1a00' }}>
            Start vorläufig: Prognose-Jahresende {yearNum - 1} ({yearNum - 1} hat noch offene Monate)
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <Legend><span className="inline-block w-6 border-t-[3px] border-[var(--color-text)]" /> Plan1</Legend>
        <Legend><span className="inline-block w-6 border-t-2 border-dashed border-[var(--color-text)]" /> Plan0</Legend>
        <Legend><span className="inline-block w-6 border-t-[3px] border-[var(--color-alert)]" /> Prognose (Barkonten)</Legend>
        <Legend><Swatch color={IC} /> Investment Cash</Legend>
        <Legend><Swatch color={SPAR} /> Sparkonten</Legend>
        <Legend><Swatch color={ANLAGE} /> Geldanlage</Legend>
      </div>
      <div className="shrink-0 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: narrow ? 0 : 900, width: '100%' }} role="img" aria-label="Prognose">
          {Array.from({ length: n + 1 }, (_, k) => {
            const y = TOP + PLOT_H - (k / n) * PLOT_H
            const lv = lo + k * stepL
            return (
              <g key={k}>
                <line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={lv === 0 ? 1.5 : 1} />
                <text x={LEFT - 8} y={y + AXIS_FS / 3} textAnchor="end" fontSize={AXIS_FS} fill="var(--color-text-muted)">{kEuro(lv)}</text>
                <text x={W - RIGHT + 8} y={y + AXIS_FS / 3} fontSize={AXIS_FS} fill="var(--color-text-muted)">{kEuro(k * stepR)}</text>
              </g>
            )
          })}
          {/* the zero line of the left axis */}
          {lo < 0 && <line x1={LEFT} x2={W - RIGHT} y1={yL(0)} y2={yL(0)} stroke="var(--color-text-muted)" strokeWidth="1.2" />}
          {pts.map((p, i) => {
            const x = cx(i) - BAR_W / 2
            const yA = yR(p.geldanlage)
            const yS = yR(Math.max(0, p.geldanlage) + Math.max(0, p.sparkonten))
            const yI = yR(Math.max(0, p.geldanlage) + Math.max(0, p.sparkonten) + Math.max(0, p.investmentCash))
            return (
              <g key={`bar${i}`} onClick={() => setPicked(i)}>
                {narrow && <rect x={cx(i) - STEP / 2} y={TOP} width={STEP} height={PLOT_H} fill={picked === i ? 'var(--color-bg)' : 'transparent'} />}
                <title>{`${LABELS[i]}: Geldanlage ${kEuro(p.geldanlage)}, Sparkonten ${kEuro(p.sparkonten)}, Investment Cash ${kEuro(p.investmentCash)}`}</title>
                <rect x={x} y={yA} width={BAR_W} height={Math.max(0, yR(0) - yA)} fill={ANLAGE} />
                <rect x={x} y={yS} width={BAR_W} height={Math.max(0, yA - yS)} fill={SPAR} />
                {yS - yI > 0 && <rect x={x + 0.5} y={yI + 0.5} width={BAR_W - 1} height={Math.max(0, yS - yI - 1)} fill={IC} stroke={IC_OUTLINE} strokeWidth="1" />}
                {/* Investment Cash: its value at the bottom of its segment; a planned minus (more invested
                    than topped up) is shown in red above the bar instead – nothing to draw there. */}
                {!narrow && p.investmentCash > 0 && yS - yI >= 14 && (
                  <text x={cx(i)} y={yS - 4} textAnchor="middle" fontSize="11" fill="var(--color-income)">{kEuro(p.investmentCash)}</text>
                )}
                {!narrow && p.investmentCash < 0 && (
                  <text x={cx(i)} y={yS - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-alert)">
                    <title>Investment Cash im Minus: mehr Anlage geplant als aufgefüllt</title>
                    {kEuro(p.investmentCash)}
                  </text>
                )}
                {!narrow && <text x={cx(i)} y={yR(0) - 6} textAnchor="middle" fontSize="11" fill="var(--color-income)">{kEuro(p.geldanlage)}</text>}
                {/* at the bottom of the light segment, as in Markus's Sheet – less in the way of the lines */}
                {!narrow && <text x={cx(i)} y={yA - 6} textAnchor="middle" fontSize="11" fill="var(--color-income)">{kEuro(p.sparkonten)}</text>}
                <text x={cx(i)} y={TOP + PLOT_H + MONTH_FS * 1.6} textAnchor="middle" fontSize={MONTH_FS} fontWeight={p.closed ? 600 : 400} fill="var(--color-text)">{narrow ? (i === 0 ? 'S' : LABELS[i][0]) : i === 0 && data.start.provisional ? 'Start (vorl.)' : LABELS[i]}</text>
              </g>
            )
          })}
          <path d={path('plan0')} fill="none" stroke={PLAN} strokeWidth={narrow ? 5 : 2} strokeDasharray={narrow ? '20 14' : '9 6'} pointerEvents="none" />
          <path d={path('plan1')} fill="none" stroke={PLAN} strokeWidth={narrow ? 8 : 3} pointerEvents="none" />
          <path d={path('prog')} fill="none" stroke={PROG} strokeWidth={narrow ? 8 : 3} pointerEvents="none" />
          {!narrow && pts.map((p, i) => (
            <g key={`lbl${i}`}>
              <title>{`${LABELS[i]}: Prognose ${kEuro(p.prog)} · Plan1 ${kEuro(p.plan1)} · Plan0 ${kEuro(p.plan0)}`}</title>
              <text x={cx(i)} y={yL(p.prog) - 9} textAnchor="middle" fontSize="12" fontWeight="600" fill={PROG}>{kEuro(p.prog)}</text>
              <text x={cx(i)} y={yL(p.plan1) + 18} textAnchor="middle" fontSize="12" fill={PLAN}>{kEuro(p.plan1)}</text>
            </g>
          ))}
        </svg>
      </div>
      {narrow && (
        <p className="text-sm">
          {picked === null ? (
            <span className="text-[var(--color-text-muted)]">Monat antippen für die Zahlen.</span>
          ) : (
            <>
              <b>{picked === 0 ? 'Start' : LABELS[picked]}:</b> <span style={{ color: PROG }}>Prognose {kEuro(pts[picked].prog)}</span> · Plan1 {kEuro(pts[picked].plan1)} · Plan0 {kEuro(pts[picked].plan0)} · Sparkonten {kEuro(pts[picked].sparkonten)} · Geldanlage {kEuro(pts[picked].geldanlage)} · Investment Cash {kEuro(pts[picked].investmentCash)}
            </>
          )}
        </p>
      )}
    </div>
  )
}

const Legend = ({ children }) => <span className="inline-flex items-center gap-1.5">{children}</span>
const Swatch = ({ color }) => <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
