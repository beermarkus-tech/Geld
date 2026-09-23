import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'

// The Unterkategorie cell editor — one combined popup with the cascading
// Kategorie→Unterkategorie pair (spec.md §3a), rather than two independently
// clickable grid cells: Kategorie has no stored value of its own (it's
// always derived from Unterkategorie's parentCategoryId, §2.6), so there's
// nothing for a separate Kategorie cell to actually edit — picking the
// group here only exists to filter which Unterkategorie options show.
const CategoryEditor = forwardRef(function CategoryEditor(props, ref) {
  const { data, categories, onApply, api } = props
  const currentCategoryId = (data.lines ?? [])[0]?.categoryId ?? null
  const currentGroupId = currentCategoryId
    ? (categories.find((c) => c.id === currentCategoryId)?.parentCategoryId ?? currentCategoryId)
    : null

  const [groupId, setGroupId] = useState(currentGroupId ?? '')
  const [categoryId, setCategoryId] = useState(currentCategoryId ?? '')

  const groups = useMemo(() => categories.filter((c) => c.parentCategoryId === null), [categories])
  const subcats = useMemo(() => categories.filter((c) => c.parentCategoryId === groupId), [categories, groupId])

  useImperativeHandle(ref, () => ({
    getValue: () => (categoryId ? { categoryId } : null),
    isCancelBeforeStart: () => false,
  }))

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
      style={{ minWidth: 260 }}
    >
      <label className="text-xs text-[var(--color-text-muted)]">
        Kategorie
        <select
          value={groupId}
          onChange={(e) => {
            // Changing Kategorie clears the already-chosen Unterkategorie
            // (spec.md §3a) — a stale leaf from the old group is never left
            // silently selected under the new one.
            setGroupId(e.target.value)
            setCategoryId('')
          }}
          className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-sm"
        >
          <option value="">– wählen –</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-[var(--color-text-muted)]">
        Unterkategorie
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={!groupId}
          className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-sm disabled:opacity-50"
        >
          <option value="">– wählen –</option>
          {subcats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {/* Explicit Übernehmen/Abbrechen (Markus's request) — same reasoning
          as KontoEditor.jsx: Übernehmen writes directly via onApply and
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
          onClick={() => {
            onApply(data, categoryId)
            api.stopEditing(true)
          }}
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
