// The one set of tag actions (PLAN.md Phase 5b, step 2 — Oct 2026, Markus).
// Every screen creates, renames, retypes and replaces tags through these, via
// useTagActions() in TagsProvider.jsx — no screen writes tags on its own.
//
// Each function only *plans*: it returns the documents to write, so the rules
// are tested here without a database. TagsProvider writes them.

import { budgetDoc } from './budgetDocs'
import { findTagByText, headerChildMapping, splitTagText } from './tagPicker'
import { validateTagRename } from './tagRename'

// German umlauts/ß transliterated before stripping everything else
// non-alphanumeric — most tag names here are German, and collapsing "ä" etc.
// straight to a dash produced ugly ids (caught: "Fähre" -> "f-hre").
export function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tag'
  )
}

// A new grouping tag's document. The id comes from the name and never changes
// (renaming only changes `name`); a taken id gets -2, -3, … `createdAt` gives
// the unused-tag cleanup its 10-minute grace period.
export function newTagDoc(takenIds, { name, parentTag = null, groupingType = null, now = Date.now() }) {
  const base = slugify(name)
  let id = base
  for (let n = 2; takenIds.has(id); n++) id = `${base}-${n}`
  takenIds.add(id)
  return { id, name: String(name).trim(), parentTag, class: 'grouping', reconciliationTargetAccountIds: [], groupingType, archived: false, createdAt: now }
}

// "Schottland:Hotels" / "Hotels" + a type → the tag to use, reusing what exists:
// the exact tag if it exists (case and spaces around the colon don't matter);
// otherwise the parent is reused by name or created (with the chosen type),
// and the child — or the plain top-level tag — is created with that type.
// @returns {{ tagId: string, creates: object[] }}
export function planFindOrCreate(tags, text, groupingType = null, now = Date.now()) {
  const found = findTagByText(tags, text)
  if (found) return { tagId: found.id, creates: [] }
  const taken = new Set(tags.map((t) => t.id))
  const creates = []
  const { parent, child } = splitTagText(text)
  let parentId = null
  if (parent) {
    const p = findTagByText(tags, parent)
    if (p && !p.parentTag) parentId = p.id
    else {
      const d = newTagDoc(taken, { name: parent, groupingType, now })
      creates.push(d)
      parentId = d.id
    }
  }
  // A child of a Dienstreise is always a Dienstreise too ("2024-05 HAM: Hotel").
  const parentType = parentId ? (tags.find((t) => t.id === parentId)?.groupingType ?? creates.find((c) => c.id === parentId)?.groupingType) : null
  const d = newTagDoc(taken, { name: child, parentTag: parentId, groupingType: parentType === 'business-trip' ? 'business-trip' : groupingType, now })
  creates.push(d)
  return { tagId: d.id, creates }
}

// Rename: only `name` changes (the id stays, so everything pointing at the tag
// follows). Refused when empty, unchanged, locked or a sibling has the name.
// @returns {{ ok: true, doc: object } | { ok: false, reason: string }}
export function planRename(tags, tagId, rawName) {
  const result = validateTagRename(tags, tagId, rawName)
  if (!result.ok) return result
  return { ok: true, doc: { ...tags.find((t) => t.id === tagId), name: result.name } }
}

// Change type. Allocation tags are fixed; no change → null.
export function planSetType(tags, tagId, groupingType) {
  const tag = tags.find((t) => t.id === tagId)
  if (!tag || tag.class === 'allocation' || (tag.groupingType ?? null) === (groupingType ?? null)) return null
  return { ...tag, groupingType: groupingType ?? null }
}

// Put an existing tag in place of a Verlauf breakdown line's tag — or, on an
// Übergruppe row (`isHeader`), of the parent: each child line then moves to
// the new parent's child of the same name, created when missing. Only this
// block (year · plan version · category/allocation tag): its budget documents
// and the rows' cell comments move to the new tag. Bookings are not touched.
// @returns {{ creates: object[], sets: {col, id, data}[], deletes: {col, id}[], focusRowId: string }}
export function planReplaceInBlock({ tags, budgets, cellComments, year, targetKey, targetId, planVersion, oldTagId, isHeader, lineTagIds, newTagId, now = Date.now() }) {
  const rowBase = `${targetKey}:${targetId}:${planVersion}`
  const creates = []
  const commentRows = new Map()
  let mapping
  if (isHeader) {
    const byId = new Map(tags.map((t) => [t.id, t]))
    const childIds = lineTagIds.filter((id) => byId.get(id)?.parentTag === oldTagId)
    const plan = headerChildMapping(tags, childIds, newTagId)
    mapping = plan.mapping
    const taken = new Set(tags.map((t) => t.id))
    for (const c of plan.create) {
      const d = newTagDoc(taken, { name: c.name, parentTag: newTagId, groupingType: c.groupingType, now })
      creates.push(d)
      mapping.set(c.fromId, d.id)
    }
    commentRows.set(`${rowBase}:rollup:${oldTagId}`, `${rowBase}:rollup:${newTagId}`)
  } else {
    mapping = new Map([[oldTagId, newTagId]])
  }
  for (const [from, to] of mapping) commentRows.set(`${rowBase}:${from}`, `${rowBase}:${to}`)

  const sets = creates.map((d) => ({ col: 'tags', id: d.id, data: d }))
  const deletes = []
  for (const b of budgets) {
    if (b.year !== year || b.planVersion !== planVersion || b[targetKey] !== targetId || !mapping.has(b.breakdownTagId)) continue
    const next = budgetDoc(year, targetKey, targetId, planVersion, b.month, mapping.get(b.breakdownTagId), b.plannedAmountCents, b.note ?? '')
    deletes.push({ col: 'budgets', id: b.id })
    sets.push({ col: 'budgets', id: next.id, data: next })
  }
  for (const c of cellComments) {
    if (c.year !== year || !commentRows.has(c.rowId)) continue
    const rowId = commentRows.get(c.rowId)
    const id = `${year}__${rowId}__${c.colId}`
    deletes.push({ col: 'cellComments', id: c.id })
    sets.push({ col: 'cellComments', id, data: { ...c, id, rowId } })
  }
  return { creates, sets, deletes, focusRowId: isHeader ? `${rowBase}:rollup:${newTagId}` : `${rowBase}:${newTagId}` }
}

// Move a tag under another parent (or to the top level with `null`) — Settings
// › Tags (Oct 2026, Markus). Only the `parentTag` changes; bookings and plan
// lines keep pointing at the same tag, so in Verlauf the line then sits under
// its new Übergruppe (and that Übergruppe's sum includes its bookings).
// Refused: allocation tags; a tag that has children itself (tags are one level
// deep); a parent that is itself a child; a sibling of the same name there.
// @returns {{ ok: true, doc } | { ok: false, reason: 'missing'|'locked'|'has-children'|'bad-parent'|'same'|'clash' }}
export function planMove(tags, tagId, newParentId) {
  const tag = tags.find((t) => t.id === tagId)
  if (!tag) return { ok: false, reason: 'missing' }
  if (tag.class === 'allocation') return { ok: false, reason: 'locked' }
  const target = newParentId ?? null
  if ((tag.parentTag ?? null) === target) return { ok: false, reason: 'same' }
  if (target !== null && tags.some((t) => t.parentTag === tagId)) return { ok: false, reason: 'has-children' }
  if (target !== null) {
    const parent = tags.find((t) => t.id === target)
    if (!parent || parent.id === tagId || parent.class !== 'grouping' || parent.parentTag) return { ok: false, reason: 'bad-parent' }
  }
  const name = tag.name.trim().toLowerCase()
  if (tags.some((t) => t.id !== tagId && (t.parentTag ?? null) === target && t.name.trim().toLowerCase() === name)) return { ok: false, reason: 'clash' }
  return { ok: true, doc: { ...tag, parentTag: target } }
}

export const MOVE_MESSAGES = {
  'has-children': 'Dieser Tag hat selbst Untertags — er kann nicht unter einen anderen geschoben werden.',
  'bad-parent': 'Dorthin geht es nicht (nur unter einen Tag ohne eigene Übergruppe).',
  clash: 'Unter dieser Übergruppe gibt es den Namen schon.',
  locked: 'Feste Rücklagen-Tags lassen sich nicht verschieben.',
}

// Same-name siblings ("doppelt" in Settings): ids of every tag that shares its
// parent and its name (case and outer spaces ignored) with another grouping tag.
export function twinIds(tags) {
  const groups = new Map()
  for (const t of tags) {
    if (t.class !== 'grouping') continue
    const k = `${t.parentTag ?? ''}|${String(t.name ?? '').trim().toLowerCase()}`
    groups.set(k, [...(groups.get(k) ?? []), t.id])
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat())
}
