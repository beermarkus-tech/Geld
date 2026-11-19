import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { db } from './firebase'
import { centsToEuro } from './lib/format'
import { analyzeClaimMigration, CLAIM_TARGETS } from './lib/claimMigration'

// Settings: a read-only preview for the planned switch from the three Merkkonten to the category
// "Außenstände" (Nov 2026, Markus). It changes nothing – it shows with the real data which cases
// exist, so the open questions can be decided before the switch is built.
export default function ClaimMigrationPreview({ onOpenInKonten }) {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [rules, setRules] = useState([])
  const [open, setOpen] = useState(null)
  useEffect(() => {
    const subs = [
      ['accounts', setAccounts],
      ['categories', setCategories],
      ['transactions', setTransactions],
      ['categorizationRules', setRules],
    ].map(([n, set]) => onSnapshot(collection(db, n), (s) => set(s.docs.map((d) => d.data()))))
    return () => subs.forEach((u) => u())
  }, [])
  const r = useMemo(() => analyzeClaimMigration({ accounts, categories, transactions, rules }), [accounts, categories, transactions, rules])
  const name = (id) => accounts.find((a) => a.id === id)?.name ?? (id || '—')

  const group = (key, title, explain, items) => (
    <div key={key} className="rounded-md border border-[var(--color-border)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <b>{items.length}</b>
        <span className="font-medium">{title}</span>
        <span className="text-xs text-[var(--color-text-muted)]">{explain}</span>
        {items.length > 0 && (
          <span className="ml-auto flex gap-3 text-sm">
            <button type="button" className="text-[var(--color-computed)] underline" onClick={() => setOpen(open === key ? null : key)}>
              {open === key ? 'Liste zu' : 'Liste'}
            </button>
            <button type="button" className="text-[var(--color-computed)] underline" onClick={() => onOpenInKonten?.({ txIds: [...new Set(items.map((i) => i.tx.id))], from: 'settings' })}>
              In Konten zeigen
            </button>
          </span>
        )}
      </div>
      {open === key && (
        <ul className="mt-1 max-h-64 overflow-y-auto text-sm">
          {items.map((i, n) => (
            <li key={i.tx.id + n} className="flex gap-3 border-t border-[var(--color-border)] py-0.5">
              <span className="w-24 shrink-0 tabular-figure text-[var(--color-text-muted)]">{i.tx.date}</span>
              <span className="w-56 shrink-0 truncate">{name(i.tx.fromAccountId)} → {name(i.tx.toAccountId)}</span>
              <span className="min-w-0 flex-1 truncate">
                {i.tx.displayLabel || i.tx.rawDescription}
                {i.categoryName ? <span className="text-[var(--color-text-muted)]"> · bisher {i.categoryName}</span> : null}
              </span>
              <span className="tabular-figure shrink-0">{centsToEuro(i.line?.amountCents ?? i.tx.amountCents)} €</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h2 className="text-lg font-semibold">Umstellung Außenstände – Vorschau</h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        Ändert nichts. Zeigt, welche Buchungen die Umstellung von den Merkkonten auf die Kategorie „Außenstände“ betrifft:{' '}
        {Object.entries(CLAIM_TARGETS).map(([acc, sub]) => `${name(acc)} → ${sub} (${r.byTarget[sub] ?? 0})`).join(' · ')}
      </p>
      {group('normal', 'normale Fälle', 'Merkkonto ↔ echtes Konto – werden einseitige Buchungen auf dem echten Konto', r.normal)}
      {group('between', 'zwischen zwei Merkkonten', 'danach kein echtes Konto mehr – offene Frage 1', r.between)}
      {group('external', 'Merkkonto ohne Gegenkonto', 'z. B. ausgebuchte Forderung – danach kein Konto mehr – offene Frage 2', r.external)}
      {group('anchors', 'Anfangsbestände (Jahresabschluß)', 'Eröffnungsbuchungen der Merkkonten – offene Frage 3', r.anchors)}
      {group('recat', 'Zeilen mit bisheriger Kategorie', 'diese Kategorie würde durch die Außenstände-Unterkategorie ersetzt', r.recategorized)}
      <div className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
        <b>{r.existingCategories.length}</b> bestehende Kategorien mit den neuen Namen
        {r.existingCategories.length ? `: ${r.existingCategories.map((c) => c.name).join(', ')}` : ''} – offene Frage 4 · <b>{r.rules.length}</b> Import-Regeln mit
        Gegenkonto auf einem Merkkonto
      </div>
    </section>
  )
}
