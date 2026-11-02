import { describe, expect, it } from 'vitest'

import {
  accountPair,
  buildStagedRows,
  counterAccountFor,
  fallbackLabel,
  importTotals,
  matchShare,
  defaultTagIdsFor,
  effectiveRow,
  effectiveRule,
  matchRule,
  parseBnpRows,
  parseKeywordCsv,
  parseTypedDate,
  realDate,
  resolveCategoryId,
  serialToIso,
} from './bankImport'

describe('serialToIso', () => {
  it('converts Excel serials', () => {
    expect(serialToIso(46323)).toBe('2026-10-28')
    expect(serialToIso(46266)).toBe('2026-09-01')
  })
})

describe('parseBnpRows', () => {
  const aoa = [
    ['Compte', 'Compte', '****0048', 46323, '', 1234.5],
    [],
    ['Date operation', 'Libelle court', 'Type', 'Libelle operation', 'Montant'],
    [46266, 'x', 'y', 'PRLV SEPA FREE MOBILE ', -21.99],
    [46267, 'x', 'y', 'VIR SEPA RECU', 50],
    ['', '', '', '', ''],
  ]
  it('reads balance, date, mask and bookings', () => {
    const p = parseBnpRows(aoa)
    expect(p).toMatchObject({ mask: '****0048', balanceDate: '2026-10-28', balanceCents: 123450 })
    expect(p.rows).toEqual([
      { bankDate: '2026-09-01', rawDescription: 'PRLV SEPA FREE MOBILE', amountCents: -2199 },
      { bankDate: '2026-09-02', rawDescription: 'VIR SEPA RECU', amountCents: 5000 },
    ])
  })
  it('refuses a foreign file', () => {
    expect(() => parseBnpRows([['a'], ['b']])).toThrow(/BNP/)
  })
})

describe('realDate', () => {
  it('takes the purchase date for card payments, refunds and withdrawals', () => {
    expect(realDate('FACTURE CARTE DU 090926 LIDL CARTE', '2026-09-30')).toBe('2026-09-09')
    expect(realDate('REMBOURST CB DU 300826 BOOKING', '2026-09-30')).toBe('2026-08-30')
    expect(realDate('RETRAIT DAB 05/09/26 VR BANK', '2026-09-30')).toBe('2026-09-05')
  })
  it('keeps the bank date otherwise, and when the text date is impossible or later', () => {
    expect(realDate('PRLV SEPA DGFIP ECH/261026', '2026-10-26')).toBe('2026-10-26')
    expect(realDate('COMMISSIONS DU 01/09/26 AU 30/09/26', '2026-09-30')).toBe('2026-09-30')
    expect(realDate('FACTURE CARTE DU 319926 X', '2026-09-30')).toBe('2026-09-30')
    expect(realDate('FACTURE CARTE DU 011026 X', '2026-09-30')).toBe('2026-09-30')
  })
})

describe('fallbackLabel', () => {
  it('drops the date part and the card number, keeps the rest', () => {
    expect(fallbackLabel('FACTURE CARTE DU 110926 SUMUP  *STRAND  CARTE   4974XXXXXXXX3562      ')).toBe('SUMUP *STRAND')
    expect(fallbackLabel('REMBOURST CB DU 300826 BOOKING.COM TRA GB LONDON       CARTE   4974XXXXXXXX3562')).toBe(
      'REMBOURST CB BOOKING.COM TRA GB LONDON',
    )
    expect(fallbackLabel('RETRAIT DAB 05/09/26 VR BANK TOULOUSE')).toBe('RETRAIT DAB VR BANK TOULOUSE')
    expect(fallbackLabel('PRLV SEPA FREE MOBILE ECH/281026')).toBe('PRLV SEPA FREE MOBILE ECH/281026')
  })
})

describe('keyword list', () => {
  const csv = [
    'Keyword,Empfänger,Gruppe,Kategorie,Farbe,,',
    'LIDL,Lidl,Lebenshaltung,Lebensmittel & Haushalt,,,',
    'LIDL4352,Lidl Muret,Lebenshaltung,Lebensmittel & Haushalt,,,',
    'FREE,Free Mobile,Kommunikation,Telefon,Blau,,',
    'PAYPAL,Paypal,,,Blau,,',
    'BRUNON,Dr. Brunon,Außenstände,Geld verliehen,,,',
    ',ADAC,Mobilität,Autoversicherung,Blau,,',
    'lidl,Doppelt,x,y,,,',
    '"A,B",Mit Komma,Sonstiges,Rente,,,',
  ].join('\n')
  const rules = parseKeywordCsv(csv)
  it('ignores lines without a keyword, the color column and duplicates', () => {
    expect(rules.map((r) => r.keyword)).toEqual(['LIDL', 'LIDL4352', 'FREE', 'PAYPAL', 'BRUNON', 'A,B'])
    expect(rules[0]).toEqual({ keyword: 'LIDL', label: 'Lidl', groupName: 'Lebenshaltung', categoryName: 'Lebensmittel & Haushalt' })
  })
  it('matches the longest keyword, case-blind', () => {
    expect(matchRule(rules, 'FACTURE CARTE DU 010926 LIDL4352 MURET').keyword).toBe('LIDL4352')
    expect(matchRule(rules, 'facture lidl').keyword).toBe('LIDL')
    expect(matchRule(rules, 'nothing here')).toBeNull()
  })
  it('resolves group+subcategory to a category id, or null', () => {
    const cats = [
      { id: 'leb', name: 'Lebenshaltung', parentCategoryId: null },
      { id: 'leb-food', name: 'Lebensmittel & Haushalt', parentCategoryId: 'leb' },
    ]
    expect(resolveCategoryId(cats, 'Lebenshaltung', 'Lebensmittel & Haushalt')).toBe('leb-food')
    expect(resolveCategoryId(cats, 'Außenstände', 'Geld verliehen')).toBeNull()
    expect(resolveCategoryId(cats, 'Lebenshaltung', '')).toBeNull()
  })
  it('builds staged rows: rule label and category, else fallback label', () => {
    const withIds = rules.map((r) => ({ ...r, categoryId: r.keyword === 'LIDL' ? 'leb-food' : null }))
    const rows = buildStagedRows(
      [
        { bankDate: '2026-09-30', rawDescription: 'FACTURE CARTE DU 090926 LIDL CARTE   4974XXXXXXXX3562', amountCents: -1000 },
        { bankDate: '2026-09-30', rawDescription: 'FACTURE CARTE DU 090926 ROSTOCK CARTE   4974XXXXXXXX3562', amountCents: -500 },
      ],
      withIds,
    )
    expect(rows[0]).toMatchObject({ date: '2026-09-09', bankDate: '2026-09-30', displayLabel: 'Lidl', categoryId: 'leb-food', include: true, edited: false })
    expect(rows[1]).toMatchObject({ displayLabel: 'ROSTOCK', categoryId: null })
  })
})

describe('importTotals', () => {
  const kontenTxs = [
    { date: '2026-08-31', toAccountId: 'bnp', fromAccountId: null, amountCents: 100000 },
    { date: '2026-08-31', toAccountId: null, fromAccountId: 'bnp', amountCents: -20000 },
    { date: '2026-12-01', toAccountId: 'bnp', fromAccountId: null, amountCents: 500 },
    { date: '2026-08-31', toAccountId: 'dkb', fromAccountId: null, amountCents: 999 },
  ]
  it('adds ticked rows to Konten and compares with the bank balance; later bookings stay apart', () => {
    const rows = [
      { include: true, amountCents: -3000 },
      { include: false, amountCents: -9999 },
    ]
    expect(importTotals({ accountId: 'bnp', balanceDate: '2026-10-28', bankBalanceCents: 77000, kontenTxs, rows })).toEqual({
      konten: 80000,
      imported: -3000,
      after: 77000,
      later: 500,
      bankBalanceCents: 77000,
      difference: 0,
    })
  })
})

describe('parseTypedDate', () => {
  it('accepts ISO, d.m.yyyy and d.m. (year from the fallback)', () => {
    expect(parseTypedDate('2026-09-10', '2026-09-01')).toBe('2026-09-10')
    expect(parseTypedDate('10.09.2026', '2026-09-01')).toBe('2026-09-10')
    expect(parseTypedDate('10.9.', '2026-09-01')).toBe('2026-09-10')
    expect(parseTypedDate('31.02.2026', '2026-09-01')).toBeNull()
    expect(parseTypedDate('quatsch', '2026-09-01')).toBeNull()
  })
})

describe('rule share and effective rows', () => {
  const rules = [{ keyword: 'LIDL', label: 'Lidl', categoryId: 'food' }, { keyword: 'PAYPAL', label: 'Paypal', categoryId: null }]
  it('counts the share of hits', () => {
    const rows = [{ rawDescription: 'LIDL A' }, { rawDescription: 'PAYPAL' }, { rawDescription: 'x' }, { rawDescription: 'y' }]
    expect(matchShare(rows, rules)).toEqual({ empfaenger: 2, kategorie: 1, total: 4, empfaengerPct: 50, kategoriePct: 25 })
  })
  it('follows the rule unless Markus typed over the field', () => {
    const raw = 'FACTURE CARTE DU 010926 LIDL CARTE   4974XXXXXXXX3562'
    expect(effectiveRow({ rawDescription: raw }, rules)).toMatchObject({ displayLabel: 'Lidl', categoryId: 'food', counterAccountId: null, tagIds: [] })
    expect(effectiveRow({ rawDescription: raw, displayLabel: 'Mein Lidl', categoryId: 'x', manual: { displayLabel: true } }, rules)).toMatchObject({
      displayLabel: 'Mein Lidl',
      categoryId: 'food',
    })
    expect(effectiveRow({ rawDescription: 'ROSTOCK 1' }, rules)).toMatchObject({ displayLabel: 'ROSTOCK 1', categoryId: null, rule: null })
  })
  it('old rules get the Gruppe account, new fields win', () => {
    expect(effectiveRule({ groupName: 'Rücklagen' })).toMatchObject({ counterAccountId: 'livret-a-sparen', tagIds: [] })
    expect(effectiveRule({ groupName: 'Rücklagen', counterAccountId: null, tagIds: ['t'] })).toMatchObject({ counterAccountId: null, tagIds: ['t'] })
  })
  it('suggests the allocation tag for a Rücklagen line', () => {
    const tags = [{ id: 'a', class: 'allocation', name: 'Rücklagen Steuern' }, { id: 'b', class: 'allocation', name: 'Sparen Sophia' }]
    expect(defaultTagIdsFor(tags, 'Rücklagen', 'Für Steuern')).toEqual(['a'])
    expect(defaultTagIdsFor(tags, 'Rücklagen', 'Für Sparen Sophia')).toEqual(['b'])
    expect(defaultTagIdsFor(tags, 'Wohnen', 'Garten')).toEqual([])
  })
})
describe('csv separators', () => {
  it('reads semicolon files and keeps a stray quote inside a field', () => {
    const r = parseKeywordCsv('Keyword;Empfänger;Gruppe;Kategorie\r\nLIDL;Lidl;Lebenshaltung;X\r\nDR;Dr. "Z";A;B\r\n')
    expect(r.map((x) => x.keyword)).toEqual(['LIDL', 'DR'])
    expect(r[1].label).toBe('Dr. "Z"')
  })
})

describe('account pair', () => {
  it('maps Gruppe to a counter account and builds the direction from the sign', () => {
    expect(counterAccountFor('Rücklagen')).toBe('livret-a-sparen')
    expect(counterAccountFor('Außenstände')).toBe('aussenstaende')
    expect(counterAccountFor('Wohnen')).toBeNull()
    expect(accountPair('bnp', -17000, 'livret-a-sparen')).toEqual({ fromAccountId: 'bnp', toAccountId: 'livret-a-sparen' })
    expect(accountPair('bnp', 5000, 'aussenstaende')).toEqual({ fromAccountId: 'aussenstaende', toAccountId: 'bnp' })
    expect(accountPair('bnp', -500, null)).toEqual({ fromAccountId: 'bnp', toAccountId: null })
    expect(accountPair('bnp', 500, null)).toEqual({ fromAccountId: null, toAccountId: 'bnp' })
  })
})
