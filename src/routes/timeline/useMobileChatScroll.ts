import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD = 48
const SCROLL_IDLE_MS = 160

type Anchor = { element: HTMLElement; top: number }

export function useMobileChatScroll(active: boolean, contentKey: string) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const touchingRef = useRef(false)
  const movingRef = useRef(false)
  const pendingRef = useRef(false)
  const anchorRef = useRef<Anchor | null>(null)
  const idleTimerRef = useRef<number | null>(null)
  const latestKeyRef = useRef(contentKey)
  const seenKeyRef = useRef(contentKey)
  const [following, setFollowing] = useState(true)
  const [hasUnseen, setHasUnseen] = useState(false)

  useLayoutEffect(() => {
    latestKeyRef.current = contentKey
  }, [contentKey])

  const maxScroll = useCallback(() => {
    const element = scrollerRef.current
    return element ? Math.max(0, element.scrollHeight - element.clientHeight) : 0
  }, [])

  const captureAnchor = useCallback(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const scrollerTop = scroller.getBoundingClientRect().top
    const children = Array.from(content.children) as HTMLElement[]
    const firstVisible = children.find((child) => child.getBoundingClientRect().bottom > scrollerTop)
    anchorRef.current = firstVisible
      ? { element: firstVisible, top: firstVisible.getBoundingClientRect().top - scrollerTop }
      : null
  }, [])

  const reconcile = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || touchingRef.current || movingRef.current) {
      pendingRef.current = true
      return
    }
    pendingRef.current = false
    if (followingRef.current) {
      scroller.scrollTop = maxScroll()
      seenKeyRef.current = latestKeyRef.current
      setHasUnseen(false)
    } else if (anchorRef.current?.element.isConnected) {
      const { element, top } = anchorRef.current
      const nextTop = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      scroller.scrollTop = Math.max(0, Math.min(maxScroll(), scroller.scrollTop + nextTop - top))
      captureAnchor()
    }
  }, [captureAnchor, maxScroll])

  const scrollToBottom = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    followingRef.current = true
    setFollowing(true)
    seenKeyRef.current = latestKeyRef.current
    setHasUnseen(false)
    scroller.scrollTop = maxScroll()
  }, [maxScroll])

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const top = Math.max(0, Math.min(maxScroll(), scroller.scrollTop))
    const atBottom = maxScroll() - top <= BOTTOM_THRESHOLD
    followingRef.current = atBottom
    setFollowing(atBottom)
    if (atBottom) {
      seenKeyRef.current = latestKeyRef.current
      setHasUnseen(false)
    } else {
      captureAnchor()
    }
    if (touchingRef.current || movingRef.current) {
      movingRef.current = true
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(() => {
        movingRef.current = false
        if (pendingRef.current) reconcile()
      }, SCROLL_IDLE_MS)
    }
  }, [captureAnchor, maxScroll, reconcile])

  const onTouchStart = useCallback(() => {
    touchingRef.current = true
    movingRef.current = true
  }, [])

  const onTouchEnd = useCallback(() => {
    touchingRef.current = false
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => {
      movingRef.current = false
      if (pendingRef.current) reconcile()
    }, SCROLL_IDLE_MS)
  }, [reconcile])

  useLayoutEffect(() => {
    if (!active) return
    // Position the chat before paint when its overlay opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    scrollToBottom()
  }, [active, scrollToBottom])

  useLayoutEffect(() => {
    if (!active) return
    // Unseen state and scroll position must update with the rendered message.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!followingRef.current && contentKey !== seenKeyRef.current) setHasUnseen(true)
    reconcile()
  }, [active, contentKey, reconcile])

  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!active || !scroller || !content) return
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reconcile)
    observer?.observe(scroller)
    observer?.observe(content)
    window.addEventListener('resize', reconcile)
    window.visualViewport?.addEventListener('resize', reconcile)
    window.visualViewport?.addEventListener('scroll', reconcile)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', reconcile)
      window.visualViewport?.removeEventListener('resize', reconcile)
      window.visualViewport?.removeEventListener('scroll', reconcile)
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
      touchingRef.current = false
      movingRef.current = false
      pendingRef.current = false
    }
  }, [active, reconcile])

  return { scrollerRef, contentRef, onScroll, onTouchStart, onTouchEnd, following, hasUnseen, scrollToBottom }
}
