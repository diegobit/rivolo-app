import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView, keymap } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { createHighlightPlugin } from '../../lib/editor/searchHighlight'
import { todoKeymap, todoPointerHandler } from '../../lib/editor/todoExtensions'
import { editorHighlights } from '../../lib/editorHighlights'
import type { Day } from '../../lib/dayRepository'

type DayEditorCardProps = {
  day: Day
  shouldMountEditor: boolean
  isFuture: boolean
  isToday: boolean
  isYesterday: boolean
  isTomorrow: boolean
  heroReveal: boolean
  title: string
  humanDate: string
  datePart: string
  weekdayPart: string | undefined
  relativeLabel: string | null
  searchQuery: string
  quote: string | null
  dateError: string | null
  markdownExtension: Extension
  editorTheme: Extension
  clearActiveLine: Extension
  titleFontFamily: string
  previousDayId: string | null
  nextDayId: string | null
  onChange: (dayId: string, value: string) => void
  onBlur: (dayId: string, event?: FocusEvent) => void
  onDelete: (dayId: string) => void
  onDateChange: (dayId: string, nextDayId: string) => void
  onFocusDay: (dayId: string, position: 'start' | 'end') => void
  onRequestEditorMount: (dayId: string, position: 'start' | 'end') => void
  registerEditor: (dayId: string, view: EditorView | null) => void
  registerDayRef: (dayId: string, node: HTMLDivElement | null) => void
}

const DayEditorCard = memo(({
  day,
  shouldMountEditor,
  isFuture,
  isToday,
  isYesterday,
  isTomorrow,
  heroReveal,
  title,
  humanDate,
  datePart,
  weekdayPart,
  relativeLabel,
  searchQuery,
  quote,
  dateError,
  markdownExtension,
  editorTheme,
  clearActiveLine,
  titleFontFamily,
  previousDayId,
  nextDayId,
  onChange,
  onBlur,
  onDelete,
  onDateChange,
  onFocusDay,
  onRequestEditorMount,
  registerEditor,
  registerDayRef,
}: DayEditorCardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const searchHighlight = useMemo(() => createHighlightPlugin(searchQuery), [searchQuery])
  const quoteHighlight = useMemo(() => (quote ? createHighlightPlugin(quote) : null), [quote])
  const previewContent = useMemo(() => {
    const trimmed = day.contentMd.trim()
    if (!trimmed) {
      return ' '
    }

    return trimmed
      .split('\n')
      .slice(0, 14)
      .join('\n')
  }, [day.contentMd])

  useEffect(() => {
    return () => {
      registerEditor(day.dayId, null)
    }
  }, [day.dayId, registerEditor])

  useEffect(() => {
    if (!showDeleteMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return
      }
      setShowDeleteMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [showDeleteMenu])

  useEffect(() => {
    return () => {
      document.body.dataset.dayEditorFocus = 'false'
    }
  }, [])

  const navigationKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'ArrowUp',
          run: (view) => {
            if (!previousDayId) return false
            const { from, to } = view.state.selection.main
            if (from !== 0 || to !== 0) return false
            onFocusDay(previousDayId, 'end')
            return true
          },
        },
        {
          key: 'ArrowDown',
          run: (view) => {
            if (!nextDayId) return false
            const { from, to } = view.state.selection.main
            const end = view.state.doc.length
            if (from !== end || to !== end) return false
            onFocusDay(nextDayId, 'start')
            return true
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            view.contentDOM.blur()
            return true
          },
        },
      ]),
    [nextDayId, onFocusDay, previousDayId],
  )

  const editorExtensions = useMemo(() => {
    const extensions: Extension[] = [
      markdownExtension,
      editorTheme,
      clearActiveLine,
      EditorView.lineWrapping,
      navigationKeymap,
      todoKeymap,
      todoPointerHandler,
      ...editorHighlights,
    ]
    if (searchHighlight) {
      extensions.push(searchHighlight)
    }
    if (quoteHighlight) {
      extensions.push(quoteHighlight)
    }
    return extensions
  }, [clearActiveLine, editorTheme, markdownExtension, navigationKeymap, quoteHighlight, searchHighlight])

  const handleOpenDatePicker = () => {
    const input = dateInputRef.current
    if (!input) return
    const picker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker
    if (picker) {
      picker.call(input)
      return
    }
    input.focus()
    input.click()
  }

  const handleContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node
      registerDayRef(day.dayId, node)
    },
    [day.dayId, registerDayRef],
  )

  return (
    <div
      ref={handleContainerRef}
      data-scroll-target={isToday ? 'today' : undefined}
      className={`scroll-anchor group rounded-[4px] border p-4 transition ${
        heroReveal ? 'hero-reveal' : ''
      } ${
        isFuture
          ? 'border-dashed border-slate-200/60 bg-white/70 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-300/60'
          : 'border-slate-200/60 bg-white shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)] hover:border-slate-300/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="relative flex items-center gap-2 text-left" onClick={handleOpenDatePicker}>
          <h3
            className={`day-title ${
              isToday ? 'text-[1.8rem]' : isYesterday || isTomorrow ? 'text-[1.5rem]' : 'text-[1.3rem]'
            } ${isFuture ? 'opacity-70' : ''}`}
            style={{ fontFamily: titleFontFamily }}
          >
            {relativeLabel ? (
              <>
                <span className="font-bold text-[#113355]">{relativeLabel}</span>
                <span className="ml-2 font-normal text-[#8899aa]">{humanDate}</span>
              </>
            ) : weekdayPart ? (
              <>
                <span className="font-bold text-[#113355]">{datePart}</span>
                <span className="ml-2 font-normal text-[#8899aa]">{weekdayPart}</span>
              </>
            ) : (
              <span className="font-bold text-[#113355]">{title}</span>
            )}
          </h3>
          <input
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            type="date"
            aria-label={`Change date for ${day.dayId}`}
            value={day.dayId}
            ref={dateInputRef}
            onChange={(event) => void onDateChange(day.dayId, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <div ref={menuRef} className="relative touch-actions">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300"
              type="button"
              aria-label="Open note actions"
              onClick={() => setShowDeleteMenu((state) => !state)}
            >
              <img src="/dots-three.svg" alt="" className="h-4 w-4 opacity-70" />
            </button>
            {showDeleteMenu && (
              <div className="absolute right-0 top-10 z-10 min-w-[150px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                  type="button"
                  onClick={() => {
                    setShowDeleteMenu(false)
                    void onDelete(day.dayId)
                  }}
                >
                  <img
                    src="/trash.svg"
                    alt=""
                    className="h-4 w-4"
                    style={{
                      filter:
                        'invert(29%) sepia(51%) saturate(2878%) hue-rotate(341deg) brightness(91%) contrast(95%)',
                    }}
                  />
                  Delete note
                </button>
              </div>
            )}
          </div>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white opacity-0 shadow-sm transition hover:border-slate-300 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 touch-hide pointer-events-none"
            type="button"
            aria-label="Delete"
            onClick={() => {
              void onDelete(day.dayId)
            }}
          >
            <img
              src="/trash.svg"
              alt=""
              className="h-4 w-4"
              style={{
                filter:
                  'invert(29%) sepia(51%) saturate(2878%) hue-rotate(341deg) brightness(91%) contrast(95%)',
              }}
            />
          </button>
        </div>
      </div>
      {dateError && (
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {dateError}
        </div>
      )}
      <div className="mt-3 overflow-hidden rounded-xl">
        {shouldMountEditor ? (
          <CodeMirror
            value={day.contentMd}
            extensions={editorExtensions}
            onChange={(value) => onChange(day.dayId, value)}
            onFocus={() => {
              document.body.dataset.dayEditorFocus = 'true'
            }}
            onBlur={(event) => void onBlur(day.dayId, event.nativeEvent)}
            onCreateEditor={(view) => registerEditor(day.dayId, view)}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
          />
        ) : (
          <button
            className="block min-h-[34px] w-full cursor-text rounded-xl border border-slate-100 bg-white px-2 py-1 text-left text-[0.98rem] leading-6 text-slate-700 transition hover:border-slate-200"
            type="button"
            aria-label={`Edit note for ${day.dayId}`}
            onClick={() => onRequestEditorMount(day.dayId, 'end')}
          >
            <pre className="max-h-64 overflow-hidden whitespace-pre-wrap break-words font-inherit text-inherit">
              {previewContent}
            </pre>
          </button>
        )}
      </div>
    </div>
  )
})

export default DayEditorCard
