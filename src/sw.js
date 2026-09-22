import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

self.skipWaiting()
cleanupOutdatedCaches()

// Precache manifest is generated from the real build output (injectManifest
// mode), so there's no hand-typed URL that can typo and break the whole
// install the way a manual cache.addAll() list could.
precacheAndRoute(self.__WB_MANIFEST)

// Navigation must be network-first, not cache-first: serving a stale cached
// shell while a sign-in redirect is in flight is a classic way to quietly
// break auth. Falls back to the precached shell only once the network
// genuinely fails or is slower than a real connection would ever be.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'app-shell',
      networkTimeoutSeconds: 2.5,
    })
  )
)
