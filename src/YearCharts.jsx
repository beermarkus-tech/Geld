import { useMemo } from 'react'

import { kEuro, niceStep } from './lib/forecast'
import { potLocations, yearBalance } from './lib/yearBalance'

// The two charts under the Prognose chart (spec.md §3d, Nov 2026, from Markus's Sheet), side by side
// (stacked on a narrow screen):
//  - Jahresbilanz: Jahresanfang → Einnahmen → Ausgaben → Jahresende. Bars = Prognose (the start and
//    end bars stacked by Barkonten + savings pots), lines = Plan0 / Plan1 / Prognose at each point.
//  - Wo liegt das Geld: one bar per savings pot, split by the account that holds it, at the end of
//    the last closed month.
// Figures: lib/yearBalance.js. Colours: --series-1 (Barkonten) then one per pot, the same in both charts.
const PROG = 'var(--color-alert)'
const PLAN = 'var(--color-text)'
const INCOME = 'color-mix(in srgb, var(--color-income) 55%, var(--color-surface))'
const EXPENSE = 'color-mix(in srgb, var(--color-expense) 60%, var(--color-surface))'
const seriesColor = (i) => `var(--series-${(i % 8) + 1})`
const pct = (part, total) => `${Math.round((100 * part) / total)} %`
const dateDe = (iso) => iso.split('-').reverse().join('.')

export default function YearCharts({ accounts, categories, tags, budgets, transactions, yearNum, closedMonths }) {
  const yb = useMemo(
    () => yearBalance({ accounts, categories, tags, budgets, transactions, year: yearNum, closedMonths }),
    [accounts, categories, tags, budgets, transactions, yearNum, closedMonths],
  )
  const loc = useMemo(() => potLocations({ accounts, tags, transactions, year: yearNum, closedMonths }), [accounts, tags, transactions, yearNum, closedMonths])
  // one colour per part id (Barkonten first, then the pots), shared by both charts
  const colorOf = Object.fromEntries(yb.startParts.map((p, i) => [p.id, seriesColor(i)]))
  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2">
      <Jahresbilanz yb={yb} colorOf={colorOf} yearNum={yearNum} />
      <WoLiegtDasGeld loc={loc} colorOf={colorOf} />
    </div>
  )
}

const W = 600
const LEFT = 64
const RIGHT = 16
const TOP = 24
const PLOT_H = 300
const H = TOP + PLOT_H + 32
const COLS = ['Jahresanfang', 'Einnahmen', 'Ausgaben', 'Jahresende']

function Jahresbilanz({ yb, colorOf, yearNum }) {
  const { versions: v } = yb
  const sumParts = (parts) => parts.reduce((s, p) => s + Math.max(0, p.cents), 0)
  const point = (x) => [x.start, x.einnahmen, x.ausgaben, x.ende]
  const vals = [...point(v.plan0), ...point(v.plan1), ...point(v.prog), sumParts(yb.startParts), sumParts(yb.endParts)]
  const step = niceStep(Math.max(...vals, 1), 4)
  const n = Math.max(1, Math.ceil(Math.max(...vals, 1) / step))
  const hi = n * step
  const y = (c) => TOP + PLOT_H - (Math.max(0, c) / hi) * PLOT_H
  const colW = (W - LEFT - RIGHT) / 4
  const cx = (i) => LEFT + colW * i + colW / 2
  const barW = colW * 0.56
  const path = (x) => point(x).map((c, i) => `${i ? 'L' : 'M'}${cx(i)},${y(c)}`).join(' ')

  const stacked = (parts, i) => {
    let base = 0
    return parts.map((p) => {
      const c = Math.max(0, p.cents)
      const y1 = y(base + c)
      const h = y(base) - y1
      base += c
      return (
        <g key={p.id}>
          <title>{`${p.name}: ${kEuro(p.cents)}`}</title>
          <rect x={cx(i) - barW / 2} y={y1 + 1} width={barW} height={Math.max(0, h - 2)} rx="2" fill={colorOf[p.id]} />
          {h >= 13 && (
            <text x={cx(i)} y={y1 + h / 2 + 3.5} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="600" style={{ paintOrder: 'stroke' }} stroke="rgba(0,0,0,0.35)" strokeWidth="2">
              {kEuro(p.cents)}
            </text>
          )}
        </g>
      )
    })
  }
  const single = (cents, i, fill, label) => (
    <g>
      <title>{`${label} (Prognose): ${kEuro(cents)}`}</title>
      <rect x={cx(i) - barW / 2} y={y(cents)} width={barW} height={Math.max(0, y(0) - y(cents))} rx="3" fill={fill} />
    </g>
  )
  const totals = [sumParts(yb.startParts), v.prog.einnahmen, v.prog.ausgaben, sumParts(yb.endParts)]

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-base font-semibold">Jahresbilanz {yearNum}</h3>
        <span className="text-xs text-[var(--color-text-muted)]">Balken: Prognose · Sparen in einen Topf ist keine Ausgabe</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <Legend><span className="inline-block w-5 border-t-2 border-dashed border-[var(--color-text)]" /> Plan0</Legend>
        <Legend><span className="inline-block w-5 border-t-[3px] border-[var(--color-text)]" /> Plan1</Legend>
        <Legend><span className="inline-block w-5 border-t-[3px] border-[var(--color-alert)]" /> Prognose</Legend>
        {yb.startParts.map((p) => (
          <Legend key={p.id}><Swatch color={colorOf[p.id]} /> {p.name}</Legend>
        ))}
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Jahresbilanz">
          {Array.from({ length: n + 1 }, (_, k) => (
            <g key={k}>
              <line x1={LEFT} x2={W - RIGHT} y1={y(k * step)} y2={y(k * step)} stroke="var(--color-border)" />
              <text x={LEFT - 8} y={y(k * step) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-muted)">{kEuro(k * step)}</text>
            </g>
          ))}
          {stacked(yb.startParts, 0)}
          {single(v.prog.einnahmen, 1, INCOME, 'Einnahmen')}
          {single(v.prog.ausgaben, 2, EXPENSE, 'Ausgaben')}
          {stacked(yb.endParts, 3)}
          {totals.map((c, i) => (
            <g key={COLS[i]}>
              <text x={cx(i) + barW / 2 + 4} y={y(c) + 4} fontSize="11.5" fontWeight="600" fill="var(--color-text)">{kEuro(c)}</text>
              <text x={cx(i)} y={TOP + PLOT_H + 22} textAnchor="middle" fontSize="12.5" fill="var(--color-text)">{COLS[i]}</text>
            </g>
          ))}
          <path d={path(v.plan0)} fill="none" stroke={PLAN} strokeWidth="2" strokeDasharray="8 5" />
          <path d={path(v.plan1)} fill="none" stroke={PLAN} strokeWidth="2.5" />
          <path d={path(v.prog)} fill="none" stroke={PROG} strokeWidth="2.5" />
          {[0, 1, 2, 3].map((i) => (
            <g key={`pt${i}`}>
              <title>{`${COLS[i]}: Prognose ${kEuro(point(v.prog)[i])} · Plan1 ${kEuro(point(v.plan1)[i])} · Plan0 ${kEuro(point(v.plan0)[i])}`}</title>
              <circle cx={cx(i)} cy={y(point(v.prog)[i])} r="4" fill={PROG} stroke="var(--color-surface)" strokeWidth="2" />
              <rect x={cx(i) - colW / 2} y={TOP} width={colW} height={PLOT_H} fill="transparent" />
            </g>
          ))}
        </svg>
      </div>
      {/* the figures behind the lines */}
      <div className="overflow-x-auto">
      <table className="text-xs tabular-figure">
        <thead className="text-[var(--color-text-muted)]">
          <tr>
            <th />
            {COLS.map((c) => (
              <th key={c} className="px-2 text-right font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[['Plan0', v.plan0], ['Plan1', v.plan1], ['Prognose', v.prog]].map(([name, x]) => (
            <tr key={name}>
              <td className="pr-2 font-medium">{name}</td>
              {point(x).map((c, i) => (
                <td key={i} className="px-2 text-right">{kEuro(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  )
}

const ROW_H = 46
function WoLiegtDasGeld({ loc, colorOf }) {
  const max = Math.max(1, ...loc.pots.map((p) => p.total))
  const NAME_W = 110
  const BAR_W = W - NAME_W - 70
  const x = (c) => (Math.max(0, c) / max) * BAR_W
  const h2 = Math.max(60, loc.pots.length * ROW_H + 8)
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-base font-semibold">Wo liegt das Geld</h3>
        <span className="text-xs text-[var(--color-text-muted)]">Stand {dateDe(loc.date)} (Ende des letzten abgeschlossenen Monats)</span>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        {loc.pots.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-text-muted)]">Keine Rücklagen an diesem Tag.</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${h2}`} className="w-full" role="img" aria-label="Wo liegt das Geld">
            {loc.pots.map((p, r) => {
              const top = 8 + r * ROW_H
              let base = 0
              return (
                <g key={p.id}>
                  <text x={NAME_W - 8} y={top + 15} textAnchor="end" fontSize="12" fill="var(--color-text)">{p.name}</text>
                  {p.parts.map((part, k) => {
                    const x0 = NAME_W + x(base)
                    const w = x(part.cents)
                    base += Math.max(0, part.cents)
                    // the parts of one pot: its colour, each further account a lighter shade, 2px apart
                    const fill = `color-mix(in srgb, ${colorOf[p.id] ?? 'var(--color-text-muted)'} ${[100, 65, 42, 28][k] ?? 20}%, var(--color-surface))`
                    return (
                      <g key={part.accountId}>
                        <title>{`${p.name} · ${part.name}: ${kEuro(part.cents)} (${pct(part.cents, p.total)})`}</title>
                        <rect x={x0 + (k ? 1 : 0)} y={top + 2} width={Math.max(0, w - (k ? 2 : 1))} height="20" rx="2" fill={fill} />
                      </g>
                    )
                  })}
                  <text x={NAME_W + x(p.total) + 6} y={top + 16} fontSize="11.5" fontWeight="600" fill="var(--color-text)">{kEuro(p.total)}</text>
                  <text x={NAME_W} y={top + 36} fontSize="10.5" fill="var(--color-text-muted)">
                    {p.parts.map((part) => `${part.name} ${pct(part.cents, p.total)}`).join(' · ')}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </section>
  )
}

const Legend = ({ children }) => <span className="inline-flex items-center gap-1.5">{children}</span>
const Swatch = ({ color }) => <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
