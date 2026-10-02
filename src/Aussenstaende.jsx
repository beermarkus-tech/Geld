import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'

import { db } from './firebase'
import { balance } from './lib/balance'
import { claimOverview, closeOutTransaction, receivableAccountIds } from './lib/claims'
import { centsToEuro } from './lib/format'
import Listbox from './Listbox'

// Außenstände (spec.md §3g) — every claim/loan tag as one card, open ones
// first. Nothing is stored here but the one deliberate action, "ausbuchen"
// (close-out): a settled claim is simply one whose tagged lines net to zero.
const todayIso = () => new Date().toISOString().slice(0, 10)
const shortDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

function CloseOutDialog({ claim, categories, onCancel, onConfirm }) {
  const [categoryId, setCategoryId] = useState('')
  const [date, setDate] = useState(todayIso())
  const options = useMemo(() => {
    const byId = Object.fromEntries(categories.map((c) => [c.id, c]))
    return categories
      .filter((c) => c.parentCategoryId)
      .map((c) => ({ id: c.id, name: `${byId[c.parentCategoryId]?.name ?? ''} › ${c.name}` }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }, [categories])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && e.target?.tagName !== 'INPUT') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const ok = categoryId && /^\d{4}-\d{2}-\d{2}$/.test(date)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg bg-[var(--color-surface)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">„{claim.name}“ ausbuchen</h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Offen sind noch {centsToEuro(Math.abs(claim.net))} €. Sie werden als echte Ausgabe/Einnahme in der gewählten
          Kategorie verbucht (von Außenstände), und der Eintrag gilt danach als abgeschlossen.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Kategorie
          <Listbox value={categoryId} onChange={setCategoryId} options={options} placeholder="Auswählen…" searchable />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Datum
          <input type="text" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm">
            Abbrechen
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => onConfirm({ categoryId, date })}
            className="rounded-lg bg-[var(--color-computed)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Ausbuchen
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Aussenstaende({ onOpenInKonten }) {
  const [accounts, setAccounts] = useState([])
  const [tags, setTags] = useState([])
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [tab, setTab] = useState('open')
  const [expanded, setExpanded] = useState(() => new Set())
  const [closing, setClosing] = useState(null)

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'accounts'), (snap) => setAccounts(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'tags'), (snap) => setTags(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'transactions'), (snap) => setTransactions(snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt))),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags])
  const receivableIds = useMemo(() => receivableAccountIds(accounts), [accounts])
  const claims = useMemo(() => claimOverview(tags, transactions, receivableIds), [tags, transactions, receivableIds])
  // What the receivable accounts hold in total — the figure Konten's pinned
  // Außenstände box shows; the claims below are what it is made of.
  const receivableTotal = useMemo(
    () => [...receivableIds].reduce((sum, id) => sum + balance(id, '9999-12-31', transactions), 0),
    [receivableIds, transactions],
  )
  const open = claims.filter((c) => c.net !== 0)
  const settled = claims.filter((c) => c.net === 0)
  const shown = tab === 'open' ? open : settled

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Lines grouped by the claim-category tag they also carry (Meal/Taxi/…),
  // in order of first appearance; lines without one come first, flat. Lines
  // are never summed within a group (spec §3g).
  function grouped(claim) {
    const groups = new Map()
    for (const line of claim.lines) {
      const cat = line.tagIds.find((id) => tagById[id]?.groupingType === 'claim-category')
      const key = cat ? tagById[cat].name : ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(line)
    }
    return [...groups.entries()].sort((a, b) => (a[0] === '') - (b[0] === ''))
  }

  async function confirmCloseOut({ categoryId, date }) {
    const claim = closing
    const id = `tx-closeout-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    await setDoc(doc(db, 'transactions', id), closeOutTransaction({ id, tagId: claim.id, tagName: claim.name, residualCents: claim.net, categoryId, date, accountId: claim.accountId }))
    setClosing(null)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2">
        <span className="text-sm text-[var(--color-text-muted)]">Außenstände gesamt (alle Forderungskonten)</span>
        <span className="text-lg font-semibold tabular-nums">{centsToEuro(receivableTotal)} €</span>
      </div>
      <div className="flex gap-2">
        {[
          ['open', `Offen (${open.length})`],
          ['settled', `Abgeschlossen (${settled.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full border px-3 py-1 text-sm ${tab === id ? 'border-[var(--color-computed)] bg-[var(--color-computed)] text-white' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">{tab === 'open' ? 'Nichts offen.' : 'Noch nichts abgeschlossen.'}</p>
      )}

      {shown.map((claim) => {
        const isOpen = claim.net !== 0
        const isExpanded = expanded.has(claim.id)
        return (
          <section key={claim.id} className="rounded-lg border border-[color-mix(in_srgb,var(--color-text)_30%,transparent)] bg-[var(--color-surface)] shadow-sm">
            <button type="button" onClick={() => toggle(claim.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
              <span className="text-[var(--color-text-muted)]">{isExpanded ? '▾' : '▸'}</span>
              <span className="flex-1 font-medium">{claim.name}</span>
              <span className={`tabular-nums font-medium ${isOpen ? 'text-[var(--color-alert)]' : 'text-[var(--color-income)]'}`}>
                {isOpen ? `${centsToEuro(claim.net)} €` : '0,00 € ✓'}
              </span>
            </button>
            {isExpanded && (
              <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-3 py-2">
                {grouped(claim).map(([group, lines]) => (
                  <div key={group || '—'} className="flex flex-col">
                    {group && <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-tag-claim-category)]">{group}</div>}
                    {lines.map((l) => (
                      <div key={`${l.txId}:${l.lineIndex}`} className="flex items-baseline gap-3 py-0.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          {l.detail || l.label} <span className="text-[var(--color-text-muted)]">· {shortDate(l.date)}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{centsToEuro(l.cents)} €</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-1 text-sm">
                  <button
                    type="button"
                    onClick={() => onOpenInKonten({ kind: 'tag', name: claim.name, year: null, month: null, from: 'aussenstaende' })}
                    className="text-[var(--color-computed)] underline"
                  >
                    In Konten anzeigen
                  </button>
                  {isOpen && (
                    <button type="button" onClick={() => setClosing(claim)} className="ml-auto rounded-lg border border-[var(--color-border)] px-3 py-1">
                      Ausbuchen…
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        )
      })}

      {closing && <CloseOutDialog claim={closing} categories={categories} onCancel={() => setClosing(null)} onConfirm={confirmCloseOut} />}
    </div>
  )
}
