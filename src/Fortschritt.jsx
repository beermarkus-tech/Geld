import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { db } from './firebase'
import { projectCards } from './lib/fortschritt'
import { centsToWholeEuro } from './lib/format'
import { CREATE_TYPES } from './lib/tagTypes'
import ui from './lib/uiState'
import TagPill, { typeLook } from './TagPill'
import { useTags } from './TagsProvider'

// Fortschritt (spec.md §3j, reworked Oct 2026, Markus): the totality of a
// project — a parent tag with its child tags — across all categories and years.
// One card per project: Budget / Prognose, the split into "Bereits gebucht" and
// "Noch zu buchen" (each year at its own "ok" month in Verlauf), and a simple
// list of the child tags per year with Details / Verlauf comments and the
// amounts. lib/fortschritt.js has the rules. Nothing is stored here but the
// search text and the type filter.
const euro = (cents) => `${centsToWholeEuro(cents)} €`
const GRID = 'grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)_7rem_8.5rem_3.5rem] items-baseline gap-x-4'

function Amount({ cents }) {
  return <span className={`tabular-nums ${cents === 0 ? 'text-[var(--color-text-muted)]' : ''}`}>{cents === 0 ? '–' : euro(cents)}</span>
}

function Card({ card, onOpenRow }) {
  const total = Math.abs(card.booked) + Math.abs(card.planned)
  const share = total > 0 ? Math.round((Math.abs(card.booked) / total) * 100) : 0
  const span = card.years.length > 1 ? `${card.years[0]}–${card.years.at(-1)}` : String(card.years[0] ?? '')
  const head = 'text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]'
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4" aria-label={card.tag.name}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <TagPill tag={card.tag} size="md">{card.tag.name}</TagPill>
          <span className="text-sm font-normal text-[var(--color-text-muted)]">{span}</span>
        </h2>
        <div className="flex shrink-0 gap-6 text-sm">
          <div className="text-right">
            <div className="text-xs text-[var(--color-text-muted)]">Budget</div>
            <div className="tabular-nums">{euro(card.budget)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--color-text-muted)]">Prognose</div>
            <div className="tabular-nums">{euro(card.prognose)}</div>
          </div>
        </div>
      </header>

      {/* The split: what is booked, what is still to be booked. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 text-sm">
          <span>
            <span className="text-[var(--color-text-muted)]">Bereits gebucht </span>
            <b className="font-medium tabular-nums">{euro(card.booked)}</b>
          </span>
          <span>
            <span className="text-[var(--color-text-muted)]">Noch zu buchen </span>
            <b className="font-medium tabular-nums">{euro(card.planned)}</b>
            {card.plannedBooked !== 0 && (
              <span className="ml-2 text-xs text-[var(--color-text-muted)]" title="Schon gebucht, aber der Monat ist in Verlauf noch nicht abgehakt">
                davon schon gebucht {euro(card.plannedBooked)}
              </span>
            )}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]" role="img" aria-label={`${share} % gebucht`}>
          <div className="h-full rounded-full bg-[var(--color-computed)]" style={{ width: `${share}%` }} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className={`${GRID} border-b border-[var(--color-border)] pb-1 ${head}`}>
            <span>Tag</span>
            <span>Details / Kommentar</span>
            <span className="text-right">Gebucht</span>
            <span className="text-right">Noch zu buchen</span>
            <span className="text-right">Jahr</span>
          </div>
          {card.rows.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onOpenRow(r)}
              title="In Konten zeigen"
              className={`${GRID} w-full rounded px-0 py-1 text-left text-sm hover:bg-[var(--color-bg)]`}
            >
              <span className="min-w-0 truncate">{r.label ?? card.tag.name}</span>
              <span className="min-w-0 text-xs leading-4 text-[var(--color-text-muted)]">
                {r.details.length > 0 && <span className="text-[var(--color-text)]">{r.details.join(' · ').replace(' · …', ' …')}</span>}
                {r.comments.length > 0 && (
                  <span className="italic">
                    {r.details.length > 0 ? ' — ' : ''}
                    {r.comments.join(' · ').replace(' · …', ' …')}
                  </span>
                )}
                {r.details.length === 0 && r.comments.length === 0 && '—'}
              </span>
              <span className="text-right"><Amount cents={r.booked} /></span>
              <span className="text-right">
                <Amount cents={r.planned} />
                {r.plannedBooked !== 0 && <span className="block text-xs text-[var(--color-text-muted)]">davon gebucht {euro(r.plannedBooked)}</span>}
              </span>
              <span className="text-right tabular-nums text-[var(--color-text-muted)]">{r.year}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function Fortschritt({ onOpenInKonten, active = true }) {
  const syncWhenVisible = useDeferWhileHidden(active)
  const { tags } = useTags()
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [cellComments, setCellComments] = useState([])
  const [closedByYear, setClosedByYear] = useState(() => new Map())
  const [filter, setFilter] = useState(() => ui.get('fortschritt', 'filter', '') || '')
  const [typeFilter, setTypeFilter] = useState(() => ui.get('fortschritt', 'type', null))
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const searchRef = useRef(null)
  useEffect(() => ui.set('fortschritt', 'filter', filter), [filter])
  useEffect(() => ui.set('fortschritt', 'type', typeFilter), [typeFilter])

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'transactions'), (snap) => {
        const next = snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt)
        syncWhenVisible(() => setTransactions(next))
      }),
      onSnapshot(collection(db, 'budgets'), (snap) => setBudgets(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'cellComments'), (snap) => setCellComments(snap.docs.map((d) => d.data()))),
      // settings/{year} hold each year's ticked months; settings/app is something else.
      onSnapshot(collection(db, 'settings'), (snap) => {
        const m = new Map()
        for (const d of snap.docs) {
          const s = d.data()
          if (/^\d{4}$/.test(String(s.id))) m.set(Number(s.id), s.closedMonths ?? [])
        }
        setClosedByYear(m)
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  // Ctrl+K goes to the search, Ctrl+I shows the shortcuts — only while visible.
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e) => {
      const mod = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
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

  const todayYear = new Date().getFullYear()
  const cards = useMemo(
    () => projectCards({ tags, transactions, budgets, cellComments, closedByYear, todayYear }),
    [tags, transactions, budgets, cellComments, closedByYear, todayYear],
  )

  const typeOf = (c) => c.tag.groupingType ?? 'none'
  const needle = filter.trim().toLowerCase()
  const inArchive = typeFilter === 'archive'
  const counts = useMemo(() => {
    const k = { archive: 0 }
    for (const c of cards) {
      if (c.tag.archived) k.archive += 1
      else k[typeOf(c)] = (k[typeOf(c)] ?? 0) + 1
    }
    return k
  }, [cards])
  const shown = cards.filter(
    (c) =>
      (inArchive ? c.tag.archived : !c.tag.archived) &&
      (!typeFilter || inArchive || typeOf(c) === typeFilter) &&
      (!needle || c.tag.name.toLowerCase().includes(needle) || c.rows.some((r) => (r.label ?? '').toLowerCase().includes(needle))),
  )
  const chips = [
    { key: null, label: 'Alle', count: cards.length - counts.archive, look: null },
    ...CREATE_TYPES.filter((o) => counts[o.groupingType ?? 'none']).map((o) => ({ key: o.groupingType ?? 'none', label: o.label, count: counts[o.groupingType ?? 'none'], look: typeLook(o.groupingType) })),
    ...(counts.archive ? [{ key: 'archive', label: 'Archiv', count: counts.archive, look: null }] : []),
  ]

  // A row opens Konten on that tag and year; Esc there comes back here.
  const openRow = (r) => onOpenInKonten({ tagId: r.tagId, year: String(r.year), from: 'fortschritt' })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={searchRef}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !filter) e.currentTarget.blur()
            }}
            placeholder="Projekte durchsuchen… (Strg+K)"
            className="w-64 max-w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {chips.map((c) =>
              c.key === null ? (
                <button
                  key="all"
                  type="button"
                  aria-pressed={typeFilter === null}
                  onClick={() => setTypeFilter(null)}
                  className={`rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-sm ${typeFilter === null ? 'ring-2 ring-[var(--color-computed)] ring-offset-1 ring-offset-[var(--color-bg)]' : 'opacity-80 hover:opacity-100'}`}
                >
                  {c.label} <span className="text-xs opacity-70">{c.count}</span>
                </button>
              ) : (
                <TagPill
                  key={c.key}
                  as="button"
                  tag={c.look}
                  size="md"
                  aria-pressed={typeFilter === c.key}
                  onClick={() => setTypeFilter(c.key)}
                  className={`cursor-pointer ${typeFilter === c.key ? 'ring-2 ring-[var(--color-computed)] ring-offset-1 ring-offset-[var(--color-bg)]' : 'opacity-80 hover:opacity-100'}`}
                >
                  {c.label} <span className="text-xs opacity-70">{c.count}</span>
                </TagPill>
              ),
            )}
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
                    <b>Strg+K</b> — Projekte durchsuchen
                  </li>
                  <li>
                    <b>Strg+I</b> — diese Übersicht ein-/ausblenden
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {shown.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            {cards.length === 0 ? 'Noch keine Projekte mit Buchungen oder Plan — ein Projekt ist ein Tag mit Untertags (oder vom Typ Reise/Projekt, Dienstreise).' : 'Nichts gefunden.'}
          </p>
        )}
        {shown.map((card) => (
          <Card key={card.key} card={card} onOpenRow={openRow} />
        ))}
      </div>
    </div>
  )
}
