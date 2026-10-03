import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'

import { db } from './firebase'
import { TAG_RENAME_MESSAGES, validateTagRename } from './lib/tagRename'
import { tagColorVar } from './lib/tagStyle'
import { CREATE_TYPES } from './TagEditor'
import { usageOf, useTagUsage, useTags } from './TagsProvider'

// Settings (spec.md §3i) — the first section, built Oct 2026 (Markus): Tags,
// with in-place renaming. The other sections of §3i (Kategorien, Konten,
// Jahres-Einstellungen, Monatsabschluss-Vorlage) will sit next to it.
//
// A rename changes only the tag's `name`: bookings and budget rows point at
// the tag's id, so they follow automatically and the new name shows
// everywhere (Konten, Quickview, Außenstände, Verlauf). Tags that exist only
// as plain text on old booking lines have no record here yet (see the note at
// the end) and the fixed allocation tags (Sparen Familie …) are locked.

const euro = (cents) => `${Math.round(cents / 100).toLocaleString('de-DE')} €`

// Where a tag is used (Oct 2026, Markus: tags that looked unused in Verlauf
// weren't deleted — a plan value in a hidden Plan0 line or another year, or a
// deleted booking, still holds them; see TagCleanup.jsx).
function UsageDetails({ usage, depth, targetNames }) {
  return (
    <div className="space-y-0.5 px-3 pb-2 text-xs text-[var(--color-text-muted)]" style={{ paddingLeft: 12 + depth * 22 + 16 }}>
      {usage.plans.map((pl) => (
        <div key={pl.key}>
          Plan: {pl.year} · {pl.planVersion === 'plan0' ? 'Plan0' : 'Plan1'} · {targetNames.get(pl.targetId) ?? pl.targetId} — {pl.months} {pl.months === 1 ? 'Monat' : 'Monate'}, zusammen {euro(pl.sum)}
        </div>
      ))}
      {usage.bookings.slice(0, 20).map((b, i) => (
        <div key={`${b.txId}-${i}`}>
          Buchung: {b.date} · {b.label || '—'} · {euro(b.cents)}
          {b.deleted && ' (gelöscht — zählt, bis sie endgültig entfernt ist)'}
        </div>
      ))}
      {usage.bookings.length > 20 && <div>… {usage.bookings.length - 20} weitere Buchungen</div>}
      {usage.plans.length === 0 && usage.bookings.length === 0 && <div>Nirgends verwendet — wird automatisch entfernt.</div>}
    </div>
  )
}

function TagRow({ tag, depth, usage, targetNames, onRename, onSetType }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tag.name)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const locked = tag.class === 'allocation'
  const colorVar = tagColorVar(tag)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const result = onRename(tag.id, draft)
    if (result === true || result === 'same') {
      setEditing(false)
      setError('')
    } else {
      setError(result)
    }
  }

  return (
    <div className="flex flex-col border-b border-[var(--color-border)] last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-1.5 text-sm" style={{ paddingLeft: 12 + depth * 22 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={80}
            onChange={(e) => {
              setDraft(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') {
                setEditing(false)
                setError('')
                setDraft(tag.name)
              }
            }}
            onBlur={() => {
              setEditing(false)
              setError('')
              setDraft(tag.name)
            }}
            className="min-w-0 flex-1 rounded border border-[var(--color-computed)] bg-[var(--color-surface)] px-2 py-0.5"
          />
        ) : (
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              setDraft(tag.name)
              setEditing(true)
            }}
            title={locked ? 'Festes Rücklagen-Tag — nicht umbenennbar' : 'Klicken zum Umbenennen'}
            className="min-w-0 flex-1 text-left"
          >
            {/* Drawn as the tag's pill, as in Konten and Verlauf (Oct 2026, Markus). */}
            <span
              className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 align-middle ${locked ? '' : 'hover:underline'} ${colorVar ? '' : 'border border-dashed border-[var(--color-text-muted)] text-[var(--color-text-muted)]'}`}
              style={colorVar ? { color: `var(${colorVar})`, backgroundColor: `color-mix(in srgb, var(${colorVar}) 15%, transparent)` } : undefined}
            >
              {tag.name}
            </span>
            {locked && <span className="ml-2" aria-label="gesperrt">🔒</span>}
          </button>
        )}
        {locked ? (
          <span className="w-32 shrink-0 text-xs text-[var(--color-text-muted)]">Rücklage</span>
        ) : (
          // The type can be changed here (Oct 2026, Markus). It decides where the
          // tag shows up: Anspruch → Außenstände, Reise/Projekt → Quickview rows.
          <select
            value={tag.groupingType ?? ''}
            onChange={(e) => onSetType(tag.id, e.target.value || null)}
            aria-label="Typ"
            className="w-32 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text)]"
          >
            {CREATE_TYPES.map((o) => (
              <option key={o.groupingType ?? 'none'} value={o.groupingType ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title="Zeigen, wo dieser Tag verwendet wird"
          className="w-40 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-muted)] hover:underline"
        >
          {usage.lines} {usage.lines === 1 ? 'Buchungszeile' : 'Buchungszeilen'}
          {usage.deletedLines > 0 && ` (+${usage.deletedLines} gelöscht)`}
          {usage.planRows > 0 && ` · ${usage.planRows} Budget`} {open ? '▴' : '▾'}
        </button>
      </div>
      {open && <UsageDetails usage={usage} depth={depth} targetNames={targetNames} />}
      {error && <div className="px-3 pb-1.5 text-xs text-[var(--color-alert)]" style={{ paddingLeft: 12 + depth * 22 }}>{error}</div>}
    </div>
  )
}

export default function Settings() {
  // The central tag list and usage counts (TagsProvider.jsx).
  const { tags } = useTags()
  const usage = useTagUsage()
  const [categories, setCategories] = useState([])
  const [filter, setFilter] = useState('')

  useEffect(() => onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))), [])
  const targetNames = useMemo(() => new Map([...categories, ...tags].map((x) => [x.id, x.name])), [categories, tags])

  // Old tags that exist only as plain text on booking lines (no record in `tags`).
  const plainTextTags = useMemo(() => {
    const known = new Set(tags.map((t) => t.id))
    return [...usage.keys()].filter((id) => !known.has(id)).length
  }, [tags, usage])

  function setType(tagId, groupingType) {
    const tag = tags.find((t) => t.id === tagId)
    if (!tag || tag.class === 'allocation' || (tag.groupingType ?? null) === groupingType) return
    setDoc(doc(db, 'tags', tagId), { ...tag, groupingType })
  }

  function rename(tagId, rawName) {
    const result = validateTagRename(tags, tagId, rawName)
    if (!result.ok) return result.reason === 'same' ? 'same' : (TAG_RENAME_MESSAGES[result.reason] ?? 'Nicht möglich.')
    setDoc(doc(db, 'tags', tagId), { ...tags.find((t) => t.id === tagId), name: result.name })
    return true
  }

  // Parents (and standalone tags) alphabetically, each followed by its children;
  // a child whose parent record is missing is listed at top level.
  const rows = useMemo(() => {
    const byName = (a, b) => a.name.localeCompare(b.name, 'de')
    const ids = new Set(tags.map((t) => t.id))
    const tops = tags.filter((t) => t.class !== 'allocation' && (!t.parentTag || !ids.has(t.parentTag))).sort(byName)
    const out = []
    for (const top of tops) {
      out.push({ tag: top, depth: 0 })
      tags.filter((t) => t.parentTag === top.id).sort(byName).forEach((c) => out.push({ tag: c, depth: 1 }))
    }
    return out
  }, [tags])
  const allocation = useMemo(() => tags.filter((t) => t.class === 'allocation').sort((a, b) => a.name.localeCompare(b.name, 'de')), [tags])

  const needle = filter.trim().toLowerCase()
  const shown = needle ? rows.filter((r) => r.tag.name.toLowerCase().includes(needle)) : rows

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Tags</h2>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Tags durchsuchen…"
            className="w-60 max-w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          />
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          Auf einen Namen klicken, neuen Namen eintippen, Enter. Das ändert nur den Namen — alle Buchungen und Budgets bleiben verbunden, und der neue Name gilt überall (Konten, Quickview, Außenstände, Verlauf). Rechts lässt sich der Typ ändern — er bestimmt Farbe und Verwendung: Anspruch erscheint in Außenstände, Reise/Projekt benennt Zeilen in Quickview.
        </p>
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-text)_30%,transparent)] bg-[var(--color-surface)]">
          {shown.length === 0 && <div className="px-3 py-3 text-sm text-[var(--color-text-muted)]">Keine Tags gefunden.</div>}
          {shown.map(({ tag, depth }) => (
            <TagRow key={tag.id} tag={tag} depth={needle ? 0 : depth} usage={usageOf(usage, tag.id)} targetNames={targetNames} onRename={rename} onSetType={setType} />
          ))}
        </div>
        {allocation.length > 0 && !needle && (
          <>
            <h3 className="pt-2 text-sm font-medium text-[var(--color-text-muted)]">Feste Rücklagen-Tags</h3>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              {allocation.map((tag) => (
                <TagRow key={tag.id} tag={tag} depth={0} usage={usageOf(usage, tag.id)} targetNames={targetNames} onRename={rename} onSetType={setType} />
              ))}
            </div>
          </>
        )}
        {plainTextTags > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Außerdem gibt es {plainTextTags} ältere Tags, die nur als Text an Buchungen hängen (z. B. aus dem Import). Sie haben noch keinen eigenen Eintrag und sind hier noch nicht umbenennbar.
          </p>
        )}
      </section>
    </div>
  )
}
