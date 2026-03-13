export const NARROW_VIEWPORT_MEDIA_QUERY = '(max-width: 699px)'

export const isNarrowViewport = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia(NARROW_VIEWPORT_MEDIA_QUERY).matches
}

export const getNarrowViewportMediaQuery = () => window.matchMedia(NARROW_VIEWPORT_MEDIA_QUERY)
