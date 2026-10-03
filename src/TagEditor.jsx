import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'

import { createTypesFor, findTagByText, tagKey } from './lib/tagPicker'
import { qualifiedTagName } from './lib/tagStyle'
import { CREATE_TYPES } from './lib/tagTypes'
import { usageHint } from './lib/tags'
import TagBox from './TagBox'
import { pillLook } from './TagPill'
import { usageOf, useTagUsage } from './TagsProvider'


// A selected tag: its pill (TagPill.jsx) with a remove ×. Untyped tags and old
// plain-text tags both get the dashed outline, on purpose (Markus): "not yet
// categorized" and "not a real tracked tag" read the same until resolved.
function Chip({ tag, label, onRemove, title }) {
  const look = pillLook(tag)
  return (
    <span title={title} className={`${look.className.replace('inline-block', '')} inline-flex items-center gap-1`} style={look.style}>
      {label}
      <button type="button" onClick={onRemove} className="leading-none">
        ×
      </button>
    </span>
  )
}

// Konten's Tags column editor (spec.md §2.5), built on the shared tag box
// (TagBox.jsx — same list, look and keys as Verlauf's boxes since Oct 2026).
// The tags already on the line sit above as removable chips; the list offers
// every tag (allocation and grouping tags; the old plain-text values became
// real tags in Oct 2026, PLAN.md Phase 5b step 6), and a "Neu … — Typ" row per type when the typed text
// doesn't exist yet. "Schottland:Fähre" creates/reuses the parent and the
// child (lib/tagActions.js). With an empty field the 5 most recently used tags
// come first.
//
// Keys: ↓/↑, Enter picks the highlighted entry (the first one is highlighted
// as you type) and closes — adding several tags at once is rare (Markus); with
// nothing to pick Enter keeps what's there and closes. Esc clears the field,
// then closes. Backspace on an empty field removes the last chip. Tab keeps
// what's there, closes and adds a new booking row below (Markus).
//
// (The old rule offering Reisekostenart only next to a claim tag is gone with
// that type — Dienstreise children are ordinary "Trip: Kind" tags.)
const TagEditor = forwardRef(function TagEditor(props, ref) {
  const { data, tags, recentTagValues = [], initialTagIds = [], onApply, onCreateTag, onTabAddRow, api } = props
  const [selectedIds, setSelectedIds] = useState(initialTagIds)
  const usage = useTagUsage()

  useImperativeHandle(ref, () => ({
    getValue: () => ({ tagIds: selectedIds }),
    isCancelBeforeStart: () => false,
  }))

  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags])
  const qName = (t) => qualifiedTagName(t, tagById)
  // The top-level tags whose family this booking already uses (on any of its
  // lines, or chosen here): "2026-05 HAM" for a line tagged "2026-05 HAM: Taxi".
  const familyParents = useMemo(() => {
    const tx = data?.__isLine ? data.__parent : data
    const ids = new Set([...(tx?.lines ?? []).flatMap((l) => l.tags ?? []), ...selectedIds])
    const out = new Map()
    for (const id of ids) {
      const t = tagById[id]
      if (!t || t.class !== 'grouping') continue
      const top = t.parentTag ? tagById[t.parentTag] : t
      if (top && !top.parentTag) out.set(top.id, top)
    }
    return [...out.values()].slice(0, 3)
  }, [data, selectedIds, tagById])

  function getOptions(rawText) {
    const text = rawText.trim().toLowerCase()
    const candidates = [...tags.filter((t) => t.class === 'allocation'), ...tags.filter((t) => t.class === 'grouping')]
    const eligible = candidates
      .filter((t) => !selectedIds.includes(t.id))
      // Spaces around the colon don't matter: "schottland:aus" finds "Schottland: Ausgaben".
      .filter((t) => text === '' || tagKey(qName(t)).includes(tagKey(text)))
    let list = eligible.slice(0, 25)
    let recentCount = 0
    if (text === '') {
      const byId = new Map(eligible.map((t) => [t.id, t]))
      const recent = []
      for (const v of recentTagValues) {
        if (recent.length >= 5) break
        if (byId.has(v)) {
          recent.push(byId.get(v))
          byId.delete(v)
        }
      }
      recentCount = recent.length
      list = [...recent, ...byId.values()].slice(0, 25)
    }
    const asOption = (t, i) => ({
      key: t.id,
      id: t.id,
      tag: tagById[t.id],
      label: qName(t) || t.id,
      hint: tagById[t.id]?.class === 'grouping' ? usageHint(usageOf(usage, t.id)) : null,
      separatorBefore: recentCount > 0 && i === recentCount,
      // A top-level tag can be opened with → to pick or add one of its children.
      drillText: tagById[t.id]?.class === 'grouping' && !tagById[t.id].parentTag ? `${tagById[t.id].name}: ` : undefined,
    })
    // The booking's own family first (Oct 2026, Markus): typing "Hotel" while
    // the booking already carries "2026-05 HAM" (or one of its children)
    // offers "2026-05 HAM: Hotel" — the existing child, or a new one.
    const family = []
    const raw = rawText.trim()
    if (raw && !raw.includes(':')) {
      for (const p of familyParents) {
        const kids = tags.filter((t) => t.parentTag === p.id && !selectedIds.includes(t.id))
        kids.filter((k) => k.name.toLowerCase().includes(text)).forEach((k) => family.push(k))
        if (!tags.some((t) => t.parentTag === p.id && t.name.trim().toLowerCase() === text))
          family.push({ newUnder: p, name: raw })
      }
    }
    const familyIds = new Set(family.filter((f) => f.id).map((f) => f.id))
    const familyOptions = family.map((f) =>
      f.newUnder
        ? { key: `new:${f.newUnder.id}`, createText: `${f.newUnder.name}:${f.name}`, groupingType: f.newUnder.groupingType ?? null, tag: { class: 'grouping', groupingType: f.newUnder.groupingType ?? null }, label: `${f.newUnder.name}: ${f.name}`, hint: 'neu' }
        : asOption(f, -1),
    )
    return [...familyOptions, ...list.filter((t) => !familyIds.has(t.id)).map(asOption)].slice(0, 30)
  }

  // Not when the text names an existing tag (incl. allocation tags).
  function getCreateTypes(rawText) {
    const text = rawText.trim().toLowerCase()
    if (!text || findTagByText(tags, rawText)) return []
    if (tags.some((t) => t.class === 'allocation' && t.name.toLowerCase() === text)) return []
    return createTypesFor(tags, rawText, CREATE_TYPES)
  }

  // Adding applies and closes at once; removing a chip doesn't close, so
  // correcting a line (remove, then pick) stays one visit.
  function add(id) {
    onApply(data, [...selectedIds, id])
    api.stopEditing(true)
  }
  // Writes directly via onApply (the grid's own commit pipeline proved
  // unreliable for popup editors, see Konten.jsx), then closes.
  function apply() {
    onApply(data, selectedIds)
    api.stopEditing(true)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg" style={{ minWidth: 300 }}>
      <TagBox
        placeholder="Tag suchen oder neu erstellen… (z.B. Schottland:Fähre)"
        getOptions={getOptions}
        getCreateTypes={getCreateTypes}
        onPick={(o) => add(o.createText ? onCreateTag(o.createText, o.groupingType) : o.id)}
        onCreate={(text, groupingType) => add(onCreateTag(text, groupingType))}
        onEnterNone={apply}
        onClose={() => api.stopEditing(true)}
        onKey={(e, text) => {
          if (e.key === 'Backspace' && text === '' && selectedIds.length > 0) {
            setSelectedIds((prev) => prev.slice(0, -1))
            return true
          }
          if (e.key === 'Tab') {
            apply()
            onTabAddRow()
            return true
          }
          return false
        }}
        header={
          <div className="flex flex-wrap gap-1">
            {selectedIds.map((id) => (
              <Chip
                key={id}
                tag={tagById[id]}
                label={qName(tagById[id] ?? { id, name: id }) || id}
                onRemove={() => setSelectedIds((prev) => prev.filter((x) => x !== id))}
                title={tagById[id] ? undefined : 'Alter Freitext-Tag — noch nicht mit einem echten Tag verknüpft'}
              />
            ))}
            {selectedIds.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Keine Tags</span>}
          </div>
        }
        footer={
          // Abbrechen closes without writing; Übernehmen keeps the chips as they are now.
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => api.stopEditing(true)} className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)]">
              Abbrechen
            </button>
            <button type="button" onClick={apply} className="rounded bg-[var(--color-computed)] px-2 py-1 text-xs font-medium text-white">
              Übernehmen
            </button>
          </div>
        }
      />
    </div>
  )
})

export default TagEditor
