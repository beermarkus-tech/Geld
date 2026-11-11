// "Do not auto-sort a table" (Nov 2026, Markus): once rows are on screen, editing a value must never
// make a row jump to its sorted place – the order only changes when the table is sorted by hand.
//
// AG Grid re-sorts after every edit; `postSortRows` lets us undo that. The grid keeps the order it
// showed last (`locked`) and puts every row back there. Rows it has not seen yet (a new booking, data
// arriving from elsewhere) go right after the row that precedes them in the sorted order. A change of
// the sort setting (header click, shortcut) releases the lock, so the new sort is applied once and
// becomes the new locked order.

/** Pure core. `sorted` = keys in AG Grid's sorted order, `locked` = keys in the order last shown (or null). */
export function stickyReorder(sorted, locked) {
  if (!locked) return sorted
  const pos = new Map(locked.map((k, i) => [k, i]))
  const out = sorted.filter((k) => pos.has(k)).sort((a, b) => pos.get(a) - pos.get(b))
  let prevKnown = null
  let insertedAfter = -1
  for (const k of sorted) {
    if (pos.has(k)) {
      prevKnown = k
      insertedAfter = -1
      continue
    }
    const at = insertedAfter >= 0 ? insertedAfter + 1 : prevKnown === null ? 0 : out.indexOf(prevKnown) + 1
    out.splice(at, 0, k)
    insertedAfter = at
  }
  return out
}

/**
 * One per grid. `apply(nodes, sortSignature, keyOf, isChild)`: reorders AG Grid's sorted `nodes` in place.
 * Rows for which `isChild(node)` is true (a split booking's line rows) stay glued behind the row before them.
 */
export function createStickyOrder() {
  let locked = null
  let lastSig = null
  return {
    apply(nodes, sig, keyOf, isChild = () => false) {
      if (sig !== lastSig) {
        lastSig = sig
        locked = null
      }
      // group = a row plus the child rows right behind it
      const groups = []
      for (const n of nodes) {
        if (isChild(n) && groups.length) groups[groups.length - 1].push(n)
        else groups.push([n])
      }
      const byKey = new Map(groups.map((g) => [keyOf(g[0]), g]))
      const keys = stickyReorder(groups.map((g) => keyOf(g[0])), locked)
      if (locked) {
        nodes.length = 0
        for (const k of keys) nodes.push(...byKey.get(k))
      }
      if (keys.length) locked = keys
    },
    unlock() {
      locked = null
    },
  }
}

// A stable `postSortRows` for a grid (lib/stickyOrder.js): AG Grid re-sorts and redraws the rows whenever
// this option's identity changes, which made every click redraw the table and swallowed double-clicks.
export function makeStickyPostSort(stickyOrder, getApi, keyOf, isChild) {
  return (params) => {
    const sig = (getApi()?.getColumnState() ?? [])
      .filter((c) => c.sort)
      .map((c) => `${c.colId}:${c.sort}:${c.sortIndex ?? 0}`)
      .join(',')
    stickyOrder.apply(params.nodes, sig, keyOf, isChild)
  }
}
