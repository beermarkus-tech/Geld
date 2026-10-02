import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { useDeferWhileHidden } from './lib/useDeferWhileHidden'
import { db } from './firebase'
import { balance } from './lib/balance'
import { claimOverview, receivableAccountIds } from './lib/claims'
import { centsToEuro } from './lib/format'

// Außenstände (spec.md §3g) — every claim/loan tag as one card, open ones
// first. Read-only: nothing is stored here; a settled claim is simply one whose
// tagged lines net to zero.
const shortDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

export default function Aussenstaende({ onOpenInKonten, active = true }) {
  // Hidden screens keep the newest data aside instead of recomputing on every save elsewhere.
  const syncWhenVisible = useDeferWhileHidden(active)
  const [accounts, setAccounts] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [tab, setTab] = useState('open')
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'accounts'), (snap) => setAccounts(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'tags'), (snap) => setTags(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'transactions'), (snap) => {
        const next = snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt)
        syncWhenVisible(() => setTransactions(next))
      }),
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

  // The direction a claim opens in: the sign of its oldest line. A line with
  // the opposite sign is a correcting booking (repayment, refund, settlement).
  const openingSign = (claim) => Math.sign(claim.lines.find((l) => l.cents !== 0)?.cents ?? 0)

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
                    {lines.map((l) => {
                      const correcting = l.cents !== 0 && Math.sign(l.cents) === -openingSign(claim)
                      return (
                        <div
                          key={`${l.txId}:${l.lineIndex}`}
                          title={correcting ? 'Ausgleichsbuchung' : undefined}
                          className={`flex items-baseline gap-3 rounded px-1 py-0.5 text-sm ${correcting ? 'bg-[var(--color-income-tint)] text-[var(--color-income)]' : ''}`}
                        >
                          <span className={`w-12 shrink-0 tabular-nums ${correcting ? 'opacity-70' : 'text-[var(--color-text-muted)]'}`}>{shortDate(l.date)}</span>
                          <span className="min-w-0 flex-1 truncate">{l.detail || l.label}</span>
                          <span className="shrink-0 tabular-nums">{centsToEuro(l.cents)} €</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-1 text-sm">
                  <button
                    type="button"
                    onClick={() => onOpenInKonten({ kind: 'tag', name: claim.name, tagId: claim.id, year: null, month: null, from: 'aussenstaende' })}
                    className="text-[var(--color-computed)] underline"
                  >
                    In Konten anzeigen
                  </button>
                </div>
              </div>
            )}
          </section>
        )
      })}

    </div>
  )
}
