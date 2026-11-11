import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// The Konto cell editor (spec.md §3a) — redesigned Nov 2026 (Markus: "unintuitive"): two lists
// side by side, always visible. Left = Von (the account the money leaves), right = Nach (the
// account it arrives on). Whatever the booking already has is pre-selected in its list, so a
// one-sided booking shows "– keins –" on the other side. Pick one entry in each list, then
// Übernehmen (or Enter). Buttons sit on top (Nov 2026: nothing can cover them).
//
// Keyboard: Up/Down move the selection in the focused list, Left/Right jump to the other list,
// typing letters jumps to the first account starting with them, Enter applies, Esc cancels.

function AccountList({ label, value, options, onChange, onEnter, listRef, otherRef }) {
  const typed = useRef({ text: '', at: 0 })
  // keep the selected entry in view (long lists scroll)
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [value, listRef])

  const move = (delta) => {
    const i = options.findIndex((o) => o.id === value)
    const next = options[Math.min(options.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))]
    if (next) onChange(next.id)
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') otherRef.current?.focus()
    else if (e.key === 'Enter') onEnter()
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const hit = options.find((o) => o.id && o.name.toLowerCase().startsWith(typed.current.text))
      if (hit) onChange(hit.id)
    } else return
    e.preventDefault()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-text-muted)]">{label}</span>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="flex max-h-60 min-h-0 flex-col overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] py-0.5 focus:border-[var(--color-computed)] focus:outline-none"
      >
        {options.map((o) => {
          const selected = o.id === value
          return (
            <button
              key={o.id || 'none'}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onClick={() => onChange(o.id)}
              className={
                'shrink-0 truncate px-2 py-1 text-left text-sm ' +
                (selected
                  ? 'bg-[var(--color-computed)] font-medium text-white'
                  : o.id
                    ? 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]')
              }
            >
              {o.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const KontoEditor = forwardRef(function KontoEditor(props, ref) {
  const { data, accounts, onApply, api } = props
  const [fromId, setFromId] = useState(data.fromAccountId ?? '')
  const [toId, setToId] = useState(data.toAccountId ?? '')
  const fromRef = useRef(null)
  const toRef = useRef(null)

  // getValue()/isCancelAfterEnd stay in place as a fallback for whatever other way a cell edit
  // might end (tabbing away) — but Übernehmen and Enter no longer depend on this pipeline.
  useImperativeHandle(ref, () => ({
    getValue: () => ({ fromAccountId: fromId || null, toAccountId: toId || null }),
    isCancelBeforeStart: () => false,
    // Refuse to commit a transaction with no account at all — that breaks every
    // balance/display computation (spec.md §2.6/§2.8).
    isCancelAfterEnd: () => !fromId && !toId,
  }))

  // Focus the Von list once the popup exists (afterGuiAttached's timing through AG Grid's popup
  // bridge is not guaranteed, a mount effect is).
  useEffect(() => {
    fromRef.current?.focus()
  }, [])

  // Escape cancels outright (capture phase: runs before AG Grid's own popup key handling).
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

  // Writes directly via onApply and closes (the grid's own commit pipeline proved unreliable for
  // popup editors, see Konten.jsx). No booking without any account.
  const apply = () => {
    if (!fromId && !toId) return
    onApply(data, fromId || null, toId || null)
    api.stopEditing(true)
  }

  const listOf = (keep) => [
    { id: '', name: '– keins –' },
    ...accounts
      .filter(keep)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ id: a.id, name: a.name })),
  ]
  // The opening-balance account Jahresabschluß (group 'system') is offered as a source (Von)
  // only — opening balances flow out of it (Oct 2026, Markus), never into it.
  const fromOptions = listOf((a) => a.tracked !== false)
  const toOptions = listOf((a) => a.tracked !== false && a.group !== 'system')

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ width: 440, maxWidth: '95vw' }}
    >
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => api.stopEditing(true)} className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)]">
          Abbrechen
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!fromId && !toId}
          className="rounded bg-[var(--color-computed)] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Übernehmen
        </button>
      </div>
      <div className="flex gap-3">
        <AccountList label="Von (Abfluss)" value={fromId} options={fromOptions} onChange={setFromId} onEnter={apply} listRef={fromRef} otherRef={toRef} />
        <AccountList label="Nach (Zufluss)" value={toId} options={toOptions} onChange={setToId} onEnter={apply} listRef={toRef} otherRef={fromRef} />
      </div>
    </div>
  )
})

export default KontoEditor
