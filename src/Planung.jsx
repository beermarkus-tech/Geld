import { Fragment, useEffect, useMemo, useState } from 'react'
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
import { ALLOCATION_TAG_ORDER, GROUP_ORDER, SUBCAT_ORDER, isKnownSubcat } from './lib/categoryOrder'
import { centsToWholeEuro, parseWholeEuroInput } from './lib/format'

// Planung (spec.md §3c) — an annotated, read-only report over Verlauf's
// own Plan0/Plan1/Prog figures. Nothing here edits a budget amount; the
// only inputs are the per-year Puffer (settings/{year}.minCashBufferCents)
// and a free-text comment per category/allocation tag per year
// (categoryYearSettings.comment, §2.7c).

// Jahresanfang's starting cash (§3c, resolved Sept 2026, Markus): every
// account in these three reportingGroups, balance on Dec 31 of the prior
// year — Sparkonten/Geldanlage stay out.
const START_CASH_GROUPS = ['Barkonten', 'Bargeld', 'Außenstände']

const LENSES = [
  { id: 'plan0', label: 'Plan 0' },
  { id: 'plan1', label: 'Plan 1' },
  { id: 'prog', label: 'Prog' },
]
const LENS_KEY = 'geld-planung-lens'

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

// Ausgaben vs. Budget — "should be near zero"; negative means the plan
// spends more than the budget allows, which is the one alert-red case
// here (§1b.4).
function deltaColor(cents) {
  if (cents < 0) return 'var(--color-alert)'
  if (cents > 0) return 'var(--color-income)'
  return 'var(--color-text)'
}

export default function Planung({ year }) {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [yearSettings, setYearSettings] = useState([])
  const [settingsByYear, setSettingsByYear] = useState({})
  const [lens, setLens] = useState(readLens)
  // Which comment editor is open: `${year}:${targetId}`, or null.
  const [openComment, setOpenComment] = useState(null)

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
    const closedMonths = settingsByYear[planYear]?.closedMonths ?? []

    function yearValue(targetKey, targetId, y, which) {
      if (which !== 'prog') return budgetTopLineMonths(targetKey, targetId, which, y, budgets).yearTotal
      const plan1 = budgetTopLineMonths(targetKey, targetId, 'plan1', y, budgets).months
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
      const ref = yearValue(targetKey, targetId, refYear, 'plan0')
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
      .filter((t) => t.class === 'allocation')
      .sort((a, b) => ALLOCATION_TAG_ORDER.indexOf(a.id) - ALLOCATION_TAG_ORDER.indexOf(b.id))
      .map((t) => row('allocationTagId', t.id, `Für ${t.name}`))

    const einnahmenTotal = total('Einnahmen gesamt', einnahmen)
    const fixkostenTotal = total('Fixkosten gesamt', fixkosten)
    const ausgabenTotal = total('Ausgaben gesamt', ausgabenGroups.flatMap((g) => g.rows))
    const ruecklagenTotal = total('Rücklagen gesamt', ruecklagen)

    const startCashAccounts = accounts.filter((a) => START_CASH_GROUPS.includes(a.reportingGroup))
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
      ausgabenGroups: ausgabenGroups.map((g) => ({ ...g, rows: g.rows.filter(visible), total: total(`${g.name} gesamt`, g.rows) })),
      ruecklagen: ruecklagen.filter(visible),
      einnahmenTotal,
      fixkostenTotal,
      ausgabenTotal,
      ruecklagenTotal,
      ref: summary(refYear, 'ref'),
      plan: summary(planYear, 'plan'),
    }
  }, [accounts, categories, tags, transactions, budgets, settingsByYear, lens, planYear, refYear])

  if (!report) return null

  const commentProps = { commentFor, openComment, setOpenComment, saveComment, refYear, planYear }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[var(--color-text-muted)]">
        <span>
          Referenzjahr <b className="text-[var(--color-text)]">{refYear}</b> · immer Plan 0
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
                className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold ${
                  lens === l.id ? 'bg-[var(--color-surface)] text-[var(--color-computed)] shadow-sm' : ''
                }`}
              >
                {l.label}
              </button>
            ))}
          </span>
        </span>
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
    <section className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold">Budget vs. Ausgaben + Rücklagen</h3>
      <div className="flex flex-col gap-4">
        {bars.map((b) => (
          <div key={b.year} className="grid grid-cols-[3rem_1fr] items-center gap-x-3 gap-y-1 text-xs">
            <span className="row-span-2 font-semibold">{b.year}</span>
            <div className="flex items-center gap-2">
              <div className="h-4 rounded-sm bg-[var(--color-income)]" style={{ width: pct(b.budget) }} />
              <span className="font-mono whitespace-nowrap">{euro(b.budget)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-4" style={{ width: pct(b.ausgaben + b.ruecklagen) }}>
                <div className="h-full rounded-l-sm bg-[var(--color-expense)]" style={{ width: `${(b.ausgaben / (b.ausgaben + b.ruecklagen || 1)) * 100}%` }} />
                <div className="h-full rounded-r-sm bg-[var(--color-savings)]" style={{ width: `${(b.ruecklagen / (b.ausgaben + b.ruecklagen || 1)) * 100}%` }} />
              </div>
              <span className="font-mono whitespace-nowrap">{euro(b.ausgaben + b.ruecklagen)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-[var(--color-text-muted)]">
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
function PufferCell({ cents, onSave, label }) {
  const [draft, setDraft] = useState(null)
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(cents ? centsToWholeEuro(cents) : '')}
        title="Puffer bearbeiten"
        aria-label={`${label} bearbeiten`}
        className="font-mono underline decoration-dotted underline-offset-2"
      >
        {euro(-cents)}
      </button>
    )
  }
  function commit() {
    const parsed = parseWholeEuroInput(draft)
    if (parsed !== null) onSave(Math.abs(parsed))
    setDraft(null)
  }
  return (
    <input
      autoFocus
      inputMode="numeric"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-right font-mono"
    />
  )
}

function CommentIcon({ y, target, commentFor, openComment, setOpenComment }) {
  const key = `${y}:${target.targetId}`
  const text = commentFor.get(key)
  return (
    <button
      type="button"
      onClick={() => setOpenComment(openComment === key ? null : key)}
      title={text ?? `${y}: Kein Kommentar — klicken zum Hinzufügen`}
      aria-label={`Kommentar ${y} ${target.label}`}
      className={`ml-1 text-[13px] leading-none ${text ? '' : 'opacity-30 grayscale hover:opacity-70'}`}
    >
      💬
    </button>
  )
}

function CommentEditor({ y, target, commentFor, saveComment, setOpenComment }) {
  const [draft, setDraft] = useState(commentFor.get(`${y}:${target.targetId}`) ?? '')
  function save() {
    saveComment(y, target, draft.trim())
    setOpenComment(null)
  }
  return (
    <div className="flex flex-col gap-1.5 text-left">
      <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">
        Kommentar {y} — {target.label}
      </span>
      <textarea
        autoFocus
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpenComment(null)
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
        }}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-xs font-normal whitespace-normal"
      />
      <div className="flex gap-2">
        <button type="button" onClick={save} className="rounded bg-[var(--color-computed)] px-2.5 py-1 text-xs font-semibold text-white">
          Speichern
        </button>
        <button type="button" onClick={() => setOpenComment(null)} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs">
          Abbrechen
        </button>
      </div>
    </div>
  )
}

// Saved comments for a row, shown under it in the report ("2026: …").
function CommentLines({ target, commentFor, refYear, planYear }) {
  const lines = [refYear, planYear]
    .map((y) => [y, commentFor.get(`${y}:${target.targetId}`)])
    .filter(([, text]) => text)
  if (lines.length === 0) return null
  return lines.map(([y, text]) => (
    <div key={y} className="text-[11px] font-normal whitespace-normal text-[var(--color-text-muted)] italic">
      ↳ {y}: {text}
    </div>
  ))
}

function splitPill(split) {
  if (split.regularYear === 0 && split.lumpYear === 0) return null
  return `${split.percent}/${100 - split.percent}`
}

const TH_BASE = 'sticky top-0 whitespace-nowrap border-b border-[var(--color-border)] bg-[var(--color-line-row-tint)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]'
const TH = `${TH_BASE} z-10 text-right`
const TD = 'whitespace-nowrap border-b border-[var(--color-border)] px-2 py-1 text-right font-mono'
const NAME_TD = 'sticky left-0 whitespace-nowrap border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-left font-semibold'

function SectionBand({ label, section }) {
  return (
    <tr>
      <td colSpan={6} className="border-b border-[var(--color-border)] bg-[var(--color-line-row-tint)] px-2 py-1.5 text-left text-[11px] font-bold tracking-wide uppercase" style={{ color: SECTION_COLOR[section] }}>
        {label}
      </td>
    </tr>
  )
}

function DataRow({ r, c }) {
  const { refYear, planYear } = c
  const pill = splitPill(r.split)
  const editing = c.openComment === `${refYear}:${r.targetId}` ? refYear : c.openComment === `${planYear}:${r.targetId}` ? planYear : null
  return (
    <>
      <tr>
        <td className={NAME_TD}>
          {r.label}
          <CommentLines target={r} {...c} />
        </td>
        <td className={TD}>
          {euro(r.ref)}
          <CommentIcon y={refYear} target={r} {...c} />
        </td>
        <td className={TD}>
          {euro(r.plan)}
          <CommentIcon y={planYear} target={r} {...c} />
        </td>
        <td className={TD}>{euro(r.split.regularYear)}</td>
        <td className={TD}>{euro(r.split.regularMonth)}</td>
        <td className={TD}>
          {euro(r.split.lumpYear)}
          {pill && (
            <span className="ml-1.5 inline-block rounded-full bg-[var(--color-savings-tint)] px-1.5 py-px font-sans text-[9.5px] font-semibold text-[var(--color-savings)]">
              {pill}
            </span>
          )}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6} className="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2">
            <CommentEditor key={c.openComment} y={editing} target={r} {...c} />
          </td>
        </tr>
      )}
    </>
  )
}

function TotalRow({ t, bold = true }) {
  return (
    <tr className={bold ? 'font-bold' : ''}>
      <td className={NAME_TD}>{t.label}</td>
      <td className={TD}>{euro(t.ref)}</td>
      <td className={TD}>{euro(t.plan)}</td>
      <td className={TD}>{euro(t.split.regularYear)}</td>
      <td className={TD}>{euro(t.split.regularMonth)}</td>
      <td className={TD}>{euro(t.split.lumpYear)}</td>
    </tr>
  )
}

// A summary-band row: only the two year columns carry a value. Each value
// is either plain cents or `{ node, color }` for a custom cell.
function BandRow({ label, refValue, planValue, color, className = '' }) {
  const cell = (v) => (typeof v === 'number' ? { node: euro(v), color } : { node: v.node, color: color ?? v.color })
  const r = cell(refValue)
  const p = cell(planValue)
  return (
    <tr className={`font-bold ${className}`}>
      <td className={NAME_TD} style={color ? { color } : undefined}>{label}</td>
      <td className={TD} style={r.color ? { color: r.color } : undefined}>{r.node}</td>
      <td className={TD} style={p.color ? { color: p.color } : undefined}>{p.node}</td>
      <td colSpan={3} className="border-b border-[var(--color-border)]" />
    </tr>
  )
}

function ReportTable({ report, savePuffer, ...c }) {
  const { refYear, planYear } = c
  const { ref, plan } = report

  return (
    <table className="w-full border-collapse bg-[var(--color-surface)] text-xs">
      <thead>
        <tr>
          <th className={`${TH_BASE} left-0 z-20 text-left`}>Kategorie</th>
          <th className={TH}>{refYear}</th>
          <th className={TH}>{planYear}</th>
          <th className={TH}>Regulär Jahr</th>
          <th className={TH}>Regulär Monat</th>
          <th className={TH}>Einmal Jahr</th>
        </tr>
      </thead>
      <tbody>
        <BandRow label="Alle Barkonten" refValue={ref.jahresanfangRaw} planValue={plan.jahresanfangRaw} />
        <BandRow
          label="Puffer"
          refValue={{ node: <PufferCell cents={ref.puffer} onSave={(v) => savePuffer(refYear, v)} label={`Puffer ${refYear}`} /> }}
          planValue={{ node: <PufferCell cents={plan.puffer} onSave={(v) => savePuffer(planYear, v)} label={`Puffer ${planYear}`} /> }}
        />
        <BandRow label="Jahresanfang (Barkonten − Puffer)" refValue={ref.startCash} planValue={plan.startCash} />

        <SectionBand label="Einnahmen" section="einnahmen" />
        {report.einnahmen.map((r) => <DataRow key={r.targetId} r={r} c={c} />)}
        <TotalRow t={report.einnahmenTotal} />

        <SectionBand label="Fixkosten" section="fixkosten" />
        {report.fixkosten.map((r) => <DataRow key={r.targetId} r={r} c={c} />)}
        <TotalRow t={report.fixkostenTotal} />

        <BandRow label="Budget" refValue={ref.budget} planValue={plan.budget} color="var(--color-computed)" />
        <BandRow
          label="Ausgaben vs. Budget — sollte nahe Null sein"
          refValue={{ node: euro(ref.ausgabenVsBudget), color: deltaColor(ref.ausgabenVsBudget) }}
          planValue={{ node: euro(plan.ausgabenVsBudget), color: deltaColor(plan.ausgabenVsBudget) }}
        />
        <BandRow label="… gebildete Rücklagen (Teil der Ausgaben)" refValue={-ref.ruecklagen} planValue={-plan.ruecklagen} color="var(--color-savings)" />

        {report.ausgabenGroups.map((g) => (
          <Fragment key={g.name}>
            <SectionBand label={g.name} section="ausgaben" />
            {g.rows.map((r) => <DataRow key={r.targetId} r={r} c={c} />)}
            <TotalRow t={g.total} bold={false} />
          </Fragment>
        ))}
        <TotalRow t={report.ausgabenTotal} />

        <SectionBand label="Rücklagen" section="ruecklagen" />
        {report.ruecklagen.map((r) => <DataRow key={r.targetId} r={r} c={c} />)}
        <TotalRow t={report.ruecklagenTotal} />
      </tbody>
    </table>
  )
}

// Phone (§1b.7): the same report as a scrolling stack of cards — one code
// path, just a different arrangement below the md breakpoint.
function Card({ r, c }) {
  const { refYear, planYear } = c
  const pill = splitPill(r.split)
  const editingYear = [refYear, planYear].find((y) => c.openComment === `${y}:${r.targetId}`)
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
      <div className="mb-1 font-semibold">{r.label}</div>
      {[
        [refYear, r.ref],
        [planYear, r.plan],
      ].map(([y, v]) => (
        <div key={y} className="flex justify-between">
          <span className="text-[var(--color-text-muted)]">
            {y}
            <CommentIcon y={y} target={r} {...c} />
          </span>
          <span className="font-mono">{euro(v)}</span>
        </div>
      ))}
      {pill && (
        <div className="mt-1 flex justify-between text-[var(--color-savings)]">
          <span>
            Regulär {r.split.percent}% · Einmal {100 - r.split.percent}%
          </span>
          <span className="font-mono">{euro(r.split.lumpYear)}</span>
        </div>
      )}
      <CommentLines target={r} {...c} />
      {editingYear && (
        <div className="mt-2">
          <CommentEditor key={c.openComment} y={editingYear} target={r} {...c} />
        </div>
      )}
    </div>
  )
}

function CardSection({ label, section, rows, t, c }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold tracking-wide uppercase" style={{ color: SECTION_COLOR[section] }}>
        {label}
      </h3>
      {rows.map((r) => <Card key={r.targetId} r={r} c={c} />)}
      {t && (
        <div className="flex justify-between px-1 text-xs font-bold">
          <span>{t.label}</span>
          <span className="font-mono">{euro(t.plan)}</span>
        </div>
      )}
    </section>
  )
}

function Line({ label, value, color }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="font-mono" style={color ? { color } : undefined}>
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
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs font-semibold">
        <Line label={`Budget ${planYear}`} value={euro(plan.budget)} color="var(--color-computed)" />
        <Line label="Ausgaben vs. Budget" value={euro(plan.ausgabenVsBudget)} color={deltaColor(plan.ausgabenVsBudget)} />
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
        <div className="mb-1 font-semibold">Jahresanfang</div>
        {[ref, plan].map((s) => (
          <div key={s.year} className="flex flex-col gap-0.5 border-t border-[var(--color-border)] py-1 first-of-type:border-t-0">
            <Line label={`Alle Barkonten ${s.year}`} value={euro(s.jahresanfangRaw)} />
            <Line label="Puffer" value={<PufferCell cents={s.puffer} onSave={(v) => savePuffer(s.year, v)} label={`Puffer ${s.year}`} />} />
            <Line label="Jahresanfang" value={euro(s.startCash)} />
          </div>
        ))}
      </div>
      <CardSection label="Einnahmen" section="einnahmen" rows={report.einnahmen} t={report.einnahmenTotal} c={c} />
      <CardSection label="Fixkosten" section="fixkosten" rows={report.fixkosten} t={report.fixkostenTotal} c={c} />
      {report.ausgabenGroups.map((g) => (
        <CardSection key={g.name} label={g.name} section="ausgaben" rows={g.rows} t={g.total} c={c} />
      ))}
      <CardSection label="Rücklagen" section="ruecklagen" rows={report.ruecklagen} t={report.ruecklagenTotal} c={c} />
    </div>
  )
}
