import { useCallback, useLayoutEffect, useRef, useState } from 'react'

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
  const [seenContentKey, setSeenContentKey] = useState(contentKey)

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
    setFollowing(atBottom)
    if (atBottom) setSeenContentKey(contentKey)
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

  return {
    ref,
    onScroll,
    hasUnseen: active && !following && contentKey !== seenContentKey,
    scrollToBottom,
  }
}
