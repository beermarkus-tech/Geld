// Stand-in for every nav destination spec.md §1b.2 lists that isn't built
// yet (Dashboard, Quickview, Fortschritt, Monatsabschluss, Außenstände,
// Settings) — resolved Sept 2026 (Markus): every item gets a real nav
// entry from the start rather than being left out until its own phase
// ships, so the nav's shape is visibly complete even while most of it is
// still under construction.
export default function PlaceholderScreen({ title }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-[var(--color-text-muted)]">Kommt noch — dieser Bereich ist noch nicht gebaut.</p>
    </div>
  )
}
