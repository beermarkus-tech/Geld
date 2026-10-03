import { Component } from 'react'

import ui from './lib/uiState'

// Catches a render error (what used to show as an empty white screen) and
// offers a restart. It also tells lib/uiState.js, so the *next* start ignores
// the remembered display state — the one thing that could be what keeps
// crashing the app — instead of looping on it.
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    ui.markCrashed()
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">Da ist etwas schiefgegangen</h1>
        <p className="max-w-md text-sm text-[var(--color-text-muted)]">
          Deine Buchungen und Einstellungen sind nicht betroffen. Beim Neustart beginnt die App mit der Standardansicht.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-[var(--color-computed)] px-5 py-2.5 font-medium text-white">
          Neu starten
        </button>
      </div>
    )
  }
}
