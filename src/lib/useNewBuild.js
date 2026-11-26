import { useEffect, useState } from 'react'

// Is a newer build deployed than the one running? (Nov 2026, Markus: a small dot on the reload
// button.) Every build ships a version.json with its number (vite.config.js); this reads it now,
// every 10 minutes and whenever the app comes back to the foreground. Offline or in the dev server
// (no file) it simply stays false.
const RUNNING = Number(__BUILD_NUMBER__)
const EVERY_MS = 10 * 60 * 1000

export function useNewBuild() {
  const [newer, setNewer] = useState(false)
  useEffect(() => {
    let stopped = false
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const { build } = await res.json()
        if (!stopped && Number(build) > RUNNING) setNewer(true)
      } catch {
        // offline, or no version.json (dev server)
      }
    }
    check()
    const timer = setInterval(check, EVERY_MS)
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return newer
}
