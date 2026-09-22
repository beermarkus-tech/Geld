import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

import { firebaseConfig } from './firebaseConfig'

export const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)

// Persistent local cache is the real offline data store (spec.md §1a), not
// a bolt-on — unlimited size, shared correctly across multiple open tabs.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})
