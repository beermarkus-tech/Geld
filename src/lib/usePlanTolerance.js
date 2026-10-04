import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'

import { db } from '../firebase'
import { DEFAULT_TOLERANCE_PERCENT } from './planCheck'

// The tolerance for Verlauf's Plan1-vs-booked colours, in percent of the plan
// value (Oct 2026, Markus; 5 by default). One app-wide document,
// settings/app — the per-year documents are settings/{year}. Settings › Verlauf
// edits it, Verlauf reads it live.
const valid = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100

export function usePlanTolerance() {
  const [percent, setPercent] = useState(DEFAULT_TOLERANCE_PERCENT)
  useEffect(
    () =>
      onSnapshot(doc(db, 'settings', 'app'), (snap) => {
        const v = snap.exists() ? snap.data().planTolerancePercent : undefined
        setPercent(valid(v) ? v : DEFAULT_TOLERANCE_PERCENT)
      }),
    [],
  )
  const save = (v) => {
    if (valid(v)) setDoc(doc(db, 'settings', 'app'), { id: 'app', planTolerancePercent: v }, { merge: true })
  }
  return [percent, save]
}
