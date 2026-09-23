import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

// A native <input type="date"> commits and closes as soon as a date is
// picked (its own onChange fires the moment the OS picker's "Fertig"/
// "Done" step completes — that step itself is the device's own UI, not
// ours, and not something a web page can skip). What Markus actually ran
// into was a *second*, app-level confirmation on top of that: AG Grid's
// default date editor doesn't stop editing on change by itself, so picking
// a date still needed a further tap elsewhere to commit it into the grid.
// Fixed here by calling stopEditing() the instant the input's value
// changes — one tap (the OS picker's own), not two.
const DateEditor = forwardRef(function DateEditor(props, ref) {
  const { value, stopEditing } = props
  const [date, setDate] = useState(value ?? '')
  const inputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    getValue: () => date,
    isCancelBeforeStart: () => false,
    afterGuiAttached: () => inputRef.current?.focus(),
  }))

  return (
    <input
      ref={inputRef}
      type="date"
      value={date}
      onChange={(e) => {
        setDate(e.target.value)
        // Deferred a tick so the value above is what getValue() reads —
        // stopEditing() reads current React state, and the setState above
        // hasn't necessarily flushed yet at this exact point in the handler.
        setTimeout(() => stopEditing(), 0)
      }}
      className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
    />
  )
})

export default DateEditor
