// Tag class/groupingType → CSS color token (spec.md §2.5's color-coding
// layer). Shared between the Tags column's read-only chip display and
// TagEditor's own chips, so the two can't drift apart.
//
// Returns null for a tag with no determined type yet — a real grouping tag
// with groupingType: null (not yet typed), or no tag at all (an unresolved
// legacy free-text string from before the real mechanism existed). Both
// get the same plain/neutral chip treatment rather than a color, on
// purpose (Markus, real-usage feedback): a colored fill implied more
// certainty about the tag's type than "unspecified" actually has, and made
// a fresh unspecified tag look inconsistent with how an untyped legacy
// string already rendered right next to it.
export function tagColorVar(tag) {
  if (!tag) return null
  if (tag.class === 'allocation') return '--color-savings'
  switch (tag.groupingType) {
    case 'project':
      return '--color-tag-project'
    case 'statement':
      return '--color-tag-statement'
    case 'claim':
      return '--color-tag-claim'
    case 'claim-category':
      return '--color-tag-claim-category'
    default:
      return null
  }
}

// "Fähre" -> "Schottland: Fähre" for a child tag (spec.md §2.5's
// parentTag hierarchy, e.g. Hotels/Flüge/Auto as real children of a trip
// tag like Schottland) — a top-level tag's own name, unqualified, is
// already unambiguous. `tagById` is a plain {id: tag} lookup, same shape
// Konten.jsx already keeps.
export function qualifiedTagName(tag, tagById) {
  if (!tag) return ''
  const parent = tag.parentTag ? tagById[tag.parentTag] : null
  return parent ? `${parent.name}: ${tag.name}` : tag.name
}
