import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent } from 'react'

export type AuthorControl = {
  selected: string | null
  names: string[]
  loading: boolean
  failed: boolean
  onChange: (author: string | null) => void
}

const keepFieldFocus = (event: MouseEvent) => event.preventDefault()

const authorIcon = (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden="true">
    <circle cx="10" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 16v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export function useAuthorSearchControl(control: AuthorControl | undefined, layout: 'card' | 'composer') {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const keyboardOpen = useRef(false)
  const mobile = layout === 'composer'

  useEffect(() => {
    if (!open) return
    if (keyboardOpen.current) menu.current?.querySelector('button')?.focus()
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (menu.current?.contains(document.activeElement)) trigger.current?.focus()
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])

  if (!control) return {}
  const { selected, names, loading, failed, onChange } = control
  const choose = (name: string | null) => {
    if (menu.current?.contains(document.activeElement)) trigger.current?.focus()
    setOpen(false)
    onChange(name)
  }

  return {
    authorChip: (
      <button ref={trigger} type="button"
        className={`search-author-chip shrink-0 ${mobile ? '' : 'capsule-chip'}`}
        data-active={Boolean(selected) || open}
        aria-label={selected ? `Remove ${selected} author filter` : undefined}
        aria-expanded={selected ? undefined : open}
        aria-controls={open ? menuId : undefined}
        onMouseDown={mobile ? keepFieldFocus : undefined}
        onClick={(event) => {
          if (selected) return choose(null)
          keyboardOpen.current = event.detail === 0
          setOpen(!open)
        }}>
        {!selected && authorIcon}
        <span className="truncate">{selected ?? 'Authors'}</span>
        <span className="shrink-0" aria-hidden="true">{selected ? '×' : '⌄'}</span>
      </button>
    ),
    authorPicker: open && (
      <div ref={menu} id={menuId} role="group" aria-label="Authors"
        className={`tray-phone-filter-menu search-author-picker ${mobile ? '' : 'search-author-picker-card'}`}
        onMouseDown={mobile ? keepFieldFocus : undefined}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false)
        }}>
        <p className="px-3 py-2 text-base font-semibold">Authors</p>
        {loading || failed || names.length === 0 ? (
          <p role="status" className="px-3 pb-3 text-sm text-[var(--theme-text-soft)]">
            {loading ? 'Loading authors…' : failed ? 'Could not load authors.' : 'No note authors yet.'}
          </p>
        ) : (
          <div className="search-author-options">
            <button type="button" className="search-author-option" onClick={() => choose(null)}>
              {authorIcon} All authors <span className="ml-auto text-[var(--theme-accent-text)]" aria-hidden="true">✓</span>
            </button>
            {names.map((name) => (
              <button key={name} type="button" className="search-author-option" onClick={() => choose(name)}>
                <span aria-hidden="true" className="search-author-avatar">
                  {name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toLocaleUpperCase()}
                </span>
                <span className="break-all">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    ),
  }
}
