import { useEffect, useState } from 'react'

// True below the tablet breakpoint (Tailwind `md`, 768 px) — the phone
// layout (Nov 2026, Pixel 7). For the few places where CSS classes alone
// can't switch the layout (AG Grid columns, a different Verlauf view).
const QUERY = '(max-width: 767px)'

export function isNarrow() {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches
}

export function useNarrow() {
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    const q = window.matchMedia(QUERY)
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return narrow
}
