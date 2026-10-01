import { useState } from 'react'
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'

import { db } from './firebase'
import { centsToEuro } from './lib/format'
import { REPLACEMENT_ACCOUNT_ID, planRetiredAccountFixes } from './lib/retiredAccounts'

// The basic safety net PLAN.md's Phase 1b calls for: "a rough, unpolished
// raw JSON dump of every collection, plus a rough script that reads it
// back into Firestore" — deliberately not §3k's full design (a separate
// parent/child transactions CSV plus this same JSON dump, its own nav
// slot, a documented restore procedure) — that stays Phase 7. This exists
// so a real mistake (a bad CSV import, an app bug, Phase 7's destructive
// Settings operations later) has *something* to recover from before then,
// not so Markus has to trust nothing will ever go wrong in the meantime.
//
// A single combined JSON file, not one per collection (§3k itself calls
// that an implementation detail, not a design decision) — one file is
// simpler for Markus to keep track of than several. Every collection
// currently defined (§2), not just the ones Konten's own screen happens to
// read live — `budgets`/`categoryYearSettings`/`settings` aren't used by
// any built screen yet, but they exist in Firestore (seeded in Phase 1a)
// and are exactly the kind of thing a "dump everything" backup has to
// cover, not skip because nothing reads them yet.
//
// Restore is a plain upsert via `writeBatch`, the same pattern
// `ImportScreen.jsx` and `persistTx` already use throughout this app —
// every document id round-trips exactly as exported, so restoring is safe
// to repeat and never silently invents a new id for something that already
// has one. Deliberately doesn't delete anything not present in the backup
// file (an upsert, not a wipe-and-replace) — restoring is for getting lost
// data back, not for pruning what's already there.
const COLLECTIONS = ['accounts', 'categories', 'tags', 'transactions', 'budgets', 'categoryYearSettings', 'settings', 'cellComments']
const CHUNK_SIZE = 400 // Firestore's batch limit is 500 writes; leave headroom

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Temporary one-off repair (Sept 2026) — moves transactions still pointing
// at the five retired receivable accounts onto `aussenstaende` (spec.md
// §2.2). Scan first, show what would change, confirm, then write. Remove
// this section once Markus has confirmed the live data is clean.
function RetiredAccountRepair() {
  const [scan, setScan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [written, setWritten] = useState(null)

  async function handleScan() {
    setBusy(true)
    setError(null)
    setWritten(null)
    try {
      const snap = await getDocs(collection(db, 'transactions'))
      setScan(planRetiredAccountFixes(snap.docs.map((d) => d.data())))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleApply() {
    setConfirming(false)
    setBusy(true)
    setError(null)
    try {
      const fixes = scan.fixes
      for (let i = 0; i < fixes.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db)
        for (const { after } of fixes.slice(i, i + CHUNK_SIZE)) batch.set(doc(collection(db, 'transactions'), after.id), after)
        await batch.commit()
      }
      setWritten(fixes.length)
      // Re-scan straight away so the screen shows the real result (0).
      const snap = await getDocs(collection(db, 'transactions'))
      setScan(planRetiredAccountFixes(snap.docs.map((d) => d.data())))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const button = 'self-start rounded-lg bg-[var(--color-computed)] px-5 py-2.5 font-medium text-white disabled:opacity-50'

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-needs-attention)] p-4">
      <h2 className="text-lg font-semibold">Einmalige Reparatur: alte Außenstände-Konten</h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        Sucht Buchungen, die noch auf die alten Konten „Geld verliehen/geliehen“ oder „Amazon Julia/Markus (DE/FR)“
        zeigen, und hängt sie auf das gemeinsame Konto „Außenstände“ um. Betrag, Datum, Kategorie und Tags bleiben
        unverändert. Bitte vorher unten eine Sicherung herunterladen.
      </p>
      <button type="button" onClick={handleScan} disabled={busy} className={button}>
        {busy && !scan ? 'Sucht…' : 'Suchen'}
      </button>
      {scan && (
        <div className="flex flex-col gap-2 text-sm">
          {scan.fixes.length === 0 ? (
            <p className="font-medium text-[var(--color-income)]">Keine Buchungen mehr auf alten Konten — alles sauber.</p>
          ) : (
            <>
              <p>
                <b>{scan.fixes.length}</b> Buchungen gefunden:
              </p>
              <ul className="list-inside list-disc text-[var(--color-text-muted)]">
                {Object.entries(scan.countsByOldId).map(([id, n]) => (
                  <li key={id}>
                    {id}: {n}
                  </li>
                ))}
              </ul>
              {scan.untagged.length > 0 && (
                <div>
                  <p className="font-medium">
                    {scan.untagged.length} davon haben keinen Tag — sie erscheinen nach dem Umhängen nicht als offener Posten
                    im Außenstände-Panel. Bitte danach in Konten von Hand taggen:
                  </p>
                  <ul className="list-inside list-disc text-[var(--color-text-muted)]">
                    {scan.untagged.map((t) => (
                      <li key={t.id}>
                        {t.date} · {centsToEuro(t.amountCents)} € {t.deletedAt ? '(gelöscht)' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={button}>
                {busy ? 'Hängt um…' : `Alle ${scan.fixes.length} auf „Außenstände“ umhängen`}
              </button>
            </>
          )}
        </div>
      )}
      {written !== null && <p className="text-sm font-medium text-[var(--color-income)]">{written} Buchungen umgehängt.</p>}
      {error && <p className="text-sm text-[var(--color-alert)]">Fehler: {error}</p>}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirming(false)}
          onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
        >
          <div className="flex max-w-sm flex-col gap-4 rounded-lg bg-[var(--color-surface)] p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm">
              {scan.fixes.length} Buchungen auf das Konto <b>{REPLACEMENT_ACCOUNT_ID}</b> umhängen? Das ändert nur das
              Konto, sonst nichts.
            </p>
            <div className="flex gap-2">
              <button type="button" autoFocus onClick={handleApply} className="rounded-lg bg-[var(--color-computed)] px-4 py-2 text-sm font-medium text-white">
                Umhängen
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default function BackupScreen() {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [exportCounts, setExportCounts] = useState(null)

  const [file, setFile] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState(null)
  const [progress, setProgress] = useState({})
  const [done, setDone] = useState(false)

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    setExportCounts(null)
    try {
      const data = {}
      const counts = {}
      for (const name of COLLECTIONS) {
        const snap = await getDocs(collection(db, name))
        data[name] = snap.docs.map((d) => d.data())
        counts[name] = data[name].length
      }
      const date = new Date().toISOString().slice(0, 10)
      downloadJson(`geld-sicherung-${date}.json`, data)
      setExportCounts(counts)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExporting(false)
    }
  }

  async function handleFileSelected(selected) {
    setFile(null)
    setParseError(null)
    setDone(false)
    setRestoreError(null)
    if (!selected) return
    try {
      const text = await selected.text()
      const data = JSON.parse(text)
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Erwartet ein JSON-Objekt mit einem Feld pro Sammlung (z.B. "transactions": [...]).')
      }
      setFile({ name: selected.name, data })
    } catch (err) {
      setParseError(err.message)
    }
  }

  async function handleRestore() {
    if (!file) return
    setRestoring(true)
    setRestoreError(null)
    setDone(false)
    setProgress({})
    try {
      for (const name of COLLECTIONS) {
        const docs = file.data[name]
        if (!Array.isArray(docs) || docs.length === 0) continue
        const usable = docs.filter((d) => d && typeof d.id === 'string')
        setProgress((prev) => ({ ...prev, [name]: { done: 0, total: usable.length } }))
        for (let i = 0; i < usable.length; i += CHUNK_SIZE) {
          const slice = usable.slice(i, i + CHUNK_SIZE)
          const batch = writeBatch(db)
          for (const d of slice) batch.set(doc(collection(db, name), d.id), d)
          await batch.commit()
          setProgress((prev) => ({ ...prev, [name]: { done: Math.min(i + CHUNK_SIZE, usable.length), total: usable.length } }))
        }
      }
      setDone(true)
    } catch (err) {
      setRestoreError(err.message)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
      <RetiredAccountRepair />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sicherung herunterladen</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Lädt alle deine Daten (Konten, Kategorien, Tags, Buchungen, Budgets) als eine einzelne Datei herunter — für
          den Fall, dass mal etwas schiefgeht und du zu einem früheren Stand zurückwillst. Kein Ersatz für die
          eingebaute 7-Tage-Wiederherstellung von Firestore selbst, sondern ein zusätzliches Sicherheitsnetz.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="self-start rounded-lg bg-[var(--color-computed)] px-5 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {exporting ? 'Lädt herunter…' : 'Sicherung herunterladen'}
        </button>
        {exportError && <p className="text-sm text-[var(--color-alert)]">Fehler: {exportError}</p>}
        {exportCounts && !exportError && (
          <ul className="text-sm text-[var(--color-text-muted)]">
            {COLLECTIONS.map((c) => (
              <li key={c}>
                {c}: {exportCounts[c]} Dokumente
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-6">
        <h2 className="text-lg font-semibold">Sicherung wiederherstellen</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Wähle eine zuvor heruntergeladene Sicherungsdatei aus. Bestehende Daten mit derselben ID werden
          überschrieben; alles andere bleibt unverändert — es wird nichts gelöscht.
        </p>
        <input
          type="file"
          accept=".json"
          disabled={restoring}
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
        />
        {parseError && <p className="text-sm text-[var(--color-alert)]">{parseError}</p>}
        {file && !parseError && (
          <p className="text-sm text-[var(--color-text-muted)]">
            {file.name}:{' '}
            {COLLECTIONS.filter((c) => Array.isArray(file.data[c])).map((c) => `${c} (${file.data[c].length})`).join(', ') ||
              'keine bekannten Sammlungen gefunden'}
          </p>
        )}
        <button
          type="button"
          disabled={!file || !!parseError || restoring}
          onClick={handleRestore}
          className="self-start rounded-lg bg-[var(--color-computed)] px-5 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {restoring ? 'Stellt wieder her…' : 'Wiederherstellen'}
        </button>
        {Object.keys(progress).length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {COLLECTIONS.filter((c) => progress[c]).map((c) => (
              <li key={c}>
                {c}: {progress[c].done}/{progress[c].total}
                {progress[c].done === progress[c].total ? ' ✓' : ''}
              </li>
            ))}
          </ul>
        )}
        {restoreError && <p className="text-sm text-[var(--color-alert)]">Fehler: {restoreError}</p>}
        {done && !restoreError && (
          <p className="text-sm font-medium text-[var(--color-income)]">Wiederherstellung abgeschlossen.</p>
        )}
      </section>
    </div>
  )
}
