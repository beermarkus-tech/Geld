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
    if (t.class !== 'grouping' || t.archived) return false
    const parent = t.parentTag ? byId.get(t.parentTag) : null
    return tagKey(parent ? `${parent.name}:${t.name}` : t.name) === key
  })
}
