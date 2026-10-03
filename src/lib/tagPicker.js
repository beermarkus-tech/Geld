// Shared by Verlauf's "add breakdown line" picker (Oct 2026, Markus: reuse
// Konten's tag creation) — typed text → parent/child parts, and the matching
// of typed text against existing tags by qualified name.

// "Schottland:Hotels" → { parent: 'Schottland', child: 'Hotels' }; text without
// a usable colon → { parent: null, child: whole text }.
export function splitTagText(text) {
  const t = String(text ?? '').trim()
  const colon = t.indexOf(':')
  if (colon === -1) return { parent: null, child: t }
  const parent = t.slice(0, colon).trim()
  const child = t.slice(colon + 1).trim()
  if (!parent || !child) return { parent: null, child: t }
  return { parent, child }
}

// Lower-cased "parent:child" key — spaces around the colon don't matter, so
// "Schottland: Hotels" (how a child is displayed) equals "Schottland:Hotels".
export function tagKey(text) {
  const { parent, child } = splitTagText(text)
  return (parent ? `${parent}:${child}` : child).toLowerCase()
}

// The grouping tag a typed text names exactly, or undefined.
export function findTagByText(tags, text) {
  const key = tagKey(text)
  const byId = new Map(tags.map((t) => [t.id, t]))
  return tags.find((t) => {
    if (t.class !== 'grouping') return false
    const parent = t.parentTag ? byId.get(t.parentTag) : null
    return tagKey(parent ? `${parent.name}:${t.name}` : t.name) === key
  })
}

// Replacing a breakdown line's or Übergruppe's tag in Verlauf (Oct 2026,
// Markus): which existing tags the list offers, by where the cursor is.
//   kind 'child'      a line under parent `parentId` → that parent's other children
//   kind 'standalone' a line without parent         → top-level tags
//   kind 'header'     the Übergruppe row `parentId`  → other top-level tags
// Never offered: the tag itself, tags already a line or Übergruppe in this
// block (`blockTagIds`), allocation tags. (Archived tags are offered: archiving
// only tidies Settings' list.)
export function replaceOptions(tags, { kind, tagId, parentId = null, blockTagIds = new Set() }) {
  return tags
    .filter((t) => t.class === 'grouping' && t.id !== tagId && !blockTagIds.has(t.id))
    .filter((t) => (kind === 'child' ? t.parentTag === parentId : !t.parentTag))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Replacing an Übergruppe: each child line moves to the new parent's child of
// the same name (case-insensitive), or to a new child that still has to be
// created (`create`, with the old child's type).
// @returns {{ mapping: Map<string, string>, create: { fromId: string, name: string, groupingType: string|null }[] }}
export function headerChildMapping(tags, childIds, newParentId) {
  const byId = new Map(tags.map((t) => [t.id, t]))
  const mapping = new Map()
  const create = []
  for (const id of childIds) {
    const child = byId.get(id)
    const name = child?.name ?? id
    const match = tags.find((t) => t.parentTag === newParentId && t.name.toLowerCase() === name.toLowerCase())
    if (match) mapping.set(id, match.id)
    else create.push({ fromId: id, name, groupingType: child?.groupingType ?? null })
  }
  return { mapping, create }
}

// The "Neu … — Typ" rows to offer for a typed text (Oct 2026): all types, but
// for "Parent:Child" under an existing parent only the parent's type — a
// family shares one type, so the new child gets it anyway.
export function createTypesFor(tags, text, types) {
  // "Parent:" with nothing after it yet (right after → opened a parent): nothing to create.
  if (String(text).trim().endsWith(':')) return []
  const { parent } = splitTagText(text)
  const p = parent ? findTagByText(tags, parent) : null
  if (!p || p.parentTag) return types
  return types.filter((o) => (o.groupingType ?? null) === (p.groupingType ?? null))
}
