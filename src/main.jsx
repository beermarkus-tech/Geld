import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import App from './App.jsx'
import BuildBadge from './BuildBadge.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { initTheme } from './lib/theme.js'
import { installZoomGuard } from './lib/zoomGuard.js'
import ZoomHint from './ZoomHint.jsx'
import './index.css'

registerSW({ immediate: true })
initTheme()
installZoomGuard()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <BuildBadge />
    <ZoomHint />
  </StrictMode>
)
