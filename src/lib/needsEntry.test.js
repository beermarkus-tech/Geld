import { describe, expect, it } from 'vitest'

import { bookingsNeedingEntry, missingColumns } from './needsEntry'

const ctx = {
  receivableIds: new Set(['aussenstaende']),
  tagById: {
    claim: { id: 'claim', groupingType: 'claim' },
    alloc: { id: 'alloc', class: 'allocation' },
    reise: { id: 'reise', groupingType: 'trip' },
  },
}
const tx = (o) => ({ id: 't', fromAccountId: 'bnp-konto', toAccountId: 'aussenstaende', lines: [{ tags: [] }], ...o })

describe('needs-entry signal', () => {
  it('flags the Tags cell of an Außenstände booking without claim tag', () => {
    const t = tx({})
    expect([...missingColumns(t, t.lines[0], ctx)]).toEqual(['tags'])
  })
  it('is satisfied by a claim tag, an old free-text tag or an untyped tag', () => {
    for (const tags of [['claim'], ['Dirk Sept'], ['unknown-id']]) {
      const t = tx({ lines: [{ tags }] })
      expect(missingColumns(t, t.lines[0], ctx).size).toBe(0)
    }
  })
  it('allocation-only or other-typed tags do not count as claim tag', () => {
    for (const tags of [['alloc'], ['reise']]) {
      const t = tx({ lines: [{ tags }] })
      expect(missingColumns(t, t.lines[0], ctx).size).toBe(1)
    }
  })
  it('ignores bookings not touching a receivable account and deleted ones', () => {
    const plain = tx({ toAccountId: null })
    expect(missingColumns(plain, plain.lines[0], ctx).size).toBe(0)
    const gone = tx({ deletedAt: 5 })
    expect(missingColumns(gone, gone.lines[0], ctx).size).toBe(0)
  })
  it('lists the booking ids needing an entry', () => {
    expect(bookingsNeedingEntry([tx({ id: 'a' }), tx({ id: 'b', lines: [{ tags: ['claim'] }] }), tx({ id: 'c', toAccountId: null })], ctx)).toEqual(['a'])
  })
})
