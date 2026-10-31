// Import staging, step 1 (spec.md §3k "Import staging"): pure functions that turn
// the BNP Excel export and Markus's keyword list into staged rows. No Firestore,
// no React — the screen (ImportStaging.jsx) wires these up.

const pad = (n) => String(n).padStart(2, '0')

/** Excel date serial (days since 1899-12-30) -> "YYYY-MM-DD". */
export function serialToIso(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

const toCents = (euro) => Math.round(Number(euro) * 100)

/**
 * Reads the sheet BNP exports (rows as arrays, like SheetJS's `header: 1`).
 * Top row: account name, ..., masked number, balance date, ..., balance.
 * Then a header row ("Date operation"…) and one booking per row.
 * Throws a German message if the file is not what we expect.
 */
export function parseBnpRows(aoa) {
  const top = aoa[0] ?? []
  const mask = top.map((c) => String(c ?? '')).find((c) => /\*{2,}\d{3,}/.test(c)) ?? null
  const dateCell = top.find((c) => typeof c === 'number' && c > 30000)
  const balanceCell = [...top].reverse().find((c) => typeof c === 'number' && c !== dateCell)
  const headerIdx = aoa.findIndex((r) => String(r?.[0] ?? '').trim() === 'Date operation')
  if (headerIdx < 0 || dateCell == null || balanceCell == null) {
    throw new Error('Das ist keine BNP-Kontoauszugsdatei (Kopfzeile nicht gefunden).')
  }
  const rows = []
  for (const r of aoa.slice(headerIdx + 1)) {
    if (typeof r?.[0] !== 'number' || typeof r?.[4] !== 'number') continue
    rows.push({
      bankDate: serialToIso(r[0]),
      rawDescription: String(r[3] ?? '').trim(),
      amountCents: toCents(r[4]),
    })
  }
  return { mask, balanceDate: serialToIso(dateCell), balanceCents: toCents(balanceCell), rows }
}

const validDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

// The three texts that carry the real purchase date (spec.md §3k): card payment,
// card refund, cash withdrawal. Nothing else is touched.
const DATE_PATTERNS = [
  { re: /FACTURE CARTE DU (\d{2})(\d{2})(\d{2})/, order: 'dmy' },
  { re: /REMBOURST CB DU (\d{2})(\d{2})(\d{2})/, order: 'dmy' },
  { re: /RETRAIT DAB (\d{2})\/(\d{2})\/(\d{2})/, order: 'dmy' },
]

/** The real purchase date from the bank text, or the bank's own date if the
 *  text has none (or it would land *after* the booking date, which cannot be). */
export function realDate(rawDescription, bankDate) {
  for (const { re } of DATE_PATTERNS) {
    const m = rawDescription.match(re)
    if (!m) continue
    const [d, mo, y] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])]
    if (!validDate(y, mo, d)) return bankDate
    const iso = `${y}-${pad(mo)}-${pad(d)}`
    return iso <= bankDate ? iso : bankDate
  }
  return bankDate
}

/** Empfänger when no keyword rule matches (spec.md §3k): the bank text minus the
 *  part that only carried the date, and never the card number. */
export function fallbackLabel(rawDescription) {
  let t = rawDescription.trim()
  t = t.replace(/^FACTURE CARTE DU \d{6}\s*/, '')
  t = t.replace(/REMBOURST CB DU \d{6}\s*/, 'REMBOURST CB ')
  t = t.replace(/RETRAIT DAB \d{2}\/\d{2}\/\d{2}\s*/, 'RETRAIT DAB ')
  t = t.replace(/\s+CARTE\s+\d{4}X+\d{4}.*$/, '')
  return t.replace(/\s+/g, ' ').trim()
}

// --- keyword list -------------------------------------------------------------

function parseCsv(text) {
  const out = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); out.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row) }
  return out
}

/** Markus's autofill list (Keyword, Empfänger, Gruppe, Kategorie, [Farbe], …).
 *  Lines without a keyword are ignored, the Farbe column and anything after it
 *  too (his instruction, Oct 2026). Later duplicates of a keyword are dropped. */
export function parseKeywordCsv(text) {
  const seen = new Set()
  const rules = []
  for (const r of parseCsv(text.replace(/^﻿/, '')).slice(1)) {
    const keyword = (r[0] ?? '').trim()
    if (!keyword) continue
    const key = keyword.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    rules.push({
      keyword,
      label: (r[1] ?? '').trim(),
      groupName: (r[2] ?? '').trim(),
      categoryName: (r[3] ?? '').trim(),
    })
  }
  return rules
}

/** Group + subcategory name -> category id, or null (no subcategory named, or the
 *  pair is not a real category, e.g. "Außenstände / Geld verliehen"). */
export function resolveCategoryId(categories, groupName, categoryName) {
  if (!groupName || !categoryName) return null
  const group = categories.find((c) => !c.parentCategoryId && c.name === groupName)
  if (!group) return null
  return categories.find((c) => c.parentCategoryId === group.id && c.name === categoryName)?.id ?? null
}

/** The rule for a bank text: the longest keyword contained in it (case-blind), so
 *  "LIDL4352" beats "LIDL". null if none. */
export function matchRule(rules, rawDescription) {
  const text = rawDescription.toUpperCase()
  let best = null
  for (const r of rules) {
    if (!text.includes(r.keyword.toUpperCase())) continue
    if (!best || r.keyword.length > best.keyword.length) best = r
  }
  return best
}

// --- staged rows & totals -----------------------------------------------------

/** One staged row per file line, with the rules applied. */
export function buildStagedRows(parsedRows, rules) {
  return parsedRows.map((r) => {
    const date = realDate(r.rawDescription, r.bankDate)
    const rule = matchRule(rules, r.rawDescription)
    return {
      include: true,
      status: 'new',
      duplicateOfTxId: null,
      date,
      originalDate: date,
      bankDate: r.bankDate,
      amountCents: r.amountCents,
      originalAmountCents: r.amountCents,
      rawDescription: r.rawDescription,
      displayLabel: rule?.label || fallbackLabel(r.rawDescription),
      categoryId: rule?.categoryId ?? null,
      detail: '',
      edited: false,
    }
  })
}

/** The totals bar's numbers (spec.md §3k). `kontenTxs` are the account's live
 *  bookings (deleted ones already removed). */
export function importTotals({ accountId, balanceDate, bankBalanceCents, kontenTxs, rows }) {
  let konten = 0
  let later = 0
  for (const tx of kontenTxs) {
    const m = Math.abs(tx.amountCents)
    const signed = (tx.toAccountId === accountId ? m : 0) - (tx.fromAccountId === accountId ? m : 0)
    if (tx.date > balanceDate) later += signed
    else konten += signed
  }
  const imported = rows.filter((r) => r.include).reduce((s, r) => s + r.amountCents, 0)
  const after = konten + imported
  return { konten, imported, after, later, bankBalanceCents, difference: bankBalanceCents == null ? null : after - bankBalanceCents }
}

/** A date typed into the grid: "2026-09-10", "10.09.2026", "10.09." / "10.9" (year
 *  taken from `fallbackIso`). null if it is not a real date. */
export function parseTypedDate(text, fallbackIso) {
  const s = String(text).trim()
  let y, m, d
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])]
  else if ((mt = s.match(/^(\d{1,2})[./](\d{1,2})[./]?(\d{2}|\d{4})?$/))) {
    d = Number(mt[1]); m = Number(mt[2])
    y = mt[3] ? (mt[3].length === 2 ? 2000 + Number(mt[3]) : Number(mt[3])) : Number(fallbackIso.slice(0, 4))
  } else return null
  return validDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null
}
