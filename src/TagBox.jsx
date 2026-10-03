import { useEffect, useRef, useState } from 'react'

import TagPill, { listRowClass, typeLook } from './TagPill'

// The one tag box (PLAN.md Phase 5b, step 4 — Oct 2026, Markus): a search
// field, below it the matching tags (pill + usage hint) and, when what you
// typed doesn't exist yet, one "Neu … — Typ" row per type. Same keys
// everywhere:
//   ↓ / ↑    move through the list
//   →        on a parent (an option with `drillText`): the field becomes
//            "Parent: " and the list shows its children
//   Enter    picks the highlighted entry; with nothing highlighted → onEnterNone
//   Esc      first puts the field back to how it started, then closes
// Used by Konten's Tags column (several tags, chips above), Verlauf's "add
// line" box and Verlauf's name editor (rename, or replace with a sibling).
//
// The keys are handled with a native listener on the input, not React's
// onKeyDown: AG Grid's popup editors listen on an ancestor and would act on
// Enter/Esc first otherwise.
//
// Props:
//   startText / resetText   the field's first value / what Esc puts back (default: startText)
//   autoHighlight           highlight the first entry as you type (Konten, add line)
//                           or nothing until ↓ (the name editor: Enter renames)
//   getOptions(text)        → [{ key, tag, label, hint?, separatorBefore?, drillText? }]
//   getCreateTypes(text)    → the "Neu" types to offer (CREATE_TYPES entries), or []
//   onPick(option) / onCreate(text, groupingType) / onEnterNone(text) / onClose()
//   onKey(event, text)      other keys (Backspace, Tab …); return true when handled
//   header / belowInput / footer   extra content (chips, a hint line, buttons)
export default function TagBox({
  startText = '',
  resetText,
  autoHighlight = true,
  selectOnOpen = false,
  getOptions,
  getCreateTypes = () => [],
  onPick,
  onCreate,
  onEnterNone,
  onClose,
  onKey,
  header,
  belowInput,
  footer,
  placeholder = 'Tag suchen…',
  listClassName = 'max-h-48',
}) {
  const first = autoHighlight ? 0 : -1
  const [text, setText] = useState(startText)
  const [highlight, setHighlight] = useState(first)
  const inputRef = useRef(null)

  const options = getOptions(text)
  const createTypes = getCreateTypes(text)
  const total = options.length + createTypes.length
  const shown = Math.min(highlight, total - 1)

  function choose(idx) {
    if (idx < options.length) onPick(options[idx])
    else if (createTypes[idx - options.length]) onCreate(text.trim(), createTypes[idx - options.length].groupingType)
  }

  useEffect(() => {
    const el = inputRef.current
    el?.focus()
    if (selectOnOpen) el?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on open
  }, [])

  const live = useRef({})
  live.current = { text, shown, total, options, choose, onEnterNone, onClose, onKey, reset: resetText ?? startText }
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onKeyDown = (e) => {
      const L = live.current
      const stop = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'ArrowDown') {
        stop()
        setHighlight(Math.min(L.total - 1, L.shown + 1))
      } else if (e.key === 'ArrowUp') {
        stop()
        setHighlight(Math.max(first, L.shown - 1))
      } else if (e.key === 'Enter') {
        stop()
        if (L.shown >= 0 && L.shown < L.total) L.choose(L.shown)
        else L.onEnterNone?.(L.text)
      } else if (e.key === 'ArrowRight' && L.options[L.shown]?.drillText && el.selectionStart === L.text.length) {
        // → on a highlighted parent opens it: the field becomes "Parent: " and
        // the list shows its children (Oct 2026, Markus).
        stop()
        setText(L.options[L.shown].drillText)
        setHighlight(first)
      } else if (e.key === 'Escape') {
        stop()
        if (L.text !== L.reset) {
          setText(L.reset)
          setHighlight(first)
        } else L.onClose?.()
      } else if (L.onKey?.(e, L.text)) {
        stop()
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads everything through `live`
  }, [])

  return (
    <>
      {header}
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setHighlight(first)
        }}
        placeholder={placeholder}
        aria-label="Tag"
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
      />
      {belowInput}
      {total > 0 && (
        <ul role="listbox" className={`${listClassName} overflow-auto rounded border border-[var(--color-border)] text-sm`}>
          {options.map((o, idx) => (
            <li key={o.key}>
              {o.separatorBefore && <hr className="border-[var(--color-border)]" />}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault() // keep the keyboard in the field
                  choose(idx)
                }}
                className={listRowClass(idx === shown)}
              >
                <span className="min-w-0 flex-1">
                  <TagPill tag={o.tag}>{o.label}</TagPill>
                </span>
                {o.hint && <span className="shrink-0 text-xs text-[var(--color-text-muted)]">{o.hint}</span>}
                {o.drillText && (
                  <span className="shrink-0 text-xs text-[var(--color-text-muted)]" title="→ zeigt die Untertags">
                    ›
                  </span>
                )}
              </button>
            </li>
          ))}
          {createTypes.map((opt, i) => {
            const idx = options.length + i
            return (
              <li key={opt.groupingType ?? 'none'}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(idx)
                  }}
                  className={listRowClass(idx === shown)}
                >
                  <span className="text-xs text-[var(--color-text-muted)]">Neu</span>
                  <TagPill tag={typeLook(opt.groupingType)}>{text.trim()}</TagPill>
                  <span className="text-xs text-[var(--color-text-muted)]">— {opt.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {footer}
    </>
  )
}

