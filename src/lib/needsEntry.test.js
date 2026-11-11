import { describe, expect, it } from 'vitest'

import { bookingsNeedingEntry, missingColumns, needsEntryChips } from './needsEntry'

const ctx = {
  receivableIds: new Set(['aussenstaende']),
  tagById: {
    claim: { id: 'claim', groupingType: 'claim' },
    alloc: { id: 'alloc', class: 'allocation' },
    reise: { id: 'reise', groupingType: 'trip' },
  },
}
const tx = (o) => ({ id: 't', fromAccountId: 'bnp-konto', toAccountId: 'aussenstaende', lines: [{ tags: [], categoryId: 'c' }], ...o })

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

describe('category rule', () => {
  const c = { receivableIds: new Set(), tagById: {} }
  it('flags Kategorie and Unterkategorie of a one-sided booking without category', () => {
    const t = { id: 'x', fromAccountId: 'bnp', toAccountId: null, lines: [{ categoryId: null, tags: [] }] }
    expect([...missingColumns(t, t.lines[0], c)].sort()).toEqual(['kategorie', 'unterkategorie'])
  })
  it('is fine with a category, or for a transfer between two accounts', () => {
    const t = { id: 'x', fromAccountId: 'bnp', toAccountId: null, lines: [{ categoryId: 'food', tags: [] }] }
    expect(missingColumns(t, t.lines[0], c).size).toBe(0)
    const tr = { id: 'y', fromAccountId: 'bnp', toAccountId: 'paypal', lines: [{ categoryId: null, tags: [] }] }
    expect(missingColumns(tr, tr.lines[0], c).size).toBe(0)
  })
  it('a blank new row (no lines yet) counts as one empty line', () => {
    expect(bookingsNeedingEntry([{ id: 'n', fromAccountId: 'bnp', toAccountId: null, lines: [] }], c)).toEqual(['n'])
  })
})

describe('needsEntryChips', () => {
  const c = { receivableIds: new Set(['aussenstaende', 'cpam', 'reisekosten-airbus']), tagById: {} }
  const t = (id, o = {}) => ({ id, fromAccountId: 'bnp', toAccountId: null, lines: [{ categoryId: null, tags: [] }], displayLabel: '', ...o })
  it('splits the bookings with a gap by chip; the rest goes to "Andere"', () => {
    const chips = needsEntryChips(
      [
        t('a', { displayLabel: 'Amazon EU' }),
        t('b', { fromAccountId: 'bnp', toAccountId: 'cpam' }),
        t('c', { fromAccountId: 'bnp', toAccountId: 'aussenstaende' }),
        t('e', { fromAccountId: 'bnp', toAccountId: 'reisekosten-airbus' }),
        t('d'),
        t('ok', { lines: [{ categoryId: 'x', tags: [] }] }),
      ],
      c,
    )
    expect(chips.map((x) => [x.key, x.ids])).toEqual([
      ['amazon', ['a']],
      ['cpam', ['b']],
      ['aussenstaende', ['c']],
      ['airbus', ['e']],
      ['rest', ['d']],
    ])
  })
  it('leaves out chips with nothing to show', () => {
    expect(needsEntryChips([t('d')], c).map((x) => x.key)).toEqual(['rest'])
    expect(needsEntryChips([], c)).toEqual([])
  })
})
