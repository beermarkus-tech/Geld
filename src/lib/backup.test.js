import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { COLLECTIONS, exportWarnings, planRestore, unknownCollections } from './backup'

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}

describe('backup covers every collection the app uses', () => {
  it('lists each collection named in the source', () => {
    const used = new Set()
    for (const f of sourceFiles(join(process.cwd(), 'src'))) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/(?:collection|doc|collectionGroup)\(\s*db\s*,\s*'([A-Za-z]+)'/g)) used.add(m[1])
      for (const m of text.matchAll(/\bcol:\s*'([A-Za-z]+)'/g)) used.add(m[1])
      for (const m of text.matchAll(/\[\s*'([A-Za-z]+)'\s*,\s*set[A-Z]\w*\s*\]/g)) used.add(m[1])
    }
    const missing = [...used].filter((c) => !COLLECTIONS.includes(c))
    expect(missing).toEqual([])
    expect(used.size).toBeGreaterThanOrEqual(10) // the scan itself must keep working
  })
})

describe('export / restore round trip', () => {
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, [{ id: `${c}-1`, n: 1 }, { id: `${c}-2`, n: 2 }]]))
  it('restores every document of every collection under its own id', () => {
    const plan = planRestore(JSON.parse(JSON.stringify(data)))
    expect(Object.keys(plan).sort()).toEqual([...COLLECTIONS].sort())
    for (const c of COLLECTIONS) expect(plan[c]).toEqual(data[c])
  })
  it('skips documents without id and non-list entries', () => {
    expect(planRestore({ accounts: [{ id: 'a' }, { name: 'x' }, null], tags: 'oops' })).toEqual({ accounts: [{ id: 'a' }] })
  })
  it('warns about empty core collections only', () => {
    expect(exportWarnings({ accounts: 3, categories: 2, transactions: 10, stagedRows: 0 })).toEqual([])
    expect(exportWarnings({ accounts: 3, categories: 2, transactions: 0 })).toHaveLength(1)
  })
  it('spots collections an older/newer file brings that this app does not know', () => {
    expect(unknownCollections({ accounts: [], mystery: [] })).toEqual(['mystery'])
  })
})
