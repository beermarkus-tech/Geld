import { useEffect, useState } from 'react'

import { zoomLooksOff } from './lib/zoomGuard'

// A small hint while the browser is zoomed away from 100 % (see lib/zoomGuard.js):
// the app cannot reset it, Ctrl+0 does. Disappears by itself once fixed.
export default function ZoomHint() {
  const [off, setOff] = useState(() => zoomLooksOff())
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    const check = () => setOff(zoomLooksOff())
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  if (!off || dismissed) return null
  return (
    <div role="status" className="fixed bottom-2 left-2 z-50 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] shadow-md">
      <span>Browser-Zoom ist nicht 100 % — Strg+0 setzt ihn zurück.</span>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Hinweis schließen" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        ×
      </button>
    </div>
  )
}
