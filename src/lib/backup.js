// Which Firestore collections the Sicherung covers. Every collection the app reads or
// writes must be listed here (backup.test.js scans the source and fails otherwise), so a
// new collection can never silently be left out of the backup.
export const COLLECTIONS = [
  'accounts',
  'categories',
  'tags',
  'transactions',
  'budgets',
  'categoryYearSettings',
  'settings',
  'cellComments',
  'categorizationRules',
  'importBatches',
  'stagedRows',
]

// Collections that are never empty in a working app – an empty one in a fresh backup is a warning sign.
export const MUST_HAVE_DATA = ['accounts', 'categories', 'transactions']

export const CHUNK_SIZE = 400 // Firestore's batch limit is 500 writes; leave headroom

/** Warnings for a fresh export: `counts` is {collection: number of documents}. */
export function exportWarnings(counts) {
  return MUST_HAVE_DATA.filter((c) => !counts[c]).map((c) => `„${c}“ ist leer – das sieht nicht richtig aus. Bitte nicht als Sicherung verlassen.`)
}

/** What a restore would write: per collection, the documents that have a string id. */
export function planRestore(data) {
  const plan = {}
  for (const name of COLLECTIONS) {
    const docs = data?.[name]
    if (!Array.isArray(docs)) continue
    const usable = docs.filter((d) => d && typeof d.id === 'string')
    if (usable.length) plan[name] = usable
  }
  return plan
}

/** Collections present in a backup file that this version of the app does not know. */
export function unknownCollections(data) {
  return Object.keys(data ?? {}).filter((k) => !COLLECTIONS.includes(k))
}
