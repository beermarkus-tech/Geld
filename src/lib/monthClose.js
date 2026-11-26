// Monatsabschluss (spec.md §3h, built Nov 2026): the default checklist and the automatic items.
// Automatic items are never ticked by hand — they read what the app already knows; manual items
// are plain checkboxes stored per year and month (settings/{year}.closeTicks).
import { balance } from './balance'
import { claimTotal } from './claims'
import { categoryActualIndex, planStatus } from './planCheck'
import { budgetTopLineMonths } from './budget'
import { bookingsNeedingEntry } from './needsEntry'
import { monthChecks } from './monthChecks'

export const SECTIONS = [
  { id: 'daten', label: 'Daten' },
  { id: 'verfeinerung', label: 'Verfeinerung' },
  { id: 'abschluss', label: 'Abschluss' },
]

// Markus's Check tab, mapped (spec.md §3h). `auto` = the check below; `accountId` on a manual item
// shows that account's month-end balance and booking count next to the checkbox.
export const DEFAULT_ITEMS = [
  { id: 'bnp-import', section: 'daten', label: 'BNP importiert', auto: 'bnpImport' },
  { id: 'dkb', section: 'daten', label: 'DKB', accountId: 'dkb-konto' },
  { id: 'paypal', section: 'daten', label: 'PayPal', accountId: 'paypal' },
  { id: 'visa', section: 'daten', label: 'Visa Airbus', accountId: 'visa-airbus' },
  { id: 'consors', section: 'daten', label: 'Consors', accountId: 'consors-verrechnungskonto' },
  { id: 'smartbroker', section: 'daten', label: 'Smartbroker', accountId: 'smartbroker-verrechnungskonto' },
  { id: 'coinbase', section: 'daten', label: 'Coinbase', accountId: 'coinbase-verrechnungskonto' },
  { id: 'ancv', section: 'daten', label: 'ANCV Chèques Vacances', accountId: 'cheqvac' },
  { id: 'bar', section: 'daten', label: 'Bar' },
  { id: 'notizen', section: 'daten', label: 'Notizen' },
  { id: 'kategorien', section: 'verfeinerung', label: 'Alles kategorisiert', auto: 'categorized' },
  { id: 'gehalt', section: 'verfeinerung', label: 'AIRBUS Gehalt' },
  { id: 'amazon', section: 'verfeinerung', label: 'Amazon' },
  { id: 'aussenstaende', section: 'verfeinerung', label: 'Außenstände', auto: 'claims' },
  { id: 'prognose', section: 'abschluss', label: 'Prognose = Kontostand', auto: 'prognose' },
  { id: 'unterkonten', section: 'abschluss', label: 'Unterkonten = Rücklagen', auto: 'reserves' },
  { id: 'verlauf', section: 'abschluss', label: 'Verlauf geprüft', auto: 'verlauf' },
  { id: 'consors-saldo', section: 'abschluss', label: 'Consors Verrechnungskonto ≤ 200 €', auto: 'consors' },
  { id: 'urlaub', section: 'abschluss', label: 'Urlaub' },
  { id: 'sonderausgaben', section: 'abschluss', label: 'Sonderausgaben' },
  { id: 'haus', section: 'abschluss', label: 'Investitionen Haus' },
  { id: 'ruecklagen', section: 'abschluss', label: 'Rücklagen' },
  { id: 'steuern', section: 'abschluss', label: 'Steuern' },
  { id: 'geldanlage', section: 'abschluss', label: 'Geldanlage' },
  { id: 'ueberweisungen', section: 'abschluss', label: 'Überweisungen' },
]

// Consors: money left on the cash account above this should be invested (Markus, Nov 2026).
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
export function autoChecks({ year, accounts, categories, tags, budgets, transactions, importBatches = [], claimCats, needsCtx, percent, uptoMonth }) {
  const live = transactions.filter((t) => !t.deletedAt)
  const months = Array.from({ length: uptoMonth }, (_, i) => i + 1)
  // The two month-end checks, judged as if every month up to now were ticked (bookings, not plans).
  const checks = new Map(monthChecks({ accounts, categories, tags, budgets, transactions: live, year, closedMonths: months }).map((c) => [c.m, c]))
  const needing = new Set(bookingsNeedingEntry(live, needsCtx))
  const actual = categoryActualIndex(live, year)
  const planned = categories
    .filter((c) => c.parentCategoryId)
    .map((c) => ({ id: c.id, name: c.name, months: budgetTopLineMonths('categoryId', c.id, 'plan1', year, budgets).months }))
  const bnpBatches = importBatches.filter((b) => b.accountId === BNP_ID && b.status === 'committed' && b.balanceDate)

  return (key, m) => {
    if (m > uptoMonth) return { state: null, text: '' }
    const end = lastDay(year, m)
    switch (key) {
      case 'bnpImport': {
        const covering = bnpBatches.filter((b) => b.balanceDate >= end).sort((a, b) => a.balanceDate.localeCompare(b.balanceDate))[0]
        if (!covering) return { state: 'warn', text: 'Noch kein Import bis Monatsende', jump: { view: 'importexport' } }
        const diff = balance(BNP_ID, covering.balanceDate, live) - (covering.bankBalanceCents ?? 0)
        if (covering.bankBalanceCents != null && diff !== 0) return { state: 'warn', text: `Kontostand am ${covering.balanceDate.slice(8)}.${covering.balanceDate.slice(5, 7)}. weicht um ${euro(diff)} ab`, jump: { view: 'konten', accountId: BNP_ID } }
        return { state: 'ok', text: `Import bis ${covering.balanceDate.slice(8)}.${covering.balanceDate.slice(5, 7)}.` }
      }
      case 'categorized': {
        const ids = live.filter((t) => inMonth(t, year, m) && needing.has(t.id)).map((t) => t.id)
        return ids.length === 0 ? { state: 'ok', text: '' } : { state: 'warn', text: `${ids.length} unvollständig`, jump: { view: 'konten', txIds: ids } }
      }
      case 'claims': {
        const open = claimTotal(live, claimCats, end)
        return { state: 'info', text: open === 0 ? 'nichts offen' : `${euro(open)} offen`, jump: { view: 'aussenstaende' } }
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
      case 'verlauf': {
        const off = planned.filter((c) => planStatus({ plan: c.months[m - 1], actual: actual.total(c.id, m), closed: true, percent }) === 'off' || planStatus({ plan: c.months[m - 1], actual: actual.total(c.id, m), closed: true, percent }) === 'unplanned')
        return off.length === 0 ? { state: 'ok', text: '' } : { state: 'warn', text: `${off.length} abweichend: ${off.slice(0, 3).map((c) => c.name).join(', ')}${off.length > 3 ? ' …' : ''}`, jump: { view: 'verlauf', month: m } }
      }
      case 'consors': {
        const b = balance(CONSORS_ID, end, live)
        return b > CONSORS_LIMIT_CENTS ? { state: 'warn', text: `${euro(b)} — anlegen?`, jump: { view: 'konten', accountId: CONSORS_ID } } : { state: 'ok', text: euro(b) }
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
export function openItems(items, m, ticks, status) {
  return items.filter((it) => (it.auto ? status(it.auto, m).state === 'warn' : !isTicked(ticks, it.id, m))).map((it) => it.label)
}
