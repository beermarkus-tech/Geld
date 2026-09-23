import { forwardRef, useImperativeHandle, useState } from 'react'

// The Konto cell editor — a small popup with two account pickers (Von/Nach)
// rather than two separate grid columns (spec.md §3a: "still two separate
// account fields underneath... exactly how editing a merged cell works...
// is an implementation detail for whenever manual entry is built, not
// resolved [in the spec]" — this is that decision, made here rather than
// left unresolved forever).
const KontoEditor = forwardRef(function KontoEditor(props, ref) {
  const { data, accounts, onApply, api } = props
  const [fromId, setFromId] = useState(data.fromAccountId ?? '')
  const [toId, setToId] = useState(data.toAccountId ?? '')

  // getValue()/isCancelAfterEnd stay in place as a fallback for whatever
  // other way a cell edit might end (Enter, tabbing away) — but Übernehmen
  // itself no longer depends on this pipeline (see the button below).
  useImperativeHandle(ref, () => ({
    getValue: () => ({ fromAccountId: fromId || null, toAccountId: toId || null }),
    isCancelBeforeStart: () => false,
    // Refuse to commit a transaction with no account at all — that breaks
    // every balance/display computation, which all key off fromAccountId/
    // toAccountId (spec.md §2.6/§2.8).
    isCancelAfterEnd: () => !fromId && !toId,
  }))

  const options = accounts
    .filter((a) => a.tracked !== false && a.group !== 'system')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ minWidth: 260 }}
    >
      <label className="text-xs text-[var(--color-text-muted)]">
        Von (Abfluss)
        <select
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-sm"
        >
          <option value="">– keins –</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-[var(--color-text-muted)]">
        Nach (Zufluss)
        <select
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-sm"
        >
          <option value="">– keins –</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {/* Explicit Übernehmen/Abbrechen (Markus's request). Übernehmen
          writes directly via onApply + closes with api.stopEditing(true)
          (cancel — we've already persisted ourselves) instead of relying
          on AG Grid's own getValue()/stopEditing() commit pipeline, which
          confirmed didn't reliably apply the selection (traced to AG
          Grid's edit-commit flow, not the popup-dismiss mechanism an
          earlier fix here wrongly targeted). */}
      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => api.stopEditing(true)}
          className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)]"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={() => {
            onApply(data, fromId || null, toId || null)
            api.stopEditing(true)
          }}
          disabled={!fromId && !toId}
          className="rounded bg-[var(--color-computed)] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Übernehmen
        </button>
      </div>
    </div>
  )
})

export default KontoEditor
