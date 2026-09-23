import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

// A custom-rendered dropdown, not a native <select> (Markus: the native
// select inside KontoEditor/CategoryEditor's popups wasn't opening at all
// on tap on his device — very likely a stacking/rendering conflict between
// a native form control's own OS-level popup and AG Grid's own popup
// positioning, which typically applies a CSS transform to position itself;
// some platforms don't render a native select's dropdown correctly inside
// a transformed ancestor. Building it ourselves sidesteps that class of
// problem entirely instead of chasing the exact cause).
//
// Also what makes the full keyboard chain (KontoEditor/CategoryEditor)
// actually match what Markus originally described: focusing this via the
// exposed focus() opens the list immediately, arrow keys move a highlight
// within it, and Enter both commits the highlighted option *and* signals
// the parent to advance — none of which needs the browser to visually pop
// anything open on its own.
//
// `options` is [{id, name}, ...] — an empty/placeholder choice, if wanted,
// is just an ordinary entry with id: '' (no special-cased handling here).
const Listbox = forwardRef(function Listbox({ value, onChange, onEnter, options, disabled, placeholder }, ref) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const buttonRef = useRef(null)

  const selected = options.find((o) => o.id === value)

  function openList() {
    if (disabled) return
    const idx = options.findIndex((o) => o.id === value)
    setHighlight(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  useImperativeHandle(ref, () => ({
    // Focusing this editor also opens it — the point of building this at
    // all was to have the list ready to arrow through immediately.
    focus: () => {
      buttonRef.current?.focus()
      openList()
    },
  }))

  function commit(idx) {
    const opt = options[idx]
    if (!opt) return
    onChange(opt.id)
    setOpen(false)
    onEnter?.(opt.id)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (disabled) return
          if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
              e.preventDefault()
              openList()
            }
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((i) => Math.min(options.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            commit(highlight)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
          }
        }}
        className="mt-0.5 flex w-full items-center justify-between gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-left text-sm disabled:opacity-50"
      >
        <span className={selected ? undefined : 'text-[var(--color-text-muted)]'}>
          {selected ? selected.name : placeholder}
        </span>
        <span className="text-[var(--color-text-muted)]">▾</span>
      </button>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-sm shadow-lg">
          {options.map((o, idx) => (
            <li key={o.id || '(leer)'}>
              <button
                type="button"
                // mousedown, not click, with preventDefault: stops the
                // button above from ever blurring before the selection is
                // read, the standard fix for a custom listbox's options
                // disappearing/misfiring on the click that was meant to
                // choose one.
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(idx)
                }}
                className={
                  'block w-full px-2 py-1 text-left ' +
                  (idx === highlight ? 'bg-[var(--color-computed)] text-white' : 'hover:bg-[var(--color-bg)]')
                }
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

export default Listbox
