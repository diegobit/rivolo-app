import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Within this distance of the end, the reader counts as following the latest.
const AT_BOTTOM_THRESHOLD_PX = 48

/**
 * Keeps a scrolling message list on its newest content while the reader is at
 * the bottom, and reports unseen content instead when they have scrolled up.
 * `contentKey` should change whenever the list's content grows.
 */
export const useStickToBottom = (active: boolean, contentKey: string) => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const [seenContentKey, setSeenContentKey] = useState(contentKey)

  useEffect(() => {
    followingRef.current = following
  }, [following])

  const scrollToBottom = useCallback(() => {
    const element = ref.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    setFollowing(true)
    setSeenContentKey(contentKey)
  }, [contentKey])

  const onScroll = useCallback(() => {
    const element = ref.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_BOTTOM_THRESHOLD_PX
    // A reader leaving the bottom has seen everything up to now, even content
    // that arrived without moving the list (e.g. a stream finishing in place).
    if (atBottom || followingRef.current) setSeenContentKey(contentKey)
    setFollowing(atBottom)
  }, [contentKey])

  // Opening the list starts at the latest message; the resulting scroll event
  // marks the reader as following again.
  useLayoutEffect(() => {
    if (!active || !ref.current) return
    ref.current.scrollTop = ref.current.scrollHeight
  }, [active])

  useLayoutEffect(() => {
    if (!active || !following || !ref.current) return
    ref.current.scrollTop = ref.current.scrollHeight
  }, [active, contentKey, following])

  // Layout changes (a narrower window rewrapping messages, a taller composer
  // shrinking the list) move the end without any content change. Re-anchor so
  // the reflow is not mistaken for the reader scrolling up.
  useEffect(() => {
    const element = ref.current
    if (!active || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [active])

  return {
    ref,
    onScroll,
    following,
    hasUnseen: active && !following && contentKey !== seenContentKey,
    scrollToBottom,
  }
}
