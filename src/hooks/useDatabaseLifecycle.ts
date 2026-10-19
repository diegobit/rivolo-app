import { useEffect } from 'react'
import {
  checkpointDatabaseSynchronously,
  flushDatabaseSave,
  warmDatabaseForVisiblePage,
} from '../lib/db'
import { claimPrimaryTabForSync, releasePrimaryTabForPageHide } from '../lib/tabSyncCoordinator'

const reportLifecycleFailure = (event: string, error: unknown) => {
  console.error(`[DB] lifecycle ${event} failed`, { error })
}

export const useDatabaseLifecycle = () => {
  useEffect(() => {
    void warmDatabaseForVisiblePage().catch((error: unknown) => {
      reportLifecycleFailure('warm', error)
    })

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        try {
          checkpointDatabaseSynchronously()
        } catch (error) {
          reportLifecycleFailure('hidden checkpoint', error)
        }
        return
      }

      void warmDatabaseForVisiblePage()
        .then(() => flushDatabaseSave())
        .catch((error: unknown) => reportLifecycleFailure('resume', error))
    }

    const handlePageHide = () => {
      try {
        checkpointDatabaseSynchronously()
      } catch (error) {
        reportLifecycleFailure('pagehide checkpoint', error)
      } finally {
        releasePrimaryTabForPageHide()
      }
    }

    const handlePageShow = () => {
      if (document.visibilityState !== 'visible') return
      void warmDatabaseForVisiblePage()
        .then(() => {
          claimPrimaryTabForSync()
          return flushDatabaseSave()
        })
        .catch((error: unknown) => reportLifecycleFailure('pageshow', error))
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])
}
