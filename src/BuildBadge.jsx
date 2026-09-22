// Total commit count at build time (vite.config.js) — a free, always-correct
// build identifier. Visible in every app state (signed in or not) so Markus
// can always tell which deploy he's looking at, on-screen and in chat.
export default function BuildBadge() {
  return (
    <span
      className="tabular-figure pointer-events-none fixed z-50 text-[10px] text-[var(--color-text-muted)] opacity-60"
      style={{
        right: 'calc(env(safe-area-inset-right, 0px) + 6px)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4px)',
      }}
    >
      Build {__BUILD_NUMBER__}
    </span>
  )
}
