import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { db } from './firebase'
import { receivableAccountIds } from './lib/claims'
import { MOVE_MESSAGES, twinIds } from './lib/tagActions'
import { TAG_RENAME_MESSAGES } from './lib/tagRename'
import { qualifiedName } from './lib/tags'
import { CREATE_TYPES } from './lib/tagTypes'
import TagPill, { typeLook } from './TagPill'
import TagBox from './TagBox'
import { usageOf, useTagActions, useTagUsage, useTags } from './TagsProvider'
import ui from './lib/uiState'
import { MERGE_MESSAGES } from './lib/tagMerge'
import { usageHint } from './lib/tags'

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
function UsageDetails({ usage, depth, targetNames, onOpenPlan, onOpenBooking }) {
  // Clicking a plan line opens that line in Verlauf, a booking opens Konten
  // filtered to this tag with the cursor on it; Esc there comes back here
  // (Oct 2026, Markus).
  const link = 'block text-left hover:text-[var(--color-text)] hover:underline'
  return (
    <div className="space-y-0.5 px-3 pb-2 text-xs text-[var(--color-text-muted)]" style={{ paddingLeft: 12 + depth * 44 + 16 }}>
      {usage.plans.map((pl) => (
        <button key={pl.key} type="button" className={link} onClick={() => onOpenPlan?.(pl)} title="In Verlauf zeigen">
          Plan: {pl.year} · {pl.planVersion === 'plan0' ? 'Plan0' : 'Plan1'} · {targetNames.get(pl.targetId) ?? pl.targetId} — {pl.months} {pl.months === 1 ? 'Monat' : 'Monate'}, zusammen {euro(pl.sum)}
        </button>
      ))}
      {usage.bookings.slice(0, 20).map((b, i) => (
        <button key={`${b.txId}-${i}`} type="button" className={link} onClick={() => onOpenBooking?.(b)} title="In Konten zeigen">
          Buchung: {b.date} · {b.label || '—'} · {euro(b.cents)}
          {b.deleted && ' (gelöscht — zählt, bis sie endgültig entfernt ist)'}
        </button>
      ))}
      {usage.bookings.length > 20 && <div>… {usage.bookings.length - 20} weitere Buchungen</div>}
      {usage.plans.length === 0 && usage.bookings.length === 0 && <div>Nirgends verwendet — wird automatisch entfernt.</div>}
    </div>
  )
}

// An old tag that exists only as text on booking lines (no record yet, e.g.
// migrated claims): shown so the list is complete; renaming and a type become
// possible once it has a record (PLAN.md Phase 5b step 6).
function PlainTagRow({ id, usage, targetNames, open, onToggle, onOpenBooking }) {
  return (
    <div className="flex flex-col border-b border-[var(--color-border)] last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-1.5 text-sm">
        <span className="min-w-0 flex-1">
          <TagPill size="md">{id}</TagPill>
        </span>
        <span className="text-sm text-[var(--color-text-muted)]">nur Text</span>
        <button type="button" onClick={onToggle} className="w-72 shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-[var(--color-text-muted)] hover:underline">
          {usage.lines} {usage.lines === 1 ? 'Buchungszeile' : 'Buchungszeilen'}
          {usage.deletedLines > 0 && ` (+${usage.deletedLines} gelöscht)`} {open ? '▴' : '▾'}
        </button>
      </div>
      {open && <UsageDetails usage={usage} depth={0} targetNames={targetNames} onOpenBooking={(b) => onOpenBooking(b, id)} />}
    </div>
  )
}

function TagRow({ tag, depth, label, dim, usage, targetNames, twin, parents, hasChildren, open, onToggle, onRename, onSetType, onMove, onMerge, onOpenPlan, onOpenBooking, kids = [], expanded = false, onToggleFamily, onArchive, archivedView = false }) {
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
      <div className={`flex items-center gap-3 px-3 py-1.5 text-sm ${dim ? 'opacity-50' : ''}`} style={{ paddingLeft: 12 + depth * 44 }}>
        {/* A family is one line, its children small behind the parent; ▸
            opens it (children as their own lines, as before) (Oct 2026). */}
        {depth === 0 && !locked &&
          (hasChildren ? (
            <button
              type="button"
              onClick={onToggleFamily}
              aria-label={expanded ? 'Untertags einklappen' : 'Untertags aufklappen'}
              className="-mr-2 w-4 shrink-0 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="-mr-2 w-4 shrink-0" />
          ))}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
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
            className={`min-w-0 text-left ${hasChildren && !expanded ? 'shrink-0' : 'flex-1'}`}
          >
            {/* Drawn as the tag's pill (TagPill.jsx), as everywhere else. */}
            <TagPill tag={tag} size="md" className={locked ? '' : 'hover:underline'}>
              {label ?? tag.name}
            </TagPill>
            {locked && <span className="ml-2" aria-label="gesperrt">🔒</span>}
            {twin && (
              <span
                className="ml-2 rounded border border-[var(--color-alert)] px-1 text-xs text-[var(--color-alert)]"
                title="Gleicher Name unter derselben Übergruppe — mit ⇢ (Zusammenführen) zu einem Tag machen."
              >
                doppelt
              </span>
            )}
          </button>
        )}
        {hasChildren && !expanded && !editing && (
          <button type="button" onClick={onToggleFamily} title="Untertags aufklappen" className="flex min-w-0 items-center gap-1 overflow-hidden opacity-80">
            {kids.map((k) => (
              <TagPill key={k.id} tag={k} className="!text-[11px] !px-1.5 !py-0">
                {k.name}
              </TagPill>
            ))}
          </button>
        )}
        </div>
        {!locked && !(depth === 0 && hasChildren) && (
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
            className="w-48 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-sm text-[var(--color-text)] disabled:opacity-50"
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
          <span className="w-40 shrink-0 text-sm text-[var(--color-text-muted)]">Rücklage</span>
        ) : (
          // The type can be changed here (Oct 2026, Markus). It decides where the
          // tag shows up: Anspruch → Außenstände, Reise/Projekt → Quickview rows.
          <select
            value={tag.groupingType ?? ''}
            onChange={(e) => onSetType(tag.id, e.target.value || null)}
            aria-label="Typ"
            className="w-40 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-sm text-[var(--color-text)]"
          >
            {CREATE_TYPES.map((o) => (
              <option key={o.groupingType ?? 'none'} value={o.groupingType ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {!locked ? (
          <button
            type="button"
            onClick={onMerge}
            title="In einen anderen Tag übernehmen (zusammenführen)"
            aria-label="Zusammenführen"
            className="w-6 shrink-0 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
          >
            ⇢
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        {/* Archive the whole family (or bring it back in the Archiv view). */}
        {!locked && depth === 0 ? (
          <button
            type="button"
            onClick={onArchive}
            title={archivedView ? 'Aus dem Archiv zurückholen (ganze Familie)' : 'Archivieren (ganze Familie) — nur aus dieser Liste, Buchungen bleiben'}
            aria-label={archivedView ? 'Zurückholen' : 'Archivieren'}
            className="w-6 shrink-0 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
          >
            {archivedView ? '↩' : '🗄'}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <button
          type="button"
          onClick={onToggle}
          title="Zeigen, wo dieser Tag verwendet wird"
          className="w-72 shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-[var(--color-text-muted)] hover:underline"
        >
          {usage.lines} {usage.lines === 1 ? 'Buchungszeile' : 'Buchungszeilen'}
          {usage.deletedLines > 0 && ` (+${usage.deletedLines} gelöscht)`}
          {usage.planRows > 0 && ` · ${usage.planRows} Budget`} {open ? '▴' : '▾'}
        </button>
      </div>
      {open && <UsageDetails usage={usage} depth={depth} targetNames={targetNames} onOpenPlan={(pl) => onOpenPlan(pl, pl.tagId ?? tag.id)} onOpenBooking={(b) => onOpenBooking(b, tag.id)} />}
      {error && <div className="px-3 pb-1.5 text-xs text-[var(--color-alert)]" style={{ paddingLeft: 12 + depth * 44 }}>{error}</div>}
    </div>
  )
}

// Merge a tag into another (Oct 2026, Markus): pick the tag to keep (same-name
// twins first), see what moves, confirm. lib/tagMerge.js has the rules.
function MergeModal({ from, tags, tagById, twins, onClose }) {
  const usage = useTagUsage()
  const tagActions = useTagActions()
  const [into, setInto] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fromUsage = usageOf(usage, from.id)
  useEffect(() => {
    if (!into) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        setInto(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [into, busy])
  const sameName = (t) => t.name.trim().toLowerCase() === from.name.trim().toLowerCase()
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center" onClick={() => !busy && onClose()}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative flex w-full max-w-md flex-col gap-3 rounded-lg bg-[var(--color-surface)] p-5 text-sm" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium">
          <TagPill tag={from}>{qualifiedName(from.id, tagById)}</TagPill> zusammenführen
        </p>
        {!into ? (
          <>
            <p className="text-xs text-[var(--color-text-muted)]">In welchen Tag übernehmen? ({usageHint(fromUsage)} wandern mit, dieser Tag verschwindet danach.)</p>
            <TagBox
              placeholder="Tag suchen…"
              getOptions={(text) => {
                const q = text.trim().toLowerCase()
                return tags
                  .filter((t) => t.class === 'grouping' && t.id !== from.id && (!q || qualifiedName(t.id, tagById).toLowerCase().includes(q)))
                  .sort((a, b) => (twins.has(b.id) && sameName(b)) - (twins.has(a.id) && sameName(a)) || qualifiedName(a.id, tagById).localeCompare(qualifiedName(b.id, tagById), 'de'))
                  .slice(0, 30)
                  .map((t) => ({ key: t.id, id: t.id, tag: t, label: qualifiedName(t.id, tagById), hint: usageHint(usageOf(usage, t.id)) }))
              }}
              onPick={(o) => {
                setError('')
                setInto(tagById[o.id])
              }}
              onClose={onClose}
              footer={
                <div className="flex justify-end">
                  <button type="button" onClick={onClose} className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]">
                    Abbrechen
                  </button>
                </div>
              }
            />
          </>
        ) : (
          <>
            <p>
              Alle Buchungen ({fromUsage.lines + fromUsage.deletedLines}), Planzeilen ({fromUsage.plans.length}) und Untertags von „{qualifiedName(from.id, tagById)}“ gehen auf{' '}
              <TagPill tag={into}>{qualifiedName(into.id, tagById)}</TagPill> über. Hatten beide in derselben Planung eine Zeile, werden die Werte addiert. „{from.name}“ wird danach gelöscht — das lässt sich nicht rückgängig machen.
            </p>
            {error && <p className="text-xs text-[var(--color-alert)]">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setInto(null)} className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]">
                Zurück
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const r = tagActions.merge(from.id, into.id)
                  if (!r.ok) {
                    setError(MERGE_MESSAGES[r.reason] ?? 'Nicht möglich.')
                    return
                  }
                  setBusy(true)
                  try {
                    await r.done
                    onClose()
                  } finally {
                    setBusy(false)
                  }
                }}
                className="rounded-md bg-[var(--color-computed)] px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Wird zusammengeführt…' : 'Zusammenführen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Settings({ year, onOpenInKonten, onOpenInVerlauf }) {
  // The central tag list and usage counts (TagsProvider.jsx).
  const { tags } = useTags()
  const usage = useTagUsage()
  const [categories, setCategories] = useState([])
  // Search, type chip and opened usage lists are remembered (lib/uiState.js),
  // so coming back from Konten/Planung (Esc) shows the list as it was.
  const [filter, setFilter] = useState(() => ui.get('settings', 'filter', '') || '')
  // Type chips above the list (Oct 2026, Markus): show only tags of one type.
  // null = all; 'none' = untyped; 'allocation' = the fixed Rücklagen tags.
  const [typeFilter, setTypeFilter] = useState(() => ui.get('settings', 'typeFilter', null))
  // Coming back (Esc from Konten/Verlauf, or any revisit): the list scrolled
  // where it was left, once the tags are there (Oct 2026, Markus).
  const scrollRef = useRef(null)
  const scrollRestoredRef = useRef(false)
  useLayoutEffect(() => {
    if (scrollRestoredRef.current || tags.length === 0 || !scrollRef.current) return
    scrollRestoredRef.current = true
    scrollRef.current.scrollTop = Number(ui.get('settings', 'scrollTop', 0)) || 0
  })
  // Ctrl+K → search field, Ctrl+I → shortcuts (Oct 2026, Markus).
  const searchRef = useRef(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) {
        if (e.key === 'Escape' && shortcutsOpen) {
          e.stopPropagation()
          setShortcutsOpen(false)
        }
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (k === 'i') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [shortcutsOpen])
  const [openIds, setOpenIds] = useState(() => new Set(ui.get('settings', 'open', [])))
  const [allYears, setAllYears] = useState(() => Boolean(ui.get('settings', 'allYears', false)))
  const [expandedFamilies, setExpandedFamilies] = useState(() => new Set(ui.get('settings', 'families', [])))
  useEffect(() => ui.set('settings', 'allYears', allYears), [allYears])
  useEffect(() => ui.set('settings', 'families', [...expandedFamilies]), [expandedFamilies])
  const toggleFamily = (id) =>
    setExpandedFamilies((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  useEffect(() => ui.set('settings', 'filter', filter), [filter])
  useEffect(() => ui.set('settings', 'typeFilter', typeFilter), [typeFilter])
  useEffect(() => ui.set('settings', 'open', [...openIds]), [openIds])
  const toggleOpen = (id) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const openBooking = (b, tagId) => onOpenInKonten?.({ tagId, focusTxId: b.txId, year: String(b.date).slice(0, 4), from: 'settings' })
  const openPlan = (pl, tagId) =>
    onOpenInVerlauf?.({ targetKey: pl.targetKey, targetId: pl.targetId, planVersion: pl.planVersion, tagId, year: String(pl.year) })
  // Merging (lib/tagMerge.js): the tag being merged away, then the one to keep.
  const [mergeFrom, setMergeFrom] = useState(null)
  const [bulkType, setBulkType] = useState('')

  useEffect(() => onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))), [])
  const [accounts, setAccounts] = useState([])
  useEffect(() => onSnapshot(collection(db, 'accounts'), (snap) => setAccounts(snap.docs.map((d) => d.data()))), [])
  // Converting the old plain-text tags (PLAN.md Phase 5b step 6): a preview in
  // a confirmation box, then one write.
  const [convertPreview, setConvertPreview] = useState(null)
  const [converting, setConverting] = useState(false)
  useEffect(() => {
    if (!convertPreview) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !converting) {
        e.preventDefault()
        setConvertPreview(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [convertPreview, converting])
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
  const typeOf = (t) => (t.class === 'allocation' ? 'allocation' : (t.groupingType ?? 'none'))
  const inArchive = typeFilter === 'archive'
  // Only tags used in the year chosen at the top (bookings or plan lines that
  // year; a tag without any use counts for its creation year), unless "alle
  // Jahre" — and searching always looks at all years (Oct 2026, Markus).
  const usedInYear = (t) => {
    const u = usageOf(usage, t.id)
    if (u.bookings.some((b) => String(b.date).startsWith(String(year))) || u.plans.some((pl) => String(pl.year) === String(year))) return true
    if (u.bookings.length === 0 && u.plans.length === 0) return !t.createdAt || new Date(t.createdAt).getFullYear() === Number(year)
    return false
  }
  const yearScoped = !allYears && !needle && !inArchive && Boolean(year)
  const visible = (t) => (inArchive ? Boolean(t.archived) : !t.archived)
  const matches = (t) =>
    visible(t) && (!needle || qualifiedName(t.id, tagById).toLowerCase().includes(needle)) && (!typeFilter || inArchive || typeOf(t) === typeFilter)
  // One entry per family: the parent (dimmed when only a child matches), the
  // children that pass, shown small behind the parent or — opened — as their
  // own lines. A search opens the families it finds children in.
  const families = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].depth !== 0) continue
    const top = rows[i].tag
    const kids = tags.filter((t) => t.parentTag === top.id).sort((x, y) => x.name.localeCompare(y.name, 'de'))
    const kidsShown = kids.filter((k) => matches(k) && (!yearScoped || usedInYear(k)))
    const topShown = matches(top) && (!yearScoped || usedInYear(top) || kidsShown.length > 0)
    if (!topShown && kidsShown.length === 0) continue
    families.push({ top, kids: kidsShown, dim: !matches(top), expanded: expandedFamilies.has(top.id) || (Boolean(needle) && kidsShown.length > 0) })
  }
  const familyIds = families.filter((f) => f.kids.length > 0).map((f) => f.top.id)
  const allOpen = familyIds.length > 0 && familyIds.every((id) => expandedFamilies.has(id))
  const shown = families.flatMap((f) => [
    { tag: f.top, depth: 0, dim: f.dim, kids: f.kids, expanded: f.expanded },
    ...(f.expanded ? f.kids.map((k) => ({ tag: k, depth: 1, dim: false })) : []),
  ])
  const matched = families.flatMap((f) => [...(f.dim ? [] : [f.top]), ...f.kids]).map((tag) => ({ tag }))
  const filtering = Boolean(needle || typeFilter)
  const typeCounts = useMemo(() => {
    const c = {}
    for (const t of tags) {
      const k = t.archived ? 'archive' : typeOf(t)
      c[k] = (c[k] ?? 0) + 1
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typeOf is pure
  }, [tags])
  const chips = [
    { key: null, label: 'Alle', count: tags.length - (typeCounts.archive ?? 0), look: null },
    ...CREATE_TYPES.map((o) => ({ key: o.groupingType ?? 'none', label: o.label, count: typeCounts[o.groupingType ?? 'none'] ?? 0, look: typeLook(o.groupingType) })),
    { key: 'allocation', label: 'Rücklage', count: typeCounts.allocation ?? 0, look: { class: 'allocation' } },
    { key: 'archive', label: 'Archiv', count: typeCounts.archive ?? 0, look: null },
  ]
  const shownPlain = needle ? plainTextTags.filter((id) => id.toLowerCase().includes(needle)) : plainTextTags
  // A parent's figures cover its whole family (Oct 2026, Markus): its own use
  // plus every child's; each plan line remembers which tag it belongs to, so
  // clicking it opens the right line in Verlauf. A booking opens the parent's
  // tag filter, which includes its children.
  const familyUsage = (tag) => {
    const own = usageOf(usage, tag.id)
    const kids = tag.parentTag ? [] : tags.filter((t) => t.parentTag === tag.id)
    if (kids.length === 0) return own
    const all = [tag, ...kids].map((t) => ({ id: t.id, u: usageOf(usage, t.id) }))
    const seen = new Set()
    return {
      lines: all.reduce((n, x) => n + x.u.lines, 0),
      deletedLines: all.reduce((n, x) => n + x.u.deletedLines, 0),
      planRows: all.reduce((n, x) => n + x.u.planRows, 0),
      yearSettings: all.reduce((n, x) => n + x.u.yearSettings, 0),
      plans: all.flatMap((x) => x.u.plans.map((pl) => ({ ...pl, key: `${x.id}|${pl.key}`, tagId: x.id }))).sort((a, b) => a.year - b.year || a.planVersion.localeCompare(b.planVersion)),
      bookings: all
        .flatMap((x) => x.u.bookings)
        .filter((b) => {
          const k = `${b.txId}|${b.cents}|${b.date}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    }
  }
  const rowProps = (tag) => ({
    usage: familyUsage(tag),
    targetNames,
    twin: twins.has(tag.id),
    parents,
    hasChildren: withChildren.has(tag.id),
    open: openIds.has(tag.id),
    onToggle: () => toggleOpen(tag.id),
    onRename: rename,
    onSetType: setType,
    onMove: move,
    onMerge: () => setMergeFrom(tag),
    onOpenPlan: openPlan,
    onOpenBooking: openBooking,
    onToggleFamily: () => toggleFamily(tag.id),
    onArchive: () => tagActions.setArchived(tag.id, !inArchive),
    archivedView: inArchive,
  })

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => ui.set('settings', 'scrollTop', e.currentTarget.scrollTop)}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
    >
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Tags</h2>
          <div className="flex items-center gap-3">
            <input
              ref={searchRef}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                // Esc clears the field (the browser's own), on an empty field it leaves it.
                if (e.key === 'Escape' && !filter) e.currentTarget.blur()
              }}
              placeholder="Tags durchsuchen… (Strg+K)"
              className="w-60 max-w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
            />
            {/* Keyboard shortcuts, like Konten's (i): hover, or Ctrl+I. */}
            <div className="relative">
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
                <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text)] shadow-lg">
                  <div className="mb-1.5 font-medium">Tastenkürzel</div>
                  <ul className="space-y-1">
                    <li>
                      <b>Strg+K</b> — ins Suchfeld
                    </li>
                    <li>
                      <b>Strg+I</b> — diese Übersicht ein-/ausblenden
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) =>
            c.key === null ? (
              <button
                key="all"
                type="button"
                aria-pressed={typeFilter === null}
                onClick={() => setTypeFilter(null)}
                className={`rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-sm ${typeFilter === null ? 'ring-2 ring-[var(--color-computed)] ring-offset-1 ring-offset-[var(--color-bg)]' : 'opacity-80 hover:opacity-100'}`}
              >
                {c.label} <span className="text-xs opacity-70">{c.count}</span>
              </button>
            ) : (
            <TagPill
              key={c.key ?? 'all'}
              as="button"
              tag={c.look}
              size="md"
              aria-pressed={typeFilter === c.key}
              onClick={() => setTypeFilter(c.key)}
              className={`cursor-pointer ${typeFilter === c.key ? 'ring-2 ring-[var(--color-computed)] ring-offset-1 ring-offset-[var(--color-bg)]' : 'opacity-80 hover:opacity-100'}`}
            >
              {c.label} <span className="text-xs opacity-70">{c.count}</span>
            </TagPill>
            ),
          )}
          {/* Open or close every family at once (Oct 2026, Markus). */}
          <div className="ml-auto flex items-center gap-3">
          {familyIds.length > 0 && (
            <button
              type="button"
              onClick={() => setExpandedFamilies(allOpen ? new Set() : new Set(familyIds))}
              className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
            >
              {allOpen ? '▾ Alle zuklappen' : '▸ Alle aufklappen'}
            </button>
          )}
          {/* The year at the top or all years (Oct 2026, Markus). */}
          <label className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]" title="Ohne Haken: nur Tags, die im oben gewählten Jahr verwendet werden">
            <input type="checkbox" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} />
            alle Jahre
          </label>
          </div>
        </div>
        {/* Change the type of every tag shown (Oct 2026, Markus) — narrow the list
            with the chips and/or the search field first. */}
        {filtering && typeFilter !== 'allocation' && matched.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span>
              Alle {matched.length} gefundenen Tags auf Typ
            </span>
            <select
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value)}
              aria-label="Typ für alle angezeigten"
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text)]"
            >
              <option value="">— wählen —</option>
              {CREATE_TYPES.map((o) => (
                <option key={o.groupingType ?? 'none'} value={o.groupingType ?? 'none'}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkType}
              onClick={() => {
                const type = bulkType === 'none' ? null : bulkType
                const label = CREATE_TYPES.find((o) => (o.groupingType ?? 'none') === bulkType)?.label
                if (!window.confirm(`${matched.length} Tags auf „${label}“ setzen?`)) return
                matched.forEach(({ tag }) => tagActions.setType(tag.id, type))
                setBulkType('')
              }}
              className="rounded-md bg-[var(--color-computed)] px-2 py-0.5 font-medium text-white disabled:opacity-40"
            >
              setzen
            </button>
          </div>
        )}
        {typeFilter !== 'allocation' && (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-text)_30%,transparent)] bg-[var(--color-surface)]">
          {shown.length === 0 && <div className="px-3 py-3 text-sm text-[var(--color-text-muted)]">Keine Tags gefunden.</div>}
          {shown.map(({ tag, depth, dim, kids, expanded }) => (
            <TagRow key={tag.id} tag={tag} depth={depth} dim={dim} kids={kids} expanded={expanded} {...rowProps(tag)} />
          ))}
        </div>
        )}
        {allocation.length > 0 && !needle && (!typeFilter || typeFilter === 'allocation') && (
          <>
            <h3 className="pt-2 text-sm font-medium text-[var(--color-text-muted)]">Feste Rücklagen-Tags</h3>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              {allocation.map((tag) => (
                <TagRow key={tag.id} tag={tag} depth={0} {...rowProps(tag)} />
              ))}
            </div>
          </>
        )}
        {shownPlain.length > 0 && !typeFilter && (
          <>
            <h3 className="pt-2 text-sm font-medium text-[var(--color-text-muted)]">Alte Text-Tags ({shownPlain.length})</h3>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                Diese Tags hängen nur als Text an Buchungen (z. B. aus dem Import) und haben noch keinen eigenen Eintrag. Umbenennen, Typ und Übergruppe gehen, sobald sie übernommen sind.
              </p>
              {!needle && (
                <button
                  type="button"
                  onClick={() => setConvertPreview(tagActions.previewPlainTags(receivableAccountIds(accounts)))}
                  disabled={accounts.length === 0}
                  className="rounded-md bg-[var(--color-computed)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Alte Text-Tags übernehmen…
                </button>
              )}
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              {shownPlain.map((id) => (
                <PlainTagRow key={id} id={id} usage={usageOf(usage, id)} targetNames={targetNames} open={openIds.has(id)} onToggle={() => toggleOpen(id)} onOpenBooking={openBooking} />
              ))}
            </div>
          </>
        )}
      </section>
      {mergeFrom && <MergeModal from={mergeFrom} tags={tags} tagById={tagById} twins={twins} onClose={() => setMergeFrom(null)} />}
      {convertPreview && (
        <div className="fixed inset-0 z-30 flex items-center justify-center" onClick={() => !converting && setConvertPreview(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative flex w-full max-w-md flex-col gap-3 rounded-lg bg-[var(--color-surface)] p-5 text-sm" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium">Alte Text-Tags übernehmen</p>
            <p>
              {convertPreview.creates.length} Text-Tags bekommen einen eigenen Eintrag: {convertPreview.counts.claim} als Anspruch, {convertPreview.counts['claim-category']} als Reisekostenart,{' '}
              {convertPreview.counts.none} ohne Typ. Die Buchungen bleiben unverändert
              {convertPreview.rewrites.length > 0 ? `, außer ${convertPreview.rewrites.length} mit einem „/“ im Tag (bekommen den neuen Namen ohne „/“)` : ''}.
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Danach lassen sie sich hier umbenennen, typisieren und verschieben. Gleichnamige Tags werden als „doppelt“ markiert, nicht zusammengelegt.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={converting}
                onClick={() => setConvertPreview(null)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={converting || convertPreview.creates.length === 0}
                onClick={async () => {
                  setConverting(true)
                  try {
                    await tagActions.convertPlainTags(receivableAccountIds(accounts))
                  } finally {
                    setConverting(false)
                    setConvertPreview(null)
                  }
                }}
                className="rounded-md bg-[var(--color-computed)] px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {converting ? 'Wird übernommen…' : 'Übernehmen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
