import { execSync } from 'node:child_process'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// Served from GitHub Pages as a project site (github.io/Geld/), so every
// asset URL needs this prefix — a plain "/" would 404 everything.
const base = '/Geld/'

// Build number = total commit count, so it's a free, always-correct,
// monotonically increasing identifier for exactly what's deployed — no
// counter file to maintain or forget to bump. Requires full git history
// (CI's checkout step uses fetch-depth: 0), not a shallow clone.
function getBuildNumber() {
  try {
    return execSync('git rev-list --count HEAD').toString().trim()
  } catch {
    return '0'
  }
}

export default defineConfig({
  base,
  define: {
    __BUILD_NUMBER__: JSON.stringify(getBuildNumber()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // We register the service worker ourselves in main.jsx via
      // `virtual:pwa-register`, so the plugin shouldn't also inject its own
      // auto-registration script (that would register it twice).
      injectRegister: null,
      injectManifest: {
        // App code + Firebase are already fairly large; raise the default
        // 2 MiB precache limit rather than silently dropping the app shell.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        id: base,
        name: 'Geld',
        short_name: 'Geld',
        description: 'Household finance tracker',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0f2a4a',
        theme_color: '#0f2a4a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        // Service worker behavior in Vite's dev server is unreliable —
        // real offline testing happens against `vite build && vite preview`.
        enabled: false,
      },
    }),
  ],
})
