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
  // Sign-out gets a real confirmation modal, not the two-click arm/confirm
  // pattern Konten's own delete uses elsewhere (Markus's explicit call for
  // this one) — a stray tap here is a real "did I just get logged out"
  // moment, not something a second tap in the same spot quietly fixes.
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false)

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

  useEffect(() => {
    if (!signOutConfirmOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setSignOutConfirmOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [signOutConfirmOpen])

  // Ctrl/Cmd+1 through +9, then +0 for the 10th, jump straight to that nav
  // item, in ALL_ITEMS' own order (Markus: "assign ctrl+1 to dashboard,
  // ctrl+2 to konten, ctrl+3 to verlauf, and so on"). **Real, near-certain
  // risk, flagged rather than assumed away** — Ctrl+1 through Ctrl+8 are
  // Chrome/Firefox/Edge's own reserved "jump to browser tab N" shortcut in
  // an ordinary tab (Ctrl+9 jumps to the last tab), the same class of
  // browser-chrome-level reservation already hit and accepted for Ctrl+T/H
  // elsewhere in this app — no in-page code can intercept a keypress the
  // browser's own chrome already claimed before it ever reaches this
  // listener. May work as intended in an installed PWA's standalone window
  // (no tab strip to reserve it for), genuinely unconfirmed without
  // testing on Markus's own devices.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const index = e.key === '0' ? 9 : Number(e.key) - 1
      if (!(index >= 0 && index < ALL_ITEMS.length)) return
      e.preventDefault()
      onNavigate(ALL_ITEMS[index].id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onNavigate])

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
          <button type="button" onClick={() => setSignOutConfirmOpen(true)} className="text-sm text-[var(--color-text-muted)]">
            Abmelden
          </button>
        </div>
      </header>

      {signOutConfirmOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center" onClick={() => setSignOutConfirmOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative flex w-full max-w-sm flex-col gap-4 rounded-lg bg-[var(--color-surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm">Wirklich abmelden?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSignOutConfirmOpen(false)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => {
                  setSignOutConfirmOpen(false)
                  onSignOut()
                }}
                className="rounded-md bg-[var(--color-alert)] px-3 py-1.5 text-sm font-medium text-white"
              >
                Abmelden
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Tablet sidebar — hidden entirely below md, hidden entirely (not
            just icons-only) when collapsed, per spec.md §1b.2: "so the
            content area can reclaim the full screen width." */}
        {!sidebarCollapsed && (
          <nav className="hidden w-48 shrink-0 flex-col gap-1 overflow-y-auto overscroll-none border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:flex">
            {ALL_ITEMS.map((item) => (
              <NavButton key={item.id} item={item} active={item.id === activeView} onClick={() => navigate(item.id)} />
            ))}
          </nav>
        )}

        {/* overscroll-none: the body-level fix (spec.md §1) predates this
            shell's own scroll container — pull-to-refresh/rubber-band is
            evaluated against the nearest scrolling ancestor under the
            touch point, not necessarily the document itself, so this
            needs the same fix directly, not just inherited from body. */}
        <main className="flex flex-1 flex-col overflow-y-auto overscroll-none pb-16 md:pb-0">{children}</main>
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
