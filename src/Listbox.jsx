import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

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
  const listRef = useRef(null)

  const selected = options.find((o) => o.id === value)

  // Keeps the highlighted option in view as arrow keys move past the
  // visible scroll window — without this, arrowing down past the list's
  // own max-height moved the highlight but left it scrolled out of sight
  // (Markus: "the cursor is not visible on screen for entries below the
  // drop down size").
  useEffect(() => {
    if (!open) return
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

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
              e.stopPropagation()
              openList()
            }
            return
          }
          // stopPropagation, not just preventDefault, on every key handled
          // here: AG Grid attaches its own native Enter/Escape/Tab handling
          // at the popup-editor-wrapper level (the same mechanism that
          // makes its own built-in popup editors work), and this button —
          // though rendered via a React portal — is still a genuine DOM
          // descendant of that wrapper, so the raw keydown keeps bubbling
          // to it unless stopped explicitly. Without this, Enter both
          // committed our selection *and* triggered AG Grid's own
          // stop-editing, tearing the whole popup down before the chain
          // (or even the just-set value) could take effect (Markus: "hitting
          // enter just closes the modal without any change applied").
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            e.stopPropagation()
            setHighlight((i) => Math.min(options.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            setHighlight((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            commit(highlight)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
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
        <ul
          ref={listRef}
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-sm shadow-lg"
        >
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
