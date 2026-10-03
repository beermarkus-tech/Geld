import { useEffect, useMemo, useRef, useState } from 'react'
import { useGridFilter } from 'ag-grid-react'

import { confirmedModel, quickFilterPasses, quickItems, suggestionsFor } from './lib/quickFilter'

// Konten's column filter (Oct 2026, Markus): one search field with a list of
// quick results below it — the distinct values of this column that contain
// what you typed (and that pass the *other* column filters). Nothing is
// filtered while you type; the table changes when you confirm.
//
//   Down / Up   move through the list          Space  tick / untick the entry (✓)
//   Esc         list → back to the search field; in the field → close, nothing changed
//   Enter       ticked entries → filter to them; none ticked but one highlighted →
//               that entry; otherwise the typed text as "contains"; empty → clear
//
// The keys are handled with a native listener on the input (not React's
// onKeyDown): AG Grid's own popup closes on Escape/Enter with a native listener
// on an ancestor element, which would run first and close the popup.
// Model shapes: lib/quickFilter.js.
export default function QuickFilter({ model, onModelChange, getValue, column, api, doesRowPassOtherFilter }) {
  const colId = column.getColId()
  const [text, setText] = useState(model?.filterType === 'text' && model.type === 'contains' ? String(model.filter ?? '') : '')
  const [ticked, setTicked] = useState(() => (model?.filterType === 'values' ? [...model.values] : []))
  const [highlight, setHighlight] = useState(-1)
  const [candidates, setCandidates] = useState([])
  const inputRef = useRef(null)

  const modelRef = useRef(model)
  modelRef.current = model
  function collectCandidates() {
    const out = []
    api.forEachNode((node) => {
      if (!node.data || !doesRowPassOtherFilter(node)) return
      out.push(...quickItems(colId, String(getValue(node) ?? '')))
    })
    setCandidates(out)
  }

  useGridFilter({
    doesFilterPass: ({ node }) => {
      const m = modelRef.current
      if (!m) return true
      const value = String(getValue(node) ?? '')
      return quickFilterPasses(m, value, quickItems(colId, value))
    },
    afterGuiAttached: () => {
      // Opened (again): start from the filter as it currently is.
      const m = modelRef.current
      setText(m?.filterType === 'text' && m.type === 'contains' ? String(m.filter ?? '') : '')
      setTicked(m?.filterType === 'values' ? [...m.values] : [])
      setHighlight(-1)
      collectCandidates()
      inputRef.current?.focus()
    },
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount; afterGuiAttached refreshes it on every opening
  useEffect(collectCandidates, [])

  const { items, more } = useMemo(() => suggestionsFor(candidates, text), [candidates, text])

  // Latest state for the native key listener below.
  const live = useRef({})
  live.current = { text, ticked, highlight, items }

  function close() {
    const focused = api.getFocusedCell()
    api.hideColumnFilter()
    // Put the grid cursor back where it was (the popup took the keyboard).
    if (focused) setTimeout(() => api.setFocusedCell(focused.rowIndex, focused.column), 0)
  }
  function confirm() {
    const { text: t, ticked: tk, highlight: h, items: its } = live.current
    onModelChange(confirmedModel({ ticked: tk, highlighted: h >= 0 ? its[h] : null, text: t }))
    close()
  }
  function toggle(item) {
    setTicked((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]))
  }

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onKeyDown = (e) => {
      const { highlight: h, items: its } = live.current
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        if (its.length > 0) setHighlight(Math.min(its.length - 1, h + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setHighlight(Math.max(-1, h - 1))
      } else if (e.key === ' ' && h >= 0) {
        e.preventDefault()
        e.stopPropagation()
        toggle(its[h])
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (h >= 0) setHighlight(-1)
        else close()
      } else if (h >= 0 && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setHighlight(-1) // typing returns to the search field
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads everything through refs / stable helpers
  }, [])

  useEffect(() => {
    document.getElementById(`qf-${colId}-${highlight}`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, colId])

  return (
    <div data-quick-filter className="flex w-72 flex-col gap-2 bg-[var(--color-surface)] p-2 text-sm text-[var(--color-text)]">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setHighlight(-1)
        }}
        placeholder="Suchen…"
        aria-label="Spalte durchsuchen"
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
      />
      {items.length > 0 && (
        <ul role="listbox" aria-multiselectable="true" className="max-h-60 overflow-y-auto rounded-md border border-[var(--color-border)]">
          {items.map((it, i) => (
            <li
              key={it}
              id={`qf-${colId}-${i}`}
              role="option"
              aria-selected={ticked.includes(it)}
              onMouseDown={(e) => {
                e.preventDefault() // keep the keyboard in the search field
                toggle(it)
                setHighlight(i)
              }}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1 ${i === highlight ? 'bg-[var(--color-computed)] text-white' : 'hover:bg-[var(--color-bg)]'}`}
            >
              <span className="w-4 shrink-0 text-center">{ticked.includes(it) ? '✓' : ''}</span>
              <span className="min-w-0 truncate">{it}</span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <div className="text-xs text-[var(--color-text-muted)]">… {more} weitere — Suche eingrenzen</div>}
      {ticked.length > 0 && <div className="text-xs text-[var(--color-text-muted)]">{ticked.length} ausgewählt</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onModelChange(null)
            close()
          }}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs"
        >
          Zurücksetzen
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={confirm} className="rounded-md bg-[var(--color-computed)] px-3 py-1 text-xs font-medium text-white">
          Übernehmen
        </button>
      </div>
    </div>
  )
}
