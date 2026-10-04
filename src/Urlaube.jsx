import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { db } from './firebase'
import { centsToWholeEuro } from './lib/format'
import { incomeCategoryIds, budgetDeviation, isReductionRow, reductionPercent, urlaubeCategoryId, urlaubeOverview } from './lib/urlaube'
import ui from './lib/uiState'
import TagPill from './TagPill'
import { useTags } from './TagsProvider'

// Urlaube (spec.md §3j, Oct 2026, Markus): only the family Sonstiges ›
// Urlaube, dissected. Left (two thirds): one card per holiday — Budget /
// Prognose, the split into "Bereits gebucht" and "Noch zu buchen", and a list
// of the child tags per year with Details / Verlauf comments. Right (one
// third): the overview per year and the holidays of each year, costs as plus
// numbers. lib/urlaube.js has the rules. Nothing is stored here but the search
// text and the archive switch.
const euro = (cents) => `${centsToWholeEuro(cents)} €`
const GRID = 'grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)_7rem_8.5rem] items-baseline gap-x-4'
const HEAD = 'text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]'

function Amount({ cents }) {
  return <span className={`tabular-nums ${cents === 0 ? 'text-[var(--color-text-muted)]' : ''}`}>{cents === 0 ? '–' : euro(cents)}</span>
}

function Card({ card, flash, collapsed, onToggle, onOpenRow, onOpenTag, onOpenVerlauf, innerRef }) {
  const total = Math.abs(card.booked) + Math.abs(card.planned)
  const share = total > 0 ? Math.round((Math.abs(card.booked) / total) * 100) : 0
  return (
    <section
      ref={innerRef}
      className={`flex scroll-mt-2 flex-col gap-3 rounded-lg border bg-[var(--color-surface)] p-4 ${flash ? 'border-[var(--color-computed)] ring-2 ring-[var(--color-computed)]' : 'border-[var(--color-border)]'}`}
      aria-label={card.tag.name}
    >
      {/* A click anywhere on the header (not on the badge or the Verlauf button, which go
          elsewhere) folds the card up or open (Oct 2026, Markus); also by keyboard. */}
      <header
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title={collapsed ? 'Aufklappen' : 'Zuklappen'}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onToggle()
          }
        }}
        className="-m-1 flex cursor-pointer flex-wrap items-start justify-between gap-3 rounded p-1 hover:bg-[var(--color-bg)]"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${collapsed ? '' : 'rotate-90'}`} aria-hidden="true">
            <path d="M6 3l5 5-5 5" />
          </svg>
          {/* The badge opens Konten on the holiday: the parent and all its children, every year. */}
          <TagPill as="button" tag={card.tag} size="md" onClick={(e) => { e.stopPropagation(); onOpenTag(card) }} title="In Konten zeigen: der Urlaub mit allen Untertags, alle Jahre" className="cursor-pointer hover:underline">
            {card.tag.name}
          </TagPill>
          {/* The year, when the tag name doesn't start with it; the booking years when they differ. */}
          {!card.tag.name.trim().startsWith(String(card.tripYear)) && <span className="text-sm font-normal text-[var(--color-text-muted)]">{card.tripYear}</span>}
          {card.years.length > 1 && <span className="text-sm font-normal text-[var(--color-text-muted)]">gebucht {card.years[0]}–{card.years.at(-1)}</span>}
        </h2>
        <div className="flex shrink-0 items-center gap-6 text-sm">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenVerlauf(card)
            }}
            title="In Verlauf zeigen: die Plan-Zeilen dieses Urlaubs"
            className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-computed)] hover:text-[var(--color-computed)]"
          >
            In Verlauf
          </button>
          <div className="text-right">
            <div className="text-xs text-[var(--color-text-muted)]" title="Gebucht bis zum letzten abgehakten Monat plus Plan1 danach">Gesamt</div>
            <div className="tabular-nums">{euro(card.booked + card.planned)}</div>
          </div>
        </div>
      </header>

      {!collapsed && (
        <>
      {budgetDeviation(card) !== 0 && (
        <p className="text-xs text-[var(--color-plan-off)]">
          Hinweis: Das Budget (Plan1) von {euro(card.budget)} weicht um {euro(Math.abs(budgetDeviation(card)))} von Gesamt ({euro(card.booked + card.planned)}) ab — Plan1 prüfen.
        </p>
      )}
      {card.outside !== 0 && (
        <p className="text-xs text-[var(--color-plan-off)]">
          Hinweis: {euro(-card.outside)} Ausgaben mit diesem Tag in anderen Kategorien — hier nicht mitgezählt (Zuschüsse und Geschenke zählen immer mit).
        </p>
      )}

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
        <div className="min-w-[34rem]">
          <div className={`${GRID} border-b border-[var(--color-border)] px-1 pb-1 ${HEAD}`}>
            <span>Tag</span>
            <span>Details / Kommentar</span>
            <span className="text-right">Gebucht</span>
            <span className="text-right">Noch zu buchen</span>
          </div>
          {card.rows.map((r) => {
            // A row of only money in — a Subvention, a Geschenk — is highlighted in green
            // (Oct 2026, Markus): the cost reductions stand out from the costs.
            const reduction = isReductionRow(r)
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => onOpenRow(r)}
                title="In Konten zeigen"
                className={`${GRID} w-full rounded px-1 py-1 text-left text-sm ${
                  reduction
                    ? 'bg-[color-mix(in_srgb,var(--color-income)_14%,transparent)] text-[var(--color-income)] hover:bg-[color-mix(in_srgb,var(--color-income)_24%,transparent)]'
                    : 'hover:bg-[var(--color-bg)]'
                }`}
              >
                <span className="min-w-0 truncate">{r.label ?? card.tag.name}</span>
                <span className={`min-w-0 text-xs leading-4 ${reduction ? '' : 'text-[var(--color-text-muted)]'}`}>
                  {r.details.length > 0 && <span className={reduction ? '' : 'text-[var(--color-text)]'}>{r.details.join(' · ').replace(' · …', ' …')}</span>}
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
                  {r.plannedBooked !== 0 && <span className={`block text-xs ${reduction ? '' : 'text-[var(--color-text-muted)]'}`}>davon gebucht {euro(r.plannedBooked)}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
        </>
      )}
    </section>
  )
}

const HOL = 'grid grid-cols-[minmax(0,1fr)_4.75rem_4.75rem_4.75rem_5.25rem] items-baseline gap-x-2'
const Money = ({ cents }) => <span className={`text-right tabular-nums ${cents === 0 ? 'text-[var(--color-text-muted)]' : ''}`}>{cents === 0 ? '–' : euro(cents)}</span>
// −20 % = the subventions took a fifth off the cost; "–" without any.
function Reduction({ cost, subvention }) {
  const pct = subvention === 0 ? null : reductionPercent(cost, subvention)
  return <span className="text-right tabular-nums text-[var(--color-text-muted)]">{pct === null ? '–' : `${pct < 0 ? '−' : ''}${Math.abs(pct)} %`}</span>
}

// The overviews (right): per year, then each year's holidays.
function Overview({ years, holidays, untagged, outside, yearFilter, onYear, onHoliday }) {
  const cols = 'grid grid-cols-[3rem_4rem_repeat(2,minmax(0,1fr))] items-baseline gap-x-2'
  return (
    <aside className="flex flex-col gap-5" aria-label="Übersicht">
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Pro Jahr</h2>
        <div className={`${cols} border-b border-[var(--color-border)] pb-1 ${HEAD} normal-case`}>
          <span>Jahr</span>
          <span className="text-right" title="Anzahl der Urlaube dieses Jahres">Anzahl</span>
          <span className="text-right" title="Gesamtkosten aller Urlaube dieses Jahres, egal wann gebucht">Urlaube des Jahres</span>
          <span className="text-right" title="Alles, was in diesem Jahr gebucht wurde, egal für welchen Urlaub">Im Jahr gebucht</span>
        </div>
        {years.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Noch nichts gebucht oder geplant.</p>}
        {years.map((y) => (
          <button
            key={y.year}
            type="button"
            onClick={() => onYear(y.year)}
            aria-pressed={yearFilter === y.year}
            title={yearFilter === y.year ? 'Alle Urlaube zeigen' : `Nur die Urlaube ${y.year} zeigen`}
            className={`${cols} w-full rounded px-1 py-1 text-left text-sm hover:bg-[var(--color-bg)] ${yearFilter === y.year ? 'bg-[var(--color-bg)] ring-1 ring-[var(--color-computed)]' : ''}`}
          >
            <span className="font-medium">{y.year}</span>
            <span className="text-right tabular-nums text-[var(--color-text-muted)]">{y.trips === 0 ? '–' : y.trips}</span>
            <span className="text-right tabular-nums">{y.tripCost === 0 && y.trips === 0 ? '–' : euro(y.tripCost)}</span>
            <span className="text-right tabular-nums">
              {euro(y.booked)}
              {y.untagged !== 0 && <span className="block text-xs text-[var(--color-text-muted)]">davon ohne Tag {euro(y.untagged)}</span>}
            </span>
          </button>
        ))}
        {(untagged !== 0 || outside !== 0) && (
          <div className="mt-1 space-y-0.5 text-xs text-[var(--color-plan-off)]">
            {untagged !== 0 && <p>Hinweis: {euro(untagged)} in Urlaube ohne Urlaubs-Tag gebucht — zählt zu „Im Jahr gebucht“, aber zu keinem Urlaub.</p>}
            {outside !== 0 && <p>Hinweis: {euro(outside)} Ausgaben mit Urlaubs-Tags in anderen Kategorien — nirgends mitgezählt.</p>}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Urlaube je Jahr</h2>
        <div className={`${HOL} border-b border-[var(--color-border)] pb-1 ${HEAD} normal-case`}>
          <span>Urlaub</span>
          <span className="text-right" title="Gesamtkosten = Kosten minus Zuschüsse und Geschenke (gebucht + noch geplant)">Gesamt</span>
          <span className="text-right" title="Nur Kosten: alle Ausgaben (negative Buchungen) plus noch Geplantes">Kosten</span>
          <span className="text-right" title="Zuschüsse und Geschenke: alle positiven Buchungen">Zuschüsse</span>
          <span className="text-right" title="Gesamtkosten ÷ Kosten − 1, auf ganze Prozent gerundet">Reduktion</span>
        </div>
        {years
          .filter((y) => y.trips > 0)
          .map((y) => {
            const list = holidays.filter((h) => h.tripYear === y.year)
            const cost = list.reduce((a, h) => a + h.cost, 0)
            const subvention = list.reduce((a, h) => a + h.subvention, 0)
            return (
              <div key={y.year} className="mt-1 flex flex-col">
                <div className={`${HOL} border-b border-[var(--color-border)] px-1 pb-0.5 text-sm font-medium`}>
                  <span>{y.year}</span>
                  <Money cents={cost - subvention} />
                  <Money cents={cost} />
                  <Money cents={subvention} />
                  <Reduction cost={cost} subvention={subvention} />
                </div>
                {list.map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    onClick={() => onHoliday(h)}
                    title="Zur Karte springen"
                    className={`${HOL} w-full rounded px-1 py-0.5 text-left text-sm hover:bg-[var(--color-bg)]`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {h.tag.name}
                        {h.outside !== 0 && <span className="ml-1 text-xs text-[var(--color-plan-off)]" title="Mit diesem Tag auch in anderen Kategorien gebucht">⚠</span>}
                      </span>
                    </span>
                    <Money cents={h.total} />
                    <Money cents={h.cost} />
                    <Money cents={h.subvention} />
                    <Reduction cost={h.cost} subvention={h.subvention} />
                  </button>
                ))}
              </div>
            )
          })}
      </section>
    </aside>
  )
}

export default function Urlaube({ onOpenInKonten, onOpenInVerlauf, active = true }) {
  const syncWhenVisible = useDeferWhileHidden(active)
  const { tags } = useTags()
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [cellComments, setCellComments] = useState([])
  const [closedByYear, setClosedByYear] = useState(() => new Map())
  const [filter, setFilter] = useState(() => ui.get('urlaube', 'filter', '') || '')
  const [archive, setArchive] = useState(() => Boolean(ui.get('urlaube', 'archive', false)))
  const [yearFilter, setYearFilter] = useState(null)
  const [flash, setFlash] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set(ui.get('urlaube', 'collapsed', []) || []))
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const searchRef = useRef(null)
  const cardRefs = useRef(new Map())
  useEffect(() => ui.set('urlaube', 'filter', filter), [filter])
  useEffect(() => ui.set('urlaube', 'archive', archive), [archive])
  useEffect(() => ui.set('urlaube', 'collapsed', [...collapsed]), [collapsed])
  const toggleCard = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
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

  // Ctrl+K goes to the search, Ctrl+I shows the shortcuts, Esc lifts the year
  // filter — only while this screen is visible.
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
      } else if (e.key === 'Escape' && yearFilter && e.target?.tagName !== 'INPUT') {
        e.preventDefault()
        e.stopPropagation()
        setYearFilter(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, shortcutsOpen, yearFilter])

  const categoryId = useMemo(() => urlaubeCategoryId(categories), [categories])
  const incomeIds = useMemo(() => incomeCategoryIds(categories), [categories])
  const todayYear = new Date().getFullYear()
  const overview = useMemo(
    () => urlaubeOverview({ categoryId, incomeIds, tags, transactions, budgets, cellComments, closedByYear, todayYear }),
    [categoryId, incomeIds, tags, transactions, budgets, cellComments, closedByYear, todayYear],
  )

  const needle = filter.trim().toLowerCase()
  const archived = overview.holidays.filter((h) => h.tag.archived).length
  const shown = overview.holidays.filter(
    (h) =>
      Boolean(h.tag.archived) === archive &&
      (!yearFilter || h.tripYear === yearFilter) &&
      (!needle || h.tag.name.toLowerCase().includes(needle) || h.rows.some((r) => (r.label ?? '').toLowerCase().includes(needle))),
  )

  // A child row opens Konten on that tag across all years (the app year is the latest it was booked or planned in); Esc comes back here.
  const openRow = (r) => onOpenInKonten({ tagId: r.tagId, allYears: true, year: String(r.lastYear), from: 'urlaube' })
  // The holiday badge: Konten on the parent and all its children, across all years.
  const openTag = (h) => onOpenInKonten({ tagId: h.tag.id, allYears: true, year: String(h.tripYear), from: 'urlaube' })
  // "In Verlauf": the Urlaube block at the holiday's group, in its year (the one in
  // the badge); a holiday planned only in other years goes to the latest of those.
  const openVerlauf = (h) => {
    const year = h.planYears.includes(h.tripYear) ? h.tripYear : (h.planYears.at(-1) ?? h.tripYear)
    onOpenInVerlauf({ year: String(year), targetKey: 'categoryId', targetId: categoryId, planVersion: 'plan1', groupId: h.tag.id, from: 'urlaube' })
  }
  // A holiday in the overview scrolls to its card (showing archive/search state as needed).
  function jumpTo(h) {
    if (Boolean(h.tag.archived) !== archive) setArchive(Boolean(h.tag.archived))
    setFilter('')
    setYearFilter(null)
    setCollapsed((prev) => {
      if (!prev.has(h.key)) return prev
      const next = new Set(prev)
      next.delete(h.key)
      return next
    })
    setFlash(h.key)
    setTimeout(() => cardRefs.current.get(h.key)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50)
    setTimeout(() => setFlash((f) => (f === h.key ? null : f)), 1800)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 px-4 py-4">
      <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-3">
        <input
          ref={searchRef}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !filter) e.currentTarget.blur()
          }}
          placeholder="Urlaube durchsuchen… (Strg+K)"
          className="w-64 max-w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
        />
        {archived > 0 && (
          <button
            type="button"
            aria-pressed={archive}
            onClick={() => setArchive((v) => !v)}
            className={`rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-sm ${archive ? 'ring-2 ring-[var(--color-computed)] ring-offset-1 ring-offset-[var(--color-bg)]' : 'opacity-80 hover:opacity-100'}`}
          >
            Archiv <span className="text-xs opacity-70">{archived}</span>
          </button>
        )}
        {yearFilter && (
          <button
            type="button"
            onClick={() => setYearFilter(null)}
            title="Alle Jahre zeigen (Esc)"
            className="rounded-full border border-[var(--color-computed)] bg-[var(--color-surface)] px-2 py-0.5 text-sm"
          >
            Urlaube {yearFilter} ✕
          </button>
        )}
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
                  <b>Strg+K</b> — Urlaube durchsuchen
                </li>
                <li>
                  <b>Esc</b> — Jahresfilter aufheben
                </li>
                <li>
                  <b>Strg+I</b> — diese Übersicht ein-/ausblenden
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {categories.length > 0 && !categoryId && <p className="text-sm text-[var(--color-text-muted)]">Die Kategorie Sonstiges › Urlaube gibt es nicht.</p>}

      <div className="mx-auto grid min-h-0 w-full max-w-[1800px] flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
          {shown.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">{overview.holidays.length === 0 ? 'Noch keine Urlaube mit Buchungen oder Plan.' : 'Nichts gefunden.'}</p>
          )}
          {shown.map((h) => (
            <Card key={h.key} card={h} flash={flash === h.key} collapsed={collapsed.has(h.key)} onToggle={() => toggleCard(h.key)} onOpenRow={openRow} onOpenTag={openTag} onOpenVerlauf={openVerlauf} innerRef={(el) => (el ? cardRefs.current.set(h.key, el) : cardRefs.current.delete(h.key))} />
          ))}
        </div>
        <div className="min-h-0 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Overview
            years={overview.years}
            holidays={overview.holidays}
            untagged={overview.untagged}
            outside={overview.outside}
            yearFilter={yearFilter}
            onYear={(y) => setYearFilter((cur) => (cur === y ? null : y))}
            onHoliday={jumpTo}
          />
        </div>
      </div>
    </div>
  )
}
