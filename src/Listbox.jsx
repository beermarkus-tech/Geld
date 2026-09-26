import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

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
//
// `searchable` (Markus: "i need a quick search bar inside the category
// selection modal, same as in the tag selection modal") opts a given
// Listbox into a text filter at the top of its own dropdown — off by
// default, so KontoEditor's plain account pickers are unaffected. When on,
// focusing this via the exposed focus() lands keyboard input in the search
// box instead of the button (the box doesn't exist in the DOM until the
// list actually renders open, so that focus happens in an effect once it
// does, not synchronously inside focus() itself); arrow/Enter/Escape all
// operate on the filtered list, not the full one. `selected`'s own display
// name always reads the full, unfiltered `options`, regardless of whatever
// search text happens to be typed at the time.
const Listbox = forwardRef(function Listbox({ value, onChange, onEnter, options, disabled, placeholder, searchable = false }, ref) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [searchText, setSearchText] = useState('')
  const buttonRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selected = options.find((o) => o.id === value)

  const visibleOptions = useMemo(() => {
    if (!searchable || searchText.trim() === '') return options
    const text = searchText.trim().toLowerCase()
    return options.filter((o) => o.name.toLowerCase().includes(text))
  }, [options, searchable, searchText])

  // Keeps the highlighted option in view as arrow keys move past the
  // visible scroll window — without this, arrowing down past the list's
  // own max-height moved the highlight but left it scrolled out of sight
  // (Markus: "the cursor is not visible on screen for entries below the
  // drop down size").
  useEffect(() => {
    if (!open) return
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  // The search input only exists once `open` is actually true and this
  // component has re-rendered with it — a synchronous focus() call right
  // when opening (inside openList() below) would run before that DOM node
  // exists at all.
  useEffect(() => {
    if (open && searchable) inputRef.current?.focus()
  }, [open, searchable])

  function openList() {
    if (disabled) return
    const idx = options.findIndex((o) => o.id === value)
    setHighlight(idx >= 0 ? idx : 0)
    setSearchText('')
    setOpen(true)
  }

  useImperativeHandle(ref, () => ({
    // Focusing this editor also opens it — the point of building this at
    // all was to have the list ready to arrow through immediately. A
    // searchable Listbox focuses the search box instead (via the effect
    // above), once it exists.
    focus: () => {
      if (!searchable) buttonRef.current?.focus()
      openList()
    },
  }))

  function commit(idx) {
    const opt = visibleOptions[idx]
    if (!opt) return
    onChange(opt.id)
    setOpen(false)
    onEnter?.(opt.id)
  }

  // A *native* listener, attached directly to our own button (or, when
  // searchable, the search input instead — whichever one keyboard focus
  // actually lands on) — not React's onKeyDown, and stopPropagation()
  // called from within a React handler isn't enough either. AG Grid's own
  // PopupEditorWrapper (its core, not React) attaches a plain native
  // keydown listener directly on the popup wrapper element our content is
  // portalled into, which is a genuine DOM ancestor of this button. React
  // 17+ attaches only one listener of its own, at the app's root
  // container, and simulates the rest of the bubble internally from
  // there — so the raw event reaches AG Grid's closer, native ancestor
  // listener and gets acted on (stopping the edit, tearing down the whole
  // popup) *before* React's own synthetic dispatch ever reaches this
  // component's handler at all. No stopPropagation() called from inside a
  // React handler can undo something an ancestor's native listener already
  // did first — the only fix is a native listener of our own, on the
  // element itself, which runs at the true target phase and gets first
  // refusal on the event.
  //
  // (Arrow keys already worked via the old React onKeyDown: AG Grid
  // explicitly skips its own navigation-key handling while a cell is being
  // edited, so nothing ever raced ahead of them — only Enter/Escape, which
  // AG Grid deliberately still acts on mid-edit to commit/cancel, needed
  // this fix.)
  useEffect(() => {
    const el = searchable ? inputRef.current : buttonRef.current
    if (!el || disabled) return
    const onKeyDown = (e) => {
      if (!open) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          openList()
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setHighlight((i) => Math.min(visibleOptions.length - 1, i + 1))
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
        // Search text first, same convention as TagEditor's own Escape
        // handling — only an already-empty search closes *this* list.
        if (searchable && searchText !== '') setSearchText('')
        else setOpen(false)
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [disabled, open, highlight, visibleOptions, value, onChange, onEnter, searchable, searchText])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        className="mt-0.5 flex w-full items-center justify-between gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-left text-sm disabled:opacity-50"
      >
        <span className={selected ? undefined : 'text-[var(--color-text-muted)]'}>
          {selected ? selected.name : placeholder}
        </span>
        <span className="text-[var(--color-text-muted)]">▾</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {searchable && (
            <input
              ref={inputRef}
              type="text"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value)
                setHighlight(0)
              }}
              placeholder="Suchen…"
              className="w-full border-b border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
            />
          )}
          <ul ref={listRef} className="max-h-48 overflow-auto text-sm">
            {visibleOptions.map((o, idx) => (
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
        </div>
      )}
    </div>
  )
})

export default Listbox
