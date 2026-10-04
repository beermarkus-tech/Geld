// The app has no zoom (Oct 2026, Markus: "reset the app's zoom level to 100 %
// when I reload"). A web page cannot set the browser's zoom — the browser
// remembers it per site, which is why it survives a reload — but it can stop
// causing it: Ctrl/Cmd + "+" / "-" (also the numpad), Ctrl + mouse wheel and
// pinch are swallowed. Ctrl/Cmd+0 is the app's Settings hotkey, but while the page looks zoomed (zoomLooksOff) the app leaves it to the browser, whose Ctrl+0 resets the zoom. Note Ctrl+"+" is
// also Konten's and Verlauf's "add" shortcut: those listeners still receive the
// key (only the browser's default is cancelled), and it used to zoom the browser
// as a side effect whenever the app did not cancel it itself (e.g. while editing).
export function installZoomGuard() {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (['+', '=', '-', '_'].includes(e.key) || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract') e.preventDefault()
    },
    true,
  )
  window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false, capture: true })
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault())
}

// Screens come in a few pixel ratios (OS scaling: 1, 1.25, 1.5, …); browser zoom
// multiplies that, so anything else means the page is zoomed. Zooms that land
// on an OS ratio (say 125 % at ratio 1) cannot be told apart this way.
const USUAL_RATIOS = [1, 1.25, 1.33, 1.5, 1.75, 2, 2.25, 2.5, 2.625, 3, 3.5, 4]
export function zoomLooksOff(ratio = window.devicePixelRatio) {
  return !USUAL_RATIOS.some((r) => Math.abs(ratio - r) / r < 0.01)
}
