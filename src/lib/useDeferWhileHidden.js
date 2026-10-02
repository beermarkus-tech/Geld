import { useCallback, useEffect, useRef } from 'react'

// Screens that stay mounted while hidden (App.jsx) used to re-render and
// recompute their whole report on every save made on another screen — a
// second of lag per edit on a tablet (Oct 2026, Markus). This wraps the
// state update of a live-data listener: while the screen is hidden the newest
// update is only remembered and applied the moment the screen becomes visible
// again; the very first update always applies, so the screen is loaded by the
// time it is first opened.
//
//   const sync = useDeferWhileHidden(active)
//   onSnapshot(..., (snap) => { const v = ...; sync(() => setTransactions(v)) })
export function useDeferWhileHidden(active) {
  const activeRef = useRef(active)
  activeRef.current = active
  const pending = useRef(null)
  const first = useRef(true)
  useEffect(() => {
    if (active && pending.current) {
      const apply = pending.current
      pending.current = null
      apply()
    }
  }, [active])
  return useCallback((apply) => {
    if (first.current || activeRef.current) {
      first.current = false
      pending.current = null
      apply()
    } else {
      pending.current = apply
    }
  }, [])
}
