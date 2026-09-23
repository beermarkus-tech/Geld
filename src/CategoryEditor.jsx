import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import Listbox from './Listbox'

// The Unterkategorie cell editor — one combined popup with the cascading
// Kategorie→Unterkategorie pair (spec.md §3a), rather than two independently
// clickable grid cells: Kategorie has no stored value of its own (it's
// always derived from Unterkategorie's parentCategoryId, §2.6), so there's
// nothing for a separate Kategorie cell to actually edit — picking the
// group here only exists to filter which Unterkategorie options show.
//
// Uses Listbox (a custom dropdown), not a native <select> — Markus found
// the native select wasn't opening at all on tap inside this popup on his
// device (see Listbox.jsx for the likely cause). Fully keyboard-chainable:
// focus lands on Kategorie already open when the popup opens; Enter on a
// highlighted group commits it and moves to Unterkategorie, already open;
// Enter on a highlighted subcategory commits it and applies, closing back
// to the grid — same as clicking Übernehmen.
const CategoryEditor = forwardRef(function CategoryEditor(props, ref) {
  const { data, categories, onApply, api } = props
  const currentCategoryId = (data.lines ?? [])[0]?.categoryId ?? null
  const currentGroupId = currentCategoryId
    ? (categories.find((c) => c.id === currentCategoryId)?.parentCategoryId ?? currentCategoryId)
    : null

  const [groupId, setGroupId] = useState(currentGroupId ?? '')
  const [categoryId, setCategoryId] = useState(currentCategoryId ?? '')
  const groupRef = useRef(null)
  const subcatRef = useRef(null)

  const groupOptions = useMemo(
    () => [
      { id: '', name: '– wählen –' },
      ...categories.filter((c) => c.parentCategoryId === null).map((g) => ({ id: g.id, name: g.name })),
    ],
    [categories],
  )
  const subcatOptions = useMemo(
    () => [
      { id: '', name: '– wählen –' },
      ...categories.filter((c) => c.parentCategoryId === groupId).map((c) => ({ id: c.id, name: c.name })),
    ],
    [categories, groupId],
  )

  useImperativeHandle(ref, () => ({
    getValue: () => (categoryId ? { categoryId } : null),
    isCancelBeforeStart: () => false,
  }))

  // Focus (and open) Kategorie as soon as this component itself mounts —
  // same fix and same reason as KontoEditor.jsx: afterGuiAttached's timing
  // through AG Grid's popup-editor bridge isn't guaranteed relative to the
  // portalled content actually committing to the DOM, which is why the
  // keyboard chain wasn't working at all (Markus: "still only mouse
  // input"). A plain mount effect is guaranteed by React to run only after
  // this component's own DOM exists.
  useEffect(() => {
    groupRef.current?.focus()
  }, [])

  // Takes an optional override for the just-committed Unterkategorie
  // value, for the same reason as KontoEditor.jsx's apply(): Listbox's
  // Enter-to-apply fires synchronously right after its own onChange, before
  // React has re-rendered `categoryId` with the new value.
  const apply = (finalCategoryId) => {
    const catId = finalCategoryId !== undefined ? finalCategoryId : categoryId
    onApply(data, catId)
    api.stopEditing(true)
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ minWidth: 260 }}
    >
      <label className="text-xs text-[var(--color-text-muted)]">
        Kategorie
        <Listbox
          ref={groupRef}
          value={groupId}
          onChange={(id) => {
            setGroupId(id)
            // Only clear the already-chosen Unterkategorie when the group
            // actually changes (spec.md §3a: a stale leaf from a genuinely
            // different old group is never left silently selected under
            // the new one) — Listbox's Enter-to-commit fires onChange even
            // when re-confirming the same group unchanged (the normal case
            // when arrowing through an already-categorized transaction),
            // and clearing on every commit regardless wiped the existing
            // subcategory before the Unterkategorie list even opened,
            // losing its pre-highlighted position (Markus: it should open
            // "with the cursor sitting on... the selected subcategory").
            if (id !== groupId) setCategoryId('')
          }}
          onEnter={(id) => id && subcatRef.current?.focus()}
          options={groupOptions}
          placeholder="– wählen –"
        />
      </label>
      <label className="text-xs text-[var(--color-text-muted)]">
        Unterkategorie
        <Listbox
          ref={subcatRef}
          value={categoryId}
          onChange={setCategoryId}
          onEnter={apply}
          options={subcatOptions}
          disabled={!groupId}
          placeholder="– wählen –"
        />
      </label>
      {/* Explicit Übernehmen/Abbrechen (Markus's request) for mouse/touch
          use — the Enter chain above is the keyboard equivalent of the
          same apply() call. Übernehmen writes directly via onApply and
          closes with api.stopEditing(true), not AG Grid's own commit
          pipeline, which confirmed didn't reliably apply the selection. */}
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
          onClick={() => apply()}
          disabled={!categoryId}
          className="rounded bg-[var(--color-computed)] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Übernehmen
        </button>
      </div>
    </div>
  )
})

export default CategoryEditor
