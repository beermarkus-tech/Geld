import { useState } from 'react'

import BackupScreen from './BackupScreen'
import ImportScreen from './ImportScreen'

// Consolidates the two previously-independent header toggles
// (Datenimport/Sicherung) under spec.md §1b.2's one "Import/Export" nav
// destination — same two screens, just reached as tabs under one entry
// instead of two separate always-visible buttons.
export default function ImportExportScreen({ userEmail, usingCachedSession }) {
  const [tab, setTab] = useState('import')

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex gap-2 border-b border-[var(--color-border)] px-4 pt-3">
        {[
          { id: 'import', label: 'Datenimport' },
          { id: 'backup', label: 'Sicherung' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              'rounded-t-md px-3 py-2 text-sm ' +
              (tab === t.id
                ? 'border-b-2 border-[var(--color-computed)] font-medium text-[var(--color-computed)]'
                : 'text-[var(--color-text-muted)]')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'import' && (
        <div>
          <p className="px-6 pt-4 text-center text-sm text-[var(--color-text-muted)]">
            Angemeldet als {userEmail}
            {usingCachedSession && ' (aus zwischengespeicherter Sitzung, noch nicht online bestätigt)'}
          </p>
          <ImportScreen />
        </div>
      )}
      {tab === 'backup' && <BackupScreen />}
    </div>
  )
}
