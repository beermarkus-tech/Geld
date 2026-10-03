import { describe, expect, it } from 'vitest'

import { planPlainTagConversion } from './tagConvert'

const tags = [{ id: 'sco', name: 'Schottland', parentTag: null, class: 'grouping' }]
const receivableIds = new Set(['aussenstaende', 'airbus'])
const transactions = [
  { id: 'a', fromAccountId: 'bnp', toAccountId: 'airbus', lines: [{ tags: ['RAW GET', 'Hotel'] }] },
  { id: 'b', fromAccountId: 'airbus', toAccountId: 'bnp', lines: [{ tags: ['RAW GET'] }] },
  { id: 'c', fromAccountId: 'bnp', toAccountId: null, lines: [{ tags: ['sco', 'Urlaub 2019'] }] },
  { id: 'd', fromAccountId: 'bnp', toAccountId: 'aussenstaende', lines: [{ tags: ['sco', 'Dirk/Sept'] }] },
  { id: 'e', fromAccountId: 'bnp', toAccountId: 'aussenstaende', lines: [{ tags: ['Hotel'] }] },
]

describe('planPlainTagConversion', () => {
  const r = planPlainTagConversion({ tags, transactions, receivableIds, now: 7 })
  const byName = Object.fromEntries(r.creates.map((d) => [d.name, d]))
  it('gives every plain-text tag a record with its text as id', () => {
    expect(byName['RAW GET']).toMatchObject({ id: 'RAW GET', class: 'grouping', parentTag: null, createdAt: 7 })
    expect(byName['Urlaub 2019'].id).toBe('Urlaub 2019')
    expect(r.creates.map((d) => d.name).sort()).toEqual(['Dirk/Sept', 'Hotel', 'RAW GET', 'Urlaub 2019'])
  })
  it('types claims (first plain tag on a receivable booking), their labels, the rest none; a claim anywhere wins', () => {
    expect(byName['RAW GET'].groupingType).toBe('claim')
    expect(byName['Urlaub 2019'].groupingType).toBeNull()
    expect(byName['Dirk/Sept'].groupingType).toBe('claim') // first *plain* tag, after a real one
    expect(byName.Hotel.groupingType).toBe('claim') // a label in "a", but the claim of "e"
    expect(r.counts).toEqual({ claim: 3, 'claim-category': 0, none: 1 })
  })
  it('a text that cannot be an id gets a new one, and its bookings are rewritten', () => {
    expect(byName['Dirk/Sept'].id).toBe('dirk-sept')
    expect(r.rewrites).toEqual([{ ...transactions[3], lines: [{ tags: ['sco', 'dirk-sept'] }] }])
  })
  it('labels within a claim become Anspruchsart', () => {
    const only = planPlainTagConversion({ tags, transactions: transactions.slice(0, 2), receivableIds })
    expect(only.creates.find((d) => d.name === 'Hotel').groupingType).toBe('claim-category')
  })
})
