import { useEffect, useMemo, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'

import { db } from './firebase'
import { defaultTagIdsFor, effectiveRule, matchRule } from './lib/bankImport'
import { qualifiedTagName } from './lib/tagStyle'
import TagBox from './TagBox'
import TagPill from './TagPill'
import { useTags } from './TagsProvider'

// The keyword rules, editable (Oct 2026, Markus: set categories, accounts and tags
// here before anything is hard-coded into the import). One row per keyword; every
// change is saved at once. Matching is case-blind and the longest keyword wins
// (lib/bankImport.js), so the "Test" field shows exactly what the import would do.
export default function ImportRules() {
  const { tags, tagById } = useTags()
  const [rules, setRules] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [filter, setFilter] = useState('')
  const [testText, setTestText] = useState('')
  const [tagFor, setTagFor] = useState(null)

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
  const eff = useMemo(() => rules.map(effectiveRule).sort((a, b) => a.keyword.localeCompare(b.keyword)), [rules])
  const shown = eff.filter((r) => {
    const q = filter.trim().toLowerCase()
    return !q || [r.keyword, r.label, r.groupName, r.categoryName].some((v) => (v ?? '').toLowerCase().includes(q))
  })
  const hit = testText.trim() ? matchRule(eff, testText) : null
  const patch = (r, p) => setDoc(doc(db, 'categorizationRules', r.id), p, { merge: true })
  const missingTags = eff.filter((r) => rules.find((x) => x.id === r.id)?.tagIds === undefined && defaultTagIdsFor(tags, r.groupName, r.categoryName).length)

  async function suggestTags() {
    const batch = writeBatch(db)
    for (const r of missingTags) batch.set(doc(db, 'categorizationRules', r.id), { tagIds: defaultTagIdsFor(tags, r.groupName, r.categoryName) }, { merge: true })
    await batch.commit()
  }

  const input = 'w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm'
  const catName = (id) => (categoryById[id] ? `${categoryById[categoryById[id].parentCategoryId]?.name ?? ''} › ${categoryById[id].name}` : '')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input className={input + ' max-w-xs'} placeholder="Regel suchen…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          type="button"
          className="rounded-md bg-[var(--color-computed)] px-3 py-1.5 text-sm font-medium text-white"
          onClick={() => setDoc(doc(db, 'categorizationRules', `rule-new-${Date.now()}`), { id: `rule-new-${Date.now()}`, keyword: '', label: '', groupName: '', categoryName: '', categoryId: null, counterAccountId: null, tagIds: [], source: 'user-confirmed', createdAt: Date.now() })}
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
        <input className={input + ' max-w-md'} placeholder="Bank-Text einfügen, z. B. VR.PERMANENT RUECKSTEUERN" value={testText} onChange={(e) => setTestText(e.target.value)} />
        {testText.trim() &&
          (hit ? (
            <span>
              → Regel <b>{hit.keyword}</b>: {hit.label || '—'} · {catName(hit.categoryId) || 'keine Kategorie'} · Gegenkonto{' '}
              {accountsSorted.find((a) => a.id === hit.counterAccountId)?.name ?? 'keins'} ·{' '}
              {hit.tagIds.map((id) => qualifiedTagName(tagById[id], tagById) || id).join(', ') || 'keine Tags'}
            </span>
          ) : (
            <span className="text-[var(--color-computed)]">kein Treffer</span>
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 bg-[var(--color-surface)] text-left">
            <tr>
              {['Keyword', 'Empfänger', 'Kategorie', 'Gegenkonto', 'Tags', ''].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-[var(--color-border)] align-top">
                <td className="w-48 p-1">
                  <input className={input} defaultValue={r.keyword} onBlur={(e) => e.target.value.trim() !== r.keyword && patch(r, { keyword: e.target.value.trim() })} />
                </td>
                <td className="w-56 p-1">
                  <input className={input} defaultValue={r.label} onBlur={(e) => e.target.value.trim() !== r.label && patch(r, { label: e.target.value.trim() })} />
                </td>
                <td className="w-64 p-1">
                  <select className={input} value={r.categoryId ?? ''} onChange={(e) => patch(r, { categoryId: e.target.value || null })}>
                    <option value="">— keine —</option>
                    {groups.map((g) => (
                      <optgroup key={g.id} label={g.name}>
                        {categories
                          .filter((c) => c.parentCategoryId === g.id && c.name !== 'Erstattungen')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  {!r.categoryId && r.categoryName && (
                    <div className="px-1 text-xs text-[var(--color-text-muted)]">Liste: {r.groupName} › {r.categoryName}</div>
                  )}
                </td>
                <td className="w-48 p-1">
                  <select className={input} value={r.counterAccountId ?? ''} onChange={(e) => patch(r, { counterAccountId: e.target.value || null })}>
                    <option value="">— keins (einseitig) —</option>
                    {accountsSorted.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="relative p-1">
                  <div className="flex flex-wrap items-center gap-1">
                    {r.tagIds.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1">
                        <TagPill tag={tagById[id]}>{qualifiedTagName(tagById[id] ?? { id, name: id }, tagById) || id}</TagPill>
                        <button type="button" aria-label="Tag entfernen" onClick={() => patch(r, { tagIds: r.tagIds.filter((x) => x !== id) })}>
                          ×
                        </button>
                      </span>
                    ))}
                    <button type="button" className="rounded border border-[var(--color-border)] px-1.5 text-xs" onClick={() => setTagFor(tagFor === r.id ? null : r.id)}>
                      + Tag
                    </button>
                  </div>
                  {tagFor === r.id && (
                    <div className="absolute left-1 top-full z-20 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg" style={{ minWidth: 300 }}>
                      <TagBox
                        placeholder="Tag suchen…"
                        getOptions={(text) => {
                          const q = text.trim().toLowerCase()
                          return tags
                            .filter((t) => !t.archived && !r.tagIds.includes(t.id))
                            .filter((t) => !q || (qualifiedTagName(t, tagById) || '').toLowerCase().includes(q))
                            .slice(0, 30)
                            .map((t) => ({ key: t.id, id: t.id, tag: t, label: qualifiedTagName(t, tagById) || t.id }))
                        }}
                        onPick={(o) => {
                          patch(r, { tagIds: [...r.tagIds, o.id] })
                          setTagFor(null)
                        }}
                        onEnterNone={() => setTagFor(null)}
                        onClose={() => setTagFor(null)}
                      />
                    </div>
                  )}
                </td>
                <td className="p-1 text-right">
                  <button type="button" title="Regel löschen" className="px-2 text-[var(--color-text-muted)]" onClick={() => window.confirm(`Regel „${r.keyword}“ löschen?`) && deleteDoc(doc(db, 'categorizationRules', r.id))}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
