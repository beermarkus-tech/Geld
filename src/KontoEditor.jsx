import { forwardRef, useImperativeHandle, useState } from 'react'

// The Konto cell editor — a small popup with two account pickers (Von/Nach)
// rather than two separate grid columns (spec.md §3a: "still two separate
// account fields underneath... exactly how editing a merged cell works...
// is an implementation detail for whenever manual entry is built, not
// resolved [in the spec]" — this is that decision, made here rather than
// left unresolved forever). Returns {fromAccountId, toAccountId} from
// getValue(); Konten.jsx's valueSetter applies it to the transaction and
// recomputes amountCents' sign convention from it.
const KontoEditor = forwardRef(function KontoEditor(props, ref) {
  const { data, accounts } = props
  const [fromId, setFromId] = useState(data.fromAccountId ?? '')
  const [toId, setToId] = useState(data.toAccountId ?? '')

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
    </div>
  )
})

export default KontoEditor
