import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Decoration, EditorView } from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { pushToDropbox } from '../lib/dropbox'
import { buttonDanger, buttonIcon } from '../lib/ui'
import { useDaysStore } from '../store/useDaysStore'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'

export default function DayEditor() {
  const navigate = useNavigate()
  const { dayId } = useParams()
  const [searchParams] = useSearchParams()
  const { activeDay, loadDay, updateDayContent, moveDayDate, deleteDay, loading } = useDaysStore()
  const { loadState, hasAuth, filePath } = useDropboxStore()
  const { passcode, locked } = useSettingsStore()
  const [draft, setDraft] = useState('')
  const [dateValue, setDateValue] = useState(dayId ?? '')
  const [dateError, setDateError] = useState<string | null>(null)
  const draftRef = useRef(draft)
  const activeDayRef = useRef(activeDay)
  const initialContentRef = useRef<string | null>(null)
  const hasLoadedRef = useRef(false)
  const createdDayRef = useRef(false)
  const syncTriggeredRef = useRef(false)
  const syncPendingRef = useRef(false)
  const exitHandledRef = useRef(false)

  const quote = searchParams.get('quote') ?? ''
  const resolvedDayId = dayId ?? ''
  const isReady = activeDay?.dayId === resolvedDayId
  const canSync = Boolean(hasAuth && filePath && passcode.trim() && !locked)

  const queueDropboxSync = useCallback(
    (context: string) => {
      if (syncTriggeredRef.current) return
      if (!canSync) return
      if (!navigator.onLine) {
        console.warn('[DayEditor] dropbox:offline', { context })
        return
      }

      syncTriggeredRef.current = true
      void (async () => {
        try {
          const result = await pushToDropbox(passcode)
          await loadState()
          console.info('[DayEditor] dropbox:push', { context, status: result.status })
          if (result.status === 'blocked') {
            console.warn('[DayEditor] dropbox:blocked', { context })
          }
          if (result.status === 'pushed' || result.status === 'clean') {
            syncPendingRef.current = false
          }
        } catch (error) {
          console.warn('[DayEditor] dropbox:push-failed', { context, error })
        }
      })()
    },
    [canSync, loadState, passcode],
  )

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    activeDayRef.current = activeDay
  }, [activeDay])

  useEffect(() => {
    hasLoadedRef.current = false
    initialContentRef.current = null
    createdDayRef.current = false
    syncTriggeredRef.current = false
    syncPendingRef.current = false
    exitHandledRef.current = false
  }, [resolvedDayId])

  const highlightData = useMemo(() => {
    const trimmedQuote = quote.trim()
    if (!trimmedQuote) {
      return { extensions: [] as Extension[], found: false }
    }

    const index = draft.indexOf(trimmedQuote)
    if (index === -1) {
      return { extensions: [] as Extension[], found: false }
    }

    const builder = new RangeSetBuilder<Decoration>()
    builder.add(index, index + trimmedQuote.length, Decoration.mark({ class: 'cm-highlight' }))
    return { extensions: [EditorView.decorations.of(builder.finish())], found: true }
  }, [draft, quote])

  useEffect(() => {
    let isActive = true

    if (resolvedDayId) {
      void (async () => {
        console.info('[DayEditor] loadDay:start', { dayId: resolvedDayId })
        const result = await loadDay(resolvedDayId)
        if (isActive) {
          createdDayRef.current = result.created
          console.info('[DayEditor] loadDay:done', {
            dayId: resolvedDayId,
            created: result.created,
          })
        }
      })()
    }

    return () => {
      isActive = false
    }
  }, [loadDay, resolvedDayId])

  useEffect(() => {
    const handlePopState = () => {
      if (!canSync || !syncPendingRef.current) return

      const shouldLeave = window.confirm('You have unsynced changes. Leave and sync in the background?')
      if (!shouldLeave) {
        navigate(1)
        return
      }

    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [canSync, navigate])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!canSync || !syncPendingRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [canSync])

  useEffect(() => {
    if (activeDay?.dayId === resolvedDayId) {
      console.info('[DayEditor] activeDay:sync', {
        dayId: activeDay.dayId,
        contentLength: activeDay.contentMd.length,
      })
      hasLoadedRef.current = true
      initialContentRef.current = activeDay.contentMd
      draftRef.current = activeDay.contentMd
      setDraft(activeDay.contentMd)
      setDateValue(activeDay.dayId)
      setDateError(null)
    }
  }, [activeDay, resolvedDayId])

  useEffect(() => {
    if (!resolvedDayId) return
    if (draft === activeDay?.contentMd) return

    const handle = window.setTimeout(() => {
      if (draft.trim()) {
        syncPendingRef.current = true
        void updateDayContent(resolvedDayId, draft)
      }
    }, 400)

    return () => window.clearTimeout(handle)
  }, [activeDay?.contentMd, draft, resolvedDayId, updateDayContent])

  useEffect(() => {
    return () => {
      if (exitHandledRef.current) return
      if (!hasLoadedRef.current) return
      const baseContent = initialContentRef.current
      if (baseContent === null) return

      const storedContent = baseContent.trim()
      const currentDraft = draftRef.current.trim()

      console.info('[DayEditor] cleanup', {
        dayId: resolvedDayId,
        created: createdDayRef.current,
        storedLength: storedContent.length,
        draftLength: currentDraft.length,
      })

      const shouldDelete = createdDayRef.current && !currentDraft && !storedContent
      const shouldSave = currentDraft !== storedContent

      void (async () => {
        if (shouldDelete) {
          syncPendingRef.current = true
          console.info('[DayEditor] cleanup:delete-empty', { dayId: resolvedDayId })
          await deleteDay(resolvedDayId)
          queueDropboxSync('cleanup-delete')
          return
        }

        if (shouldSave) {
          syncPendingRef.current = true
          console.info('[DayEditor] cleanup:save', {
            dayId: resolvedDayId,
            draftLength: draftRef.current.length,
          })
          await updateDayContent(resolvedDayId, draftRef.current)
        }

        queueDropboxSync('cleanup')
      })()
    }
  }, [deleteDay, queueDropboxSync, resolvedDayId, updateDayContent])

  const handleDateChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextDayId = event.target.value
    setDateValue(nextDayId)
    setDateError(null)

    if (!nextDayId || nextDayId === resolvedDayId) {
      return
    }

    if (draft.trim()) {
      syncPendingRef.current = true
      await updateDayContent(resolvedDayId, draft)
    }
    const result = await moveDayDate(resolvedDayId, nextDayId)

    if (result.conflict) {
      setDateError('Day already exists. Choose another date.')
      setDateValue(resolvedDayId)
      return
    }

    syncPendingRef.current = true
    navigate(`/day/${nextDayId}`, { replace: true })
  }

  const handleClose = async () => {
    if (!resolvedDayId) return
    exitHandledRef.current = true

    if (!hasLoadedRef.current || initialContentRef.current === null) {
      queueDropboxSync('close')
      navigate('/')
      return
    }

    const storedContent = initialContentRef.current.trim()
    const currentDraft = draft.trim()

    console.info('[DayEditor] close', {
      dayId: resolvedDayId,
      created: createdDayRef.current,
      storedLength: storedContent.length,
      draftLength: currentDraft.length,
    })

    if (createdDayRef.current && !currentDraft && !storedContent) {
      syncPendingRef.current = true
      console.info('[DayEditor] close:delete-empty', { dayId: resolvedDayId })
      await deleteDay(resolvedDayId)
      queueDropboxSync('close-delete')
      navigate('/')
      return
    }

    if (currentDraft !== storedContent) {
      syncPendingRef.current = true
      console.info('[DayEditor] close:save', {
        dayId: resolvedDayId,
        draftLength: draft.length,
      })
      await updateDayContent(resolvedDayId, draft)
    }

    queueDropboxSync('close')
    navigate('/')
  }

  const handleDelete = async () => {
    if (!resolvedDayId) return
    exitHandledRef.current = true
    syncPendingRef.current = true
    await deleteDay(resolvedDayId)
    queueDropboxSync('delete')
    navigate('/')
  }

  if (!resolvedDayId) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Missing day id.</p>
      </section>
    )
  }

  if (!isReady) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-sm text-slate-500">
        Loading day...
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button className={buttonIcon} type="button" onClick={handleClose}>
              &lt;
            </button>
            <div>
              <input
                className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400"
                type="date"
                value={dateValue}
                onChange={handleDateChange}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loading && <span className="text-xs text-slate-400">Saving...</span>}
            <button className={buttonDanger} type="button" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>

        {dateError && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {dateError}
          </div>
        )}

        {quote && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {highlightData.found ? 'Highlighting quoted text from citation.' : 'Citation quote not found.'}
          </div>
        )}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <CodeMirror
            value={draft}
            height="360px"
            extensions={[markdown(), ...highlightData.extensions]}
            onChange={setDraft}
            basicSetup={{ lineNumbers: false }}
          />
        </div>
      </section>
    </div>
  )
}
