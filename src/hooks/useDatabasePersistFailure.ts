import { useSyncExternalStore } from 'react'
import { getDatabasePersistFailureSnapshot, subscribeDatabasePersistFailure } from '../lib/db'

export const useDatabasePersistFailure = () =>
  useSyncExternalStore(
    subscribeDatabasePersistFailure,
    getDatabasePersistFailureSnapshot,
    getDatabasePersistFailureSnapshot,
  )
