// Investment Cash (Nov 2026, Markus): the broker cash accounts Smartbroker, Consors and Coinbase
// (technical group 'investment-cash'). They stay Barkonten – money can move freely – but the money on
// them is put aside for investing, so it is not part of the red Prognose line, Planung's starting cash
// or the Budget. It is shown as its own (lightest) green in the Dashboard bars and as a green group at
// the bottom of Konten's Barkonten box.
//
// Planning: the moment money leaves the cash is planned in one row, **"Investment Cash"** (Verlauf's
// Rücklagen section): every euro moved from Barkonten/Bargeld towards investing – to the three broker
// accounts, or straight into an investment (ESOP, Edelmetalle). The pots whose money sits in Geldanlage
// (Anlage Familie, Anlage Sophia) become the "Aufteilung" – where the money ends up; they no longer
// count against the red line.
//
// The Investment Cash row is not a real tag: it is a *virtual* planning target with the shape of an
// allocation tag (budgets rows use allocationTagId 'investment-cash'), added only to the lists the
// planning code works on (planningTags), never to the tag list itself, so it can never be put on a
// booking. Its booked figure is computed from the accounts (allocationMonthActual sees
// `investAccountIds` – the three broker accounts plus the Geldanlage accounts): money moved between
// them and any other account counts (BNP → Smartbroker, BNP → ESOP), a purchase from the broker into
// Aktien does not, and a dividend or fee booked on a broker account cancels out against its category.
// No tags needed.

export const INVESTMENT_CASH_ID = 'investment-cash'
export const INVESTMENT_CASH_NAME = 'Investment Cash'

/** One of the three broker cash accounts. */
export const isInvestmentCashAccount = (account) => account?.group === 'investment-cash'

const tracked = (accounts) => accounts.filter((a) => a.tracked !== false)

/** The accounts the red line counts: Barkonten + Bargeld, without Investment Cash. */
export function cashAccountIds(accounts, cashGroups = ['Barkonten', 'Bargeld']) {
  return tracked(accounts)
    .filter((a) => cashGroups.includes(a.reportingGroup) && !isInvestmentCashAccount(a))
    .map((a) => a.id)
}

export const investmentCashAccountIds = (accounts) => tracked(accounts).filter(isInvestmentCashAccount).map((a) => a.id)

/** A pot whose money sits in Geldanlage (its first reconciliation account): part of the "Aufteilung". */
export function isAnlagePot(tag, accounts) {
  const first = (tag?.reconciliationTargetAccountIds ?? [])[0]
  return Boolean(first && accounts.find((a) => a.id === first)?.reportingGroup === 'Geldanlage')
}

/** The virtual "Investment Cash" planning target (see the top of this file). */
export function investmentCashTarget(accounts) {
  const invest = [...investmentCashAccountIds(accounts), ...tracked(accounts).filter((a) => a.reportingGroup === 'Geldanlage').map((a) => a.id)]
  return {
    id: INVESTMENT_CASH_ID,
    name: INVESTMENT_CASH_NAME,
    class: 'allocation',
    virtual: true,
    reconciliationTargetAccountIds: [],
    investAccountIds: invest,
  }
}

/** The tag list the planning code works on: the real tags plus the virtual Investment Cash target. */
export function planningTags(tags, accounts) {
  return [...tags.filter((t) => t.id !== INVESTMENT_CASH_ID), investmentCashTarget(accounts)]
}
