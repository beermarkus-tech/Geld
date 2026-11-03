import { useEffect, useState } from 'react'

import BackupScreen from './BackupScreen'
import ImportScreen from './ImportScreen'
import ImportRules from './ImportRules'
import ImportStaging from './ImportStaging'

// Consolidates the two previously-independent header toggles
// (Datenimport/Sicherung) under spec.md §1b.2's one "Import/Export" nav
// destination — same two screens, just reached as tabs under one entry
// instead of two separate always-visible buttons.
export default function ImportExportScreen({ userEmail, usingCachedSession, active = true, onOpenInKonten = null }) {
  const [tab, setTab] = useState('staging')
  // Bank-Import and Regeln stay mounted once opened (only hidden), so cursor and scroll position survive a tab switch.
  const [seen, setSeen] = useState(() => new Set(['staging']))
  useEffect(() => setSeen((s) => (s.has(tab) ? s : new Set(s).add(tab))), [tab])

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex gap-2 border-b border-[var(--color-border)] px-4 pt-3">
        {[
          { id: 'staging', label: 'Bank-Import' },
        { id: 'rules', label: 'Regeln' },
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
      <div className={tab === 'staging' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <ImportStaging active={active && tab === 'staging'} onOpenInKonten={onOpenInKonten} />
      </div>
      {seen.has('rules') && (
        <div className={tab === 'rules' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <ImportRules active={active && tab === 'rules'} />
        </div>
      )}
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
