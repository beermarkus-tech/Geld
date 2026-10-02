import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { db } from './firebase'
import { centsToWholeEuro } from './lib/format'
import { occurredMonthCount, quickviewMonths } from './lib/quickview'
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

export default function Quickview({ year, onOpenInKonten, active = true }) {
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [selected, setSelected] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const listboxRef = useRef(null)

  // Ctrl+L opens the category dropdown (Markus, Oct 2026); Ctrl+I toggles the
  // shortcuts popover like on Konten/Verlauf, Escape closes it. Only while
  // this screen is the visible one (it stays mounted when hidden).
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        listboxRef.current?.focus()
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') {
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

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'tags'), (snap) => setTags(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'transactions'), (snap) => setTransactions(snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt))),
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
    const tagById = Object.fromEntries(tags.map((t) => [t.id, t]))
    const tgs = tags
      .filter((t) => !t.archived)
      .map((t) => ({
        id: `t:${t.id}`,
        name: `Tag: ${t.parentTag ? `${tagById[t.parentTag]?.name ?? ''} › ` : ''}${t.name}`,
        filterText: t.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    return [...cats, ...tgs]
  }, [categories, tags])

  const selection = selected ? { kind: selected.startsWith('c:') ? 'category' : 'tag', id: selected.slice(2) } : null
  const option = options.find((o) => o.id === selected)

  const months = useMemo(() => quickviewMonths(selection, year, transactions, tags), [selection?.kind, selection?.id, year, transactions, tags]) // eslint-disable-line react-hooks/exhaustive-deps -- selection is rebuilt each render; kind/id are its identity
  const occurred = year == null ? 0 : occurredMonthCount(year, todayIso())
  const yearTotal = months.slice(0, occurred).reduce((s, m) => s + m.total, 0)
  const shownAbs = months.slice(0, occurred).flatMap((m) => m.groups.slice(0, TOP_N).map((g) => Math.abs(g.cents)))
  const minAbs = Math.min(...shownAbs)
  const maxAbs = Math.max(...shownAbs)

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 xl:overflow-hidden">
      <div className="flex flex-wrap items-center gap-4">
        {/* Same arrangement as Konten's "Konto:" selector: muted label with a
            colon, then a compact dropdown in the same style. */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Kategorie oder Tag:</span>
          <Listbox ref={listboxRef} value={selected} onChange={setSelected} options={options} placeholder="Auswählen…" searchable inline />
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
                  <b>Strg+L</b> — Kategorie-/Tag-Auswahl öffnen
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
                    <ul className="flex min-h-24 flex-1 flex-col overflow-y-auto">
                      {m.groups.slice(0, TOP_N).map((g) => (
                        <li key={g.label} className="flex items-baseline gap-1.5 text-sm" title={`${g.label}${g.count > 1 ? ` · ${g.count} Buchungen` : ''}`}>
                          <span className="w-[4.75rem] shrink-0 whitespace-nowrap px-1 text-right tabular-nums" style={{ background: amountTint(Math.abs(g.cents), minAbs, maxAbs) }}>
                            {centsToWholeEuro(g.cents)} €
                          </span>
                          <span className="min-w-0 truncate">
                            {g.label}
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
