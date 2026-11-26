import { Fragment, useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'

import { db } from './firebase'
import { claimCategoryIds } from './lib/claims'
import { DEFAULT_ITEMS, SECTIONS, accountHint, autoChecks, autoTicker, isDone, openItems, toggleTick } from './lib/monthClose'
import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { useNarrow } from './lib/useNarrow'
import { useTags } from './TagsProvider'

// Monatsabschluss (spec.md §3h, Nov 2026): the year's checklist, one column per month (tablet) or
// one month at a time (phone). Automatic items show ✓ / ⚠ (tap ⚠ → where the problem is) or an
// info text; manual items are checkboxes (settings/{year}.closeTicks). "Abschließen" is the same
// switch as the month's tick in Verlauf (settings/{year}.closedMonths) — warns when items are open.
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
// Cell tints (Nov 2026, Markus): done = light green, needs attention = light amber.
const TINT = { ok: 'color-mix(in srgb, var(--color-plan-ok) 16%, transparent)', warn: 'color-mix(in srgb, var(--color-plan-off) 22%, transparent)' }
const euro = (cents) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function AutoCell({ s, onJump, onSelect, wide = false }) {
  if (!s || s.state === null) return <span className="text-[var(--color-text-muted)]">·</span>
  const color = s.state === 'ok' ? 'var(--color-plan-ok)' : s.state === 'warn' ? 'var(--color-plan-off)' : 'var(--color-text-muted)'
  const icon = s.state === 'ok' ? '✓' : s.state === 'warn' ? '⚠' : 'i'
  const body = (
    <>
      <span className="font-semibold">{icon}</span>
      {wide && s.text && <span className="ml-1.5 text-xs">{s.text}</span>}
    </>
  )
  if (onSelect)
    return (
      <button type="button" onClick={onSelect} className="rounded px-1" style={{ color }}>
        {body}
      </button>
    )
  return s.jump ? (
    <button type="button" onClick={() => onJump(s.jump)} className="rounded px-1 text-left hover:underline" style={{ color }}>
      {body}
    </button>
  ) : (
    <span className="px-1" style={{ color }}>
      {body}
    </span>
  )
}

export default function Monatsabschluss({ year, active = true, onOpenInKonten, onNavigate }) {
  const syncWhenVisible = useDeferWhileHidden(active)
  const { tags } = useTags()
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState([])
  const [transactions, setTransactions] = useState([])
  const [settings, setSettings] = useState([])
  const narrow = useNarrow()

  useEffect(() => {
    const subs = [
      onSnapshot(collection(db, 'accounts'), (s) => setAccounts(s.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'categories'), (s) => setCategories(s.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'budgets'), (s) => setBudgets(s.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'settings'), (s) => setSettings(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'transactions'), (s) => {
        const v = s.docs.map((d) => d.data())
        syncWhenVisible(() => setTransactions(v))
      }),
    ]
    return () => subs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once
  }, [])

  const yearNum = Number(year)
  const now = new Date()
  const uptoMonth = yearNum < now.getFullYear() ? 12 : yearNum > now.getFullYear() ? 0 : now.getMonth() + 1
  const yearDoc = settings.find((s) => s.id === String(yearNum)) ?? {}
  const closedMonths = yearDoc.closedMonths ?? []
  const ticks = yearDoc.closeTicks ?? {}
  const items = DEFAULT_ITEMS

  const status = useMemo(() => {
    const claimCats = claimCategoryIds(categories)
    const tagById = Object.fromEntries(tags.map((t) => [t.id, t]))
    return autoChecks({ year: yearNum, accounts, categories, tags, budgets, transactions, claimCats, needsCtx: { claimCategoryIds: claimCats, tagById }, uptoMonth })
  }, [yearNum, accounts, categories, tags, budgets, transactions, uptoMonth])

  const autoTick = useMemo(() => autoTicker(transactions, yearNum), [transactions, yearNum])
  const saveYear = (fields) => setDoc(doc(db, 'settings', String(yearNum)), { id: String(yearNum), ...fields }, { merge: true })
  const tick = (itemId, m) => saveYear({ closeTicks: toggleTick(ticks, itemId, m) })
  function toggleClosed(m) {
    if (closedMonths.includes(m)) {
      if (!window.confirm(`${MONTHS_LONG[m - 1]} wieder öffnen? (auch in Verlauf)`)) return
      saveYear({ closedMonths: closedMonths.filter((x) => x !== m) })
      return
    }
    const open = openItems(items, m, ticks, status, autoTick)
    if (open.length > 0 && !window.confirm(`Noch offen: ${open.join(', ')}.\n\n${MONTHS_LONG[m - 1]} trotzdem abschließen?`)) return
    saveYear({ closedMonths: [...closedMonths, m].sort((a, b) => a - b) })
  }
  function jump(j) {
    if (j.view === 'konten') {
      const ids = j.txIds ?? transactions.filter((t) => !t.deletedAt && (t.fromAccountId === j.accountId || t.toAccountId === j.accountId) && t.date?.startsWith(String(yearNum))).map((t) => t.id)
      onOpenInKonten?.({ txIds: ids, year: String(yearNum), from: 'monatsabschluss' })
    } else onNavigate?.(j.view)
  }
  const hintText = (it, m) => {
    if (!it.accountId || m > uptoMonth) return ''
    const h = accountHint(it.accountId, yearNum, m, transactions)
    return `${euro(h.balanceCents)} · ${h.count} ${h.count === 1 ? 'Buchung' : 'Buchungen'}`
  }

  // A manual checkbox; an autoTick item whose rule holds that month shows a green ✓ instead.
  const Check = ({ it, m, className = '', label, wide = false, onSelect }) => {
    const reason = it.autoTick && m <= uptoMonth ? autoTick(it, m) : null
    if (reason)
      return (
        <button type="button" onClick={onSelect} disabled={!onSelect} className="text-[var(--color-plan-ok)]">
          <span className="font-semibold">✓</span>
          {wide && <span className="ml-1.5 text-xs">automatisch · {reason}</span>}
        </button>
      )
    const checked = m <= uptoMonth && isDone(it, m, ticks, autoTick)
    return (
      // A manual tick looks like the automatic ✓, but keeps a box around it (Nov 2026, Markus): the
      // box says "you can tick this yourself".
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={m > uptoMonth}
        onClick={() => tick(it.id, m)}
        aria-label={label ?? it.label}
        className={`flex items-center justify-center rounded-[3px] border font-semibold leading-none text-[var(--color-plan-ok)] disabled:opacity-40 ${checked ? 'border-[var(--color-plan-ok)]' : 'border-[var(--color-text-muted)]'} ${className || 'h-4 w-4 text-xs'}`}
      >
        {checked ? '✓' : ''}
      </button>
    )
  }
  const [month, setMonth] = useState(() => Math.max(1, Math.min(12, uptoMonth || 1)))
  // a new year (or the year arriving after the first render) starts on its latest month
  useEffect(() => setMonth(Math.max(1, Math.min(12, uptoMonth || 1))), [yearNum, uptoMonth])

  // One month as a list — the phone's view, and the tablet's detail panel next to the table
  // (Nov 2026, Markus: tooltips don't work on a touch screen; every reason is written out here).
  // 'ok' (ticked by hand or automatically, or an automatic ✓), 'warn' (an automatic ⚠) or null
  const cellState = (it, m) => {
    if (m > uptoMonth) return null
    if (it.auto) {
      const st = status(it.auto, m).state
      return st === 'ok' || st === 'warn' ? st : null
    }
    return isDone(it, m, ticks, autoTick) ? 'ok' : null
  }
  const monthList = (m) => {
    const closed = closedMonths.includes(m)
    return (
      <>
        {SECTIONS.map((sec) => (
          <section key={sec.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <h3 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{sec.label}</h3>
            {items
              .filter((it) => it.section === sec.id)
              .map((it) => (
                <div key={it.id} className="flex items-center gap-3 border-t border-[var(--color-border)] px-3 py-2 text-sm first-of-type:border-t-0" style={{ backgroundColor: TINT[cellState(it, m)] }}>
                  <div className="min-w-0 flex-1">
                    <div>{it.label}</div>
                    {hintText(it, m) && <div className="text-xs text-[var(--color-text-muted)]">{hintText(it, m)}</div>}
                  </div>
                  <div className="max-w-[60%] shrink-0 text-right">{it.auto ? <AutoCell s={status(it.auto, m)} onJump={jump} wide /> : <Check it={it} m={m} className="h-5 w-5 text-sm" wide />}</div>
                </div>
              ))}
          </section>
        ))}
        <button
          type="button"
          onClick={() => toggleClosed(m)}
          disabled={m > uptoMonth}
          className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-40 ${closed ? 'border border-[var(--color-border)] text-[var(--color-plan-ok)]' : 'bg-[var(--color-computed)] text-white'}`}
        >
          {closed ? `✓ ${MONTHS_LONG[m - 1]} abgeschlossen — wieder öffnen` : `${MONTHS_LONG[m - 1]} abschließen`}
        </button>
      </>
    )
  }
  const monthSwitcher = (m, className) => (
    <div className={className}>
      <button type="button" onClick={() => setMonth((x) => Math.max(1, x - 1))} disabled={m === 1} aria-label="Voriger Monat" className="h-9 w-9 rounded-md border border-[var(--color-border)] text-lg disabled:opacity-30">
        ‹
      </button>
      <div className="flex-1 text-center font-semibold">
        {MONTHS_LONG[m - 1]} {yearNum}
      </div>
      <button type="button" onClick={() => setMonth((x) => Math.min(12, x + 1))} disabled={m === 12} aria-label="Nächster Monat" className="h-9 w-9 rounded-md border border-[var(--color-border)] text-lg disabled:opacity-30">
        ›
      </button>
    </div>
  )

  if (narrow) {
    const m = month
    return (
      <div className="flex flex-col gap-3 px-4 py-3">
        {monthSwitcher(m, 'sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2')}
        {monthList(m)}
      </div>
    )
  }
  const cols = 'grid grid-cols-[minmax(11rem,1.2fr)_repeat(12,minmax(2.75rem,1fr))]'
  const sel = month
  return (
    <div className="flex min-h-0 flex-1 gap-4 px-4 py-4">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto">
        <p className="text-sm text-[var(--color-text-muted)]">
          ✓ / ⚠ prüft die App selbst, Kästchen hakst du ab. Einen Monat antippen (Kopf oder ✓ / ⚠) zeigt rechts alle Details dazu. „Abschließen“ ist derselbe Haken wie in Verlauf.
        </p>
        <div className="min-w-[46rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm">
          <div className={`${cols} sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] py-1 font-medium`}>
            <span className="px-3 py-1">{yearNum}</span>
            {MONTHS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => setMonth(i + 1)}
                aria-pressed={sel === i + 1}
                className={`mx-0.5 rounded py-1 text-center ${sel === i + 1 ? 'bg-[var(--color-computed)] text-white' : i + 1 === uptoMonth && yearNum === now.getFullYear() ? 'text-[var(--color-computed)]' : ''} ${i + 1 > uptoMonth ? 'opacity-40' : ''}`}
              >
                {label}
                {/* closed months (= Verlauf's tick) get a small ✓ in the heading — the old "Abgeschlossen" row is gone */}
                {closedMonths.includes(i + 1) && <span className={`ml-0.5 text-xs ${sel === i + 1 ? '' : 'text-[var(--color-plan-ok)]'}`}>✓</span>}
              </button>
            ))}
          </div>
          {SECTIONS.map((sec) => (
            <Fragment key={sec.id}>
              <div className="bg-[var(--color-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{sec.label}</div>
              {items
                .filter((it) => it.section === sec.id)
                .map((it) => (
                  <div key={it.id} className={`${cols} items-center border-t border-[var(--color-border)] py-1`}>
                    <span className="truncate px-3">{it.label}</span>
                    {MONTHS.map((label, i) => {
                      const m = i + 1
                      return (
                        <span
                          key={label}
                          className={`mx-px flex justify-center self-stretch rounded-sm py-0.5 ${sel === m ? 'outline outline-1 -outline-offset-1 outline-[var(--color-computed)]' : ''}`}
                          style={{ backgroundColor: TINT[cellState(it, m)] }}
                        >
                          {it.auto ? <AutoCell s={status(it.auto, m)} onSelect={() => setMonth(m)} /> : <Check it={it} m={m} label={`${it.label} ${label}`} onSelect={() => setMonth(m)} />}
                        </span>
                      )
                    })}
                  </div>
                ))}
            </Fragment>
          ))}
        </div>
      </div>
      {/* The selected month in full: every reason written out, ⚠ links, account hints, the close button. */}
      <aside className="flex min-h-0 w-80 shrink-0 flex-col gap-3 overflow-y-auto">
        {monthSwitcher(sel, 'flex items-center gap-2')}
        {monthList(sel)}
      </aside>
    </div>
  )
}
