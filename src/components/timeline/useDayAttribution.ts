import { useEffect, useRef, useState } from 'react'
import { getDropboxDailyTarget } from '../../lib/dropbox'
import { getGoogleDriveDailyTarget } from '../../lib/googleDrive'
import type { SyncProviderId } from '../../lib/syncState'
import { getOneDriveState } from '../../lib/oneDriveState'
import { getDailyState, targetFromState } from '../../lib/oneDriveDailyState'
import { parseMarkdown } from '../../lib/markdown'
import { alignLineAttribution, editDayId, readNotebookAttribution, type LineAttribution } from '../../lib/oneDriveBlame'
import { useSyncStore } from '../../store/useSyncStore'

export function useDayAttribution(dayId: string, content: string, editedAt: number, enabled: boolean) {
  const provider = useSyncStore((state) => state.activeProvider)
  const accountName = useSyncStore((state) => state.status.accountName)
  const sourceKey = useSyncStore((state) => JSON.stringify([
    state.activeProvider, state.status.lastSyncAt, state.status.lastRemoteVersion, state.status.targetName, state.status.connected,
    state.status.accountName, state.status.accountEmail, state.status.notebookChannel,
  ]))
  const [result, setResult] = useState<{ key: string; baselineKey: string; attribution: LineAttribution[]; failed?: boolean } | null>(null)
  const baselineKey = `${dayId}:${sourceKey}`
  const cached = useRef<{ key: string; value: ReturnType<typeof loadBaseline> } | null>(null)
  const key = `${baselineKey}:${editedAt}:${content}`
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const align = async () => {
      if (cached.current?.key !== baselineKey) cached.current = { key: baselineKey, value: loadBaseline(dayId, provider, accountName) }
      const baseline = await cached.current.value
      if (cancelled) return
      const aligned = alignLineAttribution(baseline.content, content, baseline.attribution,
        { author: baseline.author, date: baseline.author ? editDayId(editedAt) : null })
      setResult({ key, baselineKey, attribution: aligned })
    }
    const timer = setTimeout(() => {
      void align().catch(() => {
        if (!cancelled) {
          cached.current = null
          setResult({ key, baselineKey, attribution: [], failed: true })
        }
      })
    }, 160)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [accountName, baselineKey, content, dayId, editedAt, enabled, key, provider])
  return {
    attribution: enabled && result?.baselineKey === baselineKey && !result.failed ? result.attribution : null,
    loading: enabled && result?.key !== key,
    failed: enabled && result?.key === key && Boolean(result.failed),
  }
}

// Reuse the persisted baseline while typing; refresh it after sync or a target change.
async function loadBaseline(dayId: string, provider: SyncProviderId | null, accountName: string | null) {
  const oneDrive = provider === 'onedrive' ? await getOneDriveState() : null
  const target = provider === 'dropbox' ? await getDropboxDailyTarget()
    : provider === 'google-drive' ? await getGoogleDriveDailyTarget()
      : oneDrive ? targetFromState(oneDrive) : null
  const dayState = target ? await getDailyState(target, dayId) : null
  const baseline = dayState?.baseline ?? oneDrive?.mergeBaseContent ?? ''
  const baseDay = parseMarkdown(baseline).days.find((day) => day.dayId === dayId)
  const attribution = await readNotebookAttribution(baseline, dayId)
  const author = target || oneDrive?.mergeBaseContent ? oneDrive?.accountName ?? accountName ?? null : null
  return { content: baseDay?.contentMd ?? '', attribution: attribution.get(dayId) ?? [], author }
}
