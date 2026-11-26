import { Fragment, useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'

import { db } from './firebase'
import { claimCategoryIds } from './lib/claims'
import { DEFAULT_ITEMS, SECTIONS, accountHint, autoChecks, autoTicker, isDone, lastDay, openItems, toggleTick } from './lib/monthClose'
import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { useNarrow } from './lib/useNarrow'
import { useTags } from './TagsProvider'

// Monatsabschluss (spec.md §3h, Nov 2026): the year's checklist, one column per month (tablet) or
// one month at a time (phone). Automatic items show ✓ / ⚠ (tap ⚠ → where the problem is) or an
// info text; manual items are checkboxes (settings/{year}.closeTicks). "Abschließen" is the same
// switch as the month's tick in Verlauf (settings/{year}.closedMonths) — warns when items are open.
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const euro = (cents) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function AutoCell({ s, onJump, wide = false }) {
  if (!s || s.state === null) return <span className="text-[var(--color-text-muted)]">·</span>
  const color = s.state === 'ok' ? 'var(--color-plan-ok)' : s.state === 'warn' ? 'var(--color-plan-off)' : 'var(--color-text-muted)'
  const icon = s.state === 'ok' ? '✓' : s.state === 'warn' ? '⚠' : 'i'
  const body = (
    <>
      <span className="font-semibold">{icon}</span>
      {wide && s.text && <span className="ml-1.5 text-xs">{s.text}</span>}
    </>
  )
  return s.jump ? (
    <button type="button" onClick={() => onJump(s.jump)} title={s.text || undefined} className="rounded px-1 hover:underline" style={{ color }}>
      {body}
    </button>
  ) : (
    <span title={s.text || undefined} className="px-1" style={{ color }}>
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
  const Check = ({ it, m, className = '', label }) => {
    const reason = it.autoTick && m <= uptoMonth ? autoTick(it, m) : null
    if (reason)
      return (
        <span className="font-semibold text-[var(--color-plan-ok)]" title={`Automatisch abgehakt: ${reason}`}>
          ✓
        </span>
      )
    return (
      <input
        type="checkbox"
        className={className}
        checked={isDone(it, m, ticks, autoTick)}
        disabled={m > uptoMonth}
        onChange={() => tick(it.id, m)}
        aria-label={label ?? it.label}
      />
    )
  }
  const [month, setMonth] = useState(() => Math.max(1, Math.min(12, uptoMonth || 1)))
  // a new year (or the year arriving after the first render) starts on its latest month
  useEffect(() => setMonth(Math.max(1, Math.min(12, uptoMonth || 1))), [yearNum, uptoMonth])

  if (narrow) {
    const m = month
    const closed = closedMonths.includes(m)
    return (
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2">
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
        {SECTIONS.map((sec) => (
          <section key={sec.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <h3 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{sec.label}</h3>
            {items
              .filter((it) => it.section === sec.id)
              .map((it) => (
                <div key={it.id} className="flex items-center gap-3 border-t border-[var(--color-border)] px-3 py-2 text-sm first-of-type:border-t-0">
                  <div className="min-w-0 flex-1">
                    <div>{it.label}</div>
                    {hintText(it, m) && <div className="text-xs text-[var(--color-text-muted)]">{hintText(it, m)}</div>}
                  </div>
                  {it.auto ? (
                    <AutoCell s={status(it.auto, m)} onJump={jump} wide />
                  ) : (
                    <Check it={it} m={m} className="h-5 w-5" />
                  )}
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
      </div>
    )
  }

  const cols = 'grid grid-cols-[minmax(14rem,1.4fr)_repeat(12,minmax(3.25rem,1fr))]'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        ✓ / ⚠ prüft die App selbst (⚠ antippen führt zum Problem), Kästchen hakst du ab. „Abschließen“ ist derselbe Haken wie in Verlauf.
      </p>
      <div className="min-w-[56rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm">
        <div className={`${cols} sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] py-2 font-medium`}>
          <span className="px-3">{yearNum}</span>
          {MONTHS.map((label, i) => (
            <span key={label} className={`text-center ${i + 1 === uptoMonth && yearNum === now.getFullYear() ? 'text-[var(--color-computed)]' : ''} ${i + 1 > uptoMonth ? 'opacity-40' : ''}`}>
              {label}
            </span>
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
                    const current = m === uptoMonth && yearNum === now.getFullYear()
                    return (
                      <span key={label} className={`flex justify-center ${current ? 'bg-[color-mix(in_srgb,var(--color-computed)_8%,transparent)]' : ''}`} title={hintText(it, m) || undefined}>
                        {it.auto ? (
                          <AutoCell s={status(it.auto, m)} onJump={jump} />
                        ) : (
                          <Check it={it} m={m} label={`${it.label} ${label}`} />
                        )}
                      </span>
                    )
                  })}
                </div>
              ))}
          </Fragment>
        ))}
        <div className={`${cols} items-center border-t-2 border-[var(--color-border)] py-2`}>
          <span className="px-3 font-medium">Monat abschließen</span>
          {MONTHS.map((label, i) => {
            const m = i + 1
            const closed = closedMonths.includes(m)
            return (
              <span key={label} className="flex justify-center">
                <button
                  type="button"
                  onClick={() => toggleClosed(m)}
                  disabled={m > uptoMonth}
                  title={closed ? 'Abgeschlossen — klicken zum Wieder-Öffnen' : `Bis ${lastDay(yearNum, m).slice(8)}. abschließen`}
                  className={`rounded px-1.5 py-0.5 text-xs disabled:opacity-30 ${closed ? 'font-semibold text-[var(--color-plan-ok)]' : 'border border-[var(--color-border)] text-[var(--color-computed)] hover:bg-[var(--color-bg)]'}`}
                >
                  {closed ? '✓' : 'zu'}
                </button>
              </span>
            )
          })}
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">Bei den Konten zeigt der Tooltip Kontostand am Monatsende und Anzahl Buchungen im Monat.</p>
    </div>
  )
}
