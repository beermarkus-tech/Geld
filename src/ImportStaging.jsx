import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import CategoryEditor from './CategoryEditor'
import { db } from './firebase'
import {
  buildStagedRows,
  accountPair,
  counterAccountFor,
  importTotals,
  matchRule,
  matchShare,
  parseBnpRows,
  parseKeywordCsv,
  parseTypedDate,
  ruleFillFor,
  resolveCategoryId,
} from './lib/bankImport'
import { centsToEuro } from './lib/format'
import { syncAgGridColorScheme } from './lib/gridColorScheme'

ModuleRegistry.registerModules([AllCommunityModule])
syncAgGridColorScheme()

// The masked account number in the BNP file -> our account (spec.md §3k: BNP Konto
// is pre-selected from "****0048", confirmed by Markus).
const ACCOUNT_BY_MASK = { '****0048': 'bnp-konto' }
const ACCOUNT_NAME = { 'bnp-konto': 'BNP Konto' }

const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '')
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'

// Firestore batches hold 500 writes at most.
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + 400)) op(batch)
    await batch.commit()
  }
}

function parseEuro(s) {
  const cleaned = String(s).trim().replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-') return null
  const f = Number(cleaned)
  return Number.isNaN(f) ? null : Math.round(f * 100)
}

export default function ImportStaging() {
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [rules, setRules] = useState([])
  const [batches, setBatches] = useState([])
  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const gridRef = useRef(null)

  useEffect(() => {
    const subs = [
      ['categories', setCategories],
      ['accounts', setAccounts],
      ['transactions', setTransactions],
      ['categorizationRules', setRules],
      ['importBatches', setBatches],
      ['stagedRows', setRows],
    ].map(([name, set]) => onSnapshot(collection(db, name), (snap) => set(snap.docs.map((d) => d.data()))))
    return () => subs.forEach((u) => u())
  }, [])

  const openBatch = batches.find((b) => b.status === 'open') ?? null
  const batchRows = useMemo(
    () => rows.filter((r) => r.batchId === openBatch?.id).sort((a, b) => a.idx - b.idx),
    [rows, openBatch],
  )
  const accountName = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.name])), [accounts])
  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const liveTxs = useMemo(() => transactions.filter((t) => !t.deletedAt), [transactions])

  const share = openBatch ? matchShare(batchRows, rules) : null
  const totals = openBatch
    ? importTotals({
        accountId: openBatch.accountId,
        balanceDate: openBatch.balanceDate,
        bankBalanceCents: openBatch.bankBalanceCents,
        kontenTxs: liveTxs.filter((t) => t.fromAccountId === openBatch.accountId || t.toAccountId === openBatch.accountId),
        rows: batchRows,
      })
    : null

  // --- keyword list -> categorizationRules ------------------------------------
  async function loadRules(file) {
    setBusy(true)
    setMessage(null)
    try {
      const text = await file.text()
      const parsed = parseKeywordCsv(text)
      const lineCount = Math.max(0, text.split(/\r?\n/).filter((l) => l.trim()).length - 1)
      const unresolved = []
      const docs = parsed.map((r) => {
        const categoryId = resolveCategoryId(categories, r.groupName, r.categoryName)
        if (r.categoryName && !categoryId) unresolved.push(`${r.keyword}: ${r.groupName} › ${r.categoryName}`)
        return { id: `rule-${slug(r.keyword)}`, ...r, categoryId, source: 'seed', createdAt: Date.now() }
      })
      await commitInChunks(docs.map((d) => (batch) => batch.set(doc(db, 'categorizationRules', d.id), d)))
      const loaded = docs.map(({ id: _id, createdAt: _c, source: _s, ...r }) => r)
      const fills = batchRows.map((r) => [r, ruleFillFor(r, loaded)]).filter(([, p]) => p)
      await commitInChunks(fills.map(([r, p]) => (batch) => batch.set(doc(db, 'stagedRows', r.id), p, { merge: true })))
      setMessage({
        ok: true,
        text:
          `${docs.length} Regeln aus ${lineCount} Datenzeilen geladen (ohne Keyword übersprungen, doppelte Keywords nur einmal)` +
          (openBatch ? `; ${fills.length} Zeilen des offenen Imports ergänzt. ` : '. ') +
          (unresolved.length
            ? `${unresolved.length} ohne passende Kategorie (nur Empfänger wird gesetzt): ${unresolved.slice(0, 12).join('; ')}${unresolved.length > 12 ? ' …' : ''}`
            : 'Alle Kategorien gefunden.'),
      })
    } catch (e) {
      setMessage({ ok: false, text: `Regeln konnten nicht geladen werden: ${e.message}` })
    }
    setBusy(false)
  }

  // --- BNP file -> importBatches / stagedRows ----------------------------------
  async function loadBankFile(file) {
    setBusy(true)
    setMessage(null)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true })
      const parsed = parseBnpRows(aoa)
      const accountId = ACCOUNT_BY_MASK[parsed.mask]
      if (!accountId) throw new Error(`Kontonummer ${parsed.mask ?? '?'} ist keinem Konto zugeordnet.`)
      if (batches.some((b) => b.status === 'open' && b.accountId === accountId)) {
        throw new Error(`Für ${ACCOUNT_NAME[accountId]} liegt schon ein offener Import. Erst übernehmen oder verwerfen.`)
      }
      const staged = buildStagedRows(parsed.rows, rules)
      const batchId = `imp-${Date.now()}`
      const batchDoc = {
        id: batchId,
        accountId,
        status: 'open',
        fileName: file.name,
        bankBalanceCents: parsed.balanceCents,
        balanceDate: parsed.balanceDate,
        createdAt: Date.now(),
        committedAt: null,
      }
      const ops = [(b) => b.set(doc(db, 'importBatches', batchId), batchDoc)]
      staged.forEach((r, idx) => {
        const id = `${batchId}-${String(idx).padStart(4, '0')}`
        ops.push((b) => b.set(doc(db, 'stagedRows', id), { id, batchId, idx, ...r }))
      })
      await commitInChunks(ops)
      setMessage({ ok: true, text: `${staged.length} Buchungen eingelesen.` })
    } catch (e) {
      setMessage({ ok: false, text: e.message })
    }
    setBusy(false)
  }

  async function discard() {
    if (!openBatch || !window.confirm('Diesen Import verwerfen? Alle Zeilen hier gehen verloren (Konten bleibt unberührt).')) return
    setBusy(true)
    const ops = batchRows.map((r) => (b) => b.delete(doc(db, 'stagedRows', r.id)))
    ops.push((b) => b.set(doc(db, 'importBatches', openBatch.id), { ...openBatch, status: 'discarded' }))
    await commitInChunks(ops)
    setBusy(false)
  }

  const patchRow = (row, patch) => {
    const next = { ...row, ...patch }
    next.edited = next.date !== next.originalDate || next.amountCents !== next.originalAmountCents
    return setDoc(doc(db, 'stagedRows', row.id), { ...patch, edited: next.edited }, { merge: true })
  }

  // --- grid ---------------------------------------------------------------------
  const columnDefs = useMemo(
    () => [
      {
        colId: 'include',
        headerName: '☑',
        width: 52,
        pinned: 'left',
        sortable: false,
        cellRenderer: (p) => (
          <input
            type="checkbox"
            checked={p.data.include}
            onChange={(e) => patchRow(p.data, { include: e.target.checked })}
            aria-label="in Konten übernehmen"
          />
        ),
      },
      { colId: 'bankDate', headerName: 'Bankdatum', width: 110, valueGetter: (p) => fmtDate(p.data.bankDate) },
      {
        colId: 'raw',
        headerName: 'Bank-Text',
        flex: 1.2,
        minWidth: 200,
        valueGetter: (p) => p.data.rawDescription,
        tooltipValueGetter: (p) => p.data.rawDescription,
        // The matched keyword in light yellow (Oct 2026, Markus).
        cellRenderer: (p) => {
          const text = p.data.rawDescription
          const kw = matchRule(rules, text)?.keyword
          const at = kw ? text.toUpperCase().indexOf(kw.toUpperCase()) : -1
          if (at < 0) return text
          return (
            <>
              {text.slice(0, at)}
              <mark style={{ background: 'var(--color-breakdown-tint)', color: 'inherit' }}>{text.slice(at, at + kw.length)}</mark>
              {text.slice(at + kw.length)}
            </>
          )
        },
        cellClass: 'text-[var(--color-text-muted)]',
      },
      {
        colId: 'amount',
        headerName: 'Betrag',
        width: 110,
        editable: true,
        valueGetter: (p) => centsToEuro(p.data.amountCents),
        valueSetter: (p) => {
          const cents = parseEuro(p.newValue)
          if (cents == null) return false
          patchRow(p.data, { amountCents: cents })
          return false
        },
        tooltipValueGetter: (p) =>
          p.data.amountCents !== p.data.originalAmountCents ? `Datei: ${centsToEuro(p.data.originalAmountCents)}` : undefined,
        cellClass: (p) => 'text-right tabular-figure' + (p.data.amountCents !== p.data.originalAmountCents ? ' font-semibold' : ''),
      },
      {
        colId: 'date',
        headerName: 'Datum',
        width: 110,
        editable: true,
        valueGetter: (p) => fmtDate(p.data.date),
        valueSetter: (p) => {
          const iso = parseTypedDate(p.newValue, p.data.bankDate)
          if (!iso) return false
          patchRow(p.data, { date: iso })
          return false
        },
        tooltipValueGetter: (p) =>
          p.data.date !== p.data.originalDate ? `Datei: ${fmtDate(p.data.originalDate)}` : undefined,
        cellClass: (p) => (p.data.date !== p.data.originalDate ? 'font-semibold' : undefined),
      },
      {
        colId: 'konto',
        headerName: 'Konto',
        flex: 1,
        minWidth: 190,
        valueGetter: (p) => {
          const rule = matchRule(rules, p.data.rawDescription)
          const { fromAccountId, toAccountId } = accountPair(openBatch.accountId, p.data.amountCents, counterAccountFor(rule?.groupName))
          const n = (id) => accountName[id] ?? id
          return fromAccountId && toAccountId ? `${n(fromAccountId)} → ${n(toAccountId)}` : n(fromAccountId ?? toAccountId)
        },
      },
      {
        colId: 'label',
        headerName: 'Empfänger',
        flex: 1,
        minWidth: 150,
        editable: true,
        valueGetter: (p) => p.data.displayLabel,
        // Not matched by any keyword rule: blue (Oct 2026, Markus) — still the plain bank text.
        cellClass: (p) => (matchRule(rules, p.data.rawDescription) ? undefined : 'text-[var(--color-computed)]'),
        valueSetter: (p) => {
          patchRow(p.data, { displayLabel: String(p.newValue ?? '').trim() })
          return false
        },
      },
      {
        colId: 'kategorie',
        headerName: 'Kategorie',
        width: 140,
        valueGetter: (p) => {
          const c = categoryById[p.data.categoryId]
          return c ? (categoryById[c.parentCategoryId]?.name ?? '') : ''
        },
      },
      {
        colId: 'unterkategorie',
        headerName: 'Unterkategorie',
        width: 180,
        editable: true,
        valueGetter: (p) => categoryById[p.data.categoryId]?.name ?? '—',
        valueSetter: () => false,
        cellEditor: CategoryEditor,
        cellEditorParams: (p) => ({
          categories,
          initialCategoryId: p.data.categoryId,
          onApply: (_d, categoryId) => patchRow(p.data, { categoryId }),
          onClear: () => patchRow(p.data, { categoryId: null }),
          startField: 'group',
        }),
        cellEditorPopup: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks read rules/accounts each render; patchRow only needs db
    [categories, categoryById, rules, openBatch, accountName],
  )

  const fileInput = (accept, onFile, label) => (
    <label className="inline-block cursor-pointer rounded-md bg-[var(--color-computed)] px-4 py-2 text-sm font-medium text-white">
      {label}
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(f)
        }}
      />
    </label>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {message && (
        <p className={'text-sm ' + (message.ok ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-alert)]')}>{message.text}</p>
      )}

      <div className="flex flex-col gap-3">
        {!openBatch && (
          <div className="flex flex-wrap items-center gap-3">
            {fileInput('.xls,.xlsx', loadBankFile, 'BNP-Datei (.xls) einlesen')}
            {rules.length === 0 && (
              <span className="text-sm text-[var(--color-text-muted)]">Ohne Regeln bleibt alles unkategorisiert — erst die Regeln laden.</span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {fileInput('.csv', loadRules, rules.length ? 'Regeln neu laden (CSV)' : 'Regeln laden (CSV)')}
          <span className="text-sm text-[var(--color-text-muted)]">
            {rules.length} Regeln gespeichert — das Laden ist nur einmal nötig, sie bleiben in der Datenbank
            (neu laden nur, wenn sich die Liste ändert; gleiche Keywords werden überschrieben).
          </span>
        </div>
      </div>

      {openBatch && totals && (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm">
            <span>
              <b>{ACCOUNT_NAME[openBatch.accountId]}</b> · {openBatch.fileName}
            </span>
            <span>
              in Konten jetzt <b className="tabular-figure">{centsToEuro(totals.konten)}</b>
            </span>
            <span>
              + Import <b className="tabular-figure">{centsToEuro(totals.imported)}</b>
            </span>
            <span>
              = nach Import <b className="tabular-figure">{centsToEuro(totals.after)}</b>
            </span>
            <span>
              Bank-Saldo ({fmtDate(openBatch.balanceDate)}) <b className="tabular-figure">{centsToEuro(totals.bankBalanceCents)}</b>
            </span>
            {totals.difference === 0 ? (
              <b className="text-[var(--color-income)]">✓ stimmt</b>
            ) : (
              <b className="text-[var(--color-alert)]">✗ Differenz {centsToEuro(totals.difference)}</b>
            )}
            {totals.later !== 0 && (
              <span className="text-[var(--color-text-muted)]">
                (Konten-Buchungen nach dem {fmtDate(openBatch.balanceDate)}: {centsToEuro(totals.later)}, nicht mitgezählt)
              </span>
            )}
            {share && (
              <span title="Anteil der Zeilen, deren Bank-Text ein Keyword aus den Regeln trifft">
                Regeltreffer <b>{share.empfaengerPct} %</b> ({share.empfaenger}/{share.total})
              </span>
            )}
            <button type="button" onClick={discard} disabled={busy} className="ml-auto rounded-md border border-[var(--color-border)] px-3 py-1">
              Verwerfen
            </button>
          </div>
          <div className="min-h-[360px] flex-1">
            <AgGridReact
              ref={gridRef}
              theme={themeQuartz}
              rowData={batchRows}
              columnDefs={columnDefs}
              defaultColDef={{ suppressMovable: true, resizable: true }}
              getRowId={(p) => p.data.id}
              tooltipShowDelay={400}
              suppressRowHoverHighlight
              getRowStyle={(p) => (p.data.include ? undefined : { opacity: 0.5 })}
              onCellKeyDown={(p) => {
                if (p.event.key === ' ' && p.column.getColId() === 'include' && !p.editing) {
                  p.event.preventDefault()
                  patchRow(p.data, { include: !p.data.include })
                }
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
