// Tag class/groupingType → CSS color token (spec.md §2.5's color-coding
// layer). Shared between the Tags column's read-only chip display and
// TagEditor's own chips, so the two can't drift apart.
export function tagColorVar(tag) {
  if (!tag) return '--color-tag-statement' // unresolved/legacy plain-string tag (see TagEditor's own note on this) — same neutral treatment as "unspecified"
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
      return '--color-tag-statement' // null/unspecified — spec: "same family as statement until deliberately typed"
  }
}
