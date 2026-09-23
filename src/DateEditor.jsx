import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Three plain <select>s (Tag/Monat/Jahr), not a native <input type="date">
// — Markus: the date field needed two taps (one to focus, one more to
// actually open the calendar overlay) where Konto/Kategorie's popups only
// needed one. The real difference: a native <select> always opens on a
// single tap, guaranteed, everywhere; a native date input's calendar
// overlay needs an explicit showPicker() call to open without a second
// tap, and that call's reliability (particularly its "was this triggered
// by a real user gesture" requirement) turned out not to hold up in
// practice. Matching Konto/Kategorie's own mechanism sidesteps that
// entirely instead of chasing it further.
//
// Fully keyboard-chainable, same pattern as the other two editors: focus
// lands on Tag when the popup opens; arrow keys cycle each select's value
// directly; Enter advances Tag → Monat → Jahr, and Enter on Jahr applies
// and returns focus to the grid cell.
const DateEditor = forwardRef(function DateEditor(props, ref) {
  const { data, value, onApply, api } = props
  const [existingYear, existingMonth, existingDay] = (value || '').split('-').map(Number)
  const today = new Date()

  const [year, setYear] = useState(existingYear || today.getFullYear())
  const [month, setMonth] = useState(existingMonth || today.getMonth() + 1)
  const [day, setDay] = useState(existingDay || today.getDate())
  const dayRef = useRef(null)
  const monthRef = useRef(null)
  const yearRef = useRef(null)

  const maxDay = daysInMonth(year, month)
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay])
  // A generous real-entry range, not just "this year" — historical
  // corrections and early entries for a year just starting both happen.
  const years = useMemo(() => {
    const base = today.getFullYear()
    return Array.from({ length: 8 }, (_, i) => base - 5 + i)
  }, [])

  const dateString = () => `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`

  useImperativeHandle(ref, () => ({
    getValue: () => dateString(),
    isCancelBeforeStart: () => false,
    afterGuiAttached: () => dayRef.current?.focus(),
  }))

  const apply = () => {
    onApply(data, dateString())
    api.stopEditing(true)
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ minWidth: 260 }}
    >
      <div className="flex gap-1">
        <select
          ref={dayRef}
          value={Math.min(day, maxDay)}
          onChange={(e) => setDay(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            monthRef.current?.focus()
          }}
          className="w-1/3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-sm"
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          ref={monthRef}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            yearRef.current?.focus()
          }}
          className="w-1/3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-sm"
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          ref={yearRef}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            apply()
          }}
          className="w-1/3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-sm"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {/* Explicit Übernehmen/Abbrechen for mouse/touch use — the Enter
          chain above is the keyboard equivalent of the same apply() call. */}
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
          onClick={apply}
          className="rounded bg-[var(--color-computed)] px-2 py-1 text-xs font-medium text-white"
        >
          Übernehmen
        </button>
      </div>
    </div>
  )
})

export default DateEditor
