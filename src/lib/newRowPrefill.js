// "+ Neue Buchung" under a filter (Nov 2026, Markus): the new row must not vanish at once because it
// lacks what the filter asks for, so it takes over what the filter says wherever that is unambiguous.
//
// `model` = the grid's column filter model ({colId: quick-filter model}), `categories` = all categories,
// `tagList` = [{id, name}] with the qualified tag names as the Tags filter sees them.
// Betrag/Datum filters and "blank" are left alone (a blank new cell already passes a blank filter).

const lower = (s) => String(s ?? '').toLowerCase()

/** The single text a filter model stands for, or null when it is blank / many values / not text. */
function wantedText(m) {
  if (!m) return null
  if (m.filterType === 'values') return m.values?.length === 1 ? String(m.values[0]) : null
  if (m.filterType === 'text' && (m.type === 'equals' || m.type === 'contains')) return String(m.filter ?? '') || null
  return null
}

/** Exactly one candidate named like the filter text (equals first, then contains), else null. */
function uniqueMatch(items, text, nameOf) {
  const exact = items.filter((i) => lower(nameOf(i)).trim() === lower(text).trim())
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const part = items.filter((i) => lower(nameOf(i)).includes(lower(text)))
  return part.length === 1 ? part[0] : null
}

export function newRowPrefill(model, { categories = [], tagList = [], tagFilterId = null } = {}) {
  const out = {}
  const label = wantedText(model?.empfaenger)
  if (label) out.displayLabel = label
  const detail = wantedText(model?.details)
  if (detail) out.detail = detail
  const catText = wantedText(model?.unterkategorie)
  if (catText) {
    const c = uniqueMatch(categories.filter((x) => x.parentCategoryId), catText, (x) => x.name)
    if (c) out.categoryId = c.id
  }
  const tagIds = []
  const tagText = wantedText(model?.tags)
  if (tagText) {
    const t = uniqueMatch(tagList, tagText, (x) => x.name)
    if (t) tagIds.push(t.id)
  }
  if (tagFilterId && !tagIds.includes(tagFilterId)) tagIds.push(tagFilterId)
  if (tagIds.length) out.tagIds = tagIds
  return out
}
