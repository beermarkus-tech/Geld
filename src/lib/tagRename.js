// Rules for renaming a tag (Oct 2026, Markus) — shared by Verlauf's in-place
// rename of breakdown lines and Settings' tag list, so both refuse the same
// things. A rename only changes `name`: every booking and budget row refers to
// the tag by its id (spec §3i), so nothing else has to be touched.
//
// @returns {{ok: true, name: string} | {ok: false, reason: 'missing'|'locked'|'empty'|'same'|'clash'}}
export function validateTagRename(tags, tagId, rawName) {
  const tag = tags.find((t) => t.id === tagId)
  if (!tag) return { ok: false, reason: 'missing' }
  // Allocation tags are fixed structure (spec §2.5), not labels.
  if (tag.class === 'allocation') return { ok: false, reason: 'locked' }
  const name = String(rawName ?? '').trim()
  if (!name) return { ok: false, reason: 'empty' }
  if (name === tag.name) return { ok: false, reason: 'same' }
  const clash = tags.some((t) => t.id !== tagId && (t.parentTag ?? null) === (tag.parentTag ?? null) && t.name.trim().toLowerCase() === name.toLowerCase())
  if (clash) return { ok: false, reason: 'clash' }
  return { ok: true, name }
}

export const TAG_RENAME_MESSAGES = {
  clash: 'Diesen Namen gibt es an dieser Stelle schon — bitte einen anderen wählen.',
  locked: 'Feste Rücklagen-Tags lassen sich nicht umbenennen.',
  empty: 'Der Name darf nicht leer sein.',
}
