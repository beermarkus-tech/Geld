import { useEffect, useRef, useState } from 'react'

import { reloadApp } from './lib/reloadApp'
import { effectiveDark, toggleTheme } from './lib/theme'
import { zoomLooksOff } from './lib/zoomGuard'

// Screen-to-component map lives in App.jsx (spec.md §3's own status table) —
// this file only owns the nav item list/labels and the shell chrome
// (header, sidebar, bottom nav) that surrounds whatever App.jsx renders as
// `children`. Order matches spec.md §1b.2's tablet sidebar list exactly.
// PRIMARY_ITEMS get their own bottom-nav button on phone (§1b.2: "5 items");
// MORE_ITEMS are reached via phone's "More" sheet, but sit inline in the
// tablet sidebar alongside PRIMARY_ITEMS — same destinations either way,
// just a layout difference (§1b.2's own wording).
// Nov 2026 (Markus, Pixel 7): Quickview takes Planung's bottom-bar place —
// it reads better on a phone; Planung moves into the "Mehr" sheet.
export const PRIMARY_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'konten', label: 'Konten' },
  { id: 'verlauf', label: 'Verlauf' },
  { id: 'quickview', label: 'Quickview' },
]
export const MORE_ITEMS = [
  { id: 'planung', label: 'Planung' },
  { id: 'urlaube', label: 'Urlaube' },
  { id: 'monatsabschluss', label: 'Monatsabschluss' },
  { id: 'aussenstaende', label: 'Außenstände' },
  { id: 'importexport', label: 'Import/Export' },
  { id: 'settings', label: 'Settings' },
]
// Sidebar order and Ctrl+1…0 hotkey order (Oct 2026, Markus: Quickview and
// Planung swapped — Quickview now 4th/Ctrl+4, Planung 5th/Ctrl+5). Kept
// separate from the PRIMARY/MORE split above, which is the *phone* layout
// (bottom bar vs. "More" sheet) and was deliberately left as it was.
const NAV_ORDER = ['dashboard', 'konten', 'verlauf', 'quickview', 'planung', 'urlaube', 'monatsabschluss', 'aussenstaende', 'importexport', 'settings']
const BY_ID = Object.fromEntries([...PRIMARY_ITEMS, ...MORE_ITEMS].map((i) => [i.id, i]))
export const ALL_ITEMS = NAV_ORDER.map((id) => BY_ID[id])

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

// Phone icons (Nov 2026, Markus: "the button bar needs icons") — plain
// stroked 24px outlines, inline so there's no icon library to load.
const ICON_PATHS = {
  dashboard: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  konten: 'M3 6h18v12H3zM3 10h18M7 15h4',
  verlauf: 'M3 4h18v16H3zM3 9h18M8 4v16',
  quickview: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5',
  planung: 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4',
  urlaube: 'M3 20h18M12 4c-4 0-7 3-7 6h14c0-3-3-6-7-6zM12 10v10',
  monatsabschluss: 'M4 12l5 5L20 6',
  aussenstaende: 'M18 6.5a7 7 0 1 0 0 11M4 10h10M4 14h10',
  importexport: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  reload: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  theme: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
}
export function NavIcon({ id, className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={id === 'more' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICON_PATHS[id]} />
    </svg>
  )
}

function NavButton({ item, active, onClick, className = '', children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-nav-id={item.id}
      aria-current={active ? 'page' : undefined}
      className={
        'rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-computed)] ' +
        (active ? 'bg-[var(--color-computed)] text-white' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]') +
        ' ' +
        className
      }
    >
      {children}
      {item.label}
    </button>
  )
}

// Profile picture (or an initial, if the account has none) + Abmelden —
// shared by the tablet sidebar's bottom and phone's "More" sheet footer
// (Markus: show the picture instead of the e-mail address) rather than two
// copies that could quietly drift apart. The e-mail itself isn't dropped,
// just demoted to a title/tooltip and the cached-session suffix under
// Abmelden, since Markus still needs some way to see whose session it is.
function UserBadge({ userEmail, photoURL, usingCachedSession, onSignOutClick, className = '' }) {
  return (
    <div className={'flex items-center gap-2 border-t border-[var(--color-border)] p-3 ' + className}>
      {photoURL ? (
        <img src={photoURL} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full" />
      ) : (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg)] text-sm text-[var(--color-text-muted)]"
          aria-hidden="true"
        >
          {(userEmail?.[0] ?? '?').toUpperCase()}
        </div>
      )}
      <button
        type="button"
        onClick={onSignOutClick}
        title={userEmail ?? undefined}
        className="flex-1 text-left text-sm text-[var(--color-text-muted)]"
      >
        Abmelden
        {usingCachedSession && <span className="block text-xs">(zwischengespeichert)</span>}
      </button>
    </div>
  )
}

export default function NavShell({
  activeView,
  onNavigate,
  year,
  years,
  onYearChange,
  userEmail,
  photoURL,
  usingCachedSession,
  onSignOut,
  onLeaveNav,
  children,
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [moreOpen, setMoreOpen] = useState(false)
  // Sign-out gets a real confirmation modal, not the two-click arm/confirm
  // pattern Konten's own delete uses elsewhere (Markus's explicit call for
  // this one) — a stray tap here is a real "did I just get logged out"
  // moment, not something a second tap in the same spot quietly fixes.
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false)
  const [isDark, setIsDark] = useState(effectiveDark)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // Per-device convenience only — nothing to recover from here.
    }
  }, [sidebarCollapsed])

  // Keeps the sun/moon icon correct if the system preference itself
  // changes (no manual override yet) or another part of the app toggles
  // the override (theme.js's 'geld-theme-change' event) — same dual
  // system-preference/manual-override listening as gridColorScheme.js.
  useEffect(() => {
    const recompute = () => setIsDark(effectiveDark())
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', recompute)
    window.addEventListener('geld-theme-change', recompute)
    return () => {
      query.removeEventListener('change', recompute)
      window.removeEventListener('geld-theme-change', recompute)
    }
  }, [])

  function navigate(id) {
    // Picked with the keyboard from the sidebar: the cursor goes on to that screen.
    const fromKeyboard = Boolean(document.activeElement?.closest?.('[data-sidebar]'))
    onNavigate(id)
    if (fromKeyboard) setTimeout(() => onLeaveNav?.(id), 100)
    setMoreOpen(false)
    // The nav button that was just used must not keep keyboard focus: the
    // next Tab should place the cursor on the new screen (lib/screenCursor.js).
    document.activeElement?.blur?.()
  }

  useEffect(() => {
    if (!moreOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMoreOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  useEffect(() => {
    if (!signOutConfirmOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSignOutConfirmOpen(false)
      }
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
      // Ctrl+0 is Settings (the 10th item), as ever — except while the page looks
      // zoomed (lib/zoomGuard.js): then it is left to the browser, whose Ctrl+0
      // resets the zoom (Oct 2026, Markus).
      if (e.key === '0' && zoomLooksOff()) return
      const index = e.key === '0' ? 9 : Number(e.key) - 1
      if (!(index >= 0 && index < ALL_ITEMS.length)) return
      e.preventDefault()
      onNavigate(ALL_ITEMS[index].id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onNavigate])

  // Esc when nothing else is left to close (App.jsx sends 'geld-open-nav')
  // opens the sidebar with the cursor on the active screen (Oct 2026, Markus);
  // ↓/↑ move, Enter opens that screen, Esc closes the sidebar again and puts
  // the cursor back on the screen. On a phone (no sidebar) it opens "Mehr".
  const navRef = useRef(null)
  const [focusNav, setFocusNav] = useState(0)
  useEffect(() => {
    const open = () => {
      if (!window.matchMedia('(min-width: 768px)').matches) {
        setMoreOpen(true)
        return
      }
      setSidebarCollapsed(false)
      setFocusNav((n) => n + 1)
    }
    window.addEventListener('geld-open-nav', open)
    return () => window.removeEventListener('geld-open-nav', open)
  }, [])
  useEffect(() => {
    if (!focusNav) return
    const nav = navRef.current
    ;(nav?.querySelector(`[data-nav-id="${activeView}"]`) ?? nav?.querySelector('[data-nav-id]'))?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when asked to focus
  }, [focusNav])
  function onNavKeyDown(e) {
    const buttons = [...(navRef.current?.querySelectorAll('[data-nav-id]') ?? [])]
    const i = buttons.indexOf(document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? Math.min(buttons.length - 1, i + 1) : Math.max(0, i - 1)
      buttons[next < 0 ? 0 : next]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSidebarCollapsed(true)
      document.activeElement?.blur?.()
      setTimeout(() => onLeaveNav?.(activeView), 0)
    }
  }

  const activeItem = ALL_ITEMS.find((i) => i.id === activeView)

  // The floating build badge would sit on the bottom bar on a phone; there the
  // number is shown in the "Mehr" sheet instead (index.css hides the badge).
  useEffect(() => {
    document.body.dataset.shell = '1'
    return () => delete document.body.dataset.shell
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 max-md:py-2">
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
          {/* Phone: only the screen's name (Nov 2026, Markus: the top bar was too cramped). */}
          <h1 className="text-lg font-semibold max-md:hidden">Geld</h1>
          {activeItem && <h1 className="text-lg font-semibold md:hidden">{activeItem.label}</h1>}
          {/* Screen title alongside the fixed "Geld" brand (spec.md §1b.3:
              "screen title... top app bar") — a plain dash-separated suffix
              rather than replacing "Geld" outright, so the app's own name
              stays the one constant landmark across every screen. */}
          {activeItem && <span className="text-sm text-[var(--color-text-muted)] max-md:hidden">— {activeItem.label}</span>}
        </div>

        <div className="flex items-center gap-3">
          {/* The single global year selector (spec.md §1b.2a) — lives here,
              not per-screen, and drives Konten today (Verlauf/Planung once
              they exist). `years` comes from whichever screen currently
              knows what data exists (Konten reports it up via
              onYearsChange) — empty until that first reports in. */}
          {/* Phone: one compact year picker instead of a row of buttons. */}
          {years.length > 0 && (
            <select
              value={year}
              onChange={(e) => onYearChange(e.target.value)}
              aria-label="Jahr"
              className="rounded-md bg-[var(--color-computed)] px-2 py-1 text-sm font-medium text-white md:hidden"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          {years.length > 0 && (
            <div className="flex items-center gap-1 max-md:hidden">
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
          {/* Reload onto the newest build (Oct 2026, Markus) — see
              reloadApp() for why this isn't just location.reload(). */}
          <button
            type="button"
            onClick={() => {
              setReloading(true)
              reloadApp()
            }}
            disabled={reloading}
            aria-label="App neu laden"
            title="App neu laden — holt die neueste Version"
            className={`flex h-8 w-8 items-center justify-center rounded-md text-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] max-md:hidden ${reloading ? 'animate-spin' : ''}`}
          >
            ⟳
          </button>
          {/* Day/night toggle, top-right of the header (Markus's own
              placement request) — a manual override on top of the system
              preference index.css already follows (theme.js). */}
          <button
            type="button"
            onClick={() => setIsDark(toggleTheme() === 'dark')}
            aria-label={isDark ? 'Zu Tagmodus wechseln' : 'Zu Nachtmodus wechseln'}
            className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-[var(--color-bg)] max-md:hidden"
          >
            {isDark ? '☀️' : '🌙'}
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
          <nav ref={navRef} data-sidebar onKeyDown={onNavKeyDown} className="hidden w-48 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex">
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-none p-3">
              {ALL_ITEMS.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={item.id === activeView}
                  onClick={() => {
                    navigate(item.id)
                    // The sidebar steps out of the way as soon as a screen
                    // is picked (Oct 2026, Markus) — the burger button
                    // brings it back.
                    setSidebarCollapsed(true)
                  }}
                />
              ))}
            </div>
            <UserBadge
              userEmail={userEmail}
              photoURL={photoURL}
              usingCachedSession={usingCachedSession}
              onSignOutClick={() => setSignOutConfirmOpen(true)}
            />
          </nav>
        )}

        {/* overscroll-none: the body-level fix (spec.md §1) predates this
            shell's own scroll container — pull-to-refresh/rubber-band is
            evaluated against the nearest scrolling ancestor under the
            touch point, not necessarily the document itself, so this
            needs the same fix directly, not just inherited from body. */}
        <main className="flex flex-1 flex-col overflow-y-auto overscroll-none pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">{children}</main>
      </div>

      {/* Phone bottom nav — hidden at md and above, where the sidebar takes
          over navigation instead (spec.md §1b.2). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {[...PRIMARY_ITEMS, { id: 'more', label: 'Mehr' }].map((item) => {
          const active = item.id === 'more' ? MORE_ITEMS.some((i) => i.id === activeView) : item.id === activeView
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => (item.id === 'more' ? setMoreOpen(true) : navigate(item.id))}
              aria-current={active ? 'page' : undefined}
              className={
                'flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ' +
                (active ? 'font-semibold text-[var(--color-computed)]' : 'text-[var(--color-text-muted)]')
              }
            >
              <NavIcon id={item.id === 'more' && MORE_ITEMS.some((i) => i.id === activeView) ? activeView : item.id} />
              {item.id === 'more' && MORE_ITEMS.some((i) => i.id === activeView) ? MORE_ITEMS.find((i) => i.id === activeView).label : item.label}
            </button>
          )
        })}
      </nav>

      {/* "More" sheet (phone only) — same destinations as the tablet
          sidebar's extra items, just reached differently (spec.md §1b.2:
          "a layout difference, not a capability difference"). */}
      {moreOpen && (
        <div className="fixed inset-0 z-20 flex items-end md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative flex w-full flex-col rounded-t-lg bg-[var(--color-surface)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1 p-3">
              {MORE_ITEMS.map((item) => (
                <NavButton key={item.id} item={item} active={item.id === activeView} onClick={() => navigate(item.id)} className="flex w-full items-center gap-3">
                  <NavIcon id={item.id} className="h-5 w-5" />
                </NavButton>
              ))}
            </div>
            {/* Reload, day/night and the build number live here on the phone. */}
            <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  setReloading(true)
                  reloadApp()
                }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
              >
                <NavIcon id="reload" className={`h-5 w-5 ${reloading ? 'animate-spin' : ''}`} />
                Neu laden
              </button>
              <button
                type="button"
                onClick={() => setIsDark(toggleTheme() === 'dark')}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
              >
                <NavIcon id="theme" className="h-5 w-5" />
                {isDark ? 'Tagmodus' : 'Nachtmodus'}
              </button>
              <span className="ml-auto pr-2 text-xs text-[var(--color-text-muted)]">Build {__BUILD_NUMBER__}</span>
            </div>
            <UserBadge
              userEmail={userEmail}
              photoURL={photoURL}
              usingCachedSession={usingCachedSession}
              onSignOutClick={() => setSignOutConfirmOpen(true)}
              className="pb-6"
            />
          </div>
        </div>
      )}
    </div>
  )
}
