import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import { db } from './firebase'
import { defaultTagIdsFor, effectiveRule, matchRule } from './lib/bankImport'
import { syncAgGridColorScheme } from './lib/gridColorScheme'
import { qualifiedTagName } from './lib/tagStyle'
import CategoryEditor from './CategoryEditor'
import Listbox from './Listbox'
import TagEditor from './TagEditor'
import TagPill from './TagPill'
import { useTagActions, useTags } from './TagsProvider'

ModuleRegistry.registerModules([AllCommunityModule])
syncAgGridColorScheme()

const NONE = '–'

// Gegenkonto popup for one rule: the same Listbox dropdown as the Konto editor in Konten, one account only.
const GegenkontoEditor = forwardRef(function GegenkontoEditor({ accounts, initialId, onApply, api }, ref) {
  const [id, setId] = useState(initialId ?? '')
  const listRef = useRef(null)
  useImperativeHandle(ref, () => ({ getValue: () => id, isCancelBeforeStart: () => false }))
  useEffect(() => {
    listRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      api.stopEditing(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [api])
  const apply = (override) => {
    onApply(override !== undefined ? override || null : id || null)
    api.stopEditing(true)
  }
  const options = [{ id: '', name: '– keins –' }, ...accounts.map((a) => ({ id: a.id, name: a.name }))]
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg" style={{ minWidth: 260 }}>
      <label className="text-xs text-[var(--color-text-muted)]">
        Gegenkonto
        <Listbox ref={listRef} value={id} onChange={setId} onEnter={(v) => apply(v)} options={options} placeholder="– keins –" />
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={() => api.stopEditing(true)} className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)]">
          Abbrechen
        </button>
        <button type="button" onClick={() => apply()} className="rounded bg-[var(--color-computed)] px-2 py-1 text-xs font-medium text-white">
          Übernehmen
        </button>
      </div>
    </div>
  )
})

// The keyword rules, editable (Oct 2026, Markus: set categories, accounts and tags
// here before anything is hard-coded into the import). Same grid look as Konten; every
// change is saved at once. Matching is case-blind and the longest keyword wins
// (lib/bankImport.js), so the "Test" field shows exactly what the import would do.
export default function ImportRules() {
  const { tags, tagById } = useTags()
  const tagActions = useTagActions()
  const [rules, setRules] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [filter, setFilter] = useState('')
  const [testText, setTestText] = useState('')
  const gridRef = useRef(null)

  useEffect(() => {
    const subs = [
      ['categorizationRules', setRules],
      ['categories', setCategories],
      ['accounts', setAccounts],
    ].map(([name, set]) => onSnapshot(collection(db, name), (snap) => set(snap.docs.map((d) => d.data()))))
    return () => subs.forEach((u) => u())
  }, [])

  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const groups = useMemo(() => categories.filter((c) => !c.parentCategoryId && c.name !== 'Erstattungen'), [categories])
  const accountsSorted = useMemo(
    () => accounts.filter((a) => a.id !== 'jahresabschluss').sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )
  const accountByName = useMemo(() => Object.fromEntries(accountsSorted.map((a) => [a.name, a.id])), [accountsSorted])
  const accountName = useMemo(() => Object.fromEntries(accountsSorted.map((a) => [a.id, a.name])), [accountsSorted])
  const eff = useMemo(() => rules.map(effectiveRule).sort((a, b) => a.keyword.localeCompare(b.keyword)), [rules])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return eff.filter((r) => !q || [r.keyword, r.label, r.groupName, r.categoryName].some((v) => (v ?? '').toLowerCase().includes(q)))
  }, [eff, filter])
  const hit = testText.trim() ? matchRule(eff, testText) : null
  const patch = (r, p) => setDoc(doc(db, 'categorizationRules', r.id), p, { merge: true })
  const missingTags = eff.filter((r) => rules.find((x) => x.id === r.id)?.tagIds === undefined && defaultTagIdsFor(tags, r.groupName, r.categoryName).length)

  // The rule's Kategorie: the group of its Unterkategorie, else the group named in the list.
  const groupOf = (r) =>
    (r.categoryId ? groups.find((g) => g.id === categoryById[r.categoryId]?.parentCategoryId) : groups.find((g) => g.name === r.groupName)) ?? null
  const catName = (id) => (categoryById[id] ? `${categoryById[categoryById[id].parentCategoryId]?.name ?? ''} › ${categoryById[id].name}` : '')

  async function suggestTags() {
    const batch = writeBatch(db)
    for (const r of missingTags) batch.set(doc(db, 'categorizationRules', r.id), { tagIds: defaultTagIdsFor(tags, r.groupName, r.categoryName) }, { merge: true })
    await batch.commit()
  }

  // The same Kategorie → Unterkategorie dropdown as Konten. A rule may stop at the Kategorie
  // (the editor then hands back the group's id); clearing (Entf) empties both.
  const categoryParams = (startField) => (p) => ({
    categories,
    initialCategoryId: p.data.categoryId ?? groupOf(p.data)?.id ?? null,
    allowGroupOnly: true,
    startField,
    onApply: (_d, id) => {
      const c = categoryById[id]
      if (c?.parentCategoryId) patch(p.data, { categoryId: c.id, categoryName: c.name, groupName: categoryById[c.parentCategoryId]?.name ?? '' })
      else patch(p.data, { categoryId: null, categoryName: '', groupName: c?.name ?? '' })
    },
    onClear: () => patch(p.data, { categoryId: null, categoryName: '', groupName: '' }),
  })

  const columnDefs = useMemo(
    () => [
      {
        colId: 'keyword',
        headerName: 'Keyword',
        width: 230,
        editable: true,
        valueGetter: (p) => p.data.keyword,
        valueSetter: (p) => {
          patch(p.data, { keyword: String(p.newValue ?? '').trim() })
          return false
        },
      },
      {
        colId: 'label',
        headerName: 'Empfänger',
        flex: 1,
        minWidth: 180,
        editable: true,
        valueGetter: (p) => p.data.label,
        valueSetter: (p) => {
          patch(p.data, { label: String(p.newValue ?? '').trim() })
          return false
        },
      },
      {
        colId: 'counter',
        headerName: 'Gegenkonto',
        width: 170,
        editable: true,
        valueGetter: (p) => accountName[p.data.counterAccountId] ?? NONE,
        valueSetter: (p) => {
          patch(p.data, { counterAccountId: accountByName[p.newValue] ?? null })
          return false
        },
        cellEditor: GegenkontoEditor,
        cellEditorParams: (p) => ({
          accounts: accountsSorted,
          initialId: p.data.counterAccountId,
          onApply: (counterAccountId) => patch(p.data, { counterAccountId }),
        }),
        cellEditorPopup: true,
        cellClass: (p) => (p.value === NONE ? 'text-[var(--color-text-muted)]' : undefined),
      },
      {
        colId: 'group',
        headerName: 'Kategorie',
        width: 150,
        editable: true,
        valueGetter: (p) => groupOf(p.data)?.name ?? NONE,
        valueSetter: (p) => {
          const g = groups.find((x) => x.name === p.newValue)
          patch(p.data, { groupName: g?.name ?? '', categoryName: '', categoryId: null })
          return false
        },
        cellEditor: CategoryEditor,
        cellEditorParams: categoryParams('group'),
        cellEditorPopup: true,
        cellClass: (p) => (p.value === NONE ? 'text-[var(--color-text-muted)]' : undefined),
      },
      {
        colId: 'unterkategorie',
        headerName: 'Unterkategorie',
        width: 190,
        editable: true,
        valueGetter: (p) => categoryById[p.data.categoryId]?.name ?? NONE,
        valueSetter: (p) => {
          const g = groupOf(p.data)
          const c = categories.find((x) => x.parentCategoryId === g?.id && x.name === p.newValue)
          patch(p.data, { categoryId: c?.id ?? null, categoryName: c?.name ?? '' })
          return false
        },
        cellEditor: CategoryEditor,
        cellEditorParams: categoryParams('category'),
        cellEditorPopup: true,
        cellClass: (p) => (p.value === NONE ? 'text-[var(--color-text-muted)]' : undefined),
      },
      {
        colId: 'tags',
        headerName: 'Tags',
        width: 230,
        editable: true,
        valueGetter: (p) => p.data.tagIds.map((id) => qualifiedTagName(tagById[id], tagById) || id).join(', '),
        valueSetter: () => false,
        cellRenderer: (p) =>
          p.data.tagIds.length ? (
            p.data.tagIds.map((id) => (
              <TagPill key={id} tag={tagById[id]} className="mr-1">
                {qualifiedTagName(tagById[id] ?? { id, name: id }, tagById) || id}
              </TagPill>
            ))
          ) : (
            <span className="text-[var(--color-text-muted)]">{NONE}</span>
          ),
        cellEditor: TagEditor,
        cellEditorParams: (p) => ({
          tags,
          recentTagValues: [],
          initialTagIds: p.data.tagIds,
          onApply: (_d, tagIds) => patch(p.data, { tagIds }),
          onCreateTag: (name, groupingType = null) => tagActions.findOrCreate(name, groupingType),
          onTabAddRow: () => {},
        }),
        cellEditorPopup: true,
      },
      {
        colId: 'delete',
        headerName: '',
        width: 52,
        pinned: 'right',
        sortable: false,
        cellRenderer: (p) => (
          <button
            type="button"
            title="Regel löschen"
            className="text-[var(--color-text-muted)]"
            onClick={() => window.confirm(`Regel „${p.data.keyword}“ löschen?`) && deleteDoc(doc(db, 'categorizationRules', p.data.id))}
          >
            🗑
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks read the lookups each render; patch only needs db
    [categories, categoryById, groups, accountsSorted, accountByName, accountName, tags, tagById],
  )

  // The cells read categories/accounts/tags through closures; AG Grid does not notice those arriving later.
  useEffect(() => {
    gridRef.current?.api?.refreshCells({ force: true })
  }, [categories, accounts, tags])

  const input = 'rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input className={input + ' w-64'} placeholder="Regel suchen…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          type="button"
          className="rounded-md bg-[var(--color-computed)] px-3 py-1.5 text-sm font-medium text-white"
          onClick={() => {
            const id = `rule-new-${Date.now()}`
            setDoc(doc(db, 'categorizationRules', id), { id, keyword: '', label: '', groupName: '', categoryName: '', categoryId: null, counterAccountId: null, tagIds: [], source: 'user-confirmed', createdAt: Date.now() })
          }}
        >
          + Neue Regel
        </button>
        {missingTags.length > 0 && (
          <button type="button" className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm" onClick={suggestTags}>
            Tag-Vorschläge für {missingTags.length} Rücklagen-Regeln übernehmen
          </button>
        )}
        <span className="text-sm text-[var(--color-text-muted)]">{rules.length} Regeln · Treffer: längstes Keyword, Groß-/Kleinschreibung egal</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
        <span className="font-medium">Test</span>
        <input className={input + ' w-96'} placeholder="Bank-Text einfügen, z. B. VR.PERMANENT RUECKSTEUERN" value={testText} onChange={(e) => setTestText(e.target.value)} />
        {testText.trim() &&
          (hit ? (
            <span>
              → Regel <b>{hit.keyword}</b>: {hit.label || NONE} · {catName(hit.categoryId) || 'keine Kategorie'} · Gegenkonto {accountName[hit.counterAccountId] ?? NONE} ·{' '}
              {hit.tagIds.map((id) => qualifiedTagName(tagById[id], tagById) || id).join(', ') || 'keine Tags'}
            </span>
          ) : (
            <span className="text-[var(--color-computed)]">kein Treffer</span>
          ))}
      </div>

      <div className="min-h-[360px] flex-1">
        <AgGridReact
          key={`${categories.length}-${accountsSorted.length}-${tags.length}`}
          ref={gridRef}
          theme={themeQuartz}
          rowData={shown}
          columnDefs={columnDefs}
          defaultColDef={{ suppressMovable: true, resizable: true }}
          getRowId={(p) => p.data.id}
          suppressRowHoverHighlight
          stopEditingWhenCellsLoseFocus
        />
      </div>
    </div>
  )
}
