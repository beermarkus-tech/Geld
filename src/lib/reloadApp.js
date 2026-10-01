// Reload the app onto the newest deployed build (Oct 2026, Markus: "a reload
// button... so that the PWA loads new every time you put in a new build").
//
// Why a plain reload isn't enough: the service worker precaches index.html
// (src/sw.js), and a new deploy only reaches the page in two steps — the
// browser first notices the changed sw.js and installs the new worker in
// the background, and only a *later* launch is then served the new
// index.html. Reloading straight away would just re-serve the old build
// from the old cache. So this asks for the update check, waits for the new
// worker to finish installing/activating (it skips waiting, src/sw.js),
// and only then reloads. Offline, or when there is no new build, it simply
// reloads after at most a few seconds.
export async function reloadApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.update()
      const worker = reg.installing ?? reg.waiting
      if (worker && worker.state !== 'activated') {
        await new Promise((resolve) => {
          const check = () => {
            if (worker.state === 'activated' || worker.state === 'redundant') resolve()
          }
          worker.addEventListener('statechange', check)
          setTimeout(resolve, 8000)
          check()
        })
      }
    }
  } catch {
    // Offline or no service worker: fall through to a plain reload.
  }
  window.location.reload()
}
