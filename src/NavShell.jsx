import { useEffect, useState } from 'react'

// Screen-to-component map lives in App.jsx (spec.md §3's own status table) —
// this file only owns the nav item list/labels and the shell chrome
// (header, sidebar, bottom nav) that surrounds whatever App.jsx renders as
// `children`. Order matches spec.md §1b.2's tablet sidebar list exactly.
// PRIMARY_ITEMS get their own bottom-nav button on phone (§1b.2: "5 items");
// MORE_ITEMS are reached via phone's "More" sheet, but sit inline in the
// tablet sidebar alongside PRIMARY_ITEMS — same destinations either way,
// just a layout difference (§1b.2's own wording).
export const PRIMARY_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'konten', label: 'Konten' },
  { id: 'verlauf', label: 'Verlauf' },
  { id: 'planung', label: 'Planung' },
]
export const MORE_ITEMS = [
  { id: 'quickview', label: 'Quickview' },
  { id: 'fortschritt', label: 'Fortschritt' },
  { id: 'monatsabschluss', label: 'Monatsabschluss' },
  { id: 'aussenstaende', label: 'Außenstände' },
  { id: 'importexport', label: 'Import/Export' },
  { id: 'settings', label: 'Settings' },
]
export const ALL_ITEMS = [...PRIMARY_ITEMS, ...MORE_ITEMS]

const SIDEBAR_COLLAPSED_KEY = 'geld-sidebar-collapsed'

// Per-device convenience only (spec.md §1b.2: "not synced app data") — a
// read/write failure (private browsing, blocked storage) just means the
// sidebar starts expanded every time, never a crash.
function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function NavButton({ item, active, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        'rounded-md px-3 py-2 text-left text-sm ' +
        (active ? 'bg-[var(--color-computed)] text-white' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]') +
        ' ' +
        className
      }
    >
      {item.label}
    </button>
  )
}

export default function NavShell({ activeView, onNavigate, year, years, onYearChange, userEmail, usingCachedSession, onSignOut, children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // Per-device convenience only — nothing to recover from here.
    }
  }, [sidebarCollapsed])

  function navigate(id) {
    onNavigate(id)
    setMoreOpen(false)
  }

  useEffect(() => {
    if (!moreOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  const activeItem = ALL_ITEMS.find((i) => i.id === activeView)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Burger — tablet only (md:), next to "Geld" (Markus's own
              placement request) — toggles the sidebar's collapsed state so
              the content area can reclaim the full width when it isn't
              needed. Phone has no sidebar to toggle, so no burger there. */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Seitenleiste einblenden' : 'Seitenleiste ausblenden'}
            className="hidden h-8 w-8 items-center justify-center rounded-md text-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] md:flex"
          >
            ☰
          </button>
          <h1 className="text-lg font-semibold">Geld</h1>
          {/* Screen title alongside the fixed "Geld" brand (spec.md §1b.3:
              "screen title... top app bar") — a plain dash-separated suffix
              rather than replacing "Geld" outright, so the app's own name
              stays the one constant landmark across every screen. */}
          {activeItem && <span className="text-sm text-[var(--color-text-muted)]">— {activeItem.label}</span>}
        </div>

        <div className="flex items-center gap-3">
          {/* The single global year selector (spec.md §1b.2a) — lives here,
              not per-screen, and drives Konten today (Verlauf/Planung once
              they exist). `years` comes from whichever screen currently
              knows what data exists (Konten reports it up via
              onYearsChange) — empty until that first reports in. */}
          {years.length > 0 && (
            <div className="flex items-center gap-1">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => onYearChange(y)}
                  className={
                    'rounded-md px-2.5 py-1 text-sm ' +
                    (y === year ? 'bg-[var(--color-computed)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-muted)]')
                  }
                >
                  {y}
                </button>
              ))}
            </div>
          )}
          {userEmail && (
            <span className="hidden text-sm text-[var(--color-text-muted)] sm:inline">
              {userEmail}
              {usingCachedSession && ' (zwischengespeichert)'}
            </span>
          )}
          <button type="button" onClick={onSignOut} className="text-sm text-[var(--color-text-muted)]">
            Abmelden
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Tablet sidebar — hidden entirely below md, hidden entirely (not
            just icons-only) when collapsed, per spec.md §1b.2: "so the
            content area can reclaim the full screen width." */}
        {!sidebarCollapsed && (
          <nav className="hidden w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:flex">
            {ALL_ITEMS.map((item) => (
              <NavButton key={item.id} item={item} active={item.id === activeView} onClick={() => navigate(item.id)} />
            ))}
          </nav>
        )}

        <main className="flex flex-1 flex-col overflow-y-auto pb-16 md:pb-0">{children}</main>
      </div>

      {/* Phone bottom nav — hidden at md and above, where the sidebar takes
          over navigation instead (spec.md §1b.2). */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden">
        {PRIMARY_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.id)}
            aria-current={item.id === activeView ? 'page' : undefined}
            className={
              'flex-1 py-2 text-center text-xs ' +
              (item.id === activeView ? 'font-semibold text-[var(--color-computed)]' : 'text-[var(--color-text-muted)]')
            }
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-current={MORE_ITEMS.some((i) => i.id === activeView) ? 'page' : undefined}
          className={
            'flex-1 py-2 text-center text-xs ' +
            (MORE_ITEMS.some((i) => i.id === activeView) ? 'font-semibold text-[var(--color-computed)]' : 'text-[var(--color-text-muted)]')
          }
        >
          More
        </button>
      </nav>

      {/* "More" sheet (phone only) — same destinations as the tablet
          sidebar's extra items, just reached differently (spec.md §1b.2:
          "a layout difference, not a capability difference"). */}
      {moreOpen && (
        <div className="fixed inset-0 z-20 flex items-end md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative flex w-full flex-col gap-1 rounded-t-lg bg-[var(--color-surface)] p-3 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            {MORE_ITEMS.map((item) => (
              <NavButton key={item.id} item={item} active={item.id === activeView} onClick={() => navigate(item.id)} className="w-full" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
