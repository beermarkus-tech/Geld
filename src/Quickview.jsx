import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { db } from './firebase'
import { centsToEuro } from './lib/format'
import { occurredMonthCount, quickviewMonths } from './lib/quickview'
import Listbox from './Listbox'

// Quickview (spec.md §3e) — a pure past-transaction deep-dive: pick one
// category or tag, see the real bookings against it per month that has
// really elapsed (newest month first), the ten largest per month, with a
// link into Konten (pre-filtered by selection + month) for the rest.
// Nothing planned, compared or stored; the only state is the selection.
const TOP_N = 10
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function Quickview({ year, onOpenInKonten }) {
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [selected, setSelected] = useState('')

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
  const shown = year == null ? [] : months.slice(0, occurredMonthCount(year, todayIso())).reverse()
  const yearTotal = shown.reduce((s, m) => s + m.total, 0)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm text-[var(--color-text-muted)]">Kategorie oder Tag</label>
        <Listbox value={selected} onChange={setSelected} options={options} placeholder="Auswählen…" searchable />
      </div>

      {!selection && <p className="text-sm text-[var(--color-text-muted)]">Wähle eine Kategorie oder einen Tag, um die echten Buchungen {year ?? ''} Monat für Monat zu sehen.</p>}

      {selection && (
        <>
          <div className="flex items-baseline justify-between border-b border-[var(--color-border)] pb-2">
            <h2 className="text-lg font-semibold">
              {option?.name} · {year}
            </h2>
            <span className="font-medium tabular-nums">{centsToEuro(yearTotal)} €</span>
          </div>
          {shown.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Für {year} liegt noch kein Monat hinter uns.</p>}
          {shown.map((m) => (
            <section key={m.month} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">{MONTH_NAMES[m.month - 1]}</h3>
                <span className="text-sm tabular-nums text-[var(--color-text-muted)]">
                  {m.count} {m.count === 1 ? 'Buchung' : 'Buchungen'} · {centsToEuro(m.total)} €
                </span>
              </div>
              {m.count === 0 && <p className="text-sm text-[var(--color-text-muted)]">Keine Buchungen.</p>}
              <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                {m.entries.slice(0, TOP_N).map((e) => (
                  <li key={`${e.txId}:${e.lineIndex}`} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 text-[var(--color-text-muted)]">{e.date.slice(8, 10)}.{e.date.slice(5, 7)}.</span>
                      {e.displayLabel}
                      {e.detail ? ` (${e.detail})` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums">{centsToEuro(e.cents)} €</span>
                  </li>
                ))}
              </ul>
              {m.count > TOP_N && (
                <button
                  type="button"
                  onClick={() => onOpenInKonten({ kind: selection.kind, name: option.filterText, year, month: m.month })}
                  className="self-start text-sm text-[var(--color-computed)] underline"
                >
                  Alle {m.count} in Konten anzeigen
                </button>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  )
}
