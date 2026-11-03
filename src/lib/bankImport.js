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
  const first = text.split(/\r?\n/, 1)[0]
  const sep = [';', '\t', ','].reduce((b, c) => (first.split(c).length > first.split(b).length ? c : b), ',')
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
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
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
    if (!r.keyword?.trim() || !text.includes(r.keyword.toUpperCase())) continue
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

/** Top-bar figure: share of lines whose bank text hits a rule (Empfänger); the
 *  category share is still returned but no longer shown. */
export function matchShare(rows, rules) {
  let empfaenger = 0
  let kategorie = 0
  for (const r of rows) {
    const rule = matchRule(rules, r.rawDescription)
    if (rule?.label) empfaenger++
    if (rule?.categoryId) kategorie++
  }
  const pct = (n) => (rows.length ? Math.round((n / rows.length) * 100) : 0)
  return { empfaenger, kategorie, total: rows.length, empfaengerPct: pct(empfaenger), kategoriePct: pct(kategorie) }
}

/** The other account of a booking, from the rule's Gruppe (Oct 2026, Markus: a keyword
 *  like STEUERN must produce the pair BNP -> Livret A): Rücklagen lines are transfers
 *  into the savings account, Außenstände lines go to/from the claims account. */
export function counterAccountFor(groupName) {
  if (groupName === 'Rücklagen') return 'livret-a-sparen'
  if (groupName === 'Außenstände') return 'aussenstaende'
  return null
}

/** { fromAccountId, toAccountId } of a staged row on `accountId`: money out of the bank
 *  account goes from it to the counter account, money in comes from the counter account.
 *  Without a counter account the booking is single-sided. */
export function accountPair(accountId, amountCents, counterAccountId) {
  const out = amountCents < 0
  if (!counterAccountId) return out ? { fromAccountId: accountId, toAccountId: null } : { fromAccountId: null, toAccountId: accountId }
  return out
    ? { fromAccountId: accountId, toAccountId: counterAccountId }
    : { fromAccountId: counterAccountId, toAccountId: accountId }
}

/** A stored rule with the newer fields filled in: rules loaded before Gegenkonto and
 *  tags existed get the Gruppe-based default account and no tags. */
export function effectiveRule(rule) {
  return {
    ...rule,
    counterAccountId: rule.counterAccountId !== undefined ? rule.counterAccountId : counterAccountFor(rule.groupName),
    tagIds: rule.tagIds ?? [],
    detail: rule.detail ?? '',
  }
}

/** Starting tags for a rule loaded from the CSV: a Rücklagen line "Für Steuern" gets the
 *  allocation tag whose name ends with "Steuern" (Rücklagen Steuern); "Für Sparen
 *  Sophia" gets Sparen Sophia. Only when exactly one allocation tag fits. */
export function defaultTagIdsFor(tags, groupName, categoryName) {
  if (groupName !== 'Rücklagen' || !categoryName) return []
  const want = categoryName.replace(/^Für\s+/i, '').trim().toLowerCase()
  const hits = tags.filter((t) => t.class === 'allocation' && t.name.toLowerCase().endsWith(want))
  return hits.length === 1 ? [hits[0].id] : []
}

/** What a staged row currently is: the rule's values for every field Markus has not
 *  typed over himself (`row.manual`), so editing a rule shows up in the open import at
 *  once. Konto and tags always come from the rule — they are not editable in staging. */
export function effectiveRow(row, rules) {
  const rule = matchRule(rules, row.rawDescription)
  const r = rule ? effectiveRule(rule) : null
  const manual = row.manual ?? {}
  return {
    rule: r,
    displayLabel: manual.displayLabel ? row.displayLabel : (r?.label || fallbackLabel(row.rawDescription)),
    categoryId: manual.categoryId ? row.categoryId : (r?.categoryId ?? null),
    counterAccountId: r?.counterAccountId ?? null,
    detail: manual.detail ? (row.detail ?? '') : (r?.detail ?? ''),
    tagIds: r?.tagIds ?? [],
  }
}

/** The bookings a commit creates from the ticked staged rows (Konten's transaction shape,
 *  SPEC §2.6). Everything comes from `effectiveRow`, i.e. the rule plus whatever Markus typed
 *  over. Ids are fixed per row, so repeating an interrupted commit writes the same documents. */
export function buildTransactions(rows, rules, batch, now = Date.now()) {
  return rows
    .filter((r) => r.include)
    .map((r) => {
      const e = effectiveRow(r, rules)
      const { fromAccountId, toAccountId } = accountPair(batch.accountId, r.amountCents, e.counterAccountId)
      // Konten's sign convention: a transfer (both accounts) carries a positive amount, a one-sided booking its natural sign.
      const amountCents = fromAccountId && toAccountId ? Math.abs(r.amountCents) : r.amountCents
      const detail = e.detail ?? ''
      return {
        id: `tx-${r.id}`,
        date: r.date,
        fromAccountId,
        toAccountId,
        amountCents,
        rawDescription: r.rawDescription,
        displayLabel: e.displayLabel,
        lines: [{ amountCents, categoryId: e.categoryId ?? null, note: detail, tags: [...e.tagIds] }],
        detail,
        bankDate: r.bankDate ?? null,
        importBatchId: batch.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }
    })
}
