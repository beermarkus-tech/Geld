import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { db } from './firebase'
import { centsToWholeEuro } from './lib/format'
import { occurredMonthCount, quickviewMonths } from './lib/quickview'
import { registerScreenCursor } from './lib/screenCursor'
import ui from './lib/uiState'
import { qualifiedName } from './lib/tags'
import { useTags } from './TagsProvider'
import Listbox from './Listbox'

// Quickview (spec.md §3e) — a pure past-transaction deep-dive: pick one
// category or tag, see the real bookings against it laid out like the Gsheet
// (two rows of six months, Jan–Jun and Jul–Dec), one row per name (all Lidl
// bookings of a month summed into one "Lidl"), the ten largest per month,
// each amount tinted by its size across the whole year, with a link into
// Konten (pre-filtered by selection + month) for the rest. Nothing planned,
// compared or stored; the only state is the selection.
const TOP_N = 10
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// Colour scale (Oct 2026, Markus): by size (absolute amount) between the
// smallest and the largest amount shown across all months; the middle colour
// sits at 70 % of that span, not at 50 %, so only the real main contributors
// reach the strong end. Translucent so it reads in light and dark mode.
const MID_AT = 0.7
const SCALE = [
  { t: 0, c: [250, 204, 21, 0.06] },
  { t: MID_AT, c: [250, 204, 21, 0.55] },
  { t: 1, c: [249, 115, 22, 0.9] },
]
function amountTint(abs, minAbs, maxAbs) {
  const t = maxAbs > minAbs ? (abs - minAbs) / (maxAbs - minAbs) : 1
  const [lo, hi] = t < MID_AT ? [SCALE[0], SCALE[1]] : [SCALE[1], SCALE[2]]
  const f = (t - lo.t) / (hi.t - lo.t)
  const [r, g, b, al] = lo.c.map((v, i) => v + (hi.c[i] - v) * f)
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${al.toFixed(2)})`
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function Quickview({ year, onOpenInKonten, active = true, preset = null, onBack = null }) {
  // Hidden screens keep the newest data aside instead of recomputing on every save elsewhere.
  const syncWhenVisible = useDeferWhileHidden(active)
  const [categories, setCategories] = useState([])
  const { tags, tagById } = useTags() // the central tag list (TagsProvider.jsx)
  const [transactions, setTransactions] = useState([])
  // Selection and cursor are remembered between sessions (lib/uiState.js); a
  // selection that no longer exists is dropped once the lists have loaded.
  const [selected, setSelected] = useState(() => ui.get('quickview', 'selected', '') || '')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const listboxRef = useRef(null)
  // The cursor: which row of which month panel ({month, index}), or null.
  // Lives here (the screen stays mounted), so it is remembered for the next
  // visit; cleared whenever a different category/tag is selected.
  const [cursor, setCursor] = useState(() => {
    const c = ui.get('quickview', 'cursor')
    return c && Number.isInteger(c.month) && Number.isInteger(c.index) ? c : null
  })
  useEffect(() => ui.set('quickview', 'selected', selected), [selected])
  useEffect(() => ui.set('quickview', 'cursor', cursor), [cursor])
  const openMonthRef = useRef(null)

  const select = (id) => {
    setSelected((prev) => {
      if (prev !== id) setCursor(null)
      return id
    })
    // The dropdown's button would keep keyboard focus and swallow the arrow
    // keys / Tab placement — hand focus back to the page.
    document.activeElement?.blur?.()
  }

  // Verlauf's subcategory click (spec §3b): App hands over a `preset`
  // ({id, kind, targetId}) with a fresh id per click; it becomes the selection.
  useEffect(() => {
    if (preset) select(`${preset.kind === 'category' ? 'c' : 't'}:${preset.targetId}`)
  }, [preset]) // eslint-disable-line react-hooks/exhaustive-deps -- select only uses setters

  // Ctrl+K opens the category dropdown (Markus, Oct 2026; was Ctrl+L); Ctrl+I toggles the
  // shortcuts popover like on Konten/Verlauf, Escape closes it. Only while
  // this screen is the visible one (it stays mounted when hidden).
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        listboxRef.current?.focus()
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
        // Same as the "Alle N Buchungen in Konten anzeigen" link, for the
        // month the cursor is in (else the current calendar month).
        e.preventDefault()
        openMonthRef.current?.()
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (e.key === 'Escape' && shortcutsOpen) {
        e.stopPropagation()
        setShortcutsOpen(false)
      } else if (e.key === 'Escape' && onBack && e.target?.tagName !== 'INPUT') {
        // Back to Verlauf, when we came from there (App passes onBack only
        // then). Not while the dropdown's search box has focus — Escape
        // closes the open dropdown first, as usual.
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, shortcutsOpen, onBack])

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'transactions'), (snap) => {
        const next = snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt)
        syncWhenVisible(() => setTransactions(next))
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  // One unified list: subcategories as "Gruppe › Name" (a group itself has
  // no bookings of its own — lines carry the subcategory), then tags.
  const options = useMemo(() => {
    const byId = Object.fromEntries(categories.map((c) => [c.id, c]))
    const cats = categories
      .filter((c) => c.parentCategoryId)
      .map((c) => ({ id: `c:${c.id}`, name: `${byId[c.parentCategoryId]?.name ?? ''} › ${c.name}`, filterText: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    const tgs = tags
      .map((t) => ({ id: `t:${t.id}`, name: `Tag: ${qualifiedName(t.id, tagById)}`, filterText: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    return [...cats, ...tgs]
  }, [categories, tags, tagById])

  // A remembered selection whose category/tag is gone (e.g. an unused tag that
  // was cleaned up) is dropped as soon as the lists have loaded.
  useEffect(() => {
    const ready = selected.startsWith('c:') ? categories.length > 0 : selected.startsWith('t:') ? tags.length > 0 : false
    if (selected && ready && !options.some((o) => o.id === selected)) {
      setSelected('')
      setCursor(null)
    }
  }, [selected, options, categories.length, tags.length])

  const selection = selected ? { kind: selected.startsWith('c:') ? 'category' : 'tag', id: selected.slice(2) } : null
  const option = options.find((o) => o.id === selected)

  const months = useMemo(() => quickviewMonths(selection, year, transactions, tags), [selection?.kind, selection?.id, year, transactions, tags]) // eslint-disable-line react-hooks/exhaustive-deps -- selection is rebuilt each render; kind/id are its identity
  const occurred = year == null ? 0 : occurredMonthCount(year, todayIso())
  const yearTotal = months.slice(0, occurred).reduce((s, m) => s + m.total, 0)
  const shownAbs = months.slice(0, occurred).flatMap((m) => m.groups.slice(0, TOP_N).map((g) => Math.abs(g.cents)))
  const minAbs = Math.min(...shownAbs)
  const maxAbs = Math.max(...shownAbs)

  // Opens Konten on one row: the whole month for an aggregated row (×N) or the
  // booking's own date for a single one, always narrowed to this selection and
  // to the row's name / detail (Konten's `jump`, spec §3e).
  function openRow(month, index) {
    const g = months[month - 1]?.groups[index]
    if (!g) return
    setCursor({ month, index })
    onOpenInKonten({
      kind: selection.kind,
      name: option.filterText,
      year,
      month,
      date: g.count === 1 ? g.date : null,
      label: g.fromTag || g.label === '(ohne Name)' ? '' : g.label,
      // a row named by its trip tag is found by that tag, not by a booking title
      tagFilter: g.fromTag ? g.label : null,
      detail: g.detail,
    })
  }

  // Strg+G: the month link's action — whole month, this selection, no name filter.
  openMonthRef.current = () => {
    if (!selection) return
    const month = cursor?.month ?? (Number(todayIso().slice(5, 7)) <= occurred ? Number(todayIso().slice(5, 7)) : occurred)
    if (!(month >= 1) || months[month - 1].count === 0) return
    onOpenInKonten({ kind: selection.kind, name: option.filterText, year, month })
  }

  // Cursor keys (Markus, Oct 2026): Up/Down move within a month's list,
  // Left/Right to the neighbouring month that has rows; Enter opens the row
  // in Konten. Only while this screen is visible and focus isn't in a field.
  useEffect(() => {
    if (!active || !selection) return
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !cursor) return
      const t = e.target?.tagName
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON') return
      const rows = (mo) => Math.min(TOP_N, months[mo - 1]?.groups.length ?? 0)
      const clamp = (mo, i) => ({ month: mo, index: Math.max(0, Math.min(i, rows(mo) - 1)) })
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = cursor.index + (e.key === 'ArrowDown' ? 1 : -1)
        setCursor(clamp(cursor.month, next))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.key === 'ArrowRight' ? 1 : -1
        for (let mo = cursor.month + step; mo >= 1 && mo <= occurred; mo += step) {
          if (rows(mo) > 0) {
            setCursor(clamp(mo, cursor.index))
            break
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        openRow(cursor.month, cursor.index)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }) // every render: always sees the current months/cursor (cheap)

  // Tab with nothing focused puts the cursor on the remembered row, else on
  // the first row of the first month that has any (lib/screenCursor.js).
  const placeCursorRef = useRef(null)
  placeCursorRef.current = () => {
    if (!selection) return false
    if (cursor && months[cursor.month - 1]?.groups[cursor.index]) return true
    for (let mo = 1; mo <= occurred; mo += 1) {
      if (months[mo - 1].groups.length > 0) {
        setCursor({ month: mo, index: 0 })
        return true
      }
    }
    return false
  }
  useEffect(() => registerScreenCursor('quickview', () => placeCursorRef.current()), [])

  // Keep the cursor row in view.
  useEffect(() => {
    if (!active || !cursor) return
    document.querySelector(`[data-qv-cursor="${cursor.month}:${cursor.index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, cursor])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 xl:overflow-hidden">
      <div className="flex flex-wrap items-center gap-4">
        {/* Same arrangement as Konten's "Konto:" selector: muted label with a
            colon, then a compact dropdown in the same style. */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Kategorie oder Tag:</span>
          <Listbox ref={listboxRef} value={selected} onChange={select} options={options} placeholder="Auswählen…" searchable inline />
        </div>
        {/* Same (i) hover button as Konten/Verlauf's toolbars. */}
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
                  <b>Strg+K</b> — Kategorie-/Tag-Auswahl öffnen
                </li>
                {onBack && (
                  <li>
                    <b>Esc</b> — zurück zu Verlauf
                  </li>
                )}
                <li>
                  <b>Tab</b> — Cursor in die Liste setzen
                </li>
                <li>
                  <b>Enter</b> / Klick — Eintrag in Konten öffnen
                </li>
                <li>
                  <b>Strg+G</b> — alle Buchungen des Monats in Konten anzeigen
                </li>
                <li>
                  <b>Strg+I</b> — diese Übersicht ein-/ausblenden
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {!selection && <p className="text-sm text-[var(--color-text-muted)]">Wähle eine Kategorie oder einen Tag, um die echten Buchungen {year ?? ''} Monat für Monat zu sehen.</p>}

      {selection && (
        <>
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2">
            <h2 className="text-lg font-semibold">
              {option?.name} · {year}
            </h2>
            <span className="font-medium tabular-nums">{centsToWholeEuro(yearTotal)} €</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:min-h-0 xl:flex-1 xl:grid-cols-6 xl:grid-rows-2">
            {months.map((m) => {
              const future = m.month > occurred
              return (
                <section key={m.month} className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--color-text)_35%,transparent)] bg-[var(--color-surface)] shadow-md ${future ? 'opacity-50' : ''}`}>
                  <h3 className="bg-[color-mix(in_srgb,var(--color-text)_10%,var(--color-surface))] py-1.5 text-center font-semibold">{MONTH_NAMES[m.month - 1]}</h3>
                  {!future && (
                    <div className="border-b border-[color-mix(in_srgb,var(--color-text)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-text)_5%,var(--color-surface))] px-2 py-1 text-center">
                      <div className="font-semibold tabular-nums">{centsToWholeEuro(m.total)} €</div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {m.count} {m.count === 1 ? 'Buchung' : 'Buchungen'}
                      </div>
                    </div>
                  )}
                  {!future && (
                    <ul className="flex min-h-24 flex-1 flex-col overflow-hidden">
                      {m.groups.slice(0, TOP_N).map((g, gi) => (
                        <li
                          key={`${g.label}\u0000${g.detail}`}
                          data-qv-cursor={`${m.month}:${gi}`}
                          onClick={() => openRow(m.month, gi)}
                          className={`flex max-h-11 min-h-6 flex-1 cursor-pointer items-center gap-1.5 text-sm hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] ${
                            cursor && cursor.month === m.month && cursor.index === gi ? 'outline outline-2 -outline-offset-2 outline-[var(--color-computed)]' : ''
                          }`}
                          title={`${g.detail ? `${g.detail} · ${g.label}` : g.label}${g.count > 1 ? ` · ${g.count} Buchungen` : ''}`}>
                          <span className="flex h-full w-[4.75rem] shrink-0 items-center justify-end whitespace-nowrap px-1 tabular-nums" style={{ background: amountTint(Math.abs(g.cents), minAbs, maxAbs) }}>
                            {centsToWholeEuro(g.cents)} €
                          </span>
                          {/* A booking with a detail shows the detail *instead of* its name
                              (Markus, Oct 2026); plain end-truncation when too long. */}
                          <span className="min-w-0 truncate">
                            {g.detail || g.label}
                            {g.count > 1 && <span className="ml-1 text-xs text-[var(--color-text-muted)]">×{g.count}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!future && m.groups.length > TOP_N && (
                    <button
                      type="button"
                      onClick={() => onOpenInKonten({ kind: selection.kind, name: option.filterText, year, month: m.month })}
                      className="px-2 py-1 text-left text-xs text-[var(--color-computed)] underline"
                    >
                      Alle {m.count} Buchungen in Konten anzeigen
                    </button>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
