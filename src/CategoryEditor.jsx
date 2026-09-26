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
  // initialCategoryId, not derived from data.lines[0] — this editor is
  // now shared by the parent row's own Kategorie/Unterkategorie cells
  // *and* an expanded split transaction's individual line rows (Konten.jsx
  // §3a's auto-remainder mechanism); the caller already knows exactly
  // which line (or none) it's editing and passes the right id directly,
  // rather than this component guessing from a `data` shape that differs
  // between the two cases.
  const { data, categories, onApply, onClear, api, startField = 'group', initialCategoryId = null } = props
  const currentGroupId = initialCategoryId
    ? (categories.find((c) => c.id === initialCategoryId)?.parentCategoryId ?? initialCategoryId)
    : null

  const [groupId, setGroupId] = useState(currentGroupId ?? '')
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? '')
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

  // Focus (and open) the field this editor should actually start on, as
  // soon as this component itself mounts — a plain mount effect is
  // guaranteed by React to run only after this component's own DOM
  // exists (same fix and same reason as KontoEditor.jsx's mount effect;
  // afterGuiAttached's timing through AG Grid's popup-editor bridge isn't
  // guaranteed relative to that). Kategorie and Unterkategorie share this
  // one editor, but opening it *from* Unterkategorie directly (Markus)
  // should jump straight to the Unterkategorie list — already open, and
  // pre-highlighted on whatever's already selected there, same as always
  // — rather than restarting the chain at Kategorie every time; Kategorie
  // itself is left exactly as it already was (currentGroupId), never
  // reset just because this editor happened to open from the other field.
  useEffect(() => {
    if (startField === 'category') {
      subcatRef.current?.focus()
    } else {
      groupRef.current?.focus()
    }
  }, [startField])

  // Advancing to Unterkategorie once a *new* group is actually picked
  // (Markus: picking a category should directly close its list and shift
  // to Unterkategorie — "it does but only after the second time"). The bug:
  // Kategorie's own `onEnter` below calls `subcatRef.current?.focus()`
  // synchronously, in the same tick as the `setGroupId` call that changed
  // it — but React hasn't re-rendered yet at that point, so the
  // Unterkategorie Listbox's `focus()` a moment later still runs against
  // its *previous* render's closure, where `disabled={!groupId}` was still
  // true for the old (pre-change) groupId and `subcatOptions` still listed
  // the old group's own children. `openList()` (Listbox.jsx) checks
  // `disabled` and silently no-ops, and the disabled button can't receive
  // real DOM focus either — so nothing visibly happens on the first pick.
  // Re-opening Kategorie and picking again works, because by then the
  // *previous* pick's state update has already landed, so Unterkategorie's
  // own closures are current. Fixed by moving the actual advance into a
  // `groupId`-keyed effect instead — guaranteed to run only after React
  // has committed the new render, so `disabled`/`subcatOptions` are always
  // fresh. `prevGroupIdRef` (initialized to the *current* groupId, not
  // reset on every render) distinguishes "groupId actually just changed via
  // a pick" from "this is just the initial mount value" — otherwise opening
  // an already-categorized row would spuriously auto-advance to
  // Unterkategorie before the user has touched anything. Kategorie's own
  // `onEnter` (below) stays as-is for the *other*, already-working case —
  // re-confirming the same group unchanged via Enter (the normal case when
  // arrowing through an already-categorized row) — since nothing is stale
  // there and both would otherwise fire redundantly; this effect simply
  // doesn't trigger a second time when groupId didn't actually change.
  const prevGroupIdRef = useRef(groupId)
  useEffect(() => {
    const changed = prevGroupIdRef.current !== groupId
    prevGroupIdRef.current = groupId
    if (changed && groupId) subcatRef.current?.focus()
  }, [groupId])

  // Escape cancels outright, discarding whatever's mid-edit (Markus) —
  // capture phase, not a plain React onKeyDown, for the same reason
  // KontoEditor.jsx's own Escape fix exists (its comment has the full
  // explanation): AG Grid's PopupEditorWrapper attaches a native keydown
  // listener on the popup wrapper itself, and a nested Listbox also claims
  // Escape natively while its own list is open (to close just that list) —
  // capture phase runs before either of those, so this always gets first
  // refusal and a single Escape closes the whole popup immediately, not
  // just whichever Listbox happened to still be open.
  // Delete clears the whole category assignment and closes (Markus: "i
  // need to be able to delete a category setting... hitting DEL should
  // close the modal and empty the category and subcat") — same capture-
  // phase reasoning as Escape above. Only when there's no actual search
  // text to delete first, though: the Kategorie/Unterkategorie Listboxes
  // are searchable (below), and their search box auto-focuses the instant
  // this popup opens, so a plain DOM check on the live input value (not
  // Listbox's own internal state, which this component has no access to)
  // is what tells "nothing typed yet, DEL means clear the categorization"
  // apart from "there's a query here, DEL means delete a character of it"
  // — the ordinary text-editing behavior a capture-phase intercept would
  // otherwise permanently break.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        api.stopEditing(true)
      } else if (e.key === 'Delete') {
        if (e.target.tagName === 'INPUT' && e.target.value !== '') return
        e.preventDefault()
        e.stopPropagation()
        onClear()
        api.stopEditing(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [api, onClear])

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
          searchable
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
          searchable
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
