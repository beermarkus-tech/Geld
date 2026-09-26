import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import App from './App.jsx'
import BuildBadge from './BuildBadge.jsx'
import { initTheme } from './lib/theme.js'
import './index.css'

registerSW({ immediate: true })
initTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <BuildBadge />
  </StrictMode>
)
