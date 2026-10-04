import { slugify } from './tagActions'

// Plain-text labels for Verlauf's split lines (Oct 2026, Markus: "sometimes I just
// need a split for planning, not for tracking — a text label has no use elsewhere
// in the app, just simple text, no tag"). A label is not a tag: no record in the
// `tags` collection, nothing in Konten, Settings, Quickview or the tag cleanup. It
// only exists as the `breakdownTagId` of a block's budget documents — an id with
// this prefix — with the text kept on those documents as `breakdownLabel`.
export const LABEL_PREFIX = 'lbl:'
export const isLabelId = (id) => typeof id === 'string' && id.startsWith(LABEL_PREFIX)

// The id of a label: the same text (ignoring case and punctuation) is the same line.
export const labelIdFor = (text) => `${LABEL_PREFIX}${slugify(text)}`

// Every label's text, by id, from the budget documents.
export function labelNames(budgets) {
  const names = new Map()
  for (const b of budgets) if (isLabelId(b.breakdownTagId) && b.breakdownLabel) names.set(b.breakdownTagId, b.breakdownLabel)
  return names
}
