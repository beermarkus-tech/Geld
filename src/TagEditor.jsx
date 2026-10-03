import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'

import { findTagByText, tagKey } from './lib/tagPicker'
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
// every tag (allocation tags, grouping tags, and old plain-text values still
// in use — reusing the exact string keeps old trip/claim labels from forking
// into near-duplicates), and a "Neu … — Typ" row per type when the typed text
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
// Anspruchsart (claim-category) tags are only offered once a claim tag is on
// the line (spec.md §2.5's sequencing rule).
const TagEditor = forwardRef(function TagEditor(props, ref) {
  const { data, tags, usedTagValues, recentTagValues = [], initialTagIds = [], onApply, onCreateTag, onTabAddRow, api } = props
  const [selectedIds, setSelectedIds] = useState(initialTagIds)
  const usage = useTagUsage()

  useImperativeHandle(ref, () => ({
    getValue: () => ({ tagIds: selectedIds }),
    isCancelBeforeStart: () => false,
  }))

  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags])
  const qName = (t) => qualifiedTagName(t, tagById)
  const legacyCandidates = useMemo(() => [...usedTagValues].filter((v) => !tagById[v]).map((v) => ({ id: v, name: v })), [usedTagValues, tagById])
  const hasClaimTag = selectedIds.some((id) => tagById[id]?.groupingType === 'claim')

  function getOptions(rawText) {
    const text = rawText.trim().toLowerCase()
    const candidates = [...tags.filter((t) => t.class === 'allocation'), ...tags.filter((t) => t.class === 'grouping'), ...legacyCandidates]
    const eligible = candidates
      .filter((t) => !t.archived && !selectedIds.includes(t.id))
      .filter((t) => t.groupingType !== 'claim-category' || hasClaimTag)
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
    return list.map((t, i) => ({
      key: t.id,
      id: t.id,
      tag: tagById[t.id],
      label: qName(t) || t.id,
      hint: tagById[t.id]?.class === 'grouping' ? usageHint(usageOf(usage, t.id)) : null,
      separatorBefore: recentCount > 0 && i === recentCount,
    }))
  }

  // Not when the text names an existing tag (incl. allocation tags and old
  // plain-text values — "dirk sept" must not offer a duplicate).
  function getCreateTypes(rawText) {
    const text = rawText.trim().toLowerCase()
    if (!text || findTagByText(tags, rawText)) return []
    if (tags.some((t) => t.class === 'allocation' && t.name.toLowerCase() === text)) return []
    if (legacyCandidates.some((t) => t.name.toLowerCase() === text)) return []
    return CREATE_TYPES.filter((o) => o.groupingType !== 'claim-category' || hasClaimTag)
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
        onPick={(o) => add(o.id)}
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
