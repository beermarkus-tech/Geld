import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

// A native <input type="date"> still needs its own OS picker UI confirmed
// (its "Fertig"/"Done" step) — that's the device's own interaction, not
// something a web page can skip. Everything *on top* of that is fixable
// though, and was the actual friction Markus ran into: AG Grid defaults to
// double-click-to-edit (fixed grid-wide in Konten.jsx via singleClickEdit),
// and focusing a date input doesn't itself pop the calendar UI open on most
// platforms — showPicker() below does that immediately instead of needing
// a further manual tap on the input first.
const DateEditor = forwardRef(function DateEditor(props, ref) {
  const { data, value, onApply, api } = props
  const [date, setDate] = useState(value ?? '')
  const inputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    // A plain string value — getValue() is fine here as a fallback path
    // (Escape/blur), unlike Konto/Kategorie's popups where it confirmed
    // unreliable; onChange below is the primary path and bypasses it.
    getValue: () => date,
    isCancelBeforeStart: () => false,
    afterGuiAttached: () => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      // Best-effort: not universally supported, and failing here just
      // means the user taps the input once themselves — no worse than
      // before this existed.
      try {
        el.showPicker?.()
      } catch {
        // ignore
      }
    },
  }))

  return (
    <input
      ref={inputRef}
      type="date"
      value={date}
      onChange={(e) => {
        setDate(e.target.value)
        onApply(data, e.target.value)
        api.stopEditing(true)
      }}
      className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
    />
  )
})

export default DateEditor
