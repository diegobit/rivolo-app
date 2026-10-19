import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Within this distance of the end, the reader counts as following the latest.
const AT_BOTTOM_THRESHOLD_PX = 48

type ScrollDirection = -1 | 1

type WheelScrollIntent = {
  direction: ScrollDirection
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Keeps a scrolling message list on its newest content while the reader is at
 * the bottom, and reports unseen content instead when they have scrolled up.
 * `contentKey` should change whenever the list's content grows.
 */
export const useStickToBottom = (active: boolean, contentKey: string) => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const wheelScrollIntentsRef = useRef<WheelScrollIntent[]>([])
  const userScrollIntentRef = useRef(false)
  const activeTouchRef = useRef(false)
  const activeScrollbarPointerRef = useRef(false)
  const inputResetFrameRef = useRef<number | null>(null)
  const wasActiveRef = useRef(false)
  const contentKeyRef = useRef(contentKey)
  const [seenContentKey, setSeenContentKey] = useState(contentKey)

  useEffect(() => {
    followingRef.current = following
  }, [following])

  const scrollToBottom = useCallback(() => {
    const element = ref.current
    if (!element) return
    wheelScrollIntentsRef.current = []
    element.scrollTop = element.scrollHeight
    lastScrollTopRef.current = element.scrollTop
    followingRef.current = true
    setFollowing(true)
    setSeenContentKey(contentKey)
  }, [contentKey])

  const onScroll = useCallback(() => {
    const element = ref.current
    if (!element) return
    const currentScrollTop = element.scrollTop
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_BOTTOM_THRESHOLD_PX
    const wheelScrollIntents = wheelScrollIntentsRef.current
    const wheelInitiated = wheelScrollIntents.some(intent => {
      if (element.scrollHeight !== intent.scrollHeight || element.clientHeight !== intent.clientHeight) return false
      return intent.direction < 0 ? element.scrollTop < intent.scrollTop : element.scrollTop > intent.scrollTop
    })
    wheelScrollIntentsRef.current = wheelScrollIntents.filter(intent =>
      currentScrollTop === intent.scrollTop &&
      element.scrollHeight === intent.scrollHeight &&
      element.clientHeight === intent.clientHeight,
    )
    const userInitiated = userScrollIntentRef.current || wheelInitiated || activeTouchRef.current || activeScrollbarPointerRef.current
    userScrollIntentRef.current = false
    lastScrollTopRef.current = currentScrollTop
    if (!userInitiated) return

    // A reader leaving the bottom has seen everything up to now, even content
    // that arrived without moving the list (e.g. a stream finishing in place).
    if (atBottom || followingRef.current) setSeenContentKey(contentKey)
    followingRef.current = atBottom
    setFollowing(atBottom)
  }, [contentKey])

  useEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const markWheelScrollIntent = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      const direction: ScrollDirection = event.deltaY < 0 ? -1 : 1
      const maxScrollTop = element.scrollHeight - element.clientHeight
      const currentScrollTop = element.scrollTop
      const lastScrollTop = lastScrollTopRef.current
      const movedBeforeWheelHandler = direction < 0
        ? currentScrollTop < lastScrollTop && lastScrollTop > 0
        : currentScrollTop > lastScrollTop && lastScrollTop < maxScrollTop
      const canScrollFromCurrentPosition = direction < 0
        ? currentScrollTop > 0
        : currentScrollTop < maxScrollTop
      if (!movedBeforeWheelHandler && !canScrollFromCurrentPosition) return

      const intent: WheelScrollIntent = {
        direction,
        scrollTop: movedBeforeWheelHandler ? lastScrollTop : currentScrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }
      const duplicate = wheelScrollIntentsRef.current.some(existing =>
        existing.direction === intent.direction &&
        existing.scrollTop === intent.scrollTop &&
        existing.scrollHeight === intent.scrollHeight &&
        existing.clientHeight === intent.clientHeight,
      )
      if (!duplicate) wheelScrollIntentsRef.current.push(intent)
    }
    const markKeyboardScrollIntent = () => {
      userScrollIntentRef.current = true
      if (inputResetFrameRef.current !== null) {
        window.cancelAnimationFrame(inputResetFrameRef.current)
      }
      inputResetFrameRef.current = window.requestAnimationFrame(() => {
        userScrollIntentRef.current = false
        inputResetFrameRef.current = null
      })
    }
    const handlePointerDown = (event: PointerEvent) => {
      // A pointer on the scrollport itself is the native scrollbar. Ignore
      // pointer activity in message content so selecting text is not a scroll.
      if (event.target === element) activeScrollbarPointerRef.current = true
    }
    const handlePointerUp = () => {
      activeScrollbarPointerRef.current = false
    }
    const handleTouchStart = () => {
      activeTouchRef.current = true
    }
    const handleTouchEnd = () => {
      activeTouchRef.current = false
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!element.contains(event.target as Node)) return
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) {
        markKeyboardScrollIntent()
      }
    }
    const clearInputFrame = () => {
      if (inputResetFrameRef.current === null) return
      window.cancelAnimationFrame(inputResetFrameRef.current)
      inputResetFrameRef.current = null
    }

    element.addEventListener('wheel', markWheelScrollIntent, { passive: true })
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    element.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    element.addEventListener('keydown', handleKeyDown)
    return () => {
      element.removeEventListener('wheel', markWheelScrollIntent)
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchEnd)
      element.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      element.removeEventListener('keydown', handleKeyDown)
      activeTouchRef.current = false
      activeScrollbarPointerRef.current = false
      userScrollIntentRef.current = false
      wheelScrollIntentsRef.current = []
      clearInputFrame()
    }
  }, [active])

  // Retire a wheel intent that never moved the list before new content changes
  // its layout. A matching position change remains pending until its scroll
  // event arrives, even if the browser delivers that event after a frame.
  useLayoutEffect(() => {
    if (contentKeyRef.current === contentKey) return
    const element = ref.current
    if (element) {
      wheelScrollIntentsRef.current = wheelScrollIntentsRef.current.flatMap(intent => {
        const movedInDirection = intent.direction < 0
          ? element.scrollTop < intent.scrollTop
          : element.scrollTop > intent.scrollTop
        return movedInDirection
          ? [{ ...intent, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }]
          : []
      })
    } else {
      wheelScrollIntentsRef.current = []
    }
    contentKeyRef.current = contentKey
  }, [contentKey])

  // Opening the list starts at the latest message and clears stale unseen state.
  useLayoutEffect(() => {
    if (!active) {
      wasActiveRef.current = false
      return
    }
    if (!ref.current || wasActiveRef.current) return
    wasActiveRef.current = true
    wheelScrollIntentsRef.current = []
    ref.current.scrollTop = ref.current.scrollHeight
    lastScrollTopRef.current = ref.current.scrollTop
    followingRef.current = true
    queueMicrotask(() => {
      setFollowing(true)
      setSeenContentKey(contentKey)
    })
  }, [active, contentKey])

  useLayoutEffect(() => {
    if (!active || !following || !ref.current) return
    ref.current.scrollTop = ref.current.scrollHeight
    lastScrollTopRef.current = ref.current.scrollTop
  }, [active, contentKey, following])

  // Layout changes (a narrower window rewrapping messages, a taller composer
  // shrinking the list) move the end without any content change. Re-anchor so
  // the reflow is not mistaken for the reader scrolling up.
  useEffect(() => {
    const element = ref.current
    if (!active || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) {
        element.scrollTop = element.scrollHeight
        lastScrollTopRef.current = element.scrollTop
      }
    })
    observer.observe(element)
    // Rewrapping changes each message row's height without changing the
    // scrollport's own box. Observe the rows too so following survives those
    // layout changes on engines that do not report scrollHeight changes.
    const observedChildren = new Set<Element>()
    const observeChildren = () => {
      const currentChildren = new Set(Array.from(element.children))
      for (const child of observedChildren) {
        if (currentChildren.has(child)) continue
        observer.unobserve(child)
        observedChildren.delete(child)
      }
      for (const child of currentChildren) {
        if (observedChildren.has(child)) continue
        observedChildren.add(child)
        observer.observe(child)
      }
    }
    observeChildren()
    const mutations = new MutationObserver(observeChildren)
    mutations.observe(element, { childList: true })
    return () => {
      mutations.disconnect()
      observer.disconnect()
    }
  }, [active])

  return {
    ref,
    onScroll,
    following,
    hasUnseen: active && !following && contentKey !== seenContentKey,
    scrollToBottom,
  }
}
