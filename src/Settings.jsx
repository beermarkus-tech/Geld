import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { db } from './firebase'
import { MOVE_MESSAGES, twinIds } from './lib/tagActions'
import { TAG_RENAME_MESSAGES } from './lib/tagRename'
import { qualifiedName } from './lib/tags'
import { CREATE_TYPES } from './lib/tagTypes'
import TagPill from './TagPill'
import { usageOf, useTagActions, useTagUsage, useTags } from './TagsProvider'

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

// An old tag that exists only as text on booking lines (no record yet, e.g.
// migrated claims): shown so the list is complete; renaming and a type become
// possible once it has a record (PLAN.md Phase 5b step 6).
function PlainTagRow({ id, usage, targetNames }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col border-b border-[var(--color-border)] last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-1.5 text-sm">
        <span className="min-w-0 flex-1">
          <TagPill size="md">{id}</TagPill>
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">nur Text</span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="w-40 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-muted)] hover:underline">
          {usage.lines} {usage.lines === 1 ? 'Buchungszeile' : 'Buchungszeilen'}
          {usage.deletedLines > 0 && ` (+${usage.deletedLines} gelöscht)`} {open ? '▴' : '▾'}
        </button>
      </div>
      {open && <UsageDetails usage={usage} depth={0} targetNames={targetNames} />}
    </div>
  )
}

function TagRow({ tag, depth, label, usage, targetNames, twin, parents, hasChildren, onRename, onSetType, onMove }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tag.name)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const locked = tag.class === 'allocation'

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
            {/* Drawn as the tag's pill (TagPill.jsx), as everywhere else. */}
            <TagPill tag={tag} size="md" className={locked ? '' : 'hover:underline'}>
              {label ?? tag.name}
            </TagPill>
            {locked && <span className="ml-2" aria-label="gesperrt">🔒</span>}
            {twin && (
              <span
                className="ml-2 rounded border border-[var(--color-alert)] px-1 text-xs text-[var(--color-alert)]"
                title="Gleicher Name unter derselben Übergruppe — in Verlauf die Zeile durch den anderen ersetzen bzw. in Konten umtaggen; der unbenutzte verschwindet dann von selbst."
              >
                doppelt
              </span>
            )}
          </button>
        )}
        {!locked && (
          // Move under another parent, or to the top level (Oct 2026, Markus).
          <select
            value={tag.parentTag ?? ''}
            disabled={hasChildren}
            onChange={(e) => {
              const r = onMove(tag.id, e.target.value || null)
              setError(r.ok || r.reason === 'same' ? '' : (MOVE_MESSAGES[r.reason] ?? 'Nicht möglich.'))
            }}
            aria-label="Übergruppe"
            title={hasChildren ? 'Hat selbst Untertags — bleibt oben' : 'Übergruppe'}
            className="w-40 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text)] disabled:opacity-50"
          >
            <option value="">— keine Übergruppe —</option>
            {parents
              .filter((p) => p.id !== tag.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
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
    return [...usage.entries()]
      .filter(([id, u]) => !known.has(id) && u.lines + u.deletedLines > 0)
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b, 'de'))
  }, [tags, usage])
  const twins = useMemo(() => twinIds(tags), [tags])
  const parents = useMemo(() => tags.filter((t) => t.class === 'grouping' && !t.parentTag).sort((a, b) => a.name.localeCompare(b.name, 'de')), [tags])
  const withChildren = useMemo(() => new Set(tags.map((t) => t.parentTag).filter(Boolean)), [tags])
  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags])
  const move = (tagId, parentId) => tagActions.move(tagId, parentId)

  // Through the shared tag actions (TagsProvider.jsx), like every screen.
  const tagActions = useTagActions()
  const setType = (tagId, groupingType) => tagActions.setType(tagId, groupingType)
  function rename(tagId, rawName) {
    const result = tagActions.rename(tagId, rawName)
    if (result.ok) return true
    return result.reason === 'same' ? 'same' : (TAG_RENAME_MESSAGES[result.reason] ?? 'Nicht möglich.')
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
  const shown = needle ? rows.filter((r) => qualifiedName(r.tag.id, tagById).toLowerCase().includes(needle)) : rows
  const shownPlain = needle ? plainTextTags.filter((id) => id.toLowerCase().includes(needle)) : plainTextTags
  const rowProps = (tag) => ({ usage: usageOf(usage, tag.id), targetNames, twin: twins.has(tag.id), parents, hasChildren: withChildren.has(tag.id), onRename: rename, onSetType: setType, onMove: move })

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
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
          Auf einen Namen klicken, neuen Namen eintippen, Enter. Das ändert nur den Namen — alle Buchungen und Budgets bleiben verbunden, und der neue Name gilt überall (Konten, Quickview, Außenstände, Verlauf). Rechts lassen sich Übergruppe und Typ ändern — er bestimmt Farbe und Verwendung: Anspruch erscheint in Außenstände, Reise/Projekt benennt Zeilen in Quickview.
        </p>
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-text)_30%,transparent)] bg-[var(--color-surface)]">
          {shown.length === 0 && <div className="px-3 py-3 text-sm text-[var(--color-text-muted)]">Keine Tags gefunden.</div>}
          {shown.map(({ tag, depth }) => (
            <TagRow key={tag.id} tag={tag} depth={needle ? 0 : depth} label={needle ? qualifiedName(tag.id, tagById) : undefined} {...rowProps(tag)} />
          ))}
        </div>
        {allocation.length > 0 && !needle && (
          <>
            <h3 className="pt-2 text-sm font-medium text-[var(--color-text-muted)]">Feste Rücklagen-Tags</h3>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              {allocation.map((tag) => (
                <TagRow key={tag.id} tag={tag} depth={0} {...rowProps(tag)} />
              ))}
            </div>
          </>
        )}
        {shownPlain.length > 0 && (
          <>
            <h3 className="pt-2 text-sm font-medium text-[var(--color-text-muted)]">Alte Text-Tags ({shownPlain.length})</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Diese Tags hängen nur als Text an Buchungen (z. B. aus dem Import) und haben noch keinen eigenen Eintrag. Umbenennen, Typ und Übergruppe gehen, sobald sie übernommen sind.
            </p>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              {shownPlain.map((id) => (
                <PlainTagRow key={id} id={id} usage={usageOf(usage, id)} targetNames={targetNames} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
