import { useEffect, useState } from 'react'

import { centsToWholeEuro, parseWholeEuroInput } from './lib/format'

// Verlauf on the phone (Nov 2026, Markus — Pixel 7): one month at a time instead of the
// 12-column grid. Same rows as the grid (Verlauf's rowData), so the figures are the
// grid's: per category Plan1 (editable where the grid lets you edit it), Gebucht (what
// was really booked, coloured like the grid's Plan1 check) and Prog. Split lines show
// under their category once it is opened (▸). Tapping Gebucht opens those bookings in
// Konten. ◀ ▶ switch the month; the checkbox ticks the month off, like the grid header.
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const SECTION_TINT = { einnahmen: '--color-income-tint', ausgaben: '--color-alert-tint', ruecklagen: '--color-savings-tint', anlage: '--color-anlage-tint' }

const euro = (cents) => (cents === 0 ? '–' : centsToWholeEuro(cents))
const CHECK_COLOR = { ok: 'var(--color-plan-ok)', off: 'var(--color-plan-off)' }

function PlanInput({ cents, onSave, small = false }) {
  const shown = cents === 0 ? '' : centsToWholeEuro(cents)
  const [text, setText] = useState(shown)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(shown)
  }, [shown, editing])
  function commit() {
    setEditing(false)
    const next = text.trim() === '' ? 0 : parseWholeEuroInput(text)
    if (next === null || next === cents) setText(shown)
    else onSave(next)
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder="0"
      aria-label="Plan1"
      onFocus={(e) => {
        setEditing(true)
        e.currentTarget.select()
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setText(shown)
          setEditing(false)
          e.currentTarget.blur()
        }
      }}
      className={`tabular-figure w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-right ${small ? 'text-xs' : 'text-sm'}`}
    />
  )
}

export default function VerlaufMonth({ rows, year, initialMonth, closedMonths, onToggleClosed, checkOf, onSave, onOpenBookings, onToggleBlock, nameOf }) {
  const [month, setMonth] = useState(initialMonth)
  const i = month - 1
  const closed = closedMonths.includes(month)

  // One entry per category/pot: its Prog and Plan1 rows plus the shown split lines.
  const blocks = []
  for (const r of rows) {
    if (r.rowLabel === 'Prog') blocks.push({ key: `${r.targetKey}:${r.targetId}`, groupName: r.groupName, section: r.section, name: r.subcatName, prog: r, plan1: null, lines: [] })
    else if (r.rowLabel === 'Plan1') blocks.at(-1).plan1 = r
    else if ((r.rowLabel === 'Plan1-breakdown' || r.rowLabel === 'Rollup') && !r.isPlan0) blocks.at(-1).lines.push(r)
  }
  const groups = []
  for (const b of blocks) {
    if (groups.at(-1)?.name !== b.groupName) groups.push({ name: b.groupName, section: b.section, blocks: [] })
    groups.at(-1).blocks.push(b)
  }

  const booked = (row) => (row.actuals ? row.actuals[i] : null)

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2">
        <button type="button" onClick={() => setMonth((m) => Math.max(1, m - 1))} disabled={month === 1} aria-label="Voriger Monat" className="h-9 w-9 rounded-md border border-[var(--color-border)] text-lg disabled:opacity-30">
          ‹
        </button>
        <div className="flex-1 text-center font-semibold">
          {MONTHS[i]} {year}
        </div>
        <button type="button" onClick={() => setMonth((m) => Math.min(12, m + 1))} disabled={month === 12} aria-label="Nächster Monat" className="h-9 w-9 rounded-md border border-[var(--color-border)] text-lg disabled:opacity-30">
          ›
        </button>
        <label className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
          <input type="checkbox" checked={closed} onChange={() => onToggleClosed(month)} />
          abgehakt
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.5rem_4rem] gap-x-2 px-1 text-xs text-[var(--color-text-muted)]">
        <span />
        <span className="text-right">Plan1</span>
        <span className="text-right">Gebucht</span>
        <span className="text-right">Prog</span>
      </div>

      {groups.map((g) => (
        <section key={g.name} className="overflow-hidden rounded-lg border border-[var(--color-border)]" style={{ backgroundColor: `var(${SECTION_TINT[g.section] ?? '--color-surface'})` }}>
          <h3 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{g.name}</h3>
          {g.blocks.map((b) => {
            const p1 = b.plan1
            const bk = p1 ? booked(p1) : null
            const status = p1 ? checkOf(p1, i) : null
            return (
              <div key={b.key} className="border-t border-[var(--color-border)] first:border-t-0">
                <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.5rem_4rem] items-center gap-x-2 px-3 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-1">
                    {p1?.rowHasBreakdown ? (
                      <button type="button" onClick={() => onToggleBlock(p1.blockKey, !p1.blockExpanded)} aria-label={p1.blockExpanded ? 'Aufteilung zuklappen' : 'Aufteilung zeigen'} className="w-4 shrink-0 text-[var(--color-text-muted)]">
                        {p1.blockExpanded ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <span className="line-clamp-2 hyphens-auto leading-tight [overflow-wrap:anywhere]">{b.name}</span>
                  </span>
                  {p1 && !p1.rowHasBreakdown ? (
                    <PlanInput cents={p1.months[i]} onSave={(c) => onSave(p1, month, c)} />
                  ) : (
                    <span className="tabular-figure text-right">{p1 ? euro(p1.months[i]) : ''}</span>
                  )}
                  {bk === null ? (
                    <span />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenBookings(p1, month)}
                      className="tabular-figure rounded px-1 text-right underline-offset-2 hover:underline"
                      style={{ color: CHECK_COLOR[status], backgroundColor: status === 'unplanned' ? 'var(--color-plan-unplanned)' : undefined }}
                    >
                      {euro(bk)}
                    </button>
                  )}
                  <span className={`tabular-figure text-right ${closed ? '' : 'text-[var(--color-text-muted)]'}`}>{euro(b.prog.months[i])}</span>
                </div>
                {p1?.blockExpanded &&
                  b.lines.map((l) => (
                    <div key={l.rowId} className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.5rem_4rem] items-center gap-x-2 bg-[var(--color-breakdown-tint)] px-3 py-1 text-xs">
                      <span className={`line-clamp-2 leading-tight ${l.isChildLine ? 'pl-8' : 'pl-5'} ${l.rowLabel === 'Rollup' ? 'font-medium' : ''}`}>{nameOf(l)}</span>
                      {l.rowLabel === 'Rollup' ? <span className="tabular-figure text-right">{euro(l.months[i])}</span> : <PlanInput small cents={l.months[i]} onSave={(c) => onSave(l, month, c)} />}
                      {l.actuals ? (
                        <button type="button" onClick={() => onOpenBookings(l, month)} className="tabular-figure text-right" style={{ color: CHECK_COLOR[checkOf(l, i)] }}>
                          {euro(l.actuals[i])}
                        </button>
                      ) : (
                        <span />
                      )}
                      <span />
                    </div>
                  ))}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
