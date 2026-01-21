import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import { EditorSelection, RangeSetBuilder, type Extension } from '@codemirror/state'
import { addDays, formatHumanDate, getTodayId, parseDayId } from '../lib/dates'
import { pushToSync } from '../lib/sync'
import { useDaysStore } from '../store/useDaysStore'
import { useSyncStore } from '../store/useSyncStore'

export default function DayEditor() {
  const navigate = useNavigate()
  const { dayId } = useParams()
  const [searchParams] = useSearchParams()
  const { activeDay, loadDay, updateDayContent, moveDayDate, deleteDay, loading } = useDaysStore()
  const { loadState: loadSyncState, status: syncStatus } = useSyncStore()
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
  const editorViewRef = useRef<EditorView | null>(null)
  const hasFocusedRef = useRef(false)
  const dateInputRef = useRef<HTMLInputElement | null>(null)

  const quote = searchParams.get('quote') ?? ''
  const resolvedDayId = dayId ?? ''
  const isReady = activeDay?.dayId === resolvedDayId
  const canSync = Boolean(syncStatus.connected && syncStatus.filePath)
  const todayId = getTodayId()
  const yesterdayId = addDays(todayId, -1)
  const tomorrowId = addDays(todayId, 1)
  const relativeLabel =
    dateValue === todayId ? 'Today' : dateValue === yesterdayId ? 'Yesterday' : dateValue === tomorrowId ? 'Tomorrow' : null
  const humanDateLabel = useMemo(() => {
    if (!dateValue) return ''
    return formatHumanDate(dateValue, todayId, { includeRelativeLabel: false })
  }, [dateValue, todayId])
  const compactDateLabel = useMemo(() => {
    if (!dateValue) return ''
    const date = parseDayId(dateValue)
    const day = `${date.getDate()}`.padStart(2, '0')
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    return `${day}/${month}/${date.getFullYear()}`
  }, [dateValue])

  const focusEditor = useCallback(() => {
    const view = editorViewRef.current
    if (!view) return
    const end = view.state.doc.length
    view.dispatch({ selection: EditorSelection.single(end), scrollIntoView: true })
    view.focus()
  }, [])

  const queueSync = useCallback(
    (context: string) => {
      if (syncTriggeredRef.current) return
      if (!canSync) return
      if (!navigator.onLine) {
        console.warn('[DayEditor] sync:offline', { context })
        return
      }

      syncTriggeredRef.current = true
      void (async () => {
        try {
          const result = await pushToSync()
          await loadSyncState()
          console.info('[DayEditor] sync:push', { context, status: result.status })
          if (result.status === 'blocked') {
            console.warn('[DayEditor] sync:blocked', { context })
          }
          if (result.status === 'pushed' || result.status === 'clean') {
            syncPendingRef.current = false
          }
        } catch (error) {
          console.warn('[DayEditor] sync:push-failed', { context, error })
        }
      })()
    },
    [canSync, loadSyncState],
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
    hasFocusedRef.current = false
  }, [resolvedDayId])

  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: 'transparent',
          minHeight: '70vh',
        },
        '.cm-scroller': {
          fontSize: '1.20rem',
          fontWeight: '400',
          fontFamily: "'CartographCF', ui-monospace, SFMono-Regular, Menlo, monospace",
          color: '#000000',
          overflow: 'visible',
        },
        '.cm-content': {
          minHeight: '70vh',
          padding: '24px 0 0',
        },
        '.cm-gutters': {
          display: 'none',
        },
      }),
    [],
  )
  const editorInputAttributes = useMemo(
    () =>
      EditorView.contentAttributes.of({
        autocapitalize: 'off',
        autocomplete: 'off',
        autocorrect: 'off',
        enterkeyhint: 'done',
        inputmode: 'text',
        spellcheck: 'false',
      }),
    [],
  )

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
    const highlight = EditorView.decorations.of(builder.finish())
    return { extensions: [highlight], found: true }
  }, [draft, quote])

  const clearActiveLine = useMemo(
    () =>
      EditorView.theme({
        '.cm-activeLine': {
          backgroundColor: 'transparent',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'transparent',
        },
      }),
    [],
  )

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
      if (!hasFocusedRef.current) {
        requestAnimationFrame(() => {
          focusEditor()
          hasFocusedRef.current = true
        })
      }
    }
  }, [activeDay, focusEditor, resolvedDayId])

  useEffect(() => {
    if (!resolvedDayId) return
    if (draft === activeDay?.contentMd) return

    const handle = window.setTimeout(() => {
      if (draft.trim()) {
        syncPendingRef.current = true
        void updateDayContent(resolvedDayId, draft)
      }
    }, 1000)

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
          queueSync('cleanup-delete')
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

        queueSync('cleanup')
      })()
    }
  }, [deleteDay, queueSync, resolvedDayId, updateDayContent])

  const commitDateChange = useCallback(
    async (nextDayId: string) => {
      if (!nextDayId || nextDayId === resolvedDayId) {
        setDateValue(resolvedDayId)
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
    },
    [draft, moveDayDate, navigate, resolvedDayId, updateDayContent],
  )

  const handleDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextDayId = event.target.value
    setDateValue(nextDayId)
    setDateError(null)
    void commitDateChange(nextDayId)
  }

  const handleDateKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  const handleClose = async () => {
    if (!resolvedDayId) return
    exitHandledRef.current = true

    if (!hasLoadedRef.current || initialContentRef.current === null) {
      queueSync('close')
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
      queueSync('close-delete')
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

    queueSync('close')
    navigate('/')
  }

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key !== 'Escape') return

      const activeElement = document.activeElement as HTMLElement | null
      const isEditable = Boolean(
        activeElement &&
          (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable),
      )

      if (isEditable) {
        activeElement?.blur()
        return
      }

      void handleClose()
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [handleClose])

  const handleDelete = async () => {
    if (!resolvedDayId) return
    exitHandledRef.current = true
    syncPendingRef.current = true
    await deleteDay(resolvedDayId)
    queueSync('delete')
    navigate('/')
  }

  const escapeKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Escape',
          run: () => {
            const view = editorViewRef.current
            if (view?.hasFocus) {
              view.contentDOM.blur()
              return true
            }
            return false
          },
        },
      ]),
    [],
  )

  if (!resolvedDayId) {
    return (
      <section className="rounded-[4px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-slate-500">Missing day id.</p>
      </section>
    )
  }

  if (!isReady) {
    return (
      <section className="rounded-[4px] bg-white/60 p-6 text-sm text-slate-500">
        Loading day...
      </section>
    )
  }

  return (
    <div className="flex flex-1 flex-col justify-center pt-4 pb-8">
      <section className="rounded-[4px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
          <div className="flex items-center gap-3">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22B3FF] shadow-sm transition hover:bg-[#22B3FF]/90"
              type="button"
              onClick={handleClose}
            >
              <img
                src="/arrow-back.svg"
                alt="Back"
                className="h-5 w-5"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-x-2 max-[640px]:gap-x-1 max-[370px]:w-full max-[370px]:justify-between">
            <div className="flex min-w-0 flex-nowrap items-center gap-x-2 max-[640px]:gap-x-1">
              {relativeLabel ? (
                <>
                  <span className="text-xl font-bold text-slate-900 max-[640px]:text-sm max-[370px]:text-base">
                    {relativeLabel}
                  </span>
                  {humanDateLabel && (
                    <span className="text-xl font-semibold text-slate-900 max-[370px]:hidden max-[640px]:text-sm">
                      {humanDateLabel}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {humanDateLabel && (
                    <span className="text-xl font-semibold text-slate-900 max-[370px]:hidden max-[640px]:text-sm">
                      {humanDateLabel}
                    </span>
                  )}
                  {compactDateLabel && (
                    <span className="hidden text-base font-semibold text-slate-900 max-[370px]:inline">
                      {compactDateLabel}
                    </span>
                  )}
                </>
              )}
            </div>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 max-[370px]:h-7 max-[370px]:w-7"
              type="button"
              aria-label="Pick date"
              onClick={() => {
                if (dateInputRef.current?.showPicker) {
                  dateInputRef.current.showPicker()
                  return
                }
                dateInputRef.current?.click()
              }}
            >
              <img src="/calendar.svg" alt="" className="h-4 w-4 max-[370px]:h-3.5 max-[370px]:w-3.5" />
            </button>
            <input
              ref={dateInputRef}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="sr-only"
              enterKeyHint="done"
              inputMode="text"
              spellCheck={false}
              type="date"
              value={dateValue}
              onChange={handleDateChange}
              onKeyDown={handleDateKeyDown}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            {loading && <span className="text-xs text-slate-400">Saving...</span>}
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 max-[370px]:h-7 max-[370px]:w-7"
              type="button"
              onClick={handleDelete}
              aria-label="Delete"
            >
              <img
                src="/trash.svg"
                alt=""
                className="h-4 w-4 max-[370px]:h-3.5 max-[370px]:w-3.5"
                style={{
                  filter:
                    'invert(29%) sepia(51%) saturate(2878%) hue-rotate(341deg) brightness(91%) contrast(95%)',
                }}
              />
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
        <div className="mt-4 overflow-hidden rounded-xl">
          <CodeMirror
            value={draft}
            extensions={[
              markdown(),
              editorTheme,
              editorInputAttributes,
              clearActiveLine,
              escapeKeymap,
              EditorView.lineWrapping,
              ...highlightData.extensions,
            ]}
            onChange={setDraft}
            onCreateEditor={(view) => {
              editorViewRef.current = view
            }}
            autoFocus
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
          />
        </div>
      </section>
    </div>
  )
}
