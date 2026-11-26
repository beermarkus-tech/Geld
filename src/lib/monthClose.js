// Monatsabschluss (spec.md §3h, built Nov 2026): the default checklist and the automatic items.
// Automatic items are never ticked by hand — they read what the app already knows; manual items
// are plain checkboxes stored per year and month (settings/{year}.closeTicks).
import { balance } from './balance'
import { claimTotal } from './claims'
import { NEEDS_ENTRY_RULES, isAmazon, linesOf } from './needsEntry'
import { monthChecks } from './monthChecks'

export const SECTIONS = [
  { id: 'daten', label: 'Daten' },
  { id: 'verfeinerung', label: 'Verfeinerung' },
  { id: 'abschluss', label: 'Abschluss' },
]

// Markus's Check tab, mapped (spec.md §3h). `auto` = the check below; `accountId` on a manual item
// shows that account's month-end balance and booking count next to the checkbox; `autoTick` ticks
// the box by itself as soon as the account has a booking in that month (Nov 2026, Markus: he enters
// an account's bookings in one go, then ticks — one booking is a good enough sign); without bookings
// the box can still be ticked by hand (a month with nothing to book). `autoTick: 'salarySplit'` (AIRBUS
// Gehalt, Markus Nov 2026): ticked once the month's salary booking is split into lines that add up to
// its total, every line with a category. `'amazonCategorized'` (Amazon, Markus Nov 2026): ticked when
// every Amazon booking of the month (lib/needsEntry.js isAmazon) has its category — a transfer between
// two accounts needs none; a month without Amazon bookings has nothing to do and is ticked too.
// shows that account's month-end balance and booking count next to the checkbox.
export const DEFAULT_ITEMS = [
  { id: 'bnp-import', section: 'daten', label: 'BNP', accountId: 'bnp-konto', autoTick: 'bookings' },
  { id: 'dkb', section: 'daten', label: 'DKB', accountId: 'dkb-konto', autoTick: 'bookings' },
  { id: 'paypal', section: 'daten', label: 'PayPal', accountId: 'paypal', autoTick: 'bookings' },
  { id: 'visa', section: 'daten', label: 'Visa Airbus', accountId: 'visa-airbus', autoTick: 'bookings' },
  { id: 'consors', section: 'daten', label: 'Consors', accountId: 'consors-verrechnungskonto', autoTick: 'bookings' },
  { id: 'smartbroker', section: 'daten', label: 'Smartbroker', accountId: 'smartbroker-verrechnungskonto', autoTick: 'bookings' },
  { id: 'coinbase', section: 'daten', label: 'Coinbase', accountId: 'coinbase-verrechnungskonto', autoTick: 'bookings' },
  { id: 'ancv', section: 'daten', label: 'ANCV Chèques Vacances', accountId: 'cheqvac' },
  { id: 'bar', section: 'daten', label: 'Bar' },
  { id: 'notizen', section: 'daten', label: 'Notizen' },
  { id: 'kategorien', section: 'verfeinerung', label: 'Alles kategorisiert', auto: 'categorized' },
  { id: 'gehalt', section: 'verfeinerung', label: 'AIRBUS Gehalt', autoTick: 'salarySplit' },
  { id: 'amazon', section: 'verfeinerung', label: 'Amazon', autoTick: 'amazonCategorized' },
  { id: 'aussenstaende', section: 'verfeinerung', label: 'Außenstände', auto: 'claims' },
  { id: 'prognose', section: 'abschluss', label: 'Prognose = Kontostand', auto: 'prognose' },
  { id: 'unterkonten', section: 'abschluss', label: 'Unterkonten = Rücklagen', auto: 'reserves' },
  { id: 'verlauf', section: 'abschluss', label: 'Verlauf geprüft' }, // manual (Nov 2026, Markus)
  { id: 'consors-saldo', section: 'abschluss', label: 'Consors Verrechnungskonto ≥ 200 €', auto: 'consors' },
  { id: 'urlaub', section: 'abschluss', label: 'Urlaub' },
  { id: 'sonderausgaben', section: 'abschluss', label: 'Sonderausgaben' },
  { id: 'haus', section: 'abschluss', label: 'Investitionen Haus' },
  { id: 'ruecklagen', section: 'abschluss', label: 'Rücklagen' },
  { id: 'steuern', section: 'abschluss', label: 'Steuern' },
  { id: 'geldanlage', section: 'abschluss', label: 'Geldanlage' },
  { id: 'ueberweisungen', section: 'abschluss', label: 'Überweisungen' },
]

// Consors: the cash account should keep at least this much (Markus, Nov 2026: below → warning).
export const CONSORS_LIMIT_CENTS = 20000
export const CONSORS_ID = 'consors-verrechnungskonto'
export const BNP_ID = 'bnp-konto'

const pad = (m) => String(m).padStart(2, '0')
export const lastDay = (year, m) => `${year}-${pad(m)}-${pad(new Date(Date.UTC(year, m, 0)).getUTCDate())}`
const inMonth = (tx, year, m) => tx.date?.startsWith(`${year}-${pad(m)}`)
const euro = (cents) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/**
 * The automatic items of one year, computed once for all months.
 * @returns {(key: string, m: number) => { state: 'ok'|'warn'|'info'|null, text: string, jump?: object }}
 *   state null = nothing to judge yet (a future month)
 */
export function autoChecks({ year, accounts, categories, tags, budgets, transactions, claimCats, needsCtx, uptoMonth }) {
  const live = transactions.filter((t) => !t.deletedAt)
  const months = Array.from({ length: uptoMonth }, (_, i) => i + 1)
  // The two month-end checks, judged as if every month up to now were ticked (bookings, not plans).
  const checks = new Map(monthChecks({ accounts, categories, tags, budgets, transactions: live, year, closedMonths: months }).map((c) => [c.m, c]))
  // Bookings of a month failing one needs-entry rule (lib/needsEntry.js): 'category' for
  // "Alles kategorisiert", 'claim-tag' (an Außenstände line without its claim tag) for Außenstände.
  const rule = (id) => NEEDS_ENTRY_RULES.find((r) => r.id === id)
  const failing = (ruleId, m) => {
    const r = rule(ruleId)
    return live.filter((tx) => inMonth(tx, year, m) && linesOf(tx).some((line) => r.check(tx, line, needsCtx))).map((tx) => tx.id)
  }

  return (key, m) => {
    if (m > uptoMonth) return { state: null, text: '' }
    const end = lastDay(year, m)
    switch (key) {
      case 'categorized': {
        const ids = failing('category', m)
        return ids.length === 0 ? { state: 'ok', text: '' } : { state: 'warn', text: `${ids.length} ohne Kategorie`, jump: { view: 'konten', txIds: ids } }
      }
      case 'claims': {
        // ✓ when every Außenstände line of the month carries its claim tag (Nov 2026, Markus);
        // the amount still open at month end is shown alongside.
        const ids = failing('claim-tag', m)
        const open = claimTotal(live, claimCats, end)
        const openText = open === 0 ? 'nichts offen' : `${euro(open)} offen`
        return ids.length === 0 ? { state: 'ok', text: openText, jump: { view: 'aussenstaende' } } : { state: 'warn', text: `${ids.length} ohne Forderungs-Tag · ${openText}`, jump: { view: 'konten', txIds: ids } }
      }
      case 'prognose': {
        const c = checks.get(m)
        if (!c) return { state: null, text: '' }
        return c.progDelta === 0 ? { state: 'ok', text: '' } : { state: 'warn', text: `Differenz ${euro(c.progDelta)}`, jump: { view: 'dashboard' } }
      }
      case 'reserves': {
        const c = checks.get(m)
        if (!c) return { state: null, text: '' }
        const off = c.reserves.filter((r) => r.delta !== 0)
        return off.length === 0 ? { state: 'ok', text: '' } : { state: 'warn', text: off.map((r) => `${r.group} ${euro(r.delta)}`).join(' · '), jump: { view: 'dashboard' } }
      }
      case 'consors': {
        const b = balance(CONSORS_ID, end, live)
        return b < CONSORS_LIMIT_CENTS ? { state: 'warn', text: `nur ${euro(b)} — auffüllen?`, jump: { view: 'konten', accountId: CONSORS_ID } } : { state: 'ok', text: euro(b) }
      }
      default:
        return { state: null, text: '' }
    }
  }
}

/** Month-end balance and the number of bookings in the month, for a manual account item. */
export function accountHint(accountId, year, m, transactions) {
  const live = transactions.filter((t) => !t.deletedAt)
  const count = live.filter((t) => inMonth(t, year, m) && (t.fromAccountId === accountId || t.toAccountId === accountId)).length
  return { balanceCents: balance(accountId, lastDay(year, m), live), count }
}

/** Manual ticks of a year: { itemId: [months] } → is item ticked in month m? */
export const isTicked = (ticks, itemId, m) => (ticks?.[itemId] ?? []).includes(m)
export function toggleTick(ticks, itemId, m) {
  const cur = ticks?.[itemId] ?? []
  const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b)
  return { ...ticks, [itemId]: next }
}

/** What still stands in the way of closing month m (for the warning). */
/** Booking counts per account and month of one year: count(accountId, m). */
export function bookingCounter(transactions, year) {
  const counts = new Map()
  for (const t of transactions) {
    if (t.deletedAt || !t.date?.startsWith(String(year))) continue
    const m = Number(t.date.slice(5, 7))
    for (const id of new Set([t.fromAccountId, t.toAccountId])) if (id) counts.set(`${id}|${m}`, (counts.get(`${id}|${m}`) ?? 0) + 1)
  }
  return (accountId, m) => counts.get(`${accountId}|${m}`) ?? 0
}

export const SALARY_CATEGORY_ID = 'einnahmen-gehalt-markus'

/**
 * Why an `autoTick` item ticks itself in month m — a short reason text, or null when it doesn't.
 * @returns {(item, m: number) => string | null}
 */
export function autoTicker(transactions, year) {
  const count = bookingCounter(transactions, year)
  const salary = new Map() // month → salary bookings (money in with a Gehalt Markus line)
  for (const t of transactions) {
    if (t.deletedAt || !t.date?.startsWith(String(year)) || !(t.amountCents > 0)) continue
    if (!(t.lines ?? []).some((l) => l.categoryId === SALARY_CATEGORY_ID)) continue
    const m = Number(t.date.slice(5, 7))
    salary.set(m, [...(salary.get(m) ?? []), t])
  }
  const amazon = new Map() // month → Amazon bookings
  const categoryRule = NEEDS_ENTRY_RULES.find((r) => r.id === 'category')
  for (const t of transactions) {
    if (t.deletedAt || !t.date?.startsWith(String(year)) || !isAmazon(t)) continue
    const m = Number(t.date.slice(5, 7))
    amazon.set(m, [...(amazon.get(m) ?? []), t])
  }
  const split = (t) => {
    const lines = t.lines ?? []
    return lines.length >= 2 && lines.every((l) => l.categoryId) && lines.reduce((a, l) => a + l.amountCents, 0) === t.amountCents
  }
  return (it, m) => {
    if (it.autoTick === 'bookings') {
      const n = count(it.accountId, m)
      return n > 0 ? `${n} ${n === 1 ? 'Buchung' : 'Buchungen'} im Monat` : null
    }
    if (it.autoTick === 'salarySplit') {
      const list = salary.get(m) ?? []
      return list.length > 0 && list.every(split) ? 'Gehalt aufgeteilt' : null
    }
    if (it.autoTick === 'amazonCategorized') {
      const list = amazon.get(m) ?? []
      if (list.length === 0) return 'keine Amazon-Buchungen'
      return list.every((t) => linesOf(t).every((l) => !categoryRule.check(t, l))) ? `${list.length} Amazon-Buchung${list.length === 1 ? '' : 'en'} kategorisiert` : null
    }
    return null
  }
}

/** A manual item counts as done when ticked — or when its `autoTick` rule ticks it (see autoTicker). */
export const isDone = (it, m, ticks, auto) => isTicked(ticks, it.id, m) || Boolean(it.autoTick && auto(it, m))

export function openItems(items, m, ticks, status, auto = () => null) {
  return items.filter((it) => (it.auto ? status(it.auto, m).state === 'warn' : !isDone(it, m, ticks, auto))).map((it) => it.label)
}
