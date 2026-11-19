import { describe, expect, it } from 'vitest'

import { bookingsNeedingEntry, missingColumns, needsEntryChips } from './needsEntry'

const ctx = {
  claimCategoryIds: new Set(['aussenstaende-verliehen']),
  tagById: {
    claim: { id: 'claim', groupingType: 'claim' },
    alloc: { id: 'alloc', class: 'allocation' },
    reise: { id: 'reise', groupingType: 'trip' },
  },
}
// a claim line: one-sided on a real account, in an Außenstände sub-category (Nov 2026)
const tx = (o) => ({ id: 't', fromAccountId: 'bnp-konto', toAccountId: null, lines: [{ tags: [], categoryId: 'aussenstaende-verliehen' }], ...o })
const claimLine = (tags) => [{ tags, categoryId: 'aussenstaende-verliehen' }]

describe('needs-entry signal', () => {
  it('flags the Tags cell of an Außenstände line without claim tag', () => {
    const t = tx({})
    expect([...missingColumns(t, t.lines[0], ctx)]).toEqual(['tags'])
  })
  it('is satisfied by a claim tag, an old free-text tag or an untyped tag', () => {
    for (const tags of [['claim'], ['Dirk Sept'], ['unknown-id']]) {
      const t = tx({ lines: claimLine(tags) })
      expect(missingColumns(t, t.lines[0], ctx).size).toBe(0)
    }
  })
  it('allocation-only or other-typed tags do not count as claim tag', () => {
    for (const tags of [['alloc'], ['reise']]) {
      const t = tx({ lines: claimLine(tags) })
      expect(missingColumns(t, t.lines[0], ctx).size).toBe(1)
    }
  })
  it('ignores lines outside Außenstände and deleted bookings', () => {
    const plain = tx({ lines: [{ tags: [], categoryId: 'food' }] })
    expect(missingColumns(plain, plain.lines[0], ctx).size).toBe(0)
    const gone = tx({ deletedAt: 5 })
    expect(missingColumns(gone, gone.lines[0], ctx).size).toBe(0)
  })
  it('lists the booking ids needing an entry', () => {
    expect(bookingsNeedingEntry([tx({ id: 'a' }), tx({ id: 'b', lines: claimLine(['claim']) }), tx({ id: 'c', lines: [{ tags: [], categoryId: 'food' }] })], ctx)).toEqual(['a'])
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

describe('Amazon chip spellings', () => {
  const c = { receivableIds: new Set(), tagById: {} }
  it('also catches AMZ and AMZN (also glued to more text), but not unrelated words', () => {
    const t = (id, label) => ({ id, fromAccountId: 'bnp', toAccountId: null, lines: [{ categoryId: null, tags: [] }], displayLabel: label })
    const chips = needsEntryChips([t('1', 'AMZ*1A2B3'), t('2', 'AMZN Mktp DE'), t('3', 'AMZNMKTP'), t('4', 'Amazon EU'), t('5', 'Reamzo Shop')], c)
    expect(chips.find((x) => x.key === 'amazon').ids).toEqual(['1', '2', '3', '4'])
  })
})

describe('needsEntryChips', () => {
  const c = { claimCategoryIds: new Set(['aussenstaende-verliehen', 'aussenstaende-cpam', 'aussenstaende-airbus-reisekosten']), tagById: {} }
  const cl = (categoryId) => ({ lines: [{ categoryId, tags: [] }] })
  const t = (id, o = {}) => ({ id, fromAccountId: 'bnp', toAccountId: null, lines: [{ categoryId: null, tags: [] }], displayLabel: '', ...o })
  it('splits the bookings with a gap by chip; the rest goes to "Andere"', () => {
    const chips = needsEntryChips(
      [
        t('a', { displayLabel: 'Amazon EU' }),
        t('b', cl('aussenstaende-cpam')),
        t('c', cl('aussenstaende-verliehen')),
        t('e', cl('aussenstaende-airbus-reisekosten')),
        t('d'),
        t('ok', { lines: [{ categoryId: 'x', tags: [] }] }),
      ],
      c,
    )
    expect(chips.map((x) => [x.key, x.ids])).toEqual([
      ['amazon', ['a']],
      ['cpam', ['b']],
      ['verliehen', ['c']],
      ['airbus', ['e']],
      ['rest', ['d']],
    ])
  })
  it('leaves out chips with nothing to show', () => {
    expect(needsEntryChips([t('d')], c).map((x) => x.key)).toEqual(['rest'])
    expect(needsEntryChips([], c)).toEqual([])
  })
})
