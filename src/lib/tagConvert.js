// Turning the old plain-text tags into real tags (PLAN.md Phase 5b, step 6 —
// Oct 2026, agreed with Markus). Before the tag mechanism existed, and in the
// whole spreadsheet import, a booking line could carry a tag as plain text with
// no record in `tags` (e.g. the migrated claims "RAW GET", labels like
// "Hotel"). Each such text gets a record — so it can be renamed, typed and
// moved in Settings like any other tag:
//   - id = exactly the text, so no booking has to change. Firestore can't use
//     a text containing "/" (or "." / "..", or "__…__") as an id: those get a
//     new id from the name, and their booking lines are rewritten to it.
//   - type: the claim itself — the first plain-text tag on a line of a booking
//     to or from a receivable account (Außenstände, CPAM, Reisekosten Airbus) —
//     becomes Anspruch; further plain-text tags on such lines become
//     Anspruchsart (labels within a claim, e.g. "Hotel"); all others none.
//     (A text that is a claim anywhere is a claim.)
//   - no parent; Markus adjusts anything in Settings afterwards.
import { newTagDoc } from './tagActions'

const validId = (s) => s.length > 0 && s.length <= 700 && !s.includes('/') && s !== '.' && s !== '..' && !/^__.*__$/.test(s)

// @returns {{ creates: object[], rewrites: object[], counts: { claim: number, 'claim-category': number, none: number } }}
//   creates   the new tag documents; rewrites   whole booking documents to save (only for texts that needed a new id)
export function planPlainTagConversion({ tags, transactions, receivableIds, now = Date.now() }) {
  const known = new Set(tags.map((t) => t.id))
  const kind = new Map() // text → 'claim' | 'claim-category' | null
  const rank = { 'claim-category': 1, claim: 2 }
  const note = (text, k) => {
    const prev = kind.get(text)
    if (prev === undefined || (rank[k] ?? 0) > (rank[prev] ?? 0)) kind.set(text, k)
  }
  for (const tx of transactions) {
    const receivable = receivableIds.has(tx.fromAccountId) || receivableIds.has(tx.toAccountId)
    for (const line of tx.lines ?? []) {
      let firstPlainSeen = false
      for (const id of line.tags ?? []) {
        if (known.has(id) || typeof id !== 'string' || !id.trim()) continue
        if (!receivable) note(id, null)
        else if (!firstPlainSeen) note(id, 'claim')
        else note(id, 'claim-category')
        firstPlainSeen = true
      }
    }
  }
  const taken = new Set(known)
  const creates = []
  const newIds = new Map() // text → new id, for texts that can't be an id
  const counts = { claim: 0, 'claim-category': 0, none: 0 }
  for (const [text, k] of [...kind].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fields = { id: text, name: text.trim(), parentTag: null, class: 'grouping', reconciliationTargetAccountIds: [], groupingType: k, archived: false, createdAt: now }
    if (validId(text)) {
      taken.add(text)
      creates.push(fields)
    } else {
      const d = newTagDoc(taken, { name: text.trim(), groupingType: k, now })
      newIds.set(text, d.id)
      creates.push(d)
    }
    counts[k ?? 'none'] += 1
  }
  const rewrites = []
  if (newIds.size)
    for (const tx of transactions) {
      if (!(tx.lines ?? []).some((l) => (l.tags ?? []).some((id) => newIds.has(id)))) continue
      rewrites.push({ ...tx, lines: tx.lines.map((l) => ({ ...l, tags: (l.tags ?? []).map((id) => newIds.get(id) ?? id) })) })
    }
  return { creates, rewrites, counts }
}
