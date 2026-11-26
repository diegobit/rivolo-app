import { useEffect, useState } from 'react'
import { loadSearchAuthors } from '../../lib/searchAuthors'
import { useSyncStore } from '../../store/useSyncStore'

type SearchAuthors = Awaited<ReturnType<typeof loadSearchAuthors>>
const empty: SearchAuthors = { days: [], byDay: new Map(), names: [] }

export function useSearchAuthors(enabled: boolean, revision: number, remoteRevision: number) {
  const provider = useSyncStore((state) => state.activeProvider)
  const status = useSyncStore((state) => state.status)
  const accountName = status.accountName ?? null
  const scope = JSON.stringify([provider, status.accountEmail, accountName, status.targetName, status.notebookChannel])
  const key = JSON.stringify([scope, revision, remoteRevision, status.lastSyncAt, status.lastRemoteVersion, status.connected])
  const [loaded, setLoaded] = useState<{ key: string; value: SearchAuthors; failed: boolean } | null>(null)

  useEffect(() => {
    if (!enabled || !provider) return
    let cancelled = false
    void loadSearchAuthors(provider, accountName).then(
      (value) => { if (!cancelled) setLoaded({ key, value, failed: false }) },
      () => { if (!cancelled) setLoaded({ key, value: empty, failed: true }) },
    )
    return () => { cancelled = true }
  }, [enabled, provider, accountName, key])

  const current = provider && loaded?.key === key ? loaded : null
  return {
    scope,
    data: current?.value ?? empty,
    loading: !!provider && !current,
    failed: current?.failed ?? false,
  }
}
