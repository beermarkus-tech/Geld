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
  const { data, accounts, filteredAccountId, onApply, api } = props
  const [fromId, setFromId] = useState(data.fromAccountId ?? '')
  const [toId, setToId] = useState(data.toAccountId ?? '')
  const fromRef = useRef(null)
  const toRef = useRef(null)

  // Simplified single-dropdown mode while an account filter is active
  // (Markus): every row visible under a filter already has the filtered
  // account on one side or the other (`rows` itself is filtered that way,
  // Konten.jsx; a brand-new row created while filtered starts with it
  // pre-filled too) — so re-picking *both* sides is redundant work, only
  // the counterpart ("Gegenkonto," the grid header's own name for it
  // under a filter) is ever actually in question. Fixed side stays
  // exactly as it already was; not itself editable from here — if the
  // filtered side genuinely needs to change, that's what "Alle Konten"
  // is for. Falls back to the ordinary two-picker layout if neither side
  // happens to match yet (shouldn't occur in practice, but a real blank
  // slate is still handled rather than assumed away).
  const fixedSide = !filteredAccountId
    ? null
    : data.fromAccountId === filteredAccountId
      ? 'from'
      : data.toAccountId === filteredAccountId
        ? 'to'
        : null

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

  // Focus (and open) the first *editable* field as soon as this component
  // itself mounts, rather than relying solely on afterGuiAttached — that's
  // bridged through AG Grid's own popup-editor wiring (a promise that
  // resolves once this component's ref is registered), and for a popup
  // editor specifically the timing isn't guaranteed relative to when the
  // portalled content actually commits to the DOM. A plain mount effect is
  // guaranteed by React to run only after this component's own DOM
  // exists, which is what the keyboard chain (Markus's original request)
  // actually depends on — confirmed broken ("still only mouse input")
  // because focus was never reliably landing on Von in the first place.
  // In simplified single-dropdown mode the fixed side has no Listbox to
  // focus at all, so this always lands on whichever ref actually exists.
  useEffect(() => {
    ;(fixedSide === 'from' ? toRef : fromRef).current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only ever meant to run once, on mount
  }, [])

  // Escape cancels outright, discarding whatever's mid-edit (Markus) —
  // capture phase, not a plain React onKeyDown, for the same reason
  // Listbox.jsx's own native listener exists (its own long comment has the
  // full explanation): AG Grid's PopupEditorWrapper attaches a native
  // keydown listener on the popup wrapper itself, and a Listbox nested
  // inside this editor *also* claims Escape natively while its own list is
  // open (to close just that list, one layer at a time) — capture phase
  // runs before either of those, so this always gets first refusal and a
  // single Escape closes the whole popup immediately, not just whichever
  // Listbox happened to still be open.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      api.stopEditing(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [api])

  // Takes an optional override for whichever field's Listbox just
  // committed via Enter: its own onChange (setFromId/setToId) fires
  // synchronously right before this, and React state hasn't re-rendered
  // yet at that point, so reading fromId/toId directly here would still
  // see the *previous* value. Each Listbox passes the id it just
  // committed as the matching override specifically to avoid that. The
  // Übernehmen button calls apply() with no overrides, where the plain
  // fromId/toId state is already current.
  const apply = ({ fromId: fromOverride, toId: toOverride } = {}) => {
    const from = fromOverride !== undefined ? fromOverride : fromId
    const to = toOverride !== undefined ? toOverride : toId
    onApply(data, from || null, to || null)
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
  const filteredAccountName = accounts.find((a) => a.id === filteredAccountId)?.name ?? filteredAccountId

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ minWidth: 260 }}
    >
      {fixedSide === 'from' && (
        <div className="text-xs text-[var(--color-text-muted)]">
          Von (Abfluss): <span className="text-[var(--color-text)]">{filteredAccountName}</span> (Filter)
        </div>
      )}
      {fixedSide !== 'from' && (
        <label className="text-xs text-[var(--color-text-muted)]">
          Von (Abfluss)
          <Listbox
            ref={fromRef}
            value={fromId}
            onChange={setFromId}
            // Two genuinely different cases: the full layout (fixedSide
            // null) chains onward to Nach, same as always. Simplified mode
            // with Nach fixed (fixedSide 'to') has no Nach field to chain
            // to at all — Von is the *only* field on screen, so Enter here
            // has to apply and close directly instead, same "single field,
            // Enter closes" convention TagEditor's own redesign
            // established.
            onEnter={fixedSide === 'to' ? (id) => apply({ fromId: id }) : () => toRef.current?.focus()}
            options={options}
            placeholder="– keins –"
          />
        </label>
      )}
      {fixedSide === 'to' && (
        <div className="text-xs text-[var(--color-text-muted)]">
          Nach (Zufluss): <span className="text-[var(--color-text)]">{filteredAccountName}</span> (Filter)
        </div>
      )}
      {fixedSide !== 'to' && (
        <label className="text-xs text-[var(--color-text-muted)]">
          Nach (Zufluss)
          <Listbox
            ref={toRef}
            value={toId}
            onChange={setToId}
            // The last field either way — full layout (chained from Von)
            // or simplified with Von fixed — so Enter here always applies
            // and closes.
            onEnter={(id) => apply({ toId: id })}
            options={options}
            placeholder="– keins –"
          />
        </label>
      )}
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
