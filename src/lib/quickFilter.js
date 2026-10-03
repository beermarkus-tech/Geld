// The pure part of Konten's column filter (Oct 2026, Markus): one search field
// plus a list of quick results to tick (src/QuickFilter.jsx).
//
// A filter model is one of
//   { filterType: 'text', type: 'contains' | 'equals' | 'blank', filter }   typed search / programmatic (Quickview links)
//   { filterType: 'values', values: [string, ...] }                          ticked entries from the list
// Text is compared case-insensitively and — on purpose — never trimmed:
// spaces are part of what you search for.

export const MAX_SUGGESTIONS = 50

/** Does a cell with this filter text (and these separate entries) pass the model? */
export function quickFilterPasses(model, value, items = [value]) {
  if (!model) return true
  const text = String(value ?? '')
  if (model.filterType === 'values') {
    const wanted = new Set((model.values ?? []).map((v) => String(v).toLowerCase()))
    return items.some((it) => wanted.has(String(it).toLowerCase()))
  }
  const needle = String(model.filter ?? '').toLowerCase()
  switch (model.type) {
    case 'equals':
      return text.trim().toLowerCase() === needle.trim()
    case 'blank':
      return text.trim() === ''
    case 'contains':
    default:
      return text.toLowerCase().includes(needle)
  }
}

/** The separate entries one cell offers in the quick-results list. */
export function quickItems(colId, value) {
  const text = String(value ?? '')
  if (text.trim() === '') return []
  if (colId === 'tags') return text.split(', ').filter((t) => t.trim() !== '')
  // Betrag is searched as "1.000,00 1000,00"; the list offers the shown form.
  if (colId === 'betrag') return [text.split(' ')[0]]
  return [text]
}

/** Distinct entries containing `text` (case-insensitive, spaces kept), sorted, capped. */
export function suggestionsFor(candidates, text, max = MAX_SUGGESTIONS) {
  const needle = String(text ?? '').toLowerCase()
  const matching = [...new Set(candidates)].filter((c) => c.toLowerCase().includes(needle))
  matching.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
  return { items: matching.slice(0, max), more: Math.max(0, matching.length - max) }
}

/** The model a confirmation (Enter / button) produces. */
export function confirmedModel({ ticked, highlighted, text }) {
  if (ticked.length > 0) return { filterType: 'values', values: ticked }
  if (highlighted != null) return { filterType: 'values', values: [highlighted] }
  if (String(text ?? '') !== '' && String(text).trim() !== '') return { filterType: 'text', type: 'contains', filter: String(text) }
  return null
}

/** Is a remembered model one this filter understands? */
export function isKnownQuickModel(m) {
  if (!m || typeof m !== 'object') return false
  if (m.filterType === 'values') return Array.isArray(m.values) && m.values.length > 0
  return m.filterType === 'text' && ['contains', 'equals', 'blank'].includes(m.type)
}
