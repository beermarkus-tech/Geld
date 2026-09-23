import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import Listbox from './Listbox'

// The Konto cell editor — a small popup with two account pickers (Von/Nach)
// rather than two separate grid columns (spec.md §3a: "still two separate
// account fields underneath... exactly how editing a merged cell works...
// is an implementation detail for whenever manual entry is built, not
// resolved [in the spec]" — this is that decision, made here rather than
// left unresolved forever).
//
// Uses Listbox (a custom dropdown), not a native <select> — Markus found
// the native select wasn't opening at all on tap inside this popup on his
// device (see Listbox.jsx for the likely cause). Fully keyboard-chainable:
// focus lands on Von already open when the popup opens; Enter on a
// highlighted option in Von commits it and moves to Nach, already open;
// Enter on Nach's highlighted option commits it and applies, closing back
// to the grid — same as clicking Übernehmen.
const KontoEditor = forwardRef(function KontoEditor(props, ref) {
  const { data, accounts, onApply, api } = props
  const [fromId, setFromId] = useState(data.fromAccountId ?? '')
  const [toId, setToId] = useState(data.toAccountId ?? '')
  const fromRef = useRef(null)
  const toRef = useRef(null)

  // getValue()/isCancelAfterEnd stay in place as a fallback for whatever
  // other way a cell edit might end (tabbing away) — but Übernehmen and
  // the Enter-chain below no longer depend on this pipeline.
  useImperativeHandle(ref, () => ({
    getValue: () => ({ fromAccountId: fromId || null, toAccountId: toId || null }),
    isCancelBeforeStart: () => false,
    // Refuse to commit a transaction with no account at all — that breaks
    // every balance/display computation, which all key off fromAccountId/
    // toAccountId (spec.md §2.6/§2.8).
    isCancelAfterEnd: () => !fromId && !toId,
  }))

  // Focus (and open) Von as soon as this component itself mounts, rather
  // than relying solely on afterGuiAttached — that's bridged through AG
  // Grid's own popup-editor wiring (a promise that resolves once this
  // component's ref is registered), and for a popup editor specifically
  // the timing isn't guaranteed relative to when the portalled content
  // actually commits to the DOM. A plain mount effect is guaranteed by
  // React to run only after this component's own DOM exists, which is
  // what the keyboard chain (Markus's original request) actually depends
  // on — confirmed broken ("still only mouse input") because focus was
  // never reliably landing on Von in the first place.
  useEffect(() => {
    fromRef.current?.focus()
  }, [])

  // Takes an optional override for the just-committed Nach value: when
  // Listbox's Enter-to-apply fires, it calls this synchronously right
  // after its own onChange(setToId) — React state hasn't re-rendered yet
  // at that point, so reading `toId` here would still see the *previous*
  // value. The Listbox passes the id it just committed as this argument
  // specifically to avoid that. The Übernehmen button calls apply() with
  // no argument, where the plain `toId` state is already current.
  const apply = (finalToId) => {
    const to = finalToId !== undefined ? finalToId : toId
    onApply(data, fromId || null, to || null)
    api.stopEditing(true)
  }

  const options = [
    { id: '', name: '– keins –' },
    ...accounts
      .filter((a) => a.tracked !== false && a.group !== 'system')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ id: a.id, name: a.name })),
  ]

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ minWidth: 260 }}
    >
      <label className="text-xs text-[var(--color-text-muted)]">
        Von (Abfluss)
        <Listbox
          ref={fromRef}
          value={fromId}
          onChange={setFromId}
          onEnter={() => toRef.current?.focus()}
          options={options}
          placeholder="– keins –"
        />
      </label>
      <label className="text-xs text-[var(--color-text-muted)]">
        Nach (Zufluss)
        <Listbox ref={toRef} value={toId} onChange={setToId} onEnter={apply} options={options} placeholder="– keins –" />
      </label>
      {/* Explicit Übernehmen/Abbrechen (Markus's request) for mouse/touch
          use — the Enter chain above is the keyboard equivalent of the
          same apply() call, not a separate path. Übernehmen writes
          directly via onApply + closes with api.stopEditing(true) (cancel
          — we've already persisted ourselves) instead of relying on AG
          Grid's own getValue()/stopEditing() commit pipeline, which
          confirmed didn't reliably apply the selection. */}
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
          onClick={() => apply()}
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
