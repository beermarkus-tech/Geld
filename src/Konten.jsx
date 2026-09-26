import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'

import CategoryEditor from './CategoryEditor'
import { db } from './firebase'
import KontoEditor from './KontoEditor'
import { jahresende } from './lib/balance'
import { syncAgGridColorScheme } from './lib/gridColorScheme'
import { withRemainder } from './lib/split'
import { tagFilterMatchIds, tagFilterTotal, tagJahresende } from './lib/tagBalance'
import { qualifiedTagName, tagColorVar, tagParent } from './lib/tagStyle'
import TagEditor, { slugify } from './TagEditor'

ModuleRegistry.registerModules([AllCommunityModule])
syncAgGridColorScheme()

// "12,34" or "12.34" -> 1234 cents; null if unparseable. Markus types
// amounts in euros with a comma decimal (German/French convention), not
// the cents integers the schema stores (spec.md §2.6).
function parseEuroInput(s) {
  const cleaned = String(s).trim().replace(/[€\s]/g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-') return null
  const f = Number(cleaned)
  return Number.isNaN(f) ? null : Math.round(f * 100)
}

// Datum is a plain text cell, like Empfänger/Details — Markus specifically
// didn't want a picker (modal or dropdown) here at all. Accepts either the
// full stored "YYYY-MM-DD" as-is, or European shorthand — D.M / D.M. /
// D/M (day first, always — never the American month-first order) with the
// year taken from the app's own year selector (`fallbackYear`), or D.M.YYYY
// / D/M/YYYY with an explicit year (2-digit years read as 20XX). "/", "."
// and "-" are all accepted as separators for the shorthand forms; "-"
// specifically with a 4-digit first part is read as the stored ISO format
// instead, not a day.
function parseFlexibleDate(input, fallbackYear) {
  const parts = String(input ?? '')
    .trim()
    .split(/[./-]/)
    .filter(Boolean)
  let year, month, day
  if (parts.length === 3 && parts[0].length === 4) {
    ;[year, month, day] = parts.map(Number)
  } else if (parts.length === 3) {
    ;[day, month, year] = parts.map(Number)
    if (year < 100) year += 2000
  } else if (parts.length === 2) {
    ;[day, month] = parts.map(Number)
    year = Number(fallbackYear)
  } else {
    return null
  }
  if (!year || !month || !day || month < 1 || month > 12 || day < 1) return null
  // Rejects an impossible day for that month (e.g. 31.04) instead of
  // silently rolling over into the next month the way `new Date(...)` does.
  if (day > new Date(year, month, 0).getDate()) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// A brand-new manually entered transaction has no split yet — exactly one
// line, created lazily the first time Kategorie or a tag is set, mirroring
// whatever the transaction's own amount already is (spec.md §2.6's
// invariant: parent amountCents === Σ lines[].amountCents, trivially true
// for a single line).
function ensureLine(tx) {
  if (!tx.lines || tx.lines.length === 0) {
    tx.lines = [{ amountCents: tx.amountCents, categoryId: null, note: tx.detail || '', tags: [] }]
  }
  return tx.lines[0]
}

// Full-document overwrite (§3a: "simple edit-in-place, no audit trail
// needed, single user"). Two different mirroring directions depending on
// how many lines exist, both keeping the split-transaction invariant
// (§2.6: parent amountCents === Σ lines[].amountCents) true on every save,
// not just checked afterward:
// - Exactly one line: the parent is still authoritative (its Betrag cell
//   is directly editable) — mirror it down into the line.
// - More than one line (genuinely split): the parent becomes a fixed
//   total ("a cached total... every aggregation runs off lines[]", §2.6)
//   that splitting only ever redistributes, never changes. Every line
//   except the last is directly editable; the last is always recomputed
//   here as whatever's left — the "live, auto-generated remaining amount
//   line" §3a describes, made concrete at the one point it actually has
//   to be a real stored number rather than a live UI computation.
function persistTx(tx) {
  const next = { ...tx }
  if (next.lines?.length === 1) {
    next.lines = [{ ...next.lines[0], amountCents: next.amountCents }]
  } else if (next.lines?.length > 1) {
    next.lines = withRemainder(next.amountCents, next.lines)
  }
  // A manually entered row has no real bank text to protect (§3a's "raw
  // label must never be overwritten" is about imported rows specifically,
  // which already arrive with rawDescription set) — mirror Empfänger into
  // it instead of leaving it permanently blank.
  if (!next.rawDescription) next.rawDescription = next.displayLabel
  // Every save touches this, distinct from createdAt (§2.6, set once and
  // never again) — recentTagValues (below) needs "when was this actually
  // last edited," not the transaction's own booking date, to rank recently
  // *used* tags (Markus: the top of the tag dropdown was ranking by
  // transaction date, so tagging an old January row today didn't bring
  // that tag to the top the way actually just having picked it should).
  next.updatedAt = Date.now()
  setDoc(doc(db, 'transactions', next.id), next)
}

// Soft-delete (spec.md §2.9a's layer 4) — marks `deletedAt` and goes
// through persistTx like any other edit, rather than an immediate
// `deleteDoc`. Excluded from every aggregation (`activeTransactions`,
// Konten.jsx) but still recoverable via the "Kürzlich gelöscht" toggle for
// roughly a week, until the purge effect below actually removes it.
function softDeleteTx(tx) {
  persistTx({ ...tx, deletedAt: Date.now() })
}
// Restore just clears deletedAt — a single click, no arm/confirm step
// (unlike delete), since undoing a delete isn't itself destructive.
function restoreTx(tx) {
  persistTx({ ...tx, deletedAt: null })
}

// Konto's and Kategorie/Unterkategorie's Übernehmen buttons call these
// directly and persist immediately, rather than going through AG Grid's
// own getValue()/valueSetter commit pipeline the way every other column
// does — a confirmed bug (Markus: selecting an account/category and
// hitting Übernehmen silently did nothing). The column valueSetters below
// still exist and do the same thing, as a fallback for whatever other way
// a cell edit might end (Enter, tabbing away) — but Übernehmen no longer
// depends on that pipeline succeeding.
function applyKontoDirect(data, fromAccountId, toAccountId) {
  if (!fromAccountId && !toAccountId) return
  const tx = { ...data }
  const magnitude = Math.abs(tx.amountCents || 0)
  tx.fromAccountId = fromAccountId
  tx.toAccountId = toAccountId
  tx.amountCents = fromAccountId && toAccountId ? magnitude : fromAccountId ? -magnitude : magnitude
  persistTx(tx)
}
function applyCategoryDirect(data, categoryId) {
  if (!categoryId) return
  const tx = { ...data }
  const line = ensureLine(tx)
  tx.lines = [{ ...line, categoryId }]
  persistTx(tx)
}
// Same idea, scoped to one specific line of an already-split transaction
// (the expanded split-line rows' own Kategorie/Unterkategorie editor) —
// unlike applyCategoryDirect, this never collapses lines down to one.
function applyCategoryToLine(tx, lineIndex, categoryId) {
  if (!categoryId) return
  const next = { ...tx }
  next.lines = next.lines.map((l, i) => (i === lineIndex ? { ...l, categoryId } : l))
  persistTx(next)
}
// A deliberate clear (Markus: "i need to be able to delete a category
// setting... hitting DEL should... empty the category and subcat") — a
// separate function, not a null categoryId threaded through
// applyCategoryDirect/applyCategoryToLine above, since those two
// deliberately refuse a falsy categoryId (guarding against an accidental
// empty commit from the normal apply path) and shouldn't have that guard
// weakened just to let a genuine clear through. Kategorie has no field of
// its own to also clear (§2.6 — always derived from categoryId), so
// nulling categoryId here already clears both cells at once.
function clearCategoryDirect(data) {
  const tx = { ...data }
  const line = ensureLine(tx)
  tx.lines = [{ ...line, categoryId: null }]
  persistTx(tx)
}
function clearCategoryToLine(tx, lineIndex) {
  const next = { ...tx }
  next.lines = next.lines.map((l, i) => (i === lineIndex ? { ...l, categoryId: null } : l))
  persistTx(next)
}
// Same direct-write pattern as applyCategoryDirect/applyCategoryToLine
// above, for TagEditor's own Übernehmen — unlike category, an empty
// tagIds array is a perfectly valid commit (a line can carry zero tags),
// so there's no "if (!tagIds) return" guard here the way category's
// truthiness check has.
function applyTagsDirect(data, tagIds) {
  const tx = { ...data }
  const line = ensureLine(tx)
  tx.lines = [{ ...line, tags: tagIds }]
  persistTx(tx)
}
function applyTagsToLine(tx, lineIndex, tagIds) {
  const next = { ...tx }
  next.lines = next.lines.map((l, i) => (i === lineIndex ? { ...l, tags: tagIds } : l))
  persistTx(next)
}

// Split-transaction editing (§3a's auto-remainder mechanism): both of
// these are the exact same operation regardless of whether they're
// starting the first split or splitting the current remainder further —
// "creating a first sub-line... automatically leaves a second,
// system-maintained line... which can... be split further itself
// (creating a new remainder each time)". Appending a blank line always
// makes the line that was previously last become directly editable, and
// the newly appended one the new live remainder (persistTx recomputes it
// on every save) — one uniform rule instead of a special case for "the
// first split" vs. "splitting again."
function addSplitLine(tx) {
  const next = { ...tx }
  ensureLine(next)
  next.lines = [...next.lines, { amountCents: 0, categoryId: null, note: '', tags: [] }]
  persistTx(next)
}
// Removing any line (including the last) just leaves persistTx to
// recompute the new last line's amount from whatever remains — no special
// casing needed for which position was removed. Falling back to 0 or 1
// lines this way is exactly how a split collapses back to normal.
function removeLine(tx, lineIndex) {
  const next = { ...tx }
  next.lines = next.lines.filter((_, i) => i !== lineIndex)
  persistTx(next)
}

// Barkonten/Sparkonten/Geldanlage/Außenstände — Markus's own top-level
// mental model (spec.md §2.2's reportingGroup), not the technical account
// `group`. Außenstände (the seven receivable accounts) got its own block
// Sept 2026 — they're open claims/loans, not "real accounts" the same way
// a bank or cash balance is (spec.md §2.2's revision note).
const REPORTING_GROUPS = ['Barkonten', 'Sparkonten', 'Geldanlage', 'Außenstände']

// Amazon Julia (DE)/(FR), Amazon Markus (DE)/(FR), and Geld verliehen/
// geliehen collapsed into this one shared receivable account (Markus's
// design, Sept 2026, spec.md §2.2/§3a) — which specific claim or loan a
// transaction belongs to is now carried by a tag, not by which of five
// near-identical placeholder accounts it happened to sit on. CPAM and
// Reisekosten Airbus stay their own real accounts (Markus: "those will
// have a specific tracker later"). This id must exist in the live
// `accounts` collection with exactly this id for any of this to do
// anything — until Markus creates it (and migrates the historical Amazon/
// loan transactions onto it), the panel/filter code below simply finds no
// transactions touching it and stays quietly inert.
const AUSSENSTAENDE_ACCOUNT_ID = 'aussenstaende'

function centsToEuro(cents) {
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Keeps a split transaction's line rows glued to their parent under
// *any* column's sort, not just Datum (Markus: sorting by a different
// column scattered them back to the top). AG Grid's default comparator
// sorts by whatever a column's own valueGetter returns, which is blank
// or a line's own distinct value for a line row — either way, not tied
// to the parent, so lines float away from it under most sorts. Given a
// function that computes a column's "parent-level" comparable value,
// this compares every row by *its own parent's* value — a line row and
// its parent always tie under this rule, and JS's stable sort (ES2019+)
// then preserves displayRows' own [parent, line0, line1, ...] build
// order for that tie, keeping them adjacent regardless of which column
// is actually driving the sort.
function glueToParent(getValue) {
  return (_valueA, _valueB, nodeA, nodeB) => {
    const a = getValue(nodeA.data.__isLine ? nodeA.data.__parent : nodeA.data)
    const b = getValue(nodeB.data.__isLine ? nodeB.data.__parent : nodeB.data)
    return a < b ? -1 : a > b ? 1 : 0
  }
}

export default function Konten() {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  // All-time, never year-scoped: balance() needs the full history back to
  // the one Jahresabschluß anchor (spec.md §2.1/§2.3/§2.8). At real-world
  // volume — a few thousand transactions a year, one household — this
  // stays trivial to hold in memory even as more years accumulate.
  const [transactions, setTransactions] = useState([])
  const [loaded, setLoaded] = useState({ accounts: false, categories: false, tags: false, transactions: false })
  const [year, setYear] = useState(null)
  // Account filter: a distinct mechanism from a plain column filter (spec.md
  // §3a's filtering section) — Konto's own display is derived per row, so
  // the same account can show up on either side depending on that
  // transaction's direction. Picking an account here instead re-displays
  // every matching row from *that* account's own perspective.
  const [accountFilter, setAccountFilter] = useState(null)
  // Tracks AG Grid's own column filters (Datum/Empfänger/Kategorie/
  // Unterkategorie/Details/Betrag/Tags' header filters) — separate from
  // accountFilter, which is Konten's own account/tag mechanism, not an AG
  // Grid column filter at all. Drives the "Filter zurücksetzen" button
  // below (Markus): visible whenever *either* kind of filter is active.
  const [anyColumnFilter, setAnyColumnFilter] = useState(false)
  // Shared by the "Filter zurücksetzen" button and its Ctrl/Cmd+Shift+F
  // shortcut (Markus) — clears both kinds of filter at once, same as the
  // button always has.
  function resetFilters() {
    setAccountFilter(null)
    gridRef.current?.api?.setFilterModel(null)
  }
  // "Kürzlich gelöscht" toggle (spec.md §2.9a's layer 4), off by default —
  // switched on, soft-deleted-but-not-yet-purged rows reappear in `rows`
  // below, visually distinct, each with its own Wiederherstellen action.
  const [showDeleted, setShowDeleted] = useState(false)
  // Manual "empty the trash" (Markus: "i need a function to permanently
  // delete all 'kürzlich gelöscht' rows... in case i have to delete a
  // large number of rows for any reason") — distinct from the automatic
  // ~week-later purge effect above, which only ever catches up on its own
  // schedule. A real, irreversible deleteDoc per row, gated behind this
  // confirmation modal rather than firing straight from the trashcan click.
  const [confirmPurgeOpen, setConfirmPurgeOpen] = useState(false)
  // Keyboard-shortcuts help popover (Markus) — hover the (i) icon to show
  // it, Ctrl+I toggles the same state without hovering, Escape closes it.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Two-click delete: which row (if any) is currently armed, waiting for a
  // second click to actually confirm. See handleDeleteClick below.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const confirmTimeoutRef = useRef(null)
  const gridRef = useRef(null)
  const accountSelectRef = useRef(null)
  // The id (and target column) of a row waiting to be scrolled into view,
  // selected, and cell-focused once it actually settles into `rows` —
  // shared by addRow() and any cell edit that can move a row. Both write,
  // then wait: addRow's row only exists in Firestore, not yet round-tripped
  // back through onSnapshot into `rows`; a cell edit's row already exists
  // in `rows`, but if the edited column is part of the active sort (Datum
  // is, always), it can still move. AG Grid does its own immediate resort
  // right after the valueSetter mutates the row locally, but that's not
  // the *final* word — our own `rows` useMemo re-sorts again, from
  // scratch, once the Firestore round-trip lands the edit back through
  // onSnapshot, and its date-then-id tie-break for two same-date rows
  // isn't guaranteed to agree with whatever order AG Grid's own transient
  // in-place resort happened to leave them in (a stable sort keeps
  // whatever relative order they already had, not an id comparison).
  // Refocusing right after AG Grid's own resort (an earlier version of
  // this did exactly that) can therefore end up one row off from where
  // `rows` settles moments later — caught by Markus: two same-dated rows,
  // blue tint on one, cursor rectangle on the other. Waiting for `rows`
  // itself to contain the settled order, like addRow already did, is the
  // one point both agree on.
  const pendingFocusIdRef = useRef(null)
  const pendingFocusColRef = useRef('date')
  // null = focus the parent row once it settles (the normal case); a
  // number = focus that specific line index of the parent instead
  // (editing a split line's own field, per Markus — the cursor should
  // stay on the line just edited, not jump back to the parent row).
  const pendingFocusLineIndexRef = useRef(null)
  // A second, independent focus/selection claim exists —
  // focusGridMidViewport (Ctrl+K panel's Escape/Enter) — with its own
  // immediate setTimeout(0), not gated on `rows` settling at all, since it
  // often has nothing to wait for (the filter may not even have changed
  // row data). Two genuinely independent "claim the focus rectangle and
  // the blue tint" mechanisms, each firing its own deferred callback, can
  // interleave: an edit made just before a Ctrl+K/arrow/Enter round trip
  // may still have its settle effect below pending when
  // focusGridMidViewport's own timeout runs, and either callback's two
  // calls (setFocusedCell, setSelected) aren't atomic against the other's
  // — caught by Markus, screenshot showing the cell-focus rectangle on one
  // row and the blue selection tint on a different one after exactly this
  // sequence. Same underlying shape as the race the comment above already
  // fixed once (AG Grid's own transient resort vs. `rows`' own), just a
  // second, independent pair of racing callbacks rather than that one.
  // Fixed the same way in spirit: whichever claim was made *last* should
  // always win, in full (both calls together, never split) — a shared
  // monotonic counter, bumped by every claimant, checked right before each
  // deferred callback actually applies anything; a claim whose number has
  // since been superseded silently no-ops instead of clobbering half of a
  // newer claim's work.
  const focusClaimRef = useRef(0)
  const pendingFocusClaimRef = useRef(0)
  function claimPendingFocus(id, colId, lineIndex = null) {
    pendingFocusIdRef.current = id
    pendingFocusColRef.current = colId
    pendingFocusLineIndexRef.current = lineIndex
    focusClaimRef.current += 1
    pendingFocusClaimRef.current = focusClaimRef.current
  }
  // Which split transactions currently show their line rows expanded
  // (§3a: "parent row with an expand chevron... plus its detail rows
  // revealed on expand"). Keyed by the real transaction id, not the
  // synthetic line-row ids — those only exist while expanded.
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'accounts'), (snap) => {
        setAccounts(snap.docs.map((d) => d.data()))
        setLoaded((l) => ({ ...l, accounts: true }))
      }),
      onSnapshot(collection(db, 'categories'), (snap) => {
        setCategories(snap.docs.map((d) => d.data()))
        setLoaded((l) => ({ ...l, categories: true }))
      }),
      onSnapshot(collection(db, 'tags'), (snap) => {
        setTags(snap.docs.map((d) => d.data()))
        setLoaded((l) => ({ ...l, tags: true }))
      }),
      onSnapshot(collection(db, 'transactions'), (snap) => {
        setTransactions(snap.docs.map((d) => d.data()))
        setLoaded((l) => ({ ...l, transactions: true }))
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts])
  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags])
  // Every distinct value (real tag id or legacy free-text string alike —
  // indistinguishable at the data level) currently sitting in some line's
  // Every real aggregation/suggestion computation below reads this, not
  // `transactions` directly — a soft-deleted row (spec.md §2.9a's layer 4)
  // stays in `transactions` (so it can still be found/restored/purged) but
  // must never count toward a balance, a tag total, or a "this tag is in
  // use" suggestion. Only `rows` (the grid's own display list, below) ever
  // reads `transactions` directly instead, since that's the one place a
  // soft-deleted row is deliberately allowed back into view.
  const activeTransactions = useMemo(() => transactions.filter((t) => !t.deletedAt), [transactions])

  // `tags[]`, across every loaded transaction, any year — not scoped to
  // the selected year, since a tag used at all should stay reachable.
  // Drives TagEditor's usage-based suggestion list (Markus, real-usage
  // feedback): an unused grouping tag doesn't clutter the empty-input
  // browse view, and a pre-existing free-text string becomes a real
  // reusable suggestion instead of only ever showing up already-applied.
  const usedTagValues = useMemo(() => {
    const set = new Set()
    activeTransactions.forEach((t) => (t.lines ?? []).forEach((l) => (l.tags ?? []).forEach((v) => set.add(v))))
    return set
  }, [activeTransactions])
  // Every used value again, ordered by when it was actually *applied* —
  // each transaction's own `updatedAt` (persistTx, above), not its booking
  // `date` (Markus caught this: tagging an old January row today didn't
  // bring that tag to the top, because the original version ranked by the
  // transaction's calendar date instead of when it was actually last
  // touched). TagEditor takes the first 5 of these that are still real
  // suggestion candidates (already-selected/archived/etc. filtered out
  // there, not here). Known imprecision, not chased further: `updatedAt`
  // is per-transaction, not per-tag-application, so editing any other
  // field (Betrag, Datum, ...) on a transaction also bumps every tag
  // already sitting on it — close enough for "what did I just tag," not
  // worth a per-tag timestamp for.
  const recentTagValues = useMemo(() => {
    const lastUsed = new Map()
    activeTransactions.forEach((t) => {
      const ts = t.updatedAt ?? 0
      ;(t.lines ?? []).forEach((l) =>
        (l.tags ?? []).forEach((v) => {
          if (!lastUsed.has(v) || lastUsed.get(v) < ts) lastUsed.set(v, ts)
        }),
      )
    })
    return [...lastUsed.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
  }, [activeTransactions])
  const accountName = (id) => accountById[id]?.name ?? id
  const categoryName = (id) => categoryById[id]?.name ?? id
  // A soft-deleted transaction (spec.md §2.9a's layer 4) should not be
  // touchable in any way except restoring it (Markus: "i should not be
  // able to create split rows on a deleted item or interact in any way
  // with it... except undelete it") — every column's own `editable` below
  // checks this, and the split column's add/expand buttons check it
  // directly. Works for a line row too, via its `__parent` — a line of an
  // already-split, now-deleted transaction is exactly as locked as its
  // parent, not a separate case.
  const isRowDeleted = (data) => Boolean((data.__isLine ? data.__parent : data)?.deletedAt)
  // Grouping tags only, never allocation (spec.md §2.5: allocation tags
  // are fixed/pre-seeded, "a deliberate Settings-area action," never
  // created inline while entering a transaction). Fire-and-forget, same
  // style as persistTx elsewhere — TagEditor needs the new id back
  // synchronously to add it to the line's selection right away, not after
  // a round trip. Collision-checked against currently-loaded tags (a
  // brand new name colliding with an existing slug, e.g. two different
  // "2026-08" style labels) rather than assumed unique.
  function createPlainTag(name, parentTag, groupingType = null) {
    let id = slugify(name)
    if (tags.some((t) => t.id === id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`
    setDoc(doc(db, 'tags', id), {
      id,
      name,
      parentTag,
      class: 'grouping',
      reconciliationTargetAccountIds: [],
      groupingType,
      archived: false,
    })
    return id
  }
  // "Schottland:Fähre" (Markus) creates/reuses a parent tag and a real
  // child under it (spec.md §2.5's parentTag hierarchy) — the id actually
  // applied to the line is always the *child's*, never the parent's, per
  // spec's own breakdown-rollup note ("Real Konten transactions must
  // still be tagged with the specific child... an untagged child
  // contributes nothing"). Reuses an existing top-level tag matching the
  // parent name (case-insensitive) rather than creating a duplicate
  // "Schottland" every time a new child is added under it. `groupingType`
  // (TagEditor's own create-type picker, Markus) applies to whichever tag
  // actually gets returned/selected — the child's, for a parent:child
  // pair, since that's the one being categorized in context; a newly
  // implied parent always starts unspecified.
  function createTag(name, groupingType = null) {
    const colon = name.indexOf(':')
    if (colon === -1) return createPlainTag(name, null, groupingType)
    const parentName = name.slice(0, colon).trim()
    const childName = name.slice(colon + 1).trim()
    if (!parentName || !childName) return createPlainTag(name, null, groupingType)
    const existingParent = tags.find(
      (t) => t.class === 'grouping' && !t.parentTag && t.name.toLowerCase() === parentName.toLowerCase(),
    )
    const parentId = existingParent ? existingParent.id : createPlainTag(parentName, null)
    return createPlainTag(childName, parentId, groupingType)
  }
  // Kategorie (the parent group, e.g. "Lebenshaltung") is derived/display
  // only — only the leaf Unterkategorie is ever stored (spec.md §2.6/§3a).
  const groupName = (id) => {
    const parentId = categoryById[id]?.parentCategoryId
    return parentId ? categoryName(parentId) : categoryName(id)
  }

  // The transaction's amount, signed relative to one specific account's own
  // position — the same magnitude-by-position rule balance() uses (§2.6),
  // applied here per row instead of summed over all rows.
  const signedFor = (tx, accountId) => {
    const magnitude = Math.abs(tx.amountCents)
    if (tx.fromAccountId === accountId) return -magnitude
    if (tx.toAccountId === accountId) return magnitude
    return null
  }

  // accountFilter (below) now holds either a real account id *or* an
  // allocation tag id — the pinned panel's tag rows are full filter
  // buttons too now (Markus). The "re-sign relative to the filtered
  // entity" display Konto/Betrag do below only makes sense for a single
  // reference *account* — an allocation tag can span several target
  // accounts at once (Anlage Familie: Aktien/Crypto/Edelmetalle/ESOP
  // together, §2.5), so there's no one meaningful "the other side" to
  // show. Tag-filtered rows just show their own plain, unfiltered Konto
  // arrow and natural amountCents sign instead — filteredAccountId is
  // null whenever accountFilter is actually a tag, which every place
  // below that used to read accountFilter directly for this purpose now
  // reads instead.
  const filteredAccountId = accountFilter && accountById[accountFilter] ? accountFilter : null

  // Each column's "parent-level" comparable/display value, extracted so
  // both its valueGetter (parent-row display) and its comparator (every
  // row, via glueToParent above) compute it exactly the same way — never
  // two parallel implementations that could quietly drift apart.
  const kontoValue = (t) => {
    if (filteredAccountId) {
      const outgoing = t.fromAccountId === filteredAccountId
      const other = outgoing ? t.toAccountId : t.fromAccountId
      if (!other) return '—'
      return (outgoing ? '→ ' : '← ') + accountName(other)
    }
    if (t.fromAccountId && t.toAccountId) {
      return `${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`
    }
    return accountName(t.fromAccountId ?? t.toAccountId)
  }
  const betragValue = (t) => signedFor(t, filteredAccountId ?? (t.fromAccountId ?? t.toAccountId))
  const kategorieValue = (t) => {
    const ids = [...new Set((t.lines ?? []).map((l) => l.categoryId).filter(Boolean))]
    if (ids.length === 0) return '—'
    const groups = [...new Set(ids.map(groupName))]
    return groups.length === 1 ? groups[0] : '(mehrere)'
  }
  const unterkategorieValue = (t) => {
    const ids = [...new Set((t.lines ?? []).map((l) => l.categoryId).filter(Boolean))]
    if (ids.length === 0) return '—'
    return ids.length === 1 ? categoryName(ids[0]) : '(mehrere)'
  }
  // Resolved names, not raw ids (sorting by cryptic slugs would be
  // meaningless) — falls back to the raw string itself for a legacy
  // pre-tag-mechanism free-text entry that doesn't resolve to any real
  // tag id (TagEditor's own note on this has the full explanation).
  const tagsValue = (t) =>
    [...new Set((t.lines ?? []).flatMap((l) => l.tags ?? []))].map((id) => qualifiedTagName(tagById[id], tagById) || id).join(', ')
  const tagIdsValue = (t) => [...new Set((t.lines ?? []).flatMap((l) => l.tags ?? []))]

  // Persists, then defers to the same pendingFocusIdRef/rows effect addRow
  // uses (see its declaration above) to re-locate both the selection tint
  // and the focus rectangle together, once `rows` has actually settled —
  // not right away, which was one resort too early. A line row edits its
  // __parent (a real transaction) rather than itself — that's what
  // actually gets persisted — but the *cursor* should stay on the exact
  // line just edited, not jump back to the parent row (Markus). A pure
  // value edit (amount/category/note/tags) doesn't add or remove lines,
  // so the edited line's own index stays valid across the round-trip;
  // pendingFocusLineIndexRef carries it through to the effect below,
  // which looks the line back up by parent + index rather than by a
  // synthetic id (those now change on any add/remove — see displayRows).
  const handleCellValueChanged = (params) => {
    const tx = params.data.__isLine ? params.data.__parent : params.data
    persistTx(tx)
    claimPendingFocus(tx.id, params.column.getColId(), params.data.__isLine ? params.data.__lineIndex : null)
  }

  // Adds a blank row right below whatever's currently selected in the
  // grid: same date (so it lands next to it once the grid re-sorts by
  // date), and an id whose timestamp suffix sorts after every row that
  // already exists on that date (rows sort by date, then id — §3a's
  // "confirmed column order" note doesn't specify insert position, this is
  // the natural reading of "below"). No selection -> falls back to today
  // (or this year's Jan 1 if today isn't in the year being viewed).
  // Pre-fills fromAccountId from the active account filter, if any, so the
  // new row is actually visible in a filtered view instead of vanishing
  // the moment it's created (it wouldn't match the filter otherwise).
  async function addRow() {
    const selected = gridRef.current?.api?.getSelectedRows()?.[0]
    const today = new Date().toISOString().slice(0, 10)
    const date = selected?.date ?? (year && today.startsWith(year) ? today : `${year}-01-01`)
    const id = `tx-manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    claimPendingFocus(id, 'date')
    await setDoc(doc(db, 'transactions', id), {
      id,
      date,
      fromAccountId: filteredAccountId,
      toAccountId: null,
      amountCents: 0,
      rawDescription: '',
      displayLabel: '',
      lines: [],
      detail: '',
      createdAt: Date.now(),
    })
  }

  // Hands the cursor back to the grid, landing on the Datum cell of
  // whichever row is roughly mid-viewport rather than the first/last one —
  // shared by the panel's Escape (clears the filter first) and Enter
  // (keeps it) key handling. Deferred a tick since clearing the filter
  // changes the row set and the grid only re-renders with it after the
  // caller's handler returns. Makes its own claim on the shared
  // focusClaimRef counter (see its declaration above) — this used to be
  // fully independent of the edit-settle effect's own deferred callback,
  // which could leave the two mid-air at once: an edit made just before
  // Ctrl+K/arrow/Enter could still be waiting on its own settle when this
  // fires, and whichever of the two happened to apply *second* would only
  // partially overwrite the other (one call succeeding, one not), splitting
  // the focus rectangle from the blue tint across two different rows
  // (Markus, screenshot). Clearing pendingFocusIdRef here too, not just
  // bumping the counter, so a same-id edit-settle that hasn't even fired
  // yet won't spuriously re-claim later, off some unrelated future `rows`
  // change, and jump the cursor back without any new user action asking it
  // to.
  function focusGridMidViewport() {
    pendingFocusIdRef.current = null
    focusClaimRef.current += 1
    const myClaim = focusClaimRef.current
    setTimeout(() => {
      if (focusClaimRef.current !== myClaim) return
      const api = gridRef.current?.api
      const first = api?.getFirstDisplayedRowIndex()
      const last = api?.getLastDisplayedRowIndex()
      if (first != null && first >= 0 && last != null && last >= 0) {
        const rowIndex = Math.floor((first + last) / 2)
        api.setFocusedCell(rowIndex, 'date')
        // Select the landing row explicitly rather than relying on
        // onCellFocused's selection side effect to fire in time — right
        // after a filter change (Escape/Enter from the panel both change
        // accountFilter first) the row set is still settling, and that side
        // effect isn't reliably in sync yet, which left a stale blue tint
        // on the row selected before Ctrl+K was pressed (caught by Markus,
        // screenshot showing two rows tinted at once).
        api.getDisplayedRowAtIndex(rowIndex)?.setSelected(true, true)
      }
    }, 0)
  }

  // Ctrl/Cmd+'+' triggers "+ Neue Buchung" (Markus's request). Note, not
  // hidden: Ctrl/Cmd+'+' is the browser's own zoom-in shortcut in Chrome/
  // Firefox/Safari, and browsers commonly refuse to let a page override or
  // suppress it (unlike most other shortcuts) — this listens for it
  // anyway, since worst case the browser also zooms and best case both
  // happen harmlessly, but it may not be fully reliable everywhere for
  // reasons outside the app's control. '=' is included since '+' usually
  // requires Shift, and keyboards/browsers report that combination either
  // way depending on layout. **Ctrl/Cmd+N removed again (Markus, Sept
  // 2026): "'+' is enough"** — it had the same real browser-reservation
  // risk as Ctrl+T/H anyway ("new window," nearly everywhere), and wasn't
  // worth keeping alongside '+' once asked. Skipped while a cell is being
  // edited, so this doesn't fire in the middle of typing a category/tag/etc.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key !== '+' && e.key !== '=') return
      if (gridRef.current?.api?.getEditingCells().length > 0) return
      e.preventDefault()
      addRow()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addRow closes over year/accountFilter, both already current each render
  }, [year, accountFilter])

  // Tab on the Tags cell adds a new row instead of AG Grid's own default
  // Tab-to-next-cell navigation (Markus: "when i hit tab on the tags
  // field... i want a new empty row to be created below the current one")
  // — covers the *not currently editing* case only; TagEditor's own native
  // listener handles the same key while its popup is actually open (it has
  // direct access to the tags just picked, to apply them first). Capture
  // phase, same reason as Ctrl+T above: Tab is a key AG Grid's own core
  // keyboard service claims natively for cell-to-cell navigation, so a
  // plain bubble-phase listener would lose that race outright.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const api = gridRef.current?.api
      if (!api || api.getEditingCells().length > 0) return
      if (api.getFocusedCell()?.column?.getColId() !== 'tags') return
      e.preventDefault()
      e.stopPropagation()
      addRow()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addRow closes over year/accountFilter, both already current each render
  }, [year, accountFilter])

  // Ctrl/Cmd+T ("Teilen") triggers the split column's own ✚ (Markus) for
  // whichever transaction the cursor is currently on — a parent row
  // (starts the first split) or any of its own line rows (splits
  // further), same as clicking the button itself; landing on the first
  // line's Betrag field either way (see the split column's own cellRenderer
  // for why). No dedicated button to click first — the whole point is
  // making this reachable without leaving the keyboard, since every other
  // split-column action already was except this one.
  //
  // Was Ctrl+Enter — still didn't fire even after fixing the AG Grid race
  // below (capture phase + stopPropagation, kept here for T too, since it's
  // real and still needed for the *page-level* race regardless of which
  // key). Enter specifically has a second, earlier obstacle no in-page fix
  // can reach: 'T' is one of the most universally browser/OS-reserved
  // Ctrl-combos there is (new tab, everywhere, iPadOS included) — if it
  // *also* silently fails, that's the browser/OS swallowing the keypress
  // before it ever reaches the page's JavaScript at all, not this code.
  //
  // Capture phase, not the default bubble phase, and stopPropagation() once
  // we've decided to act — Enter, Ctrl held or not, is one of the few keys
  // AG Grid's own core (not React) attaches a *native* keydown listener for
  // directly on the row container (RowContainerEventsFeature, confirmed in
  // its actual bundled source), which starts editing the focused cell. That
  // listener sits on a real DOM ancestor of the grid's cells and fires in
  // the normal bubble phase; a bubble-phase listener on `window` (what
  // every other shortcut here uses) is strictly further out, so it always
  // loses that race — by the time it ran, AG Grid had already started
  // editing, and this handler's own "not already editing" guard then
  // correctly, but unhelpfully, bailed out. A capture-phase window listener
  // runs during the top-down capture pass, before the target is even
  // reached, i.e. strictly before any bubble-phase listener anywhere —
  // stopping propagation here prevents AG Grid's own handler from ever
  // running at all for this specific keypress, same category of fix as
  // Listbox.jsx's native listener for the same underlying reason: a React
  // (or here, default-phase-`window`) handler can't out-run a closer native
  // one just by asking nicely — it has to run first, or not compete at all.
  // T isn't a key AG Grid's own core claims at all, so this part shouldn't
  // matter for T specifically — kept anyway, since it's still correct and
  // harmless, and saves re-deriving it if this ever moves to another key.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key.toLowerCase() !== 't') return
      const api = gridRef.current?.api
      if (!api || api.getEditingCells().length > 0) return
      const focused = api.getFocusedCell()
      if (!focused) return
      const row = api.getDisplayedRowAtIndex(focused.rowIndex)?.data
      if (!row) return
      e.preventDefault()
      e.stopPropagation()
      // No further splitting on an already-deleted transaction (Markus) —
      // still swallows the keypress above rather than falling through to
      // it, same as every other case where a row is focused.
      if (isRowDeleted(row)) return
      const tx = row.__isLine ? row.__parent : row
      addSplitLine(tx)
      setExpandedIds((prev) => new Set(prev).add(tx.id))
      claimPendingFocus(tx.id, 'betrag', 0)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Ctrl/Cmd+K always jumps into the pinned panel's account boxes, never
  // the plain <select> (Markus, correcting an earlier version of this) —
  // landing on the currently active filter's own button if one is set,
  // otherwise the first account overall. From there: arrow keys roam
  // (Session 15/16), Escape resets to "Alle Konten" and returns to the
  // grid, Enter keeps the highlighted filter and *also* returns to the
  // grid (added below) — so Ctrl+K, arrow, Enter, Ctrl+K again reopens
  // exactly where you left off, a closed loop.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return
      if (gridRef.current?.api?.getEditingCells().length > 0) return
      e.preventDefault()
      const target = accountFilter
        ? document.querySelector(`[data-filter-id="${accountFilter}"]`)
        : document.querySelector('[data-group] ul button')
      target?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [accountFilter])

  // Ctrl/Cmd+H toggles "Kürzlich gelöscht" (Markus). **Real risk, flagged
  // to Markus rather than silently assumed away:** Ctrl+H is Chrome's own
  // "Show History" shortcut on Windows/Linux (Cmd+H is macOS's "Hide
  // window") — both are reserved at the browser/OS chrome level in an
  // ordinary tab, the same category of conflict already hit and accepted
  // for Ctrl+T above, and no in-page preventDefault can reach a keypress
  // the browser chrome already claimed before it reaches this code. An
  // installed PWA's standalone window (no address bar/History UI at all)
  // *may* not reserve it the same way, but that's genuinely untested here
  // — needs confirming on Markus's own devices, both as an installed PWA
  // and in an ordinary browser tab.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key.toLowerCase() !== 'h') return
      if (gridRef.current?.api?.getEditingCells().length > 0) return
      e.preventDefault()
      setShowDeleted((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Ctrl/Cmd+I toggles the keyboard-shortcuts help popover (Markus) — same
  // shown/hidden state the (i) icon's hover uses, so either path opens and
  // closes the identical popover. Capture phase + a conditional
  // stopPropagation on Escape specifically while open, so this reliably
  // wins over whatever else might otherwise claim Escape (an open cell
  // editor's own cancel, the armed-delete discharge above) rather than
  // silently losing that race the way a plain bubble-phase listener has
  // before elsewhere in this file.
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }
      if (e.key === 'Escape' && shortcutsOpen) {
        e.stopPropagation()
        setShortcutsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [shortcutsOpen])

  // Ctrl/Cmd+F opens AG Grid's own native filter popup for whichever column
  // currently holds the focus rectangle (Markus: "opens the filter modal
  // for the active column"), instead of the browser's own page-search —
  // same browser-reservation category as Ctrl+T/H above, accepted the same
  // way. Enter closes the popup and keeps whatever was typed — AG Grid's
  // built-in text/number filters already apply live as you type, so there's
  // nothing extra to "apply" — while Escape restores whatever filter model
  // existed right before Ctrl+F was pressed and closes without changing
  // anything (Markus's own spec for the two keys). Either way, focus goes
  // back to the currently selected/tinted row, in that same column (Markus:
  // "cursor is going back on the tinted row in that column") — found via
  // the selected node, not a snapshotted row index, since applying or
  // reverting a filter can itself change which rows are displayed and at
  // what index.
  //
  // `session` is a plain closure variable, not React state — only this one
  // listener ever needs to know a filter session is open, and state would
  // just add a render in between for no benefit. Capture phase, for the
  // same reason as every other key here that AG Grid's own core (or its
  // filter popup) might otherwise claim first — Enter/Escape while the
  // popup's own text input has focus is the same race class already
  // documented for the cell-editor popups elsewhere in this file.
  useEffect(() => {
    let session = null
    function returnFocusTo(api, colId) {
      const node = api.getSelectedNodes()[0]
      // The normal case: the previously selected/tinted row is still on
      // display (rowIndex only exists on a currently-displayed row), so
      // land back on it exactly, per Markus's own spec for both keys.
      if (node && node.rowIndex != null) {
        api.ensureNodeVisible(node, 'middle')
        api.setFocusedCell(node.rowIndex, colId)
        return
      }
      // Edge case Markus's own wording didn't anticipate: applying a
      // filter on Enter can filter the very row it started from right out
      // of view, leaving no "tinted row" to return to. Land on whatever's
      // now first rather than stranding the cursor with no focus at all.
      const first = api.getDisplayedRowAtIndex(0)
      if (!first) return
      first.setSelected(true, true)
      api.setFocusedCell(0, colId)
    }
    const onKeyDown = (e) => {
      const api = gridRef.current?.api
      if (!api) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        if (api.getEditingCells().length > 0) return
        const column = api.getFocusedCell()?.column
        if (!column || !column.isFilterAllowed()) return
        e.preventDefault()
        const colId = column.getColId()
        session = { colId, prevModel: api.getColumnFilterModel(colId) }
        api.showColumnFilter(colId)
        return
      }
      if (!session) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const { colId } = session
        session = null
        api.hideColumnFilter()
        returnFocusTo(api, colId)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        const { colId, prevModel } = session
        session = null
        api.setColumnFilterModel(colId, prevModel).then(() => {
          api.onFilterChanged()
          api.hideColumnFilter()
          returnFocusTo(api, colId)
        })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Ctrl/Cmd+S toggles the currently focused column's sort between
  // ascending and descending (Markus: "sorts the active column (toggle asc
  // and desc)") — deliberately never clears back to unsorted, matching his
  // own literal wording; a column not yet sorted starts at ascending.
  // Single-column sort, replacing whatever the grid was previously sorted
  // by — the same semantics a header click already has. preventDefault
  // always, whether or not a column ends up toggled, since Ctrl+S is the
  // browser's own "Save Page" shortcut and letting that through here would
  // be strictly worse than a no-op.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      const api = gridRef.current?.api
      if (!api || api.getEditingCells().length > 0) return
      const column = api.getFocusedCell()?.column
      if (!column || !column.isSortable()) return
      const nextSort = column.getSort() === 'asc' ? 'desc' : 'asc'
      api.applyColumnState({ state: [{ colId: column.getColId(), sort: nextSort }], defaultState: { sort: null } })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Ctrl/Cmd+Shift+F triggers the same "Filter zurücksetzen" the button
  // does (Markus) — clears both the account/tag filter and every AG Grid
  // column filter at once, keyboard-reachable without hunting for the
  // button. Plain Ctrl/Cmd+F above explicitly excludes Shift so the two
  // never both fire off the same keypress.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'f') return
      if (gridRef.current?.api?.getEditingCells().length > 0) return
      e.preventDefault()
      resetFilters()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Two clicks, not a modal (Markus's call).
  function armDelete(id) {
    setConfirmDeleteId(id)
    clearTimeout(confirmTimeoutRef.current)
    confirmTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteId((cur) => (cur === id ? null : cur))
    }, 4000)
  }
  // Takes the row itself, not just an id — a split line's own row has no
  // Firestore document of its own to delete (Markus: a breakdown line's
  // trashcan should behave exactly like a transaction's own, arm/confirm/
  // red-tint included, but what "confirm" actually does differs: removeLine
  // on the parent, not a transaction-level delete). confirmDeleteId doesn't
  // care whether the id it's holding belongs to a parent or a line row —
  // it's just "the currently armed row's own id" either way. A whole
  // transaction's own delete is a soft-delete (spec.md §2.9a's layer 4,
  // softDeleteTx above), not deleteDoc — recoverable via the "Kürzlich
  // gelöscht" toggle for roughly a week, not gone the instant this confirms.
  // A soft-deleted row (only ever a whole transaction, never a line — see
  // above) arms/confirms *restore* through this exact same two-click path
  // instead of delete (Markus: "assign the same DEL button shortcut to the
  // deleted row in order to undelete it... deleting and undeleting the same
  // row takes 4 presses of DEL"), so a full delete-then-undelete round trip
  // is symmetric: arm, confirm, arm, confirm — not delete-then-single-click.
  function handleDeleteClick(row) {
    if (confirmDeleteId === row.id) {
      clearTimeout(confirmTimeoutRef.current)
      setConfirmDeleteId(null)
      if (row.__isLine) {
        removeLine(row.__parent, row.__lineIndex)
      } else if (row.deletedAt) {
        restoreTx(row)
      } else {
        softDeleteTx(row)
      }
    } else {
      armDelete(row.id)
    }
  }

  // Real, irreversible deletes — every currently soft-deleted transaction,
  // not just the ones in the selected year (Markus wants to clean up "a
  // large number of rows," which could span years) — gated behind
  // confirmPurgeOpen's modal, not fired directly from a click.
  function purgeAllDeleted() {
    transactions.forEach((t) => {
      if (t.deletedAt) deleteDoc(doc(db, 'transactions', t.id))
    })
    setConfirmPurgeOpen(false)
  }

  // Escape discharges an armed delete (Markus) regardless of where focus
  // currently is — arming can start from either the trashcan click or the
  // keyboard Delete key on a focused cell, so this listens globally rather
  // than only within the grid's own key handling.
  useEffect(() => {
    if (!confirmDeleteId) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        clearTimeout(confirmTimeoutRef.current)
        setConfirmDeleteId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDeleteId])

  // Same, for the purge-confirmation modal above.
  useEffect(() => {
    if (!confirmPurgeOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setConfirmPurgeOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmPurgeOpen])

  // getRowStyle alone doesn't get re-evaluated for already-rendered rows
  // just because confirmDeleteId changed elsewhere in React state — force
  // AG Grid to re-ask for it whenever the armed row changes, so the
  // red warning tint (Markus) actually appears/disappears live.
  useEffect(() => {
    gridRef.current?.api?.redrawRows()
  }, [confirmDeleteId])

  // The actual purge behind "a short recovery window" (spec.md §2.9a's
  // layer 4: "recoverable for roughly a week... before an actual purge") —
  // without this, a soft-deleted row would just sit there forever, which
  // isn't what "a short recovery window" means. No backend cron exists in
  // this app (GitHub Pages + Firestore, no server) to run this on a
  // schedule, so it runs opportunistically instead, whenever transactions
  // load or change — "roughly a week" doesn't need tighter precision than
  // that. purgedIdsRef avoids re-issuing a redundant deleteDoc for a row
  // this effect already purged, while waiting for Firestore's own
  // onSnapshot to confirm the previous call and drop it from `transactions`.
  const purgedIdsRef = useRef(new Set())
  useEffect(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    transactions.forEach((t) => {
      if (t.deletedAt && t.deletedAt < cutoff && !purgedIdsRef.current.has(t.id)) {
        purgedIdsRef.current.add(t.id)
        deleteDoc(doc(db, 'transactions', t.id))
      }
    })
  }, [transactions])

  const years = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 4)))
    return [...set].sort()
  }, [transactions])

  // Default to the most recent year once data has loaded; a manual pick
  // (below) always overrides this.
  useEffect(() => {
    if (year === null && years.length > 0) setYear(years[years.length - 1])
  }, [years, year])

  // AG Grid's own change detection is keyed on row-data identity, not on
  // "did some external value a valueGetter closes over change" — Konto and
  // Betrag both read `accountFilter` from closure (§3a's account filter),
  // and a plain columnDefs update doesn't reliably make the grid re-run
  // valueGetters for rows it already had cached from the *previous* filter
  // (caught directly by Markus: switching from one filtered account
  // straight to another, e.g. Bar Markus → Bar Julia, left stale values —
  // Betrag showing 0,00 and Konto showing the wrong direction for rows
  // that hadn't been re-evaluated against the new filter). Explicitly
  // telling the grid to recompute every visible cell whenever the filter
  // changes is the documented fix for a valueGetter with an external
  // dependency like this.
  useEffect(() => {
    gridRef.current?.api?.refreshCells({ force: true })
  }, [accountFilter])

  // Keeps the Tags column's own native header filter in sync with
  // accountFilter whenever it's a tag (Markus: clicking a tag to filter
  // should also show that tag in the header filter box) — a single effect
  // covers every way accountFilter can become a tag (a grid chip, a panel
  // button) rather than duplicating the sync at each click site. Clears
  // the column filter back out again the moment the filter becomes an
  // account or nothing, so a stale tag search never lingers in the header
  // after switching away from it. setColumnFilterModel is async — must
  // await before calling onFilterChanged (AG Grid's own doc comment on
  // the method), or the grid re-applies filtering before the new model
  // actually landed.
  useEffect(() => {
    const api = gridRef.current?.api
    if (!api) return
    let cancelled = false
    ;(async () => {
      if (accountFilter && !filteredAccountId) {
        const t = tagById[accountFilter]
        const label = t ? qualifiedTagName(t, tagById) : accountFilter
        // 'contains', not 'equals' — a parent-tag filter (Markus) shows a
        // label like "Schottland", which needs to match a row's own text
        // like "Schottland: Fähre" rather than the whole cell text, and a
        // row carrying more than one tag already renders as a joined
        // "TagA, TagB" list that 'equals' could never match either way;
        // `rows` above is what actually decides inclusion — this is only
        // for the header filter icon/box to visibly agree with it.
        await api.setColumnFilterModel('tags', { filterType: 'text', type: 'contains', filter: label })
      } else {
        await api.setColumnFilterModel('tags', null)
      }
      if (!cancelled) api.onFilterChanged()
    })()
    return () => {
      cancelled = true
    }
  }, [accountFilter, filteredAccountId, tagById])

  const rows = useMemo(() => {
    if (!year) return []
    // A tag filter's own match set — the filtered tag itself plus every
    // *direct* child under it (Markus: filtering by a parent like
    // "Schottland" should also catch "Schottland: Fähre" etc., not just
    // lines tagged with the bare parent) — shared with tagFilterTotal via
    // tagFilterMatchIds() so the row filter and the toolbar's own total
    // can't quietly disagree on what counts as a match.
    const tagMatchIds = accountFilter && !filteredAccountId ? tagFilterMatchIds(accountFilter, tags) : null
    return transactions
      .filter((t) => t.date.startsWith(year))
      // Soft-deleted rows (spec.md §2.9a's layer 4) stay hidden by default,
      // same as every other view — the "Kürzlich gelöscht" toggle is the
      // one deliberate exception that lets them back into the grid itself,
      // visually distinct (below), while still excluded from every
      // aggregation (activeTransactions, above).
      .filter((t) => showDeleted || !t.deletedAt)
      .filter((t) => {
        if (!accountFilter) return true
        // filteredAccountId can't be used here: it's deliberately null for
        // a tag filter (see its own comment), which is exactly the case
        // this needs to still match rows for.
        if (filteredAccountId) return t.fromAccountId === filteredAccountId || t.toAccountId === filteredAccountId
        return (t.lines ?? []).some((l) => (l.tags ?? []).some((id) => tagMatchIds.has(id)))
      })
      .slice()
      .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
  }, [transactions, year, accountFilter, filteredAccountId, tags, showDeleted])

  // Once a pending row (addRow's new row, or a just-edited row that may
  // have moved) actually settles into `rows` — via the Firestore
  // round-trip through onSnapshot, never synchronously available right
  // after a write — scroll it into view and put the cell cursor on the
  // target column, selected too (the blue tint), so both always land on
  // the exact same row together. Not editing it (Markus, re: addRow: he
  // wants the focus rectangle there, ready for a single tap/Enter to open
  // per §1's singleClickEdit, not editing already forced open on arrival).
  useEffect(() => {
    const id = pendingFocusIdRef.current
    if (!id || !rows.some((r) => r.id === id)) return
    const myClaim = pendingFocusClaimRef.current
    pendingFocusIdRef.current = null
    const colId = pendingFocusColRef.current
    const lineIndex = pendingFocusLineIndexRef.current
    pendingFocusLineIndexRef.current = null
    const api = gridRef.current?.api
    if (!api) return
    setTimeout(() => {
      // A newer claim (another edit, or focusGridMidViewport returning
      // focus from the panel) has since been made — let it stand rather
      // than split it with half of this older, now-superseded one.
      if (focusClaimRef.current !== myClaim) return
      let node = api.getRowNode(id)
      // A pending line index means the edit was on a specific split line
      // (Markus: stay there, don't jump to the parent) — find its row by
      // parent + index rather than reconstructing its synthetic id, which
      // now depends on the current line count too (see displayRows) and
      // isn't worth duplicating here. Falls back to the parent's own row
      // if that line somehow no longer exists (e.g. removed elsewhere in
      // the meantime).
      if (lineIndex != null) {
        let lineNode = null
        api.forEachNode((n) => {
          if (n.data?.__isLine && n.data.__parent.id === id && n.data.__lineIndex === lineIndex) lineNode = n
        })
        if (lineNode) node = lineNode
      }
      if (!node) return
      api.ensureNodeVisible(node, 'middle')
      // Selected (the blue tint), not just cell-focused (Markus) — this
      // also means the *next* "+ Neue Buchung" naturally inserts below
      // this new row too, chaining correctly when adding several in a row.
      node.setSelected(true, true)
      api.setFocusedCell(node.rowIndex, colId)
    }, 0)
  }, [rows])

  // What the grid actually renders: `rows` (real transactions) with each
  // expanded split transaction's lines interleaved right after it as
  // synthetic rows (§3a: "parent row... plus its detail rows revealed on
  // expand"). AG Grid Community has no master/detail row support (that's
  // an Enterprise feature) — this is the Community-tier equivalent,
  // feeding the grid one flat array where a "line row" is just an
  // ordinary row with `__isLine: true` that every column def below
  // renders/edits differently. `__parent` is a live reference into `rows`
  // (not a copy), so column defs read/mutate the real transaction object
  // directly, the same pattern already used for every other in-place
  // valueSetter mutation in this file.
  const displayRows = useMemo(() => {
    const out = []
    for (const tx of rows) {
      out.push(tx)
      if ((tx.lines?.length ?? 0) > 1 && expandedIds.has(tx.id)) {
        // The line count is baked into every line's own id here, not just
        // its index — a line has no stable id of its own in the schema
        // (§2.6), so removing/adding a line shifts every later line's
        // *index*, which otherwise means whatever row previously held
        // that index's id (e.g. the old last/remainder line) inherits a
        // *different* line's identity under AG Grid's own id-based row
        // reconciliation — it can't tell "this row moved" from "this id
        // now holds different content" (Markus: a stale leftover row after
        // deleting a non-last line). Baking the count in forces every line
        // row for this transaction to get a genuinely new id whenever the
        // split structure itself changes, so AG Grid fully rebuilds them
        // instead of trying to partially reconcile an ambiguous match —
        // ids stay stable (and updates stay smooth) across a pure value
        // edit, which doesn't change the count.
        tx.lines.forEach((_, i) => {
          out.push({ id: `${tx.id}::line::${i}::${tx.lines.length}`, __isLine: true, __parent: tx, __lineIndex: i })
        })
      }
    }
    return out
  }, [rows, expandedIds])

  // Confirmed column order (spec.md §3a): Datum → Konto → Empfänger →
  // Betrag → Kategorie → Unterkategorie → Details → Tags (plus a narrow,
  // unlabeled delete column at the end — not part of the spec'd order,
  // just an action). Konto is one merged column (not Konto1/Konto2 —
  // revised Sept 2026): the primary account with an arrow to the second
  // one for a transfer, unless an account filter is active, in which case
  // it shows the *other* side only (a single-account register view) and
  // Betrag is re-signed relative to the filtered account instead of the
  // row's own primary side. Only Unterkategorie is stored; Kategorie is
  // its derived parent, but both columns open the same cascading picker.
  //
  // Editing works the same whether or not an account filter is active
  // (rethought Sept 2026 — an earlier version disabled editing entirely
  // while filtered). The only genuinely filter-dependent things are what
  // Konto/Betrag *display*; neither actually needs editing disabled:
  // Konto's editor always edits the real fromAccountId/toAccountId
  // directly, regardless of what the cell shows when not being edited, and
  // Betrag's valueSetter below uses the same "reference account" the
  // display already uses (the filtered account, or Konto1 when unfiltered)
  // to interpret the typed sign — so both stay well-defined either way.
  // Filtering is in fact exactly when you're most likely reviewing and
  // fixing one account's own entries, so disabling editing there was
  // working against the feature's actual purpose.
  const columnDefs = useMemo(
    () => [
      {
        headerName: '',
        colId: 'split',
        width: 56,
        sortable: false,
        filter: false,
        suppressMovable: true,
        resizable: false,
        pinned: 'left',
        // The one control column for expand/split (§3a's "expand chevron
        // and an 'N Positionen' hint" plus starting/continuing a split) —
        // removing a line moved to the trashcan column instead (Markus:
        // it should arm/confirm/red-tint exactly like deleting a whole
        // transaction, not this column's old instant-remove ✕).
        // - Parent, not yet split (≤1 line): "✚" starts the first split
        //   (addSplitLine) and auto-expands, so the newly appended line is
        //   immediately visible without a second click.
        // - Parent, split (>1 lines): a chevron toggling expandedIds.
        // - A line row: blank, except the *last* line (the live remainder)
        //   gets "✚" to split further — "or split further itself
        //   (creating a new remainder each time)".
        cellRenderer: (p) => {
          const row = p.data
          // Every button here goes through the same pendingFocusIdRef/rows
          // effect as a normal cell edit (see handleCellValueChanged) —
          // these are button clicks, not cell edits, so nothing else
          // would otherwise tell the grid which row to re-select once the
          // Firestore round-trip lands. Without this, AG Grid's own
          // selection state was left to drift across the rowData
          // replacement these actions cause, showing a stale blue tint on
          // some other row that happened to land at the same position
          // (Markus, second screenshot). Landing specifically on the
          // *first* line's own Betrag field, not just the transaction's
          // split column (Markus) — that's the natural next step after
          // starting or continuing a split: type how much this piece is.
          if (row.__isLine) {
            const isLast = row.__lineIndex === row.__parent.lines.length - 1
            // No further splitting on an already-deleted transaction
            // (Markus: "i should not be able to create split rows on a
            // deleted item") — the chevron/expand view above this branch
            // is unaffected, only the *creating new lines* affordance is.
            if (!isLast || isRowDeleted(row)) return null
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  addSplitLine(row.__parent)
                  claimPendingFocus(row.__parent.id, 'betrag', 0)
                }}
                title="Weiter aufteilen (Ctrl+T)"
                className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-computed)]"
              >
                ✚
              </button>
            )
          }
          const lineCount = row.lines?.length ?? 0
          if (lineCount > 1) {
            const expanded = expandedIds.has(row.id)
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpanded(row.id)
                }}
                title={expanded ? 'Einklappen' : `${lineCount} Positionen anzeigen`}
                className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)]"
              >
                {expanded ? '▾' : '▸'}
              </button>
            )
          }
          // Same "no split rows on a deleted item" rule as the line-row
          // branch above, for the unsplit-parent case.
          if (isRowDeleted(row)) return null
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                addSplitLine(row)
                setExpandedIds((prev) => new Set(prev).add(row.id))
                claimPendingFocus(row.id, 'betrag', 0)
              }}
              title="Aufteilen (Ctrl+T)"
              className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-computed)]"
            >
              ✚
            </button>
          )
        },
      },
      {
        field: 'date',
        headerName: 'Datum',
        width: 110,
        // Blank and non-editable for a line row — a split transaction has
        // exactly one date, at the parent level; only the economic
        // breakdown (category/tags/note/amount) splits across lines.
        valueGetter: (p) => (p.data.__isLine ? '' : p.data.date),
        editable: (p) => !p.data.__isLine && !isRowDeleted(p.data),
        // Explicitly false, not left to infer — AG Grid samples this
        // column's own data to auto-detect a "cellDataType" when none is
        // set, and a plain ISO string like "2026-04-03" matches its own
        // built-in "dateString" type, which silently swaps in AG Grid's
        // own agDateStringCellEditor (a calendar popup) in place of the
        // plain text editor intended here — confirmed by reading AG Grid's
        // own DataTypeService source (dataTypeMatchers.dateString), and
        // exactly the "modal still opens" behavior Markus reported despite
        // no cellEditor being set on this column at all.
        cellDataType: false,
        // Plain text, like Empfänger/Details — no picker, modal or
        // dropdown at all (Markus, replacing what had been a three-select
        // popup). Accepts flexible European shorthand via
        // parseFlexibleDate; goes through the same default AG Grid text
        // editor + valueSetter pipeline Empfänger/Details already use
        // successfully (unlike the custom popup editors' getValue()/
        // stopEditing() pipeline, which confirmed wasn't reliable there).
        valueSetter: (p) => {
          const parsed = parseFlexibleDate(p.newValue, year)
          if (!parsed) return false
          p.data.date = parsed
          return true
        },
        // glueToParent, not the default value-based sort — every column
        // needs this, not just Datum (Markus: sorting by a different
        // column scattered line rows back to the top too) — see
        // glueToParent's own comment for why.
        comparator: glueToParent((t) => t.date),
        colId: 'date',
        // Markus: header filters on the other columns too, now that
        // building Tags' own turned up that none of them had ever
        // actually been wired up (spec.md §3a's own gap). Plain text
        // ("contains" etc.) works fine even here — Datum is stored as a
        // "YYYY-MM-DD" string, so it compares/sorts correctly as text
        // without needing a real date-typed filter.
        filter: 'agTextColumnFilter',
      },
      {
        headerName: filteredAccountId ? `Gegenkonto (${accountName(filteredAccountId)})` : 'Konto',
        // Deliberately no header filter here, unlike every other column
        // now — spec.md §3a already settled this exact question: "Filtering
        // by account is its own filter, not a plain column filter on Konto"
        // (Sept 2026), precisely because Konto's displayed value is
        // *derived*/relative to whichever account is filtered, not a plain
        // field a text search could meaningfully match against. The
        // dedicated Konto dropdown + pinned panel already cover this.
        // Blank and non-editable for a line row, same reasoning as Datum —
        // Konto is fixed at the parent level for a split transaction.
        valueGetter: (p) => (p.data.__isLine ? '' : kontoValue(p.data)),
        comparator: glueToParent(kontoValue),
        // A cellRenderer, not just the plain valueGetter string, so the
        // arrow is always the exact same glyph mirrored via CSS rather than
        // the → and ← Unicode characters — which, in the grid's font,
        // render at visibly different sizes (caught by Markus). Reads
        // p.data directly rather than re-parsing the value string.
        cellRenderer: (p) => {
          const t = p.data
          if (t.__isLine) return ''
          let other, pointsLeft
          if (filteredAccountId) {
            const outgoing = t.fromAccountId === filteredAccountId
            other = outgoing ? t.toAccountId : t.fromAccountId
            pointsLeft = !outgoing
          } else if (t.fromAccountId && t.toAccountId) {
            other = null // both names are shown as plain text below, no single "other"
            pointsLeft = false
          }
          if (filteredAccountId) {
            if (!other) return '—'
            return (
              <span className="inline-flex items-center gap-1">
                <span style={{ display: 'inline-block', transform: pointsLeft ? 'scaleX(-1)' : undefined }}>→</span>
                {accountName(other)}
              </span>
            )
          }
          if (t.fromAccountId && t.toAccountId) {
            return (
              <span className="inline-flex items-center gap-1">
                {accountName(t.fromAccountId)}
                <span style={{ display: 'inline-block' }}>→</span>
                {accountName(t.toAccountId)}
              </span>
            )
          }
          return accountName(t.fromAccountId ?? t.toAccountId)
        },
        // Editing sets fromAccountId/toAccountId directly, then re-derives
        // amountCents' sign convention (positive magnitude once both sides
        // are real accounts, natural sign for a single-sided row — §2.6),
        // keeping whatever magnitude was already there so switching Konto
        // never silently zeroes the amount.
        valueSetter: (p) => {
          const { fromAccountId, toAccountId } = p.newValue ?? {}
          if (!fromAccountId && !toAccountId) return false
          const magnitude = Math.abs(p.data.amountCents || 0)
          p.data.fromAccountId = fromAccountId
          p.data.toAccountId = toAccountId
          p.data.amountCents = fromAccountId && toAccountId ? magnitude : fromAccountId ? -magnitude : magnitude
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        editable: (p) => !p.data.__isLine && !isRowDeleted(p.data),
        cellEditor: KontoEditor,
        cellEditorParams: { accounts, filteredAccountId, onApply: applyKontoDirect },
        cellEditorPopup: true,
        flex: 1.6,
      },
      {
        headerName: 'Empfänger',
        // A line row has no displayLabel of its own — it shows its own
        // `note` instead (§2.6: each line's own short free-text field,
        // e.g. "Gehalt Markus" for one leg of a split salary deposit),
        // prefixed "↳" on display only (the raw value, what's actually
        // editable, has no prefix — the prefix is cellRenderer-only so
        // editing doesn't start from "↳ " as literal text).
        valueGetter: (p) => (p.data.__isLine ? (p.data.__parent.lines[p.data.__lineIndex]?.note ?? '') : p.data.displayLabel),
        cellRenderer: (p) => (p.data.__isLine ? `↳ ${p.value || '(kein Vermerk)'}` : p.value),
        comparator: glueToParent((t) => t.displayLabel),
        valueSetter: (p) => {
          if (p.data.__isLine) {
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, note: p.newValue ?? '' } : l))
            return true
          }
          p.data.displayLabel = p.newValue ?? ''
          return true
        },
        // A line row's own valueGetter returns its `note`, not the
        // parent's displayLabel — matches what the cellRenderer's "↳"
        // prefix actually reads, so filtering a line row searches the same
        // text that's actually shown for it.
        filter: 'agTextColumnFilter',
        editable: (p) => !isRowDeleted(p.data),
        flex: 1.4,
      },
      {
        headerName: 'Betrag',
        // Explicit colId, not left auto-generated — starting/continuing a
        // split (below) focuses this column by id directly, landing the
        // cursor on the first line's own amount field (Markus).
        colId: 'betrag',
        // A line row shows its own signed amountCents directly — no
        // account-relative sign logic needed here, unlike the parent
        // (§2.6: "a line can be positive or negative independent of the
        // parent's own sign").
        valueGetter: (p) => (p.data.__isLine ? (p.data.__parent.lines[p.data.__lineIndex]?.amountCents ?? 0) : betragValue(p.data)),
        valueFormatter: (p) => centsToEuro(p.value),
        // A number filter (greater/less/equals etc.), not text — but
        // against euros, not the raw stored cents, via filterValueGetter:
        // the column's own value is cents (10000 for 100,00€), and typing
        // "100" to mean "100 euros" is what Markus would actually expect
        // to type, matching what the cell itself displays.
        filter: 'agNumberColumnFilter',
        filterValueGetter: (p) =>
          (p.data.__isLine ? (p.data.__parent.lines[p.data.__lineIndex]?.amountCents ?? 0) : betragValue(p.data)) / 100,
        // Sorting the whole grid by every individual split line's own
        // amount wouldn't be that meaningful anyway — glued to its
        // already-amount-sorted parent (like every other column) is the
        // sensible behavior here too.
        comparator: glueToParent(betragValue),
        // Typed relative to the same "reference account" the display uses
        // (the filtered account if any, else Konto1). Two real accounts
        // always store a positive magnitude regardless of the typed sign
        // (§2.6); a single-sided row keeps exactly the typed sign. A line
        // row's amount is stored exactly as typed, no sign remapping.
        valueSetter: (p) => {
          const cents = parseEuroInput(p.newValue)
          if (cents === null) return false
          if (p.data.__isLine) {
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, amountCents: cents } : l))
            return true
          }
          const { fromAccountId, toAccountId } = p.data
          if (!fromAccountId && !toAccountId) return false
          p.data.amountCents = fromAccountId && toAccountId ? Math.abs(cents) : cents
          return true
        },
        cellEditor: 'agTextCellEditor',
        cellEditorParams: { useFormatter: true },
        // Negative amounts turn amber while an account or tag filter is
        // active (Markus) — reuses --color-expense rather than red: spec.md
        // §1b.4 reserves red exclusively for alerts, never for "this is an
        // expense/negative," and Markus confirmed keeping that rule rather
        // than carving out an exception here. `p.value` is already the
        // resolved signed amount (this column's own valueGetter above), so
        // no separate recomputation is needed.
        cellClass: (p) => 'text-right tabular-figure' + (accountFilter && p.value < 0 ? ' text-[var(--color-expense)]' : ''),
        // The parent, once split, is a fixed total that splitting only
        // ever redistributes (persistTx's own comment) — not directly
        // editable there anymore. A line is editable unless it's the
        // *last* one: that's always the live remainder (persistTx
        // recomputes it on every save), never typed into directly — "the
        // live, auto-generated remaining amount line" (§3a).
        editable: (p) =>
          !isRowDeleted(p.data) &&
          (p.data.__isLine ? p.data.__lineIndex !== p.data.__parent.lines.length - 1 : (p.data.lines ?? []).length <= 1),
        width: 130,
      },
      {
        headerName: 'Kategorie',
        colId: 'kategorie',
        valueGetter: (p) => {
          if (p.data.__isLine) {
            const catId = p.data.__parent.lines[p.data.__lineIndex]?.categoryId
            return catId ? groupName(catId) : '—'
          }
          return kategorieValue(p.data)
        },
        comparator: glueToParent(kategorieValue),
        filter: 'agTextColumnFilter',
        // Same cascading Kategorie→Unterkategorie picker as the
        // Unterkategorie column below — Kategorie has no stored value of
        // its own, so editing it here writes the same categoryId. A
        // fallback path only (Übernehmen/Enter apply directly and cancel
        // AG Grid's own commit via api.stopEditing(true)) — but AG Grid's
        // own Tab handling can still stop editing in *commit* mode, which
        // does reach this. A line row has no `.lines` of its own —
        // ensureLine(p.data) would silently create a bogus one on the
        // synthetic row object and lose the edit, so this branches exactly
        // like the cellEditorParams above.
        valueSetter: (p) => {
          if (p.data.__isLine) {
            const categoryId = p.newValue?.categoryId
            if (!categoryId) return false
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, categoryId } : l))
            return true
          }
          const line = ensureLine(p.data)
          line.categoryId = p.newValue?.categoryId ?? line.categoryId
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        // A line row is always editable here — including the last/remainder
        // line, which "can... be categorized/tagged directly as the final
        // line" (§3a) — a parent row only while unsplit (≤1 line); once
        // split, per-line category editing happens on the expanded rows.
        editable: (p) => (p.data.__isLine || (p.data.lines ?? []).length <= 1) && !isRowDeleted(p.data),
        cellEditor: CategoryEditor,
        // A per-row function, not a static object: a line row needs its
        // own onApply (writing to that specific line, not
        // ensureLine/replace-lines-with-one-element) and its own current
        // selection to pre-highlight, read from that line directly rather
        // than data.lines[0].
        cellEditorParams: (p) =>
          p.data.__isLine
            ? {
                categories,
                initialCategoryId: p.data.__parent.lines[p.data.__lineIndex]?.categoryId ?? null,
                onApply: (_data, categoryId) => applyCategoryToLine(p.data.__parent, p.data.__lineIndex, categoryId),
                onClear: () => clearCategoryToLine(p.data.__parent, p.data.__lineIndex),
                startField: 'group',
              }
            : {
                categories,
                initialCategoryId: (p.data.lines ?? [])[0]?.categoryId ?? null,
                onApply: applyCategoryDirect,
                onClear: () => clearCategoryDirect(p.data),
                startField: 'group',
              },
        cellEditorPopup: true,
        flex: 1.1,
      },
      {
        headerName: 'Unterkategorie',
        colId: 'unterkategorie',
        valueGetter: (p) => {
          if (p.data.__isLine) {
            const catId = p.data.__parent.lines[p.data.__lineIndex]?.categoryId
            return catId ? categoryName(catId) : '—'
          }
          return unterkategorieValue(p.data)
        },
        comparator: glueToParent(unterkategorieValue),
        filter: 'agTextColumnFilter',
        // Same fallback-path reasoning as Kategorie's valueSetter above.
        valueSetter: (p) => {
          if (p.data.__isLine) {
            const categoryId = p.newValue?.categoryId
            if (!categoryId) return false
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, categoryId } : l))
            return true
          }
          const line = ensureLine(p.data)
          line.categoryId = p.newValue?.categoryId ?? line.categoryId
          return true
        },
        cellClass: (p) => (p.value === '—' ? 'text-[var(--color-text-muted)]' : undefined),
        editable: (p) => (p.data.__isLine || (p.data.lines ?? []).length <= 1) && !isRowDeleted(p.data),
        cellEditor: CategoryEditor,
        // startField: 'category' — opening from Unterkategorie directly
        // (Markus) leaves Kategorie as already set and jumps straight to
        // the Unterkategorie list, open and pre-highlighted on the
        // existing selection, instead of starting the chain over at
        // Kategorie every time. Same per-row params as Kategorie above.
        cellEditorParams: (p) =>
          p.data.__isLine
            ? {
                categories,
                initialCategoryId: p.data.__parent.lines[p.data.__lineIndex]?.categoryId ?? null,
                onApply: (_data, categoryId) => applyCategoryToLine(p.data.__parent, p.data.__lineIndex, categoryId),
                onClear: () => clearCategoryToLine(p.data.__parent, p.data.__lineIndex),
                startField: 'category',
              }
            : {
                categories,
                initialCategoryId: (p.data.lines ?? [])[0]?.categoryId ?? null,
                onApply: applyCategoryDirect,
                onClear: () => clearCategoryDirect(p.data),
                startField: 'category',
              },
        cellEditorPopup: true,
        flex: 1.3,
      },
      {
        headerName: 'Details',
        // `detail` is parent-only free text (distinct from each line's own
        // `note`, shown in Empfänger) — blank and non-editable on a line
        // row rather than repeating/splitting the same field.
        valueGetter: (p) => (p.data.__isLine ? '' : p.data.detail),
        comparator: glueToParent((t) => t.detail),
        valueSetter: (p) => {
          if (p.data.__isLine) return false
          p.data.detail = p.newValue ?? ''
          return true
        },
        filter: 'agTextColumnFilter',
        editable: (p) => !p.data.__isLine && !isRowDeleted(p.data),
        flex: 1.3,
      },
      {
        headerName: 'Tags',
        // Explicit colId, not left auto-generated — the Tab-adds-a-row
        // handling below (Markus) needs to identify this exact column
        // reliably from both onCellKeyDown (cell focused, not editing) and
        // TagEditor's own native listener (mid-edit).
        colId: 'tags',
        // The value is the raw tag-id array (or, for a legacy pre-mechanism
        // line, whatever raw strings are still sitting there) — cellRenderer
        // resolves each to a name+color chip; the comparator below uses its
        // own resolved-name string separately (tagsValue), so this can stay
        // the plain array AG Grid actually hands the cellRenderer.
        valueGetter: (p) => (p.data.__isLine ? (p.data.__parent.lines[p.data.__lineIndex]?.tags ?? []) : tagIdsValue(p.data)),
        comparator: glueToParent(tagsValue),
        // Markus's "C": a real header filter, the same convention spec.md
        // §3a already describes for every column ("tag 'has this tag'")
        // but that turned out to have never actually been wired up
        // anywhere in the grid yet (no column had `filter` set at all —
        // caught only because Markus asked for this one specifically).
        // A plain text ("contains") filter against the resolved qualified
        // names, not a picker — simplest thing that works without a
        // custom filter component, and pairs naturally with "B" (clicking
        // a chip) as the precise/one-click alternative to typing a name.
        filter: 'agTextColumnFilter',
        filterValueGetter: (p) =>
          p.data.__isLine
            ? (p.data.__parent.lines[p.data.__lineIndex]?.tags ?? []).map((id) => qualifiedTagName(tagById[id], tagById) || id).join(', ')
            : tagsValue(p.data),
        // Colored fill only for a tag with a determined type (allocation,
        // or a grouping tag with a real groupingType); a plain dashed
        // outline for an unspecified grouping tag *and* an unresolved
        // legacy free-text string alike — same neutral chip either way
        // (Markus, real-usage feedback: a colored "unspecified" tag looked
        // inconsistent right next to an old free-text one). h-full +
        // items-center vertically centers the chip row within the cell
        // (Markus) — AG Grid's own cell wrapper doesn't do this by default
        // for a multi-line-capable custom renderer like this one.
        // Each chip is clickable — sets the grid filter to that tag
        // (Markus's "B": click any tag chip to filter by it, the same
        // shortcut relationship the pinned panel's own account/tag buttons
        // already have to the Konto dropdown).
        //
        // **A native listener via a ref callback, not a React `onClick`**
        // (Markus caught this: clicking a chip was *also* opening the
        // TagEditor popup, even with `e.stopPropagation()` on the React
        // handler) — the exact same race this codebase has hit twice
        // before (Listbox.jsx's Enter fix; the Ctrl+Enter/AG Grid capture-
        // phase fix). AG Grid's `singleClickEdit` starts editing via a
        // plain native click listener attached on the cell/row itself, a
        // real DOM ancestor of this button — but React 17+ doesn't attach
        // a real listener on the button at all, it attaches ONE delegated
        // listener way up at the app's root container and only dispatches
        // to this component's `onClick` once the raw event has already
        // bubbled *past* every ancestor in between, AG Grid's own cell
        // listener included. So AG Grid's closer, real listener always
        // saw the click and started editing before a React `onClick`
        // handler's `stopPropagation()` ever got a chance to run. A
        // native listener assigned directly on this element itself (via
        // the ref callback, `el.onclick =`) runs at the true target phase
        // — strictly before the event starts bubbling anywhere — so it
        // wins the race outright instead of trying to out-run it.
        cellRenderer: (p) => {
          const ids = p.value ?? []
          if (ids.length === 0) return null
          return (
            <div className="flex h-full flex-wrap content-center items-center gap-1 py-0.5">
              {ids.map((id) => {
                const t = tagById[id]
                const colorVar = tagColorVar(t)
                const chipClassName =
                  'rounded-full px-1.5 py-0.5 text-xs ' +
                  (colorVar ? '' : 'border border-dashed border-[var(--color-text-muted)] text-[var(--color-text-muted)]')
                const chipStyle = colorVar
                  ? { color: `var(${colorVar})`, backgroundColor: `color-mix(in srgb, var(${colorVar}) 15%, transparent)` }
                  : undefined
                const parent = tagParent(t, tagById)
                // A child tag ("Schottland: Fähre") splits into two
                // independently clickable halves (Markus: "I need to be
                // able to filter for the parent tag, too, and show the
                // total"). Clicking "Schottland" filters/sums the parent —
                // itself plus every direct child, via tagFilterMatchIds —
                // clicking "Fähre" still filters just that one child,
                // unchanged. The outer pill is a <span>, not a <button>
                // (two real buttons live inside it), same colored/dashed
                // treatment as a plain single-tag chip.
                if (parent) {
                  return (
                    <span key={id} className={chipClassName} style={chipStyle} title="Klicken zum Filtern">
                      <button
                        type="button"
                        ref={(el) => {
                          if (!el) return
                          el.onclick = (e) => {
                            e.stopPropagation()
                            setAccountFilter(parent.id)
                          }
                        }}
                        className="cursor-pointer hover:underline"
                      >
                        {parent.name}
                      </button>
                      {': '}
                      <button
                        type="button"
                        ref={(el) => {
                          if (!el) return
                          el.onclick = (e) => {
                            e.stopPropagation()
                            setAccountFilter(id)
                          }
                        }}
                        className="cursor-pointer hover:underline"
                      >
                        {t.name}
                      </button>
                    </span>
                  )
                }
                return (
                  <button
                    key={id}
                    type="button"
                    ref={(el) => {
                      if (!el) return
                      el.onclick = (e) => {
                        e.stopPropagation()
                        setAccountFilter(id)
                      }
                    }}
                    className={chipClassName + ' hover:opacity-75'}
                    style={chipStyle}
                    title={(t ? '' : 'Alter Freitext-Tag — noch nicht mit einem echten Tag verknüpft. ') + 'Klicken zum Filtern'}
                  >
                    {qualifiedTagName(t, tagById) || id}
                  </button>
                )
              })}
            </div>
          )
        },
        cellEditor: TagEditor,
        // Per-row function, same reason as Kategorie/Unterkategorie above —
        // a line row writes to that specific line (applyTagsToLine), a
        // parent row (only while unsplit) writes via applyTagsDirect.
        cellEditorParams: (p) =>
          p.data.__isLine
            ? {
                tags,
                usedTagValues,
                recentTagValues,
                initialTagIds: p.data.__parent.lines[p.data.__lineIndex]?.tags ?? [],
                onApply: (_data, tagIds) => applyTagsToLine(p.data.__parent, p.data.__lineIndex, tagIds),
                onCreateTag: createTag,
                onTabAddRow: addRow,
              }
            : {
                tags,
                usedTagValues,
                recentTagValues,
                initialTagIds: (p.data.lines ?? [])[0]?.tags ?? [],
                onApply: applyTagsDirect,
                onTabAddRow: addRow,
                onCreateTag: createTag,
              },
        cellEditorPopup: true,
        // Fallback for whatever other way an edit might end (e.g. blur) —
        // same reasoning as Konto/Category's own fallback valueSetter,
        // Übernehmen itself writes directly via onApply and never depends
        // on this running. An empty tagIds array is a valid, intentional
        // commit (a line can carry zero tags) — unlike Kategorie's
        // valueSetter, there's no truthiness guard here.
        valueSetter: (p) => {
          const tagIds = p.newValue?.tagIds
          if (!tagIds) return false
          if (p.data.__isLine) {
            const { __parent: parent, __lineIndex: idx } = p.data
            parent.lines = parent.lines.map((l, i) => (i === idx ? { ...l, tags: tagIds } : l))
            return true
          }
          const line = ensureLine(p.data)
          line.tags = tagIds
          return true
        },
        editable: (p) => (p.data.__isLine || (p.data.lines ?? []).length <= 1) && !isRowDeleted(p.data),
        // Widened (Markus) so two tag chips fit side by side without
        // immediately wrapping onto a second line for the common case.
        flex: 1.6,
        minWidth: 160,
      },
      {
        headerName: '',
        colId: 'delete',
        width: 52,
        sortable: false,
        filter: false,
        suppressMovable: true,
        // A genuinely pinned column, not just lockPosition (which only
        // stops drag-reordering *within* the scrollable area) — pinned
        // columns render outside the scrollable body, to the left of
        // where the vertical scrollbar reserves its space, so the
        // trashcan is never half-covered by it (caught by Markus).
        pinned: 'right',
        resizable: false,
        // Works the same for a line row as for a transaction row (Markus:
        // a breakdown line's own trashcan should arm/confirm/red-tint
        // exactly like a transaction's own, not the split column's old
        // instant-remove ✕, which is gone now — one consistent delete
        // affordance instead of two with different confirmation behavior).
        cellRenderer: (p) => {
          // A soft-deleted transaction (spec.md §2.9a's layer 4), visible
          // only via the "Kürzlich gelöscht" toggle, shows Wiederherstellen
          // (↺) here instead of the trashcan — same two-click arm/confirm
          // as delete, through the very same handleDeleteClick (Markus:
          // "assign the same DEL button shortcut... two clicks, charge =>
          // undelete" — deleting and undeleting the same row is symmetric,
          // 4 presses of DEL/clicks total, not delete-then-single-click).
          // Never true for a line row: a line's own removal (removeLine)
          // doesn't go through deletedAt at all, only a whole transaction
          // does.
          const deleted = !p.data.__isLine && p.data.deletedAt
          const armed = confirmDeleteId === p.data.id
          const title = armed
            ? deleted
              ? 'Nochmal klicken zum Wiederherstellen'
              : 'Nochmal klicken zum Löschen'
            : deleted
              ? 'Wiederherstellen'
              : p.data.__isLine
                ? 'Position löschen'
                : 'Buchung löschen'
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteClick(p.data)
              }}
              title={title}
              className={
                'w-full rounded px-1 text-xs ' +
                (armed
                  ? 'font-semibold text-[var(--color-alert)]'
                  : deleted
                    ? 'text-[var(--color-computed)] hover:opacity-75'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-alert)]')
              }
            >
              {armed ? '⚠︎' : deleted ? '↺' : '🗑'}
            </button>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountName/categoryName/groupName/ensureLine/handleDeleteClick/toggleExpanded/createTag close over these
    [accountById, categoryById, tagById, usedTagValues, recentTagValues, accountFilter, accounts, categories, tags, confirmDeleteId, year, expandedIds],
  )

  const panel = useMemo(() => {
    if (!year) return []
    return REPORTING_GROUPS.map((group) => {
      const groupAccounts = accounts.filter((a) => a.reportingGroup === group && a.tracked !== false)
      const groupAccountIds = new Set(groupAccounts.map((a) => a.id))
      const items = groupAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        cents: jahresende(a.id, Number(year), activeTransactions),
      }))
      const total = items.reduce((sum, i) => sum + i.cents, 0)
      // Allocation-tag reconciliation, surfaced here per spec.md §3a's own
      // "Live consistency checks" note ("should surface here, since
      // Konten's pinned header is one of the natural places for always-on
      // reconciliation to live") — Markus asked to see these directly,
      // not just trust the invariant holds invisibly. A tag whose targets
      // span more than one reportingGroup (none currently do) would show
      // under each group it touches; Anlage Familie/Sophia (targeting all
      // four Geldanlage accounts as one combined pool, §2.5) show once,
      // under Geldanlage, not once per account.
      const tagItems = tags
        .filter((t) => t.class === 'allocation')
        .filter((t) => (t.reconciliationTargetAccountIds ?? []).some((id) => groupAccountIds.has(id)))
        .map((t) => ({ id: t.id, name: t.name, cents: tagJahresende(t.id, Number(year), activeTransactions, tags), tag: t }))
      // Open claims/loans on the shared Außenstände account (Markus's
      // design, Sept 2026) — unlike the allocation-tag rows above, there's
      // no stored per-tag target to read (every claim tag here shares the
      // one same account, tagFilterTotal hardcodes it rather than needing
      // one), so the candidate tag list itself has to be *discovered*:
      // every distinct tag used on a line whose transaction touches
      // Außenstände. "Open" (shown) vs. "settled" (silently drops off the
      // list, same as the loan mechanism already described in spec.md
      // §3a) is exactly "does its total come out to zero."
      if (group === 'Außenstände' && groupAccountIds.has(AUSSENSTAENDE_ACCOUNT_ID)) {
        const candidateTagIds = new Set()
        activeTransactions.forEach((t) => {
          if (t.fromAccountId === AUSSENSTAENDE_ACCOUNT_ID || t.toAccountId === AUSSENSTAENDE_ACCOUNT_ID) {
            ;(t.lines ?? []).forEach((l) => (l.tags ?? []).forEach((tagId) => candidateTagIds.add(tagId)))
          }
        })
        const claimItems = [...candidateTagIds]
          .map((tagId) => ({
            id: tagId,
            name: tagById[tagId]?.name ?? tagId,
            cents: tagFilterTotal(tagId, `${year}-12-31`, activeTransactions, AUSSENSTAENDE_ACCOUNT_ID, tags),
            tag: tagById[tagId],
          }))
          .filter((i) => i.cents !== 0)
        return { group, items, total, tagItems: [...tagItems, ...claimItems] }
      }
      return { group, items, total, tagItems }
    })
  }, [accounts, activeTransactions, tags, tagById, year])

  const stillLoading = !(loaded.accounts && loaded.categories && loaded.tags && loaded.transactions)

  if (stillLoading) {
    return <p className="px-6 py-4 text-[var(--color-text-muted)]">Lädt…</p>
  }
  if (accounts.length === 0) {
    return (
      <p className="px-6 py-4 text-[var(--color-text-muted)]">
        Noch keine Daten importiert — siehe „Datenimport“ oben rechts.
      </p>
    )
  }

  // The tag-filter total (Markus, thought through together before coding):
  // shown only while filtered by a tag, never an account (the panel
  // already shows an account's own balance). Branches on the tag's own
  // class, since they need genuinely different math: an allocation tag
  // already has a correct, real reconciliation-target-based figure
  // (tagJahresende, same as the panel's own allocation rows use) — reusing
  // that here rather than tagFilterTotal's Außenstände-specific rule,
  // which doesn't know about Anlage Familie's four target accounts and
  // would just undercount it. Everything else (a grouping tag — a trip,
  // an expense breakdown, a claim/loan, or an unresolved legacy string)
  // goes through tagFilterTotal.
  const filteredTagForSum = accountFilter && !filteredAccountId ? tagById[accountFilter] : null
  const tagFilterSum =
    accountFilter && !filteredAccountId
      ? filteredTagForSum?.class === 'allocation'
        ? tagJahresende(accountFilter, Number(year), activeTransactions, tags)
        : tagFilterTotal(accountFilter, `${year}-12-31`, activeTransactions, AUSSENSTAENDE_ACCOUNT_ID, tags)
      : null

  return (
    <div className="flex min-h-full flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Jahr:</span>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={
                'rounded-md px-3 py-1 text-sm ' +
                (y === year
                  ? 'bg-[var(--color-computed)] text-white'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]')
              }
            >
              {y}
            </button>
          ))}
        </div>

        {/* The account filter from spec.md §3a's filtering section — not the
            same as a column filter on Konto (see the note there): this shows
            every transaction touching the chosen account, either side, from
            that account's own perspective. Clicking an account in the panel
            below is a shortcut for picking it here. */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Konto:</span>
          <select
            ref={accountSelectRef}
            // filteredAccountId, not accountFilter directly — when a tag
            // filter is active this select (accounts only) has no
            // matching <option> at all; falling back to "Alle Konten"
            // here reads correctly instead of showing nothing selected.
            value={filteredAccountId ?? ''}
            onChange={(e) => setAccountFilter(e.target.value || null)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          >
            <option value="">Alle Konten</option>
            {/* Grouped by reportingGroup, via <optgroup> — a flat
                alphabetical list across every account made arrow-key
                navigation jump between unrelated groups (e.g. Consors
                straight to CPAM, caught by Markus); this keeps arrow-key
                movement inside one block at a time, same as the pinned
                panel above reads. */}
            {REPORTING_GROUPS.map((group) => {
              const groupAccounts = accounts
                .filter((a) => a.reportingGroup === group && a.tracked !== false && a.group !== 'system')
                .sort((a, b) => a.name.localeCompare(b.name))
              if (groupAccounts.length === 0) return null
              return (
                <optgroup key={group} label={group}>
                  {groupAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </div>

        {/* spec.md §2.9a's layer 4 recovery mechanism — off by default, so
            a soft-deleted transaction stays invisible in normal use;
            switched on, it reappears in `rows` above (greyed) with its own
            Wiederherstellen action. */}
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Kürzlich gelöscht
        </label>
        {/* Manual "empty the trash" (Markus), only reachable while browsing
            the deleted rows — a real, irreversible delete, so it opens a
            confirmation modal (below) rather than firing on click alone. */}
        {showDeleted && (
          <button
            type="button"
            onClick={() => setConfirmPurgeOpen(true)}
            title="Alle gelöschten Buchungen endgültig entfernen"
            className="rounded px-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-alert)]"
          >
            🗑
          </button>
        )}

        <button
          type="button"
          onClick={addRow}
          title="Fügt eine leere Zeile direkt unter der markierten Zeile ein (mit deren Datum) (Ctrl+'+')"
          className="rounded-md bg-[var(--color-computed)] px-3 py-1 text-sm font-medium text-white"
        >
          + Neue Buchung
        </button>

        {/* Everything right-aligned lives in one shared wrapper with a
            single `ml-auto` — Markus caught a real layout bug from an
            earlier version of this that gave the Summe/Filter-zurücksetzen
            group *and* the (i) icon each their own `ml-auto`: flexbox
            splits the row's free space evenly across every auto-margin
            item present, which opened a large visible gap between the two
            instead of pushing them snugly together. One wrapper, always
            rendered (so the (i) icon still lands at the far right even
            when the Summe/Filter-zurücksetzen content isn't), with its own
            internal `gap-3` handling the spacing between whichever of its
            children are actually present. */}
        <div className="ml-auto flex items-center gap-3">
          {/* Markus: the tag-filter total ("thought through together before
              coding" — right where you're already looking once you've
              filtered, not a new panel section, which only makes sense for
              tags with real account-reconciliation semantics) and the
              "clear everything" action grouped together (a tag filter with
              no column filter shows only the sum; a plain column filter
              with no tag shows only the reset button; either way both stay
              pinned to the right edge, next to the (i) icon below). */}
          {tagFilterSum !== null && (
            <span className="text-sm text-[var(--color-text-muted)]">
              Angezeigt:{' '}
              <span className="tabular-figure font-medium text-[var(--color-computed)]">{centsToEuro(tagFilterSum)} €</span>
            </span>
          )}
          {(accountFilter || anyColumnFilter) && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
            >
              Filter zurücksetzen
            </button>
          )}

          {/* Keyboard-shortcuts help (Markus): hover shows the list; Ctrl+I
              toggles the same popover without needing the mouse; Escape (or
              Ctrl+I again) closes it — see the two effects above for the
              actual key handling. Always the very last/rightmost item in
              the toolbar (Markus). */}
          <div className="relative">
            <button
              type="button"
              onMouseEnter={() => setShortcutsOpen(true)}
              onMouseLeave={() => setShortcutsOpen(false)}
              title="Tastenkürzel (Strg+I)"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-computed)]"
            >
              i
            </button>
            {shortcutsOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text)] shadow-lg">
                <div className="mb-1.5 font-medium">Tastenkürzel</div>
                <ul className="space-y-1">
                  <li>
                    <b>Strg++</b> — Neue Buchung
                  </li>
                  <li>
                    <b>Strg+T</b> — Aufteilen / weiter aufteilen
                  </li>
                  <li>
                    <b>Strg+K</b> — Sprung ins Konto-Panel
                  </li>
                  <li>
                    <b>Strg+H</b> — Kürzlich gelöscht ein-/ausblenden
                  </li>
                  <li>
                    <b>Strg+F</b> — Spalte filtern
                  </li>
                  <li>
                    <b>Strg+S</b> — Spalte sortieren
                  </li>
                  <li>
                    <b>Strg+Umschalt+F</b> — Filter zurücksetzen
                  </li>
                  <li>
                    <b>Strg+I</b> — diese Übersicht ein-/ausblenden
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pinned balance panel — Jahresende(selected year) per account,
          grouped by reportingGroup (spec.md §2.2/§1b.3's "pinned balance
          panel" pattern). This is the direct testable check from PLAN.md
          Phase 1a: every figure here should match the real Gsheet closing
          balance for that account/year. Each account is also a shortcut
          into the account filter above. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {panel.map(({ group, items, total, tagItems }) => (
          <div key={group} data-group={group} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-1 flex items-baseline justify-between">
              {/* The group heading itself is a shortcut back to "Alle
                  Konten" — there's no group-level filter (only single
                  accounts), so this just clears whatever's currently
                  selected. */}
              <button
                type="button"
                onClick={() => setAccountFilter(null)}
                title='Filter zurücksetzen ("Alle Konten")'
                className="text-sm font-semibold hover:underline"
              >
                {group}
              </button>
              <span className="tabular-figure text-sm text-[var(--color-computed)]">{centsToEuro(total)} €</span>
            </div>
            <ul className="flex flex-col gap-0.5 text-xs text-[var(--color-text-muted)]">
              {/* Accounts, then this group's own allocation tags (Markus:
                  the tag rows must be fully part of the same filter/
                  cycling, not a separate read-only list) — one combined
                  <ul> so ArrowUp/Down's `closest('ul').querySelectorAll
                  ('button')` naturally sweeps through both together, tags
                  last. accountFilter (the shared state, despite its name)
                  holds either an account id or a tag id — every consumer
                  below (`rows`, Ctrl+K's active-button lookup) already
                  branches on which kind it actually got. */}
              {[...items.map((i) => ({ ...i, kind: 'account' })), ...tagItems.map((i) => ({ ...i, kind: 'tag' }))].map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    data-filter-id={i.id}
                    onClick={() => setAccountFilter(i.id)}
                    // Up/Down: move within this group's <ul>, listbox-style
                    // (plain <button>s have no built-in arrow-key behavior
                    // the way a <select> does), and *apply the filter as
                    // you move* — Markus: arrow keys should act like the
                    // dropdown's, not just move a focus rectangle. Left/
                    // Right: jump to the first account of the adjacent
                    // reportingGroup box (Barkonten/Sparkonten/Geldanlage/
                    // Außenstände, in that fixed order) via the panel's own
                    // data-group wrapper and DOM sibling order. Escape:
                    // back to "Alle Konten", then to the grid. Enter: keep
                    // whatever's currently highlighted as the filter, then
                    // *also* to the grid — same destination, different
                    // filter outcome. Ctrl+K (see the effect above) closes
                    // the loop back to here, at the active filter's button.
                    onKeyDown={(e) => {
                      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape', 'Enter'].includes(e.key)) {
                        return
                      }
                      e.preventDefault()
                      if (e.key === 'Escape') {
                        setAccountFilter(null)
                        focusGridMidViewport()
                        return
                      }
                      if (e.key === 'Enter') {
                        setAccountFilter(i.id)
                        focusGridMidViewport()
                        return
                      }
                      let target
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        const buttons = [...e.currentTarget.closest('ul').querySelectorAll('button')]
                        target = buttons[buttons.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]
                      } else {
                        const panel = e.currentTarget.closest('[data-group]')
                        const sibling = e.key === 'ArrowRight' ? panel.nextElementSibling : panel.previousElementSibling
                        target = sibling?.querySelector('ul button')
                      }
                      if (!target) return
                      target.focus()
                      setAccountFilter(target.dataset.filterId)
                    }}
                    className={
                      'flex w-full justify-between gap-2 rounded px-1 text-left hover:bg-[var(--color-bg)] ' +
                      (i.kind === 'tag'
                        ? i.id === accountFilter
                          ? 'font-semibold'
                          : ''
                        : i.id === accountFilter
                          ? 'text-[var(--color-computed)]'
                          : 'text-[var(--color-text-muted)]')
                    }
                    style={i.kind === 'tag' && tagColorVar(i.tag) ? { color: `var(${tagColorVar(i.tag)})` } : undefined}
                  >
                    <span>{i.name}</span>
                    <span className="tabular-figure">{centsToEuro(i.cents)} €</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* A fixed height, not flex-1/min-h-0: that relied on main having a
          bounded height, which broke the moment the panel above grew taller
          than the viewport on a narrow screen (nothing could scroll to
          reach the grid at all). This way the grid always has its own
          working internal scroll, and the page itself scrolls normally if
          the panel above is tall. */}
      <div className="h-[70vh] min-h-[360px]">
        <AgGridReact
          ref={gridRef}
          theme={themeQuartz}
          rowData={displayRows}
          columnDefs={columnDefs}
          // Mirrors AG Grid's own column-filter state into React (Markus's
          // "Filter zurücksetzen" button needs to know this) — also fires
          // for the Tags column's filter model being set/cleared
          // programmatically (the tag-chip-click sync effect above), not
          // just a header icon the user opened by hand, which is exactly
          // right: either way there's a real active filter to show/clear.
          onFilterChanged={(e) => setAnyColumnFilter(e.api.isAnyFilterPresent())}
          // suppressMovable (not just per-column, so it also covers the
          // default column menu) keeps the spec'd column order fixed —
          // Markus's request: no accidental drag-reordering or hiding.
          defaultColDef={{ suppressMovable: true }}
          // Single-row selection just for "+ Neue Buchung"'s "insert below
          // the selected row" — not a bulk-actions feature.
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          // No hover tint: on a touchscreen the last tap leaves the pointer
          // parked on screen, so the hover highlight sticks to whichever row
          // scrolls under that spot — a second "selected-looking" row that
          // follows scrolling (Markus). The selection tint already marks the
          // current row.
          suppressRowHoverHighlight
          // One click starts editing an editable cell, not AG Grid's
          // default double-click — Markus's date-field report ("double
          // click... then a third click to open the date selector") was
          // partly this: the first click was only ever selecting the row,
          // never starting the edit at all.
          singleClickEdit={true}
          getRowId={(p) => p.data.id}
          onCellValueChanged={handleCellValueChanged}
          undoRedoCellEditingLimit={20}
          // Tints a row pale red while its delete is armed, waiting for
          // the confirming second click/Delete/trashcan tap (Markus: red,
          // not grey — an earlier version used opacity/grayscale) — pale
          // green instead when the armed action is actually an *undelete*
          // (Markus: "instead of turning red, turn the row in a green tint
          // when staged for undeletion") — the second delete-key/click on
          // an already-deleted row restores it, a positive action, not a
          // destructive one, so it shouldn't read as the same warning red.
          // Paired with the redrawRows() effect above, since getRowStyle
          // alone isn't re-evaluated for existing rows just because React
          // state changed elsewhere. A split transaction's own line rows
          // get a distinct subtle tint too (Markus), so they read as
          // visually separate from ordinary transaction rows at a glance —
          // armed red/green still wins if a line row is somehow both.
          getRowStyle={(p) => {
            if (confirmDeleteId === p.data.id) {
              return { backgroundColor: p.data.deletedAt ? 'var(--color-income-tint)' : 'var(--color-alert-tint)' }
            }
            // "Visually distinct" for a soft-deleted row surfaced via the
            // "Kürzlich gelöscht" toggle (spec.md §2.9a's layer 4, "e.g.
            // struck through/greyed") — a different case from the armed-
            // delete red above (that's "about to delete," this is "already
            // deleted, browsing to restore"), so opacity here doesn't
            // conflict with the "red, not grey" call made for arming.
            if (!p.data.__isLine && p.data.deletedAt) return { opacity: 0.5 }
            if (p.data.__isLine) return { backgroundColor: 'var(--color-line-row-tint)' }
            return undefined
          }}
          // Keyboard cell navigation moves the row selection (the blue
          // tint) along with it, not just the mouse click (Markus: "it
          // will be clearer to know which row is selected"). This also
          // means "+ Neue Buchung"'s insert-below-selected-row now follows
          // wherever arrow keys left the cursor, not only the last click.
          onCellFocused={(p) => {
            if (p.rowIndex == null) return
            const node = p.api.getDisplayedRowAtIndex(p.rowIndex)
            node?.setSelected(true, true)
            // Real focus movement (Tab/arrow/click), not our own settle
            // effect's setFocusedCell call below, supersedes any claim for
            // a *different* target the moment it happens — otherwise a
            // Firestore round-trip landing after the user has already
            // tabbed away yanks focus back to the cell they just left
            // (Markus: hitting Tab right after an edit "jumps back to the
            // edited cell," needing a second Tab press). Matches this claim
            // by the exact same identity the settle effect itself uses
            // (transaction id + column + line index), so our *own*
            // programmatic refocus onto the still-pending target never
            // trips this — only a genuinely different cell does.
            const data = node?.data
            const targetId = data?.__isLine ? data.__parent.id : data?.id
            const targetLineIndex = data?.__isLine ? data.__lineIndex : null
            const stillPending =
              pendingFocusIdRef.current != null &&
              pendingFocusIdRef.current === targetId &&
              pendingFocusColRef.current === p.column?.getColId() &&
              pendingFocusLineIndexRef.current === targetLineIndex
            if (!stillPending) {
              pendingFocusIdRef.current = null
              focusClaimRef.current += 1
            }
          }}
          // The keyboard Delete key does the same thing as clicking the
          // trashcan (Markus's request) — same two-click-style arm/confirm
          // via handleDeleteClick, not an instant delete. Ignored while a
          // cell is actively being edited, so Delete still just edits text
          // like normal (clearing a character/selection) rather than also
          // arming row deletion underneath it.
          onCellKeyDown={(p) => {
            const key = p.event?.key
            if (key !== 'Delete' || p.api.getEditingCells().length > 0) return
            handleDeleteClick(p.data)
          }}
          // Datum sorted ascending on first load only (the underlying rows
          // are already date-sorted anyway — this is just the header
          // arrow). Previously this was hard-set on the Datum colDef
          // itself, which made it stick around as a permanent secondary
          // sort criterion alongside whatever column got clicked afterward
          // — the "Datum 2 / Betrag 1" priority badges Markus ran into.
          // initialState applies once and then gets out of the way, so
          // clicking any column header now does a normal single-column
          // sort/replace.
          initialState={{ sort: { sortModel: [{ colId: 'date', sort: 'asc' }] } }}
        />
      </div>
      {/* Confirmation for purgeAllDeleted (Markus) — a real, irreversible
          delete, unlike everything else this trashcan icon does elsewhere
          in this file, so it gets its own explicit confirmation step rather
          than the grid's own click-twice pattern. `position: fixed` renders
          as a full-viewport overlay regardless of nesting depth, so this
          can live right here rather than needing a portal. */}
      {confirmPurgeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmPurgeOpen(false)}>
          <div
            className="w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-sm font-medium">Gelöschte Buchungen endgültig entfernen?</div>
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              {transactions.filter((t) => t.deletedAt).length} gelöschte Buchung(en) werden unwiderruflich entfernt, nicht nur aus der
              Ansicht.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmPurgeOpen(false)}
                className="rounded px-3 py-1 text-sm text-[var(--color-text-muted)]"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={purgeAllDeleted}
                className="rounded bg-[var(--color-alert)] px-3 py-1 text-sm font-medium text-white"
              >
                Endgültig löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
