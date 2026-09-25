import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { qualifiedTagName, tagColorVar } from './lib/tagStyle'

// German umlauts/ß transliterated before stripping everything else
// non-alphanumeric — most tag names here are German (Schottland, Käse-
// style words are routine), and collapsing "ä" etc. straight to a dash
// produced ugly, hard-to-read ids (caught: "Fähre" -> "f-hre").
function slugify(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tag'
  )
}

// A tag chip, colored when its type is determined (allocation, or a
// grouping tag with a real groupingType) and a plain neutral dashed
// outline otherwise — covers both a genuine unspecified grouping tag and
// an unresolved legacy free-text string (no `tag` object at all) with the
// exact same look, on purpose: from the user's side, "not yet categorized"
// and "not a real tracked tag at all" read the same until proven
// otherwise (Markus, real-usage feedback — a colored fill on a brand new
// unspecified tag looked inconsistent with how an old free-text tag
// already rendered next to it).
function Chip({ label, colorVar, onRemove, title }) {
  return (
    <span
      title={title}
      className={
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ' +
        (colorVar ? '' : 'border border-dashed border-[var(--color-text-muted)] text-[var(--color-text-muted)]')
      }
      style={
        colorVar
          ? { color: `var(${colorVar})`, backgroundColor: `color-mix(in srgb, var(${colorVar}) 15%, transparent)` }
          : undefined
      }
    >
      {label}
      <button type="button" onClick={onRemove} className="leading-none">
        ×
      </button>
    </span>
  )
}

// The real inline tag mechanism (spec.md §2.5) — replaces the earlier
// plain comma-separated-text placeholder. Multi-select autocomplete: type
// to filter existing tags, Enter/click to add one as a removable chip,
// "Tag '<text>' erstellen" when nothing matches (grouping-class tags only
// — allocation tags are fixed/pre-seeded, never created here, per spec's
// "a deliberate Settings-area action" note). New tags default to
// `groupingType: null` (spec's own "unspecified" state) — there's no UI
// here to pick project/statement/claim/claim-category at creation time;
// logged in DEVLOG as a real open question, not guessed at silently.
//
// **"Schottland:Fähre" creates/selects a child tag** (spec.md §2.5's
// `parentTag` hierarchy) — a colon in the typed text splits into
// parent/child; `onCreateTag` (Konten.jsx) resolves an existing parent by
// name or creates one, then creates the child under it. Suggestions and
// the "already exists" check both match against each tag's *qualified*
// name (parent-prefixed for a child, plain for a top-level tag), so
// typing a child's bare name or its full "Parent: Child" form both find
// it.
//
// **Suggestions are usage-derived for grouping tags** (Markus, real-usage
// feedback): browsing with an empty input only offers grouping tags
// actually used on at least one line somewhere — a tag nobody's tagged
// anything with in a while doesn't clutter the list — but typing searches
// the full collection regardless of current usage, so a real but
// currently-unused tag is still reachable by name rather than becoming a
// dead end. Allocation tags are exempt from this filter entirely (fixed/
// structural, always relevant regardless of whether they're used on the
// row currently being edited). `usedTagValues` (a Set, computed once in
// Konten.jsx from every line's `tags[]` across all loaded transactions)
// also drives the other half of this: a value used somewhere that *isn't*
// a real tag id at all is a pre-existing free-text string (typed before
// this mechanism existed) — surfaced here as a plain, colorless,
// selectable suggestion too, not just as a dashed chip once it's already
// on the current line. Reusing the exact same string keeps Markus's
// existing trip/claim labels (e.g. an informal loan's own tag) usable
// without silently forking into a near-duplicate real tag.
//
// Fully removable/editable either way; turning a legacy string into a
// real tracked tag is a deliberate re-add (remove the old chip, retype —
// matches the real tag by name if one already exists, or creates it).
const TagEditor = forwardRef(function TagEditor(props, ref) {
  const { data, tags, usedTagValues, initialTagIds = [], onApply, onCreateTag, api } = props
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

  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags])
  const qName = (t) => qualifiedTagName(t, tagById)

  const selectedChips = selectedIds.map((id) => tagById[id] ?? { id, name: id })
  const legacyCandidates = useMemo(
    () => [...usedTagValues].filter((v) => !tagById[v]).map((v) => ({ id: v, name: v })),
    [usedTagValues, tagById],
  )

  // claim-category tags are only ever offered once a claim tag already
  // sits on this same line (spec.md §2.5's UI sequencing rule — Meal/Taxi
  // aren't meaningful outside some specific trip/claim context).
  const hasClaimTag = selectedIds.some((id) => tagById[id]?.groupingType === 'claim')

  const suggestions = useMemo(() => {
    const text = inputText.trim().toLowerCase()
    const groupingCandidates =
      text === '' ? tags.filter((t) => t.class === 'grouping' && usedTagValues.has(t.id)) : tags.filter((t) => t.class === 'grouping')
    const candidates = [...tags.filter((t) => t.class === 'allocation'), ...groupingCandidates, ...legacyCandidates]
    return candidates
      .filter((t) => !t.archived)
      .filter((t) => !selectedIds.includes(t.id))
      .filter((t) => t.groupingType !== 'claim-category' || hasClaimTag)
      .filter((t) => text === '' || qName(t).toLowerCase().includes(text))
      .slice(0, 25)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- qName closes over tagById, already covered by `tags`
  }, [tags, legacyCandidates, usedTagValues, selectedIds, inputText, hasClaimTag])

  // Checked against real tags *and* legacy free-text values in current
  // use (not just `tags`) — otherwise typing a legacy string's exact name
  // (e.g. "dirk sept") still offered a redundant "create" option right
  // next to the real matching suggestion for that same string.
  const canCreate =
    inputText.trim() !== '' &&
    !tags.some((t) => qName(t).toLowerCase() === inputText.trim().toLowerCase()) &&
    !legacyCandidates.some((t) => t.name.toLowerCase() === inputText.trim().toLowerCase())
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
        {selectedChips.map((t) => (
          <Chip
            key={t.id}
            label={qName(t) || t.id}
            colorVar={tagColorVar(tagById[t.id])}
            onRemove={() => removeChip(t.id)}
            title={tagById[t.id] ? undefined : 'Alter Freitext-Tag — noch nicht mit einem echten Tag verknüpft'}
          />
        ))}
        {selectedChips.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Keine Tags</span>}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputText}
        onChange={(e) => {
          setInputText(e.target.value)
          setHighlight(0)
        }}
        placeholder="Tag suchen oder neu erstellen… (z.B. Schottland:Fähre)"
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
      />
      {(suggestions.length > 0 || canCreate) && (
        <ul className="max-h-48 overflow-auto rounded border border-[var(--color-border)] text-sm">
          {suggestions.map((t, idx) => {
            const colorVar = tagColorVar(t)
            return (
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
                  <span
                    className="h-2 w-2 shrink-0 rounded-full border border-[var(--color-text-muted)]"
                    style={colorVar ? { backgroundColor: `var(${colorVar})`, borderColor: `var(${colorVar})` } : undefined}
                  />
                  {qName(t)}
                </button>
              </li>
            )
          })}
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
