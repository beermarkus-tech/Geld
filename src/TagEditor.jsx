import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { tagColorVar } from './lib/tagStyle'

function slugify(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tag'
  )
}

// The real inline tag mechanism (spec.md §2.5) — replaces the earlier
// plain comma-separated-text placeholder. Multi-select autocomplete: type
// to filter existing tags, Enter/click to add one as a removable chip,
// "Tag '<text>' erstellen" when nothing matches (grouping-class tags only
// — allocation tags are fixed/pre-seeded, never created here, per spec's
// "a deliberate Settings-area action" note). New tags default to
// `groupingType: null` (spec's own "unspecified" state, shown same gray
// as statement) — there's no UI here to pick project/statement/claim/
// claim-category at creation time; logged in DEVLOG as a real open
// question, not guessed at silently.
//
// **Backward compatibility with pre-existing free-text tags:** every tag
// entered before this mechanism existed is a raw string, not a real tag
// id — Konten.jsx's old placeholder editor just split comma-separated
// text with no id/collection behind it at all. Those still show up here
// as plain dashed-border chips (their literal text, unresolved) rather
// than being silently upgraded into real tag documents — upgrading them
// automatically, unsupervised, risked creating near-duplicate tags from
// typos with no one watching. They stay fully editable/removable; turning
// one into a real tracked tag is a deliberate re-add (remove the old
// chip, retype the same text, either pick the real tag if one already
// matches by name or create it).
const TagEditor = forwardRef(function TagEditor(props, ref) {
  const { data, tags, initialTagIds = [], onApply, onCreateTag, api } = props
  const [selectedIds, setSelectedIds] = useState(initialTagIds)
  const [inputText, setInputText] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    getValue: () => ({ tagIds: selectedIds }),
    isCancelBeforeStart: () => false,
  }))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const selectedTags = selectedIds.map((id) => tags.find((t) => t.id === id)).filter(Boolean)
  const legacyRaw = selectedIds.filter((id) => !tags.some((t) => t.id === id))

  // claim-category tags are only ever offered once a claim tag already
  // sits on this same line (spec.md §2.5's UI sequencing rule — Meal/Taxi
  // aren't meaningful outside some specific trip/claim context).
  const hasClaimTag = selectedIds.some((id) => tags.find((t) => t.id === id)?.groupingType === 'claim')

  const suggestions = useMemo(() => {
    const text = inputText.trim().toLowerCase()
    return tags
      .filter((t) => !t.archived)
      .filter((t) => !selectedIds.includes(t.id))
      .filter((t) => t.groupingType !== 'claim-category' || hasClaimTag)
      .filter((t) => text === '' || t.name.toLowerCase().includes(text))
      .slice(0, 25)
  }, [tags, selectedIds, inputText, hasClaimTag])

  const canCreate =
    inputText.trim() !== '' && !tags.some((t) => t.name.toLowerCase() === inputText.trim().toLowerCase())
  const optionCount = suggestions.length + (canCreate ? 1 : 0)

  function selectSuggestion(idx) {
    if (idx < suggestions.length) {
      setSelectedIds((prev) => [...prev, suggestions[idx].id])
    } else if (canCreate) {
      setSelectedIds((prev) => [...prev, onCreateTag(inputText.trim())])
    }
    setInputText('')
    setHighlight(0)
  }

  function removeChip(id) {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }

  // Writes directly via onApply, same established reason as Konto/
  // Category's own Übernehmen (Konten.jsx): AG Grid's own getValue()/
  // valueSetter commit pipeline confirmed unreliable for those, so this
  // follows the same direct-write-then-stopEditing(true) pattern rather
  // than depending on it here either. The valueSetter fallback still
  // exists in Konten.jsx's Tags column def for whatever other way an edit
  // might end (e.g. blur), same as Konto/Category.
  function apply() {
    onApply(data, selectedIds)
    api.stopEditing(true)
  }

  // Native listener on the input itself, not a React onKeyDown prop — the
  // exact race Listbox.jsx already found and fixed once (see its own long
  // comment there): AG Grid's PopupEditorWrapper attaches a plain native
  // keydown listener on the popup wrapper, a real DOM ancestor of this
  // input, and still acts on Enter/Escape itself mid-edit before React's
  // own synthetic dispatch would ever reach a plain onKeyDown prop here.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setHighlight((i) => Math.min(optionCount - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setHighlight((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        // Empty input + Enter finishes and closes (same "final Enter
        // closes the popup" convention as Kategorie/Unterkategorie's own
        // chain) — typing/selecting several tags in one sitting doesn't
        // close after each one, only this does.
        if (inputText === '') apply()
        else if (optionCount > 0) selectSuggestion(highlight)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (inputText !== '') setInputText('')
        else api.stopEditing(true)
      } else if (e.key === 'Backspace' && inputText === '' && selectedIds.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIds((prev) => prev.slice(0, -1))
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [inputText, highlight, optionCount, suggestions, canCreate, selectedIds])

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ minWidth: 280 }}
    >
      <div className="flex flex-wrap gap-1">
        {selectedTags.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{
              color: `var(${tagColorVar(t)})`,
              backgroundColor: `color-mix(in srgb, var(${tagColorVar(t)}) 15%, transparent)`,
            }}
          >
            {t.name}
            <button type="button" onClick={() => removeChip(t.id)} className="leading-none">
              ×
            </button>
          </span>
        ))}
        {legacyRaw.map((raw) => (
          <span
            key={raw}
            title="Alter Freitext-Tag — noch nicht mit einem echten Tag verknüpft"
            className="flex items-center gap-1 rounded-full border border-dashed border-[var(--color-text-muted)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
          >
            {raw}
            <button type="button" onClick={() => removeChip(raw)} className="leading-none">
              ×
            </button>
          </span>
        ))}
        {selectedTags.length === 0 && legacyRaw.length === 0 && (
          <span className="text-xs text-[var(--color-text-muted)]">Keine Tags</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputText}
        onChange={(e) => {
          setInputText(e.target.value)
          setHighlight(0)
        }}
        placeholder="Tag suchen oder neu erstellen…"
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
      />
      {(suggestions.length > 0 || canCreate) && (
        <ul className="max-h-48 overflow-auto rounded border border-[var(--color-border)] text-sm">
          {suggestions.map((t, idx) => (
            <li key={t.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectSuggestion(idx)
                }}
                className={
                  'flex w-full items-center gap-2 px-2 py-1 text-left ' +
                  (idx === highlight ? 'bg-[var(--color-computed)] text-white' : 'hover:bg-[var(--color-bg)]')
                }
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(${tagColorVar(t)})` }} />
                {t.name}
              </button>
            </li>
          ))}
          {canCreate && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectSuggestion(suggestions.length)
                }}
                className={
                  'block w-full px-2 py-1 text-left italic ' +
                  (suggestions.length === highlight ? 'bg-[var(--color-computed)] text-white' : 'hover:bg-[var(--color-bg)]')
                }
              >
                Tag „{inputText.trim()}“ erstellen
              </button>
            </li>
          )}
        </ul>
      )}
      {/* Explicit Übernehmen/Abbrechen (same convention as Konto/Category) —
          Abbrechen uses stopEditing(true) same as apply() does, not because
          it's "cancelling an apply" but because AG Grid's own true meaning
          for that argument is cancel, and skipping the fallback commit
          pipeline here matters most exactly when the user meant to discard
          whatever they were mid-typing. */}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={() => api.stopEditing(true)} className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)]">
          Abbrechen
        </button>
        <button type="button" onClick={apply} className="rounded bg-[var(--color-computed)] px-2 py-1 text-xs font-medium text-white">
          Übernehmen
        </button>
      </div>
    </div>
  )
})

export default TagEditor
export { slugify }
