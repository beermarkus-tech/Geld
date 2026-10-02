import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'

import { db } from './firebase'
import { jahresanfang } from './lib/balance'
import {
  allocationMonthActual,
  budgetTopLineMonths,
  categoryMonthActual,
  planungSummary,
  progMonths,
  regularShare,
  splitYear,
} from './lib/budget'
import { ALLOCATION_TAG_ORDER, GROUP_ORDER, SUBCAT_ORDER, isBudgetPlannedTag, isKnownSubcat } from './lib/categoryOrder'
import { centsToWholeEuro, parseWholeEuroInput } from './lib/format'
import { registerScreenCursor } from './lib/screenCursor'

// Planung (spec.md §3c) — an annotated, read-only report over Verlauf's
// own Plan0/Plan1/Prog figures. Nothing here edits a budget amount; the
// only inputs are the per-year Puffer (settings/{year}.minCashBufferCents)
// and a free-text comment per category/allocation tag per year
// (categoryYearSettings.comment, §2.7c), edited right in two comment columns
// (one behind each year) that can be hidden together.

// Jahresanfang's starting cash (§3c, resolved Sept 2026, Markus): every
// account in these three reportingGroups, balance on Dec 31 of the prior
// year — Sparkonten/Geldanlage stay out.
const START_CASH_GROUPS = ['Barkonten', 'Bargeld', 'Außenstände']
// TRANSITIONAL safety net (Oct 2026): Livret A Tagesgeld is a Barkonten
// account now (spec.md §2.2, seed accounts.json), so START_CASH_GROUPS
// already covers it once the live account document has been re-imported.
// Until then it is still filed under Sparkonten in Firestore, and this keeps
// the start cash right. Remove together with the re-import confirmation.
const START_CASH_EXTRA_ACCOUNTS = ['livret-a-tagesgeld']

const LENSES = [
  { id: 'plan0', label: 'Plan0' },
  { id: 'plan1', label: 'Plan1' },
  { id: 'prog', label: 'Prog' },
]
const LENS_KEY = 'geld-planung-lens'
const SHOW_COMMENTS_KEY = 'geld-planung-show-comments'

// Whether the two comment columns are shown — per device, shown by default.
function readShowComments() {
  try {
    return localStorage.getItem(SHOW_COMMENTS_KEY) !== '0'
  } catch {
    return true
  }
}

// Per-device convenience only (same try/catch pattern as NavShell's
// sidebar state) — a storage failure just means it starts on Plan 0.
function readLens() {
  try {
    const stored = localStorage.getItem(LENS_KEY)
    return LENSES.some((l) => l.id === stored) ? stored : 'plan0'
  } catch {
    return 'plan0'
  }
}

// `|| 0` so a zero that happens to be negative (−0, e.g. negating an empty
// Rücklagen total) never shows as "-0 €".
function euro(cents) {
  return `${centsToWholeEuro(cents || 0).replace(/^-0$/, '0')} €`
}

function settingsDocId(year, targetId) {
  return `${year}_${targetId}`
}

const SECTION_COLOR = {
  einnahmen: 'var(--color-income)',
  fixkosten: 'var(--color-expense)',
  ausgaben: 'var(--color-expense)',
  ruecklagen: 'var(--color-savings)',
}

// Section background tint — the same tokens Verlauf's category columns use
// (§1b.4, including its one deliberate red exception for Ausgaben).
const SECTION_TINT = {
  einnahmen: 'var(--color-income-tint)',
  fixkosten: 'var(--color-alert-tint)',
  ausgaben: 'var(--color-alert-tint)',
  ruecklagen: 'var(--color-savings-tint)',
}

// The three Budget lines (Budget, Ausgaben vs. Budget, gebildete Rücklagen)
// are tinted yellow to set them apart from the report around them (Oct 2026,
// Markus) — the same pale yellow token Verlauf uses for its breakdown rows.
const BUDGET_BAND_TINT = 'var(--color-breakdown-tint)'

// A slightly darker/stronger version of each tint, for the total rows
// (group headers) so they stand out from the category rows under them (Oct
// 2026, Markus) — the tint with a little of its section's own color mixed in.
const SECTION_TINT_STRONG = {
  einnahmen: 'color-mix(in srgb, var(--color-income-tint) 86%, var(--color-income))',
  fixkosten: 'color-mix(in srgb, var(--color-alert-tint) 86%, var(--color-alert))',
  ausgaben: 'color-mix(in srgb, var(--color-alert-tint) 86%, var(--color-alert))',
  ruecklagen: 'color-mix(in srgb, var(--color-savings-tint) 86%, var(--color-savings))',
}

// Ausgaben vs. Budget — "should be near zero"; negative means the plan
// spends more than the budget allows, which is the one alert-red case
// here (§1b.4).
function deltaColor(cents) {
  if (cents < 0) return 'var(--color-alert)'
  if (cents > 0) return 'var(--color-income)'
  return 'var(--color-text)'
}

export default function Planung({ year, active = true }) {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [yearSettings, setYearSettings] = useState([])
  const [settingsByYear, setSettingsByYear] = useState({})
  const [lens, setLens] = useState(readLens)
  const [showComments, setShowComments] = useState(readShowComments)
  // Screen persistence (Oct 2026): App keeps this screen mounted and only
  // hides it, so the scroll position and the cursor cell are remembered here
  // and put back when the screen is shown again (a hidden element loses
  // both, same job Konten/Verlauf do for their own cursor).
  const scrollRef = useRef(null)
  const scrollTopRef = useRef(0)
  const lastCellRef = useRef(null)

  const planYear = Number(year)
  const refYear = planYear - 1

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'accounts'), (snap) => setAccounts(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'categories'), (snap) => setCategories(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'tags'), (snap) => setTags(snap.docs.map((d) => d.data()))),
      // Soft-deleted transactions (§2.9a) never count toward anything here.
      onSnapshot(collection(db, 'transactions'), (snap) => setTransactions(snap.docs.map((d) => d.data()).filter((t) => !t.deletedAt))),
      onSnapshot(collection(db, 'budgets'), (snap) => setBudgets(snap.docs.map((d) => d.data()))),
      onSnapshot(collection(db, 'categoryYearSettings'), (snap) => setYearSettings(snap.docs.map((d) => d.data()))),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  // Both years' settings/{year} documents — each year has its own Puffer,
  // and the planning year's closedMonths drives the Prog lens.
  useEffect(() => {
    if (!year) return
    const unsubs = [refYear, planYear].map((y) =>
      onSnapshot(doc(db, 'settings', String(y)), (snap) => {
        setSettingsByYear((prev) => ({ ...prev, [y]: snap.exists() ? snap.data() : {} }))
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [year, refYear, planYear])

  function chooseLens(id) {
    setLens(id)
    try {
      localStorage.setItem(LENS_KEY, id)
    } catch {
      // per-device convenience only
    }
  }

  function chooseShowComments(on) {
    setShowComments(on)
    try {
      localStorage.setItem(SHOW_COMMENTS_KEY, on ? '1' : '0')
    } catch {
      // per-device convenience only
    }
  }

  function savePuffer(y, cents) {
    // merge: settings/{year} also holds Verlauf's closedMonths.
    setDoc(doc(db, 'settings', String(y)), { id: String(y), minCashBufferCents: cents }, { merge: true })
  }

  function saveComment(y, target, text) {
    setDoc(
      doc(db, 'categoryYearSettings', settingsDocId(y, target.targetId)),
      {
        id: settingsDocId(y, target.targetId),
        year: y,
        categoryId: target.targetKey === 'categoryId' ? target.targetId : null,
        allocationTagId: target.targetKey === 'allocationTagId' ? target.targetId : null,
        comment: text,
      },
      { merge: true },
    )
  }

  const commentFor = useMemo(() => {
    const map = new Map()
    for (const s of yearSettings) {
      const targetId = s.categoryId ?? s.allocationTagId
      if (targetId && s.comment) map.set(`${s.year}:${targetId}`, s.comment)
    }
    return map
  }, [yearSettings])

  const report = useMemo(() => {
    if (!planYear) return null
    // Prog of year `y` uses that year's own month-close switches (Verlauf's
    // checkboxes) — a closed month is the real actual, an open one mirrors
    // Plan1, exactly as Verlauf shows that year.
    function yearValue(targetKey, targetId, y, which) {
      if (which !== 'prog') return budgetTopLineMonths(targetKey, targetId, which, y, budgets).yearTotal
      const plan1 = budgetTopLineMonths(targetKey, targetId, 'plan1', y, budgets).months
      const closedMonths = settingsByYear[y]?.closedMonths ?? []
      return progMonths(targetKey, targetId, plan1, closedMonths, y, transactions, tags).reduce((a, b) => a + b, 0)
    }

    function refActualMonths(targetKey, targetId) {
      return Array.from({ length: 12 }, (_, i) =>
        targetKey === 'allocationTagId'
          ? allocationMonthActual(targetId, refYear, i + 1, transactions, tags)
          : categoryMonthActual(targetId, refYear, i + 1, transactions),
      )
    }

    function row(targetKey, targetId, label) {
      // The reference year is shown as its Prog — what actually happened
      // (Oct 2026, Markus: actuals are the better base for Plan0 of the
      // planning year than last year's Plan0).
      const ref = yearValue(targetKey, targetId, refYear, 'prog')
      const plan = yearValue(targetKey, targetId, planYear, lens)
      const split = splitYear(plan, regularShare(refActualMonths(targetKey, targetId)))
      return { targetKey, targetId, label, ref, plan, split }
    }

    function total(label, rows) {
      const sum = (f) => rows.reduce((a, r) => a + f(r), 0)
      return {
        label,
        ref: sum((r) => r.ref),
        plan: sum((r) => r.plan),
        split: {
          regularYear: sum((r) => r.split.regularYear),
          regularMonth: sum((r) => r.split.regularMonth),
          lumpYear: sum((r) => r.split.lumpYear),
        },
      }
    }

    // A row with nothing planned in either year and nothing in the lens
    // column is noise in a report — hidden, not shown as a line of zeros.
    const visible = (r) => r.ref !== 0 || r.plan !== 0

    const groups = categories
      .filter((c) => !c.parentCategoryId)
      .sort((a, b) => GROUP_ORDER.indexOf(a.name) - GROUP_ORDER.indexOf(b.name))
    const subcatsOf = (group) =>
      categories
        .filter((c) => c.parentCategoryId === group.id && isKnownSubcat(c.name))
        .sort((a, b) => SUBCAT_ORDER.indexOf(a.name) - SUBCAT_ORDER.indexOf(b.name))

    const einnahmenGroup = groups.find((g) => g.name === 'Einnahmen')
    const einnahmen = (einnahmenGroup ? subcatsOf(einnahmenGroup) : []).map((c) => row('categoryId', c.id, c.name))

    // Fixkosten (§2.4 isFixkosten) pulled out of their own groups into one
    // section; every other expense subcategory stays under its group.
    const expenseGroups = groups.filter((g) => g.name !== 'Einnahmen')
    const fixkosten = expenseGroups.flatMap((g) => subcatsOf(g).filter((c) => c.isFixkosten)).map((c) => row('categoryId', c.id, c.name))
    const ausgabenGroups = expenseGroups
      .map((g) => ({ name: g.name, rows: subcatsOf(g).filter((c) => !c.isFixkosten).map((c) => row('categoryId', c.id, c.name)) }))
      .filter((g) => g.rows.some(visible))

    const ruecklagen = tags
      .filter((t) => t.class === 'allocation' && isBudgetPlannedTag(t))
      .sort((a, b) => ALLOCATION_TAG_ORDER.indexOf(a.id) - ALLOCATION_TAG_ORDER.indexOf(b.id))
      .map((t) => row('allocationTagId', t.id, `Für ${t.name}`))

    const einnahmenTotal = total('Einnahmen', einnahmen)
    const fixkostenTotal = total('Fixkosten', fixkosten)
    const ausgabenTotal = total('Ausgaben gesamt', ausgabenGroups.flatMap((g) => g.rows))
    const ruecklagenTotal = total('Rücklagen', ruecklagen)
    // The grand total above the per-group breakdown (§3c: "Ausgaben +
    // Rücklagen is the grand total row that sits just above the per-group
    // breakdown").
    const ausgabenInklTotal = total('Ausgaben inkl. Rücklagen', [...ausgabenGroups.flatMap((g) => g.rows), ...ruecklagen])

    const startCashAccounts = accounts.filter((a) => START_CASH_GROUPS.includes(a.reportingGroup) || START_CASH_EXTRA_ACCOUNTS.includes(a.id))
    const startCash = (y) => startCashAccounts.reduce((a, acc) => a + jahresanfang(acc.id, y, transactions), 0)
    const puffer = (y) => settingsByYear[y]?.minCashBufferCents ?? 0

    function summary(y, col) {
      return {
        year: y,
        jahresanfangRaw: startCash(y),
        puffer: puffer(y),
        ausgaben: ausgabenTotal[col],
        ruecklagen: ruecklagenTotal[col],
        ...planungSummary({
          einnahmen: einnahmenTotal[col],
          fixkosten: fixkostenTotal[col],
          jahresanfang: startCash(y),
          puffer: puffer(y),
          ausgaben: ausgabenTotal[col],
          ruecklagen: ruecklagenTotal[col],
        }),
      }
    }

    return {
      einnahmen: einnahmen.filter(visible),
      fixkosten: fixkosten.filter(visible),
      ausgabenGroups: ausgabenGroups.map((g) => ({ ...g, rows: g.rows.filter(visible), total: total(g.name, g.rows) })),
      ruecklagen: ruecklagen.filter(visible),
      einnahmenTotal,
      fixkostenTotal,
      ausgabenTotal,
      ruecklagenTotal,
      ausgabenInklTotal,
      ref: summary(refYear, 'ref'),
      plan: summary(planYear, 'plan'),
    }
  }, [accounts, categories, tags, transactions, budgets, settingsByYear, lens, planYear, refYear])

  // Months of the reference year not ticked closed in Verlauf — their Prog is
  // still Plan1, not real bookings (shown as a warning; unknown while the
  // year's settings haven't loaded).
  const refSettings = settingsByYear[refYear]
  const refOpenMonths = refSettings ? 12 - (refSettings.closedMonths ?? []).length : 0

  // Column titles say what the numbers are (Oct 2026, Markus): the reference
  // year is always its Prog; the planning year is whichever lens is selected.
  const refLabel = `${refYear} Prog`
  const planLabel = `${planYear} ${LENSES.find((l) => l.id === lens)?.label ?? ''}`

  const commentProps = { commentFor, saveComment, refYear, planYear, showComments, active, refLabel, planLabel }

  // Tab with nothing focused (lib/screenCursor.js, App.jsx): the remembered
  // cell if it is still there, else the first editable cell that is in view.
  function placeCursorFromTab() {
    const root = scrollRef.current
    if (!root) return false
    const cells = [...root.querySelectorAll('[data-nav-row]')].filter((el) => el.offsetParent !== null)
    const cell = lastCellRef.current
    let target = cell ? cells.find((el) => el.dataset.navRow === cell.row && el.dataset.navCol === cell.col) : null
    if (!target) {
      const top = root.getBoundingClientRect().top
      target = cells.find((el) => el.getBoundingClientRect().top >= top) ?? cells[0]
    }
    if (!target) return false
    target.focus({ preventScroll: !!cell })
    return true
  }
  const placeCursorRef = useRef(placeCursorFromTab)
  placeCursorRef.current = placeCursorFromTab
  useEffect(() => registerScreenCursor('planung', () => placeCursorRef.current()), [])

  // Coming back to the screen: scroll and cursor exactly where they were.
  useLayoutEffect(() => {
    if (!active) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = scrollTopRef.current
    const cell = lastCellRef.current
    if (cell) {
      el.querySelector(`[data-nav-row="${CSS.escape(cell.row)}"][data-nav-col="${cell.col}"]`)?.focus({ preventScroll: true })
    }
  }, [active])

  if (!report) return null

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        // A hidden element reports 0; only remember real scrolling.
        if (e.currentTarget.offsetParent !== null) scrollTopRef.current = e.currentTarget.scrollTop
      }}
      onFocus={(e) => {
        const t = e.target
        if (t.dataset?.navRow !== undefined) lastCellRef.current = { row: t.dataset.navRow, col: t.dataset.navCol }
      }}
      className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--color-text-muted)]">
        <span>
          Referenzjahr <b className="text-[var(--color-text)]">{refYear}</b> · Prog (tatsächlich)
          {refOpenMonths > 0 && (
            <span className="ml-2 text-[var(--color-needs-attention)]" title="In Verlauf ist für diese Monate das Häkchen „abgeschlossen“ nicht gesetzt; dort gilt Plan 1 statt der echten Buchungen.">
              ⚠ {refOpenMonths} {refOpenMonths === 1 ? 'Monat' : 'Monate'} nicht abgeschlossen (dort gilt Plan 1)
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          Planungsjahr <b className="text-[var(--color-text)]">{planYear}</b> · Spalte zeigt:
          <span className="flex gap-0.5 rounded-lg bg-[var(--color-line-row-tint)] p-0.5" role="radiogroup" aria-label="Quelle der Planungsspalte">
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={lens === l.id}
                onClick={() => chooseLens(l.id)}
                className={`whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ${
                  lens === l.id ? 'bg-[var(--color-surface)] text-[var(--color-computed)] shadow-sm' : ''
                }`}
              >
                {l.label}
              </button>
            ))}
          </span>
        </span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showComments} onChange={(e) => chooseShowComments(e.target.checked)} />
          Kommentare
        </label>
      </div>

      <BudgetChart years={[report.ref, report.plan]} />

      <div className="hidden md:block">
        <ReportTable report={report} savePuffer={savePuffer} {...commentProps} />
      </div>
      <div className="md:hidden">
        <ReportCards report={report} savePuffer={savePuffer} {...commentProps} />
      </div>
    </div>
  )
}

// Budget (green) against a stacked Ausgaben (amber) + Rücklagen (purple)
// bar, per year (§3c) — horizontal, plain divs, no chart library needed
// for four bars. Rücklagen that net *out* of savings (a positive figure)
// can't be drawn as a stacked segment and simply don't add width.
function BudgetChart({ years }) {
  const bars = years.map((y) => ({
    year: y.year,
    budget: Math.max(0, y.budget),
    ausgaben: Math.max(0, -y.ausgaben),
    ruecklagen: Math.max(0, -y.ruecklagen),
  }))
  const max = Math.max(1, ...bars.flatMap((b) => [b.budget, b.ausgaben + b.ruecklagen]))
  const pct = (v) => `${(v / max) * 100}%`
  return (
    <section className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
      <h3 className="mb-3 font-semibold">Budget vs. Ausgaben + Rücklagen</h3>
      <div className="flex flex-col gap-4">
        {bars.map((b) => (
          <div key={b.year} className="grid grid-cols-[3rem_1fr] items-center gap-x-3 gap-y-1">
            <span className="row-span-2 font-semibold">{b.year}</span>
            <div className="flex items-center gap-2">
              <div className="h-4 rounded-sm bg-[var(--color-income)]" style={{ width: pct(b.budget) }} />
              <span className="tabular-figure whitespace-nowrap">{euro(b.budget)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-4" style={{ width: pct(b.ausgaben + b.ruecklagen) }}>
                <div className="h-full rounded-l-sm bg-[var(--color-expense)]" style={{ width: `${(b.ausgaben / (b.ausgaben + b.ruecklagen || 1)) * 100}%` }} />
                <div className="h-full rounded-r-sm bg-[var(--color-savings)]" style={{ width: `${(b.ruecklagen / (b.ausgaben + b.ruecklagen || 1)) * 100}%` }} />
              </div>
              <span className="tabular-figure whitespace-nowrap">{euro(b.ausgaben + b.ruecklagen)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-[var(--color-text-muted)]">
        <Legend color="var(--color-income)" label="Budget" />
        <Legend color="var(--color-expense)" label="Ausgaben" />
        <Legend color="var(--color-savings)" label="Rücklagen" />
      </div>
    </section>
  )
}

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

// The Puffer — the only number typed on this screen (§2.7a). Shown as the
// negative amount it subtracts; editing takes the plain positive figure.
function PufferCell({ cents, onSave, label, navCol }) {
  const [draft, setDraft] = useState(null)
  const btnRef = useRef(null)
  const returnFocus = useRef(false)
  // After Enter/Escape the cursor stays on the cell (so the arrow keys keep
  // working); leaving by clicking elsewhere must not steal focus back.
  useEffect(() => {
    if (draft === null && returnFocus.current) {
      returnFocus.current = false
      btnRef.current?.focus()
    }
  }, [draft])
  const start = (text) => setDraft(text ?? (cents ? centsToWholeEuro(cents) : ''))
  if (draft === null) {
    return (
      <button
        ref={btnRef}
        type="button"
        {...(navCol === undefined ? {} : { 'data-nav-row': 'puffer', 'data-nav-col': navCol })}
        // Double click (or Enter/F2) to edit, like the grids (Oct 2026,
        // Markus) — a single click only selects; typing a digit starts
        // editing with it.
        onDoubleClick={() => start()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2') {
            e.preventDefault()
            start()
          } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (/^[0-9-]$/.test(e.key) || e.key === 'Backspace' || e.key === 'Delete')) {
            e.preventDefault()
            start(/^[0-9-]$/.test(e.key) ? e.key : '')
          }
        }}
        title="Puffer — Doppelklick zum Bearbeiten"
        aria-label={`${label} bearbeiten`}
        className="tabular-figure scroll-mt-14 underline decoration-dotted underline-offset-2"
      >
        {euro(-cents)}
      </button>
    )
  }
  function commit(keepCursor) {
    const parsed = parseWholeEuroInput(draft)
    if (parsed !== null) onSave(Math.abs(parsed))
    returnFocus.current = keepCursor
    setDraft(null)
  }
  return (
    <input
      autoFocus
      inputMode="numeric"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(true)
        if (e.key === 'Escape') {
          returnFocus.current = true
          setDraft(null)
        }
      }}
      className="tabular-figure w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-right"
    />
  )
}

// One comment cell: a plain textarea that grows with its content, so the
// row grows with it (Oct 2026, Markus: "the cells will have to expand
// flexibly with the content of the comments"). Like a grid cell it is only
// *selected* by a single click; a double click (or Enter/F2) starts editing
// (Oct 2026, Markus). Enter saves, Shift+Enter adds a line, Escape drops the
// unsaved change; clicking away saves too (and so does the screen going
// away mid-edit).
function CommentBox({ y, target, c, cell = true, navCol }) {
  const saved = c.commentFor.get(`${y}:${target.targetId}`) ?? ''
  const [draft, setDraft] = useState(saved)
  const [editing, setEditing] = useState(false)
  const ref = useRef(null)
  const editingRef = useRef(false)
  editingRef.current = editing
  const latest = useRef({ draft, saved })
  latest.current = { draft, saved }

  // A change arriving from Firestore replaces the text unless it's being edited.
  useEffect(() => {
    if (!editingRef.current) setDraft(saved)
  }, [saved])

  function fit() {
    const el = ref.current
    // Measuring a hidden box (screen switched away, or the other layout)
    // would collapse it to 0 — keep the last height instead.
    if (!el || el.offsetParent === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(fit, [draft, c.active])
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // Entering edit mode puts the caret at the end of the text.
  useEffect(() => {
    if (!editing) return
    const el = ref.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  function commit() {
    const { draft: d, saved: s } = latest.current
    if (d.trim() !== s) c.saveComment(y, target, d.trim())
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(), [])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      readOnly={!editing}
      {...(navCol === undefined ? {} : { 'data-nav-row': target.targetId, 'data-nav-col': navCol })}
      aria-label={`Kommentar ${y} ${target.label}`}
      title={editing ? undefined : 'Doppelklick zum Bearbeiten'}
      onDoubleClick={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        commit()
      }}
      onKeyDown={(e) => {
        if (!editing) {
          if (e.key === 'Enter' || e.key === 'F2') {
            e.preventDefault()
            setEditing(true)
          } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
            // Typing on a selected cell starts editing with what was typed
            // replacing the old text, like the grids; Backspace/Delete
            // start from an empty cell.
            e.preventDefault()
            setDraft(e.key.length === 1 ? e.key : '')
            setEditing(true)
          }
          return
        }
        if (e.key === 'Escape') {
          setDraft(saved)
          latest.current = { draft: saved, saved }
          setEditing(false)
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
          setEditing(false)
        }
      }}
      className={
        'block w-full scroll-mt-14 resize-none overflow-hidden bg-transparent text-sm leading-5 whitespace-pre-wrap focus:outline-2 focus:-outline-offset-2 focus:outline-[var(--color-computed)] ' +
        (editing ? 'cursor-text bg-[var(--color-surface)] ' : 'cursor-default select-none hover:bg-[var(--color-line-row-tint)] ') +
        (cell ? 'px-3 py-1' : 'rounded border border-[var(--color-border)] px-2 py-1')
      }
    />
  )
}

function splitPill(split) {
  if (split.regularYear === 0 && split.lumpYear === 0) return null
  return `${split.percent}/${100 - split.percent}`
}

// Same cell conventions as Verlauf's grid: 14px text, ~30px rows, figures
// in the tabular JetBrains Mono face (`tabular-figure`, index.css), a
// value of exactly 0 shown blank, and the category name cells tinted by
// section (SECTION_TINT).
const TH_BASE = 'sticky top-0 whitespace-nowrap border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 font-medium'
const TH = `${TH_BASE} z-10 text-right`
const TD = 'tabular-figure whitespace-nowrap border-b border-[var(--color-border)] px-3 py-1 text-right align-top'
const NAME_TD = 'sticky left-0 whitespace-nowrap border-b border-[var(--color-border)] px-3 py-1 text-left align-top'
// A comment column cell has no padding of its own — the textarea inside
// fills it, so the whole cell is the click target.
const COMMENT_TD = 'min-w-[14rem] border-b border-[var(--color-border)] p-0 align-top'
// The vertical grid line between the 2025 block (figures + comment) and the
// 2026 block (Oct 2026, Markus) — a left border on every 2026 figure cell.
const DIVIDER = 'border-l'

function blankZero(cents) {
  return cents === 0 ? '' : euro(cents)
}

// A group header row that carries its own group's totals (Markus, Sept
// 2026: "put the sub group totals into the subgroup headers") — label and
// every figure in the group's own color, the whole row in its section tint.
function GroupHeader({ t, section, showComments }) {
  const style = { backgroundColor: SECTION_TINT_STRONG[section], color: SECTION_COLOR[section] }
  return (
    <tr className="font-semibold" style={style}>
      <td className={NAME_TD} style={style}>
        {t.label}
      </td>
      <td className={TD}>{blankZero(t.ref)}</td>
      {showComments && <td className={COMMENT_TD} />}
      <td className={`${TD} ${DIVIDER}`}>{blankZero(t.plan)}</td>
      {showComments && <td className={COMMENT_TD} />}
      <td className={TD}>{blankZero(t.split.regularYear)}</td>
      <td className={TD}>{blankZero(t.split.regularMonth)}</td>
      <td className={TD}>{blankZero(t.split.lumpYear)}</td>
      <td className="border-b border-[var(--color-border)]" />
    </tr>
  )
}

function DataRow({ r, section, c }) {
  const { refYear, planYear, showComments } = c
  const pill = splitPill(r.split)
  return (
    <tr>
      <td className={`${NAME_TD} pl-6`} style={{ backgroundColor: SECTION_TINT[section] }}>
        {r.label}
      </td>
      <td className={TD}>{blankZero(r.ref)}</td>
      {showComments && (
        <td className={COMMENT_TD}>
          <CommentBox y={refYear} target={r} c={c} navCol={0} />
        </td>
      )}
      <td className={`${TD} ${DIVIDER}`}>{blankZero(r.plan)}</td>
      {showComments && (
        <td className={COMMENT_TD}>
          <CommentBox y={planYear} target={r} c={c} navCol={1} />
        </td>
      )}
      <td className={TD}>{blankZero(r.split.regularYear)}</td>
      <td className={TD}>{blankZero(r.split.regularMonth)}</td>
      <td className={TD}>
        {blankZero(r.split.lumpYear)}
      </td>
      <td className="whitespace-nowrap border-b border-[var(--color-border)] px-3 py-1 text-center align-top">
        {pill && (
          <span className="inline-block rounded-full bg-[var(--color-savings-tint)] px-1.5 py-px text-xs font-medium text-[var(--color-savings)]">
            {pill}
          </span>
        )}
      </td>
    </tr>
  )
}

function Group({ t, rows, section, c }) {
  return (
    <>
      <GroupHeader t={t} section={section} showComments={c.showComments} />
      {rows.map((r) => (
        <DataRow key={r.targetId} r={r} section={section} c={c} />
      ))}
    </>
  )
}

// A summary row (Jahresanfang, Budget band): only the two year columns
// carry a value. Each value is either plain cents or `{ node, color }`.
function BandRow({ label, refValue, planValue, color, bold = false, tint, showComments }) {
  const cell = (v) => (typeof v === 'number' ? { node: euro(v), color } : { node: v.node, color: color ?? v.color })
  const r = cell(refValue)
  const p = cell(planValue)
  return (
    <tr className={bold ? 'font-semibold' : ''} style={tint ? { backgroundColor: tint } : undefined}>
      <td className={`${NAME_TD} ${tint ? '' : 'bg-[var(--color-surface)]'}`} style={{ ...(color ? { color } : {}), ...(tint ? { backgroundColor: tint } : {}) }}>
        {label}
      </td>
      <td className={TD} style={r.color ? { color: r.color } : undefined}>
        {r.node}
      </td>
      {showComments && <td className="border-b border-[var(--color-border)]" />}
      <td className={`${TD} ${DIVIDER}`} style={p.color ? { color: p.color } : undefined}>
        {p.node}
      </td>
      {showComments && <td className="border-b border-[var(--color-border)]" />}
      <td colSpan={4} className="border-b border-[var(--color-border)]" />
    </tr>
  )
}

// The visual split between the report's three blocks (Markus, Sept 2026):
// Einnahmen/Fixkosten → the Budget band → Ausgaben.
function BlockGap({ showComments }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={showComments ? 9 : 7} className="h-5 border-b border-[var(--color-border)] bg-[var(--color-bg)] p-0" />
    </tr>
  )
}

// Arrow keys move the cursor between the editable cells (the two Puffer
// figures, then every comment cell) like in the grids (Oct 2026, Markus). A
// cell carries `data-nav-row` (its row) and `data-nav-col` (0 = the 2025
// block, 1 = the 2026 block), so a Puffer cell and the comment cell under it
// line up. Not while a cell is being edited — there the arrows move the text
// caret as usual.
function moveCursor(e) {
  const t = e.target
  if (!(t instanceof HTMLElement) || t.dataset.navRow === undefined) return
  if (t.tagName === 'TEXTAREA' && !t.readOnly) return
  const step = { ArrowUp: [1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
  if (!step) return
  const cells = new Map()
  const rows = []
  for (const el of e.currentTarget.querySelectorAll('[data-nav-row]')) {
    if (!rows.includes(el.dataset.navRow)) rows.push(el.dataset.navRow)
    cells.set(`${el.dataset.navRow}|${el.dataset.navCol}`, el)
  }
  let r = rows.indexOf(t.dataset.navRow)
  let col = Number(t.dataset.navCol)
  let next = null
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const dy = e.key === 'ArrowUp' ? -1 : 1
    for (r += dy; r >= 0 && r < rows.length && !next; r += dy) next = cells.get(`${rows[r]}|${col}`) ?? null
  } else {
    next = cells.get(`${rows[r]}|${col + step[1]}`) ?? null
  }
  e.preventDefault()
  if (next) {
    next.focus()
    next.scrollIntoView({ block: 'nearest' })
  }
}

function ReportTable({ report, savePuffer, ...c }) {
  const { refYear, planYear, showComments } = c
  const { ref, plan } = report
  return (
    <table onKeyDown={moveCursor} className="w-full border-separate border-spacing-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm">
      <thead>
        <tr>
          <th className={`${TH_BASE} left-0 z-20 text-left`}>Kategorie</th>
          <th className={TH}>{c.refLabel}</th>
          {showComments && <th className={`${TH_BASE} z-10 min-w-[14rem] text-left`}>Kommentare</th>}
          <th className={`${TH} ${DIVIDER}`}>{c.planLabel}</th>
          {showComments && <th className={`${TH_BASE} z-10 min-w-[14rem] text-left`}>Kommentare</th>}
          <th className={TH}>Regulär Jahr</th>
          <th className={TH}>Regulär Monat</th>
          <th className={TH}>Einmal Jahr</th>
          <th className={`${TH_BASE} z-10 text-center`}>Anteil</th>
        </tr>
      </thead>
      <tbody>
        <BandRow label="Alle Barkonten" refValue={ref.jahresanfangRaw} planValue={plan.jahresanfangRaw} color="var(--color-computed)" showComments={showComments} />
        <BandRow
          label="Puffer"
          refValue={{ node: <PufferCell cents={ref.puffer} onSave={(v) => savePuffer(refYear, v)} label={`Puffer ${refYear}`} navCol={0} /> }}
          planValue={{ node: <PufferCell cents={plan.puffer} onSave={(v) => savePuffer(planYear, v)} label={`Puffer ${planYear}`} navCol={1} /> }}
          showComments={showComments}
        />
        <BandRow label="Jahresanfang (Barkonten − Puffer)" refValue={ref.startCash} planValue={plan.startCash} color="var(--color-computed)" bold showComments={showComments} />
        <Group t={report.einnahmenTotal} rows={report.einnahmen} section="einnahmen" c={c} />
        <Group t={report.fixkostenTotal} rows={report.fixkosten} section="fixkosten" c={c} />

        <BlockGap showComments={showComments} />
        <BandRow label="Budget" refValue={ref.budget} planValue={plan.budget} color="var(--color-computed)" bold tint={BUDGET_BAND_TINT} showComments={showComments} />
        <BandRow
          label="Ausgaben vs. Budget — sollte nahe Null sein"
          refValue={{ node: euro(ref.ausgabenVsBudget), color: deltaColor(ref.ausgabenVsBudget) }}
          planValue={{ node: euro(plan.ausgabenVsBudget), color: deltaColor(plan.ausgabenVsBudget) }}
          bold
          tint={BUDGET_BAND_TINT}
          showComments={showComments}
        />
        <BandRow label="… gebildete Rücklagen (Teil der Ausgaben)" refValue={-ref.ruecklagen} planValue={-plan.ruecklagen} color="var(--color-savings)" tint={BUDGET_BAND_TINT} showComments={showComments} />

        <BlockGap showComments={showComments} />
        <GroupHeader t={report.ausgabenInklTotal} section="ausgaben" showComments={showComments} />
        {report.ausgabenGroups.map((g) => (
          <Group key={g.name} t={g.total} rows={g.rows} section="ausgaben" c={c} />
        ))}
        <Group t={report.ruecklagenTotal} rows={report.ruecklagen} section="ruecklagen" c={c} />
      </tbody>
    </table>
  )
}

// Phone (§1b.7): the same report as a scrolling stack of cards — one code
// path, just a different arrangement below the md breakpoint.
function Card({ r, c }) {
  const { refYear, planYear, showComments } = c
  const pill = splitPill(r.split)
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
      <div className="mb-1 font-semibold">{r.label}</div>
      {[
        [refYear, c.refLabel, r.ref],
        [planYear, c.planLabel, r.plan],
      ].map(([y, title, v]) => (
        <div key={y} className="mb-1">
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">{title}</span>
            <span className="tabular-figure">{euro(v)}</span>
          </div>
          {showComments && (
            <div className="mt-0.5">
              <CommentBox y={y} target={r} c={c} cell={false} />
            </div>
          )}
        </div>
      ))}
      {pill && (
        <div className="mt-1 flex justify-between text-[var(--color-savings)]">
          <span>
            Regulär {r.split.percent}% · Einmal {100 - r.split.percent}%
          </span>
          <span className="tabular-figure">{euro(r.split.lumpYear)}</span>
        </div>
      )}
    </div>
  )
}

// A card-stack section header carrying its own total, in the group's own
// color and tint — the phone equivalent of GroupHeader.
function CardGroupHeader({ t, section }) {
  return (
    <div
      className="flex justify-between rounded-md px-3 py-1.5 text-sm font-semibold"
      style={{ backgroundColor: SECTION_TINT[section], color: SECTION_COLOR[section] }}
    >
      <span>{t.label}</span>
      <span className="tabular-figure">{euro(t.plan)}</span>
    </div>
  )
}

function CardSection({ t, section, rows, c }) {
  return (
    <section className="flex flex-col gap-2">
      <CardGroupHeader t={t} section={section} />
      {rows.map((r) => (
        <Card key={r.targetId} r={r} c={c} />
      ))}
    </section>
  )
}

function Line({ label, value, color }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-figure" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}

function ReportCards({ report, savePuffer, ...c }) {
  const { planYear } = c
  const { ref, plan } = report
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
        <div className="mb-1 font-semibold">Jahresanfang</div>
        {[ref, plan].map((s) => (
          <div key={s.year} className="flex flex-col gap-0.5 border-t border-[var(--color-border)] py-1 first-of-type:border-t-0">
            <Line label={`Alle Barkonten ${s.year}`} value={euro(s.jahresanfangRaw)} color="var(--color-computed)" />
            <Line label="Puffer" value={<PufferCell cents={s.puffer} onSave={(v) => savePuffer(s.year, v)} label={`Puffer ${s.year}`} />} />
            <Line label="Jahresanfang" value={euro(s.startCash)} color="var(--color-computed)" />
          </div>
        ))}
      </div>
      <CardSection t={report.einnahmenTotal} section="einnahmen" rows={report.einnahmen} c={c} />
      <CardSection t={report.fixkostenTotal} section="fixkosten" rows={report.fixkosten} c={c} />

      <div className="my-2 flex flex-col gap-0.5 rounded-lg border-2 border-[var(--color-computed)] p-3 text-sm font-semibold" style={{ backgroundColor: BUDGET_BAND_TINT }}>
        <Line label={`Budget ${planYear}`} value={euro(plan.budget)} color="var(--color-computed)" />
        <Line label="Ausgaben vs. Budget" value={euro(plan.ausgabenVsBudget)} color={deltaColor(plan.ausgabenVsBudget)} />
        <Line label="… gebildete Rücklagen" value={euro(-plan.ruecklagen)} color="var(--color-savings)" />
      </div>

      <CardGroupHeader t={report.ausgabenInklTotal} section="ausgaben" />
      {report.ausgabenGroups.map((g) => (
        <CardSection key={g.name} t={g.total} section="ausgaben" rows={g.rows} c={c} />
      ))}
      <CardSection t={report.ruecklagenTotal} section="ruecklagen" rows={report.ruecklagen} c={c} />
    </div>
  )
}
