import { useEffect, useState } from 'react'
import { getNarrowViewportMediaQuery, isNarrowViewport } from '../lib/viewport'

export const useIsNarrowViewport = () => {
  const [isNarrowViewportMode, setIsNarrowViewportMode] = useState(() => isNarrowViewport())

  useEffect(() => {
    const mediaQuery = getNarrowViewportMediaQuery()

    const updateViewport = () => {
      setIsNarrowViewportMode(mediaQuery.matches)
    }

    updateViewport()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateViewport)
      return () => {
        mediaQuery.removeEventListener('change', updateViewport)
      }
    }

    mediaQuery.addListener(updateViewport)
    return () => {
      mediaQuery.removeListener(updateViewport)
    }
  }, [])

  return isNarrowViewportMode
}
