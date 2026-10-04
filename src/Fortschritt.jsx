import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'

import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { db } from './firebase'
import { GROUP_ORDER, SUBCAT_ORDER, isKnownSubcat } from './lib/categoryOrder'
import { fortschrittCards } from './lib/fortschritt'
import { centsToWholeEuro } from './lib/format'
import ui from './lib/uiState'
import Listbox from './Listbox'
import TagPill from './TagPill'
import { useTags } from './TagsProvider'

// Fortschritt (spec.md §3j, built Oct 2026): one subcategory of the selected
// year split into what is already booked and what is still only planned, at
// the last month ticked "ok" in Verlauf — one card per trip/project tag found
// under it (lib/fortschritt.js has the rules). A query, not a rebalancing
// tool: nothing is stored here but the selection.
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const euro = (cents) => `${centsToWholeEuro(cents)} €`

function Figure({ label, cents }) {
  return (
    <div className="text-right">
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="tabular-nums">{euro(cents)}</div>
    </div>
  )
}

function Card({ card, title, onOpenBooking }) {
  const hasBooked = card.subs.some((s) => s.booked.length > 0)
  const hasPlanned = card.subs.some((s) => s.planned.length > 0)
  const section = 'text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]'
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4" aria-label={title}>
      <header className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold">
          {card.tag ? <TagPill tag={card.tag} size="md">{card.tag.name}</TagPill> : title}
        </h2>
        <div className="flex shrink-0 gap-4 text-sm">
          <Figure label="Budget" cents={card.budget} />
          <Figure label="Prognose" cents={card.prognose} />
        </div>
      </header>

      <div>
        <div className="mb-1 flex items-baseline justify-between border-b border-[var(--color-border)] pb-1">
          <span className={section}>Bereits gebucht</span>
          <span className="text-sm tabular-nums">{euro(card.bookedTotal)}</span>
        </div>
        {!hasBooked && <p className="py-1 text-sm text-[var(--color-text-muted)]">Noch nichts.</p>}
        {card.subs.map((s) =>
          s.booked.length === 0 ? null : (
            <Fragment key={s.key}>
              {s.label && (
                <div className="mt-1.5 flex justify-between text-xs font-medium text-[var(--color-text-muted)]">
                  <span>{s.label}</span>
                  <span className="tabular-nums">{euro(s.bookedTotal)}</span>
                </div>
              )}
              {s.booked.map((e) => (
                <button
                  key={`${e.txId}-${e.lineIndex}`}
                  type="button"
                  onClick={() => onOpenBooking(e)}
                  title="In Konten zeigen"
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-[var(--color-bg)]"
                >
                  <span className="w-12 shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">{e.date.slice(8, 10)}.{e.date.slice(5, 7)}.</span>
                  <span className="min-w-0 flex-1 truncate">
                    {e.label || '(ohne Name)'}
                    {e.detail && <span className="text-[var(--color-text-muted)]"> ({e.detail})</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{euro(e.cents)}</span>
                </button>
              ))}
            </Fragment>
          ),
        )}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between border-b border-[var(--color-border)] pb-1">
          <span className={section}>Noch geplant</span>
          <span className="text-sm tabular-nums">{euro(card.plannedTotal)}</span>
        </div>
        {!hasPlanned && <p className="py-1 text-sm text-[var(--color-text-muted)]">Nichts mehr geplant.</p>}
        {card.subs.map((s) =>
          s.planned.length === 0 ? null : (
            <Fragment key={s.key}>
              {s.label && (
                <div className="mt-1.5 flex justify-between text-xs font-medium text-[var(--color-text-muted)]">
                  <span>{s.label}</span>
                  <span className="tabular-nums">{euro(s.plannedTotal)}</span>
                </div>
              )}
              {s.planned.map((p) => (
                <div key={p.month} className="flex items-baseline gap-2 px-1 py-0.5 text-sm">
                  <span className="min-w-0 flex-1">
                    {MONTH_NAMES[p.month - 1]}
                    {p.booked !== 0 && (
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]" title="Schon gebucht, aber der Monat ist in Verlauf noch nicht abgehakt">
                        davon schon gebucht {euro(p.booked)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{euro(p.plan)}</span>
                </div>
              ))}
            </Fragment>
          ),
        )}
      </div>
    </section>
  )
}

export default function Fortschritt({ year, onOpenInKonten, active = true }) {
  const syncWhenVisible = useDeferWhileHidden(active)
  const { tags } = useTags()
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [closedMonths, setClosedMonths] = useState([])
  const [group, setGroup] = useState(() => ui.get('fortschritt', 'group', '') || '')
  const [subId, setSubId] = useState(() => ui.get('fortschritt', 'sub', '') || '')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const groupRef = useRef(null)
  useEffect(() => ui.set('fortschritt', 'group', group), [group])
  useEffect(() => ui.set('fortschritt', 'sub', subId), [subId])

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'transactions'), (snap) => {
        const next = snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt)
        syncWhenVisible(() => setTransactions(next))
      }),
      onSnapshot(collection(db, 'budgets'), (snap) => setBudgets(snap.docs.map((d) => d.data()))),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])
  // settings/{year} holds the "ok" months; re-pointed with the year selector.
  useEffect(() => {
    if (!year) return
    return onSnapshot(doc(db, 'settings', String(year)), (snap) => setClosedMonths(snap.exists() ? (snap.data().closedMonths ?? []) : []))
  }, [year])

  // Ctrl+K opens the Kategorie list, Ctrl+I the shortcuts popover — only while visible.
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e) => {
      const mod = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        groupRef.current?.focus()
      } else if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (e.key === 'Escape' && shortcutsOpen) {
        e.stopPropagation()
        setShortcutsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, shortcutsOpen])

  // Kategorie → Unterkategorie, in the app's fixed order (lib/categoryOrder.js).
  const groups = useMemo(() => {
    const top = categories.filter((c) => !c.parentCategoryId)
    const rank = (c) => (GROUP_ORDER.includes(c.name) ? GROUP_ORDER.indexOf(c.name) : GROUP_ORDER.length)
    return top.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'))
  }, [categories])
  const subs = useMemo(
    () =>
      categories
        .filter((c) => c.parentCategoryId === group && isKnownSubcat(c.name))
        .sort((a, b) => SUBCAT_ORDER.indexOf(a.name) - SUBCAT_ORDER.indexOf(b.name)),
    [categories, group],
  )
  // A remembered selection that no longer exists is dropped once categories have loaded.
  useEffect(() => {
    if (categories.length === 0) return
    if (group && !groups.some((g) => g.id === group)) setGroup('')
    else if (subId && !subs.some((s) => s.id === subId)) setSubId('')
  }, [categories.length, groups, subs]) // eslint-disable-line react-hooks/exhaustive-deps -- only ids matter

  const sub = subs.find((s) => s.id === subId)
  const yearNum = Number(year)
  const result = useMemo(
    () => (sub && yearNum ? fortschrittCards({ categoryId: sub.id, year: yearNum, transactions, budgets, tags, closedMonths }) : null),
    [sub?.id, yearNum, transactions, budgets, tags, closedMonths], // eslint-disable-line react-hooks/exhaustive-deps -- sub is rebuilt each render; its id is its identity
  )

  const openBooking = (e) =>
    onOpenInKonten({ kind: 'category', name: sub.name, year: yearNum, month: e.month, date: e.date, label: e.label, detail: e.detail })

  const onlyUntagged = result && result.cards.length === 1 && result.cards[0].key === 'none'

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Kategorie:</span>
          <Listbox
            ref={groupRef}
            value={group}
            onChange={(id) => {
              setGroup(id)
              setSubId('')
              document.activeElement?.blur?.()
            }}
            options={groups.map((g) => ({ id: g.id, name: g.name }))}
            placeholder="Auswählen…"
            searchable
            inline
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Unterkategorie:</span>
          <Listbox
            value={subId}
            onChange={(id) => {
              setSubId(id)
              document.activeElement?.blur?.()
            }}
            options={subs.map((s) => ({ id: s.id, name: s.name }))}
            placeholder={group ? 'Auswählen…' : 'Erst Kategorie wählen'}
            disabled={!group}
            searchable
            inline
          />
        </div>
        <div className="relative ml-auto">
          <button
            type="button"
            onMouseEnter={() => setShortcutsOpen(true)}
            onMouseLeave={() => setShortcutsOpen(false)}
            title="Tastenkürzel (Strg+I)"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-computed)]"
          >
            i
          </button>
          {shortcutsOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text)] shadow-lg">
              <div className="mb-1.5 font-medium">Tastenkürzel</div>
              <ul className="space-y-1">
                <li>
                  <b>Strg+K</b> — Kategorie-Auswahl öffnen
                </li>
                <li>
                  <b>Strg+I</b> — diese Übersicht ein-/ausblenden
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {!sub && <p className="text-sm text-[var(--color-text-muted)]">Wähle eine Kategorie und eine Unterkategorie, um {year ?? ''} getrennt in „Bereits gebucht“ und „Noch geplant“ zu sehen.</p>}

      {result && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2">
            <h2 className="text-lg font-semibold">
              {sub.name} · {year}
            </h2>
            <span className="text-sm text-[var(--color-text-muted)]">
              {result.pivot > 0 ? `gebucht bis einschließlich ${MONTH_NAMES[result.pivot - 1]} (in Verlauf abgehakt)` : 'noch kein Monat in Verlauf abgehakt — alles ist noch geplant'}
            </span>
          </div>
          {result.cards.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Für {year} gibt es hier weder Buchungen noch Plan.</p>}
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.cards.map((card) => (
              <Card key={card.key} card={card} title={onlyUntagged ? sub.name : 'Ohne Tag'} onOpenBooking={openBooking} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
